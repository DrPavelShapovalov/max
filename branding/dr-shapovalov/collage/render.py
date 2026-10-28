"""Before/after collages for @dr__shapovalov — house style.

Usage:  python3 render.py case.json
The case file lists every photo with hand-measured landmarks (see case.example.json
and README.md). Output: one 1080x1440 JPEG per slide, next to the case file.
"""
import io, json, os, sys
import cairosvg
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps
from fit import solve
from fonts import manrope

HERE = os.path.dirname(os.path.abspath(__file__))
MARK_SVG = os.path.join(HERE, '..', 'mark-dark.svg')

# 3:4 canvas; header and footer sit inside the central 4:5 band so a 4:5 crop loses nothing.
W, H = 1080, 1440
BG, INK, MUTED, WHITE = (244, 243, 240), (22, 24, 26), (138, 135, 129), (255, 255, 255)
TOP, HEAD, GAP_H, GAP_F, FOOT, BOTTOM, GUT, SIDE = 56, 64, 22, 26, 40, 56, 14, 56
GRID_TOP = TOP + HEAD + GAP_H
GRID_H = H - GRID_TOP - GAP_F - FOOT - BOTTOM
RADIUS, SS = 20, 3
HANDLE = '@dr__shapovalov'

F_TITLE = ImageFont.truetype(manrope(800), 36)
F_SUB = ImageFont.truetype(manrope(500), 36)
F_PILL = ImageFont.truetype(manrope(800), 17)
F_HANDLE = ImageFont.truetype(manrope(700), 21)
F_BADGE = ImageFont.truetype(manrope(800), 40)
F_BADGE_CAP = ImageFont.truetype(manrope(600), 16)


def open_upright(path):
    # Landmarks are measured on the image as it displays, i.e. after EXIF rotation.
    return ImageOps.exif_transpose(Image.open(path)).convert('RGB')


def load(photo, base):
    """Opens a photo, blacks out the eyes (supersampled circles), applies "precrop"."""
    img = open_upright(os.path.join(base, photo['file']))
    circles = photo.get('eyes', [])
    if circles:
        big = Image.new('L', (img.width * 4, img.height * 4), 0)
        d = ImageDraw.Draw(big)
        for cx, cy, r in circles:
            d.ellipse([(cx - r) * 4, (cy - r) * 4, (cx + r) * 4, (cy + r) * 4], fill=255)
        img.paste((0, 0, 0), (0, 0), big.resize(img.size, Image.LANCZOS))
    if photo.get('precrop'):
        img = img.crop(tuple(photo['precrop']))
    if photo.get('pad'):
        l, t, rr, b = photo['pad']
        color = photo.get('pad_color', 'edge')
        grown = Image.new('RGB', (img.width + l + rr, img.height + t + b),
                          tuple(color) if color != 'edge' else (0, 0, 0))
        if color == 'edge':
            # Continue the background by smearing the outermost pixel column/row
            # (softened vertically/horizontally), so the extension has no visible seam.
            if l:
                col = img.crop((0, 0, 1, img.height)).filter(ImageFilter.GaussianBlur(3))
                grown.paste(col.resize((l, img.height)), (0, t))
            if rr:
                col = img.crop((img.width - 1, 0, img.width, img.height)).filter(ImageFilter.GaussianBlur(3))
                grown.paste(col.resize((rr, img.height)), (l + img.width, t))
            if t:
                row = img.crop((0, 0, img.width, 1)).filter(ImageFilter.GaussianBlur(3))
                grown.paste(row.resize((img.width, t)), (l, 0))
            if b:
                row = img.crop((0, img.height - 1, img.width, img.height)).filter(ImageFilter.GaussianBlur(3))
                grown.paste(row.resize((img.width, b)), (l, t + img.height))
        grown.paste(img, (l, t))
        img = grown
    return img


def shifted(photo, size):
    """Landmarks are measured on the full image; "precrop" (e.g. a screenshot's frame)
    moves the origin, so the solver gets coordinates inside the cropped area."""
    q = dict(photo)
    ox, oy, w, h = 0, 0, size[0], size[1]
    if photo.get('precrop'):
        l, t, r, b = photo['precrop']
        ox, oy, w, h = -l, -t, r - l, b - t
    if photo.get('pad'):
        # Background strip added on the given sides (plain wall / black), never anatomy.
        l, t, r, b = photo['pad']
        ox, oy, w, h = ox + l, oy + t, w + l + r, h + t + b
    q['anchor'] = [photo['anchor'][0] + ox, photo['anchor'][1] + oy]
    q['include'] = [[x + ox, y + oy] for x, y in photo['include']]
    q['size'] = (w, h)
    return q


def _offset(photo):
    """Shift from source coordinates to the loaded (precropped/padded) image."""
    ox = oy = 0
    if photo.get('precrop'):
        ox -= photo['precrop'][0]; oy -= photo['precrop'][1]
    if photo.get('pad'):
        ox += photo['pad'][0]; oy += photo['pad'][1]
    return ox, oy


def skin_tone(img, photo):
    """Median RGB over the "skin" boxes (cheeks/forehead, clear of eye plates)."""
    ox, oy = _offset(photo)
    chans = ([], [], [])
    for l, t, r_, b in photo['skin']:
        patch = img.crop((l + ox, t + oy, r_ + ox, b + oy)).convert('RGB')
        for store, ch in zip(chans, patch.split()):
            store.extend(ch.tobytes())
    return [sorted(c)[len(c) // 2] for c in chans]


def match_skin(img, photo, ref_img, ref_photo):
    """Per-channel gains so the skin of img matches ref's skin. Multiplicative,
    so black stays black; it corrects lighting/white balance, not anatomy."""
    src, dst = skin_tone(img, photo), skin_tone(ref_img, ref_photo)
    gains = [d / max(s, 1) for s, d in zip(src, dst)]
    print(f'  skin match {photo["file"]}: gains {[round(g, 3) for g in gains]}')
    return Image.merge('RGB', [ch.point(lambda v, g=g: min(255, int(v * g + 0.5)))
                               for ch, g in zip(img.split(), gains)])


def rounded_mask(size, r):
    m = Image.new('L', (size[0] * SS, size[1] * SS), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, m.width - 1, m.height - 1], r * SS, fill=255)
    return m.resize(size, Image.LANCZOS)


def tracked(draw, x, y, text, font, fill, track):
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + track


def pill(canvas, x, y, label, dark):
    d = ImageDraw.Draw(canvas)
    tw = sum(d.textlength(c, font=F_PILL) for c in label) + 1.6 * (len(label) - 1)
    w, h = int(tw + 30), 34
    layer = Image.new('RGBA', (w * SS, h * SS), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle([0, 0, w * SS - 1, h * SS - 1], h * SS // 2,
                                            fill=INK + (235,) if dark else WHITE + (240,),
                                            outline=None if dark else INK + (40,), width=SS)
    layer = layer.resize((w, h), Image.LANCZOS)
    canvas.paste(layer, (x, y), layer)
    tracked(d, x + 15, y + 7, label, F_PILL, WHITE if dark else INK, 1.6)


def enhance(im, kind):
    """Levels, colour and sharpness only: nothing is added to or removed from the anatomy."""
    if kind == 'photo':
        im = ImageOps.autocontrast(im, cutoff=0.5)
        im = ImageEnhance.Brightness(im).enhance(1.04)
        im = ImageEnhance.Color(im).enhance(1.08)
    elif kind == 'sharpen':
        pass
    elif kind == 'ct':
        im = ImageOps.autocontrast(im, cutoff=0.3, preserve_tone=True)   # keeps greyscale grey
    return im.filter(ImageFilter.UnsharpMask(radius=1.4, percent=70, threshold=2))


def badge(canvas, x, y, w, h, value, caption, dark):
    """Big measurement plate in the photo's bottom-right corner."""
    d = ImageDraw.Draw(canvas)
    vw = d.textlength(value, font=F_BADGE); cw_ = d.textlength(caption, font=F_BADGE_CAP)
    bw, bh = int(max(vw, cw_) + 36), 88
    bx, by = x + w - bw - 14, y + h - bh - 14
    layer = Image.new('RGBA', (bw * SS, bh * SS), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle([0, 0, bw * SS - 1, bh * SS - 1], 16 * SS,
                                            fill=INK + (235,) if dark else WHITE + (242,))
    layer = layer.resize((bw, bh), Image.LANCZOS)
    canvas.paste(layer, (bx, by), layer)
    fg = WHITE if dark else INK
    d.text((bx + 18, by + 14), caption, font=F_BADGE_CAP, fill=(200, 200, 200) if dark else MUTED)
    d.text((bx + 18, by + 34), value, font=F_BADGE, fill=fg)


def place(canvas, img, box, x, y, w, h, label, dark, photo=None):
    im = img.resize((w, h), Image.LANCZOS, box=box)   # box aspect == w/h, so scale is uniform
    if photo and photo.get('enhance'):
        im = enhance(im, photo['enhance'])
    canvas.paste(im, (x, y), rounded_mask((w, h), RADIUS))
    pill(canvas, x + 14, y + 14, label, dark)
    if photo and photo.get('badge'):
        b = photo['badge']
        badge(canvas, x, y, w, h, b['value'], b.get('caption', ''), dark)


WM_H = 66                     # footer watermark height; stays inside the 4:5 safe band


def header_footer(canvas, title, subtitle, watermark=None):
    d = ImageDraw.Draw(canvas)
    sub = f' · {subtitle}'
    tw = d.textlength(title, font=F_TITLE) + d.textlength(sub, font=F_SUB)
    x, base = (W - tw) / 2, TOP + 44
    d.text((x, base), title, font=F_TITLE, fill=INK, anchor='ls')
    d.text((x + d.textlength(title, font=F_TITLE), base), sub, font=F_SUB, fill=MUTED, anchor='ls')
    hw = d.textlength(HANDLE, font=F_HANDLE)
    if watermark:
        # Watermark lives in the footer strip under the grid, never on a photo,
        # so it can never cover a patient's face.
        wm = Image.open(watermark).convert('RGBA')
        wm = wm.resize((int(wm.width * WM_H / wm.height), WM_H), Image.LANCZOS)
        grid_bottom = H - GAP_F - FOOT - BOTTOM
        cy = (grid_bottom + (H - BOTTOM + 11)) // 2
        gap = 18
        fx = int((W - (wm.width + gap + hw)) / 2)
        canvas.paste(wm, (fx, cy - WM_H // 2), wm)
        d.text((fx + wm.width + gap, cy + 2), HANDLE, font=F_HANDLE, fill=INK, anchor='lm')
        return
    png = cairosvg.svg2png(url=MARK_SVG, output_width=34 * SS, output_height=34 * SS)
    mark = Image.open(io.BytesIO(png)).convert('RGBA').resize((34, 34), Image.LANCZOS)
    fx, fy = int((W - (34 + 10 + hw)) / 2), H - BOTTOM - FOOT + 3
    canvas.paste(mark, (fx, fy), mark)
    d.text((fx + 44, fy + 17), HANDLE, font=F_HANDLE, fill=INK, anchor='lm')


def fitted(pair, w, h, margin, base, zoom='in'):
    pair = [shifted(p, open_upright(os.path.join(base, p['file'])).size) for p in pair]
    r = solve(pair, w, h, margin=margin, zoom=zoom)
    if r is None:
        raise SystemExit(f'No crop fits {w}x{h} for {[p["file"] for p in pair]}: '
                         'loosen "include" points or change the layout.')
    if r['mismatch'] > 1.0:
        print(f'  scale mismatch {r["mismatch"]} for {[p["file"] for p in pair]}')
    for p, b in zip(pair, r['boxes']):
        up = w / (b[2] - b[0])
        if up > 1.3:
            print(f'  warning: {p["file"]} enlarged x{up:.2f}, may look soft')
    return [load(p, base) for p in pair], r['boxes']


def slide_pairs(slide, labels, base):
    """Every row is a before|after pair; all boxes share one size."""
    rows = slide['rows']
    free = GRID_H - (len(rows) - 1) * GUT
    weights = slide.get('row_weights', [1] * len(rows))
    heights = [int(free * wgt / sum(weights)) for wgt in weights]
    cw = min(slide.get('max_width', (W - 2 * SIDE - GUT) // 2), (W - 2 * SIDE - GUT) // 2)
    x0 = (W - (2 * cw + GUT)) // 2
    c = Image.new('RGB', (W, H), BG)
    y = GRID_TOP
    independent = set(slide.get('independent_rows', []))
    for i, (row, rh) in enumerate(zip(rows, heights)):
        if i in independent:
            # Photos shot so differently that a shared scale is meaningless: frame each on its own.
            fits = [fitted([p], cw, rh, slide.get('margin', 0.025), base, slide.get('zoom', 'in')) for p in row]
            imgs, boxes = [f[0][0] for f in fits], [f[1][0] for f in fits]
        else:
            imgs, boxes = fitted(row, cw, rh, slide.get('margin', 0.025), base, slide.get('zoom', 'in'))
        mode = slide.get('match_skin')
        if mode and all(p.get('skin') for p in row):
            if mode == 'all':
                # Every face on the slide takes the skin tone of the first "before" photo.
                if i == 0:
                    ref = (imgs[0], row[0])
                else:
                    imgs = [match_skin(imgs[0], row[0], *ref), imgs[1]]
            else:
                ref = (imgs[0], row[0])
            imgs = [imgs[0], match_skin(imgs[1], row[1], *ref)]
        for j in range(2):
            place(c, imgs[j], boxes[j], x0 + j * (cw + GUT), y, cw, rh, labels[j], j == 1, row[j])
        y += rh + GUT
    return c


def slide_pair_then_stacked(slide, labels, base):
    """Row 1: before|after pair. Row 2: one pair shown full-width, before above after."""
    cw = (W - 2 * SIDE - GUT) // 2
    full = 2 * cw + GUT
    h1 = slide.get('first_row_height', 340)
    h2 = (GRID_H - h1 - 2 * GUT) // 2
    c = Image.new('RGB', (W, H), BG)
    imgs, boxes = fitted(slide['rows'][0], cw, h1, slide.get('margin', 0.03), base)
    for j in range(2):
        place(c, imgs[j], boxes[j], SIDE + j * (cw + GUT), GRID_TOP, cw, h1, labels[j], j == 1, slide['rows'][0][j])
    imgs, boxes = fitted(slide['rows'][1], full, h2, slide.get('margin', 0.03), base)
    for j in range(2):
        place(c, imgs[j], boxes[j], SIDE, GRID_TOP + h1 + GUT + j * (h2 + GUT), full, h2, labels[j], j == 1,
              slide['rows'][1][j])
    return c


def slide_justified(slide, labels, base):
    """Each row: before|after at one height, widths follow each photo's own "crop" aspect,
    so nothing inside the crop is cut to fit a shared frame. Rows fill the grid width;
    if they overflow the grid height, the whole block shrinks and stays centred."""
    rows = slide['rows']
    inner = W - 2 * SIDE
    specs = []
    for row in rows:
        imgs = [load(p, base) for p in row]
        boxes = [tuple(p['crop']) if p.get('crop') else (0, 0, im.width, im.height)
                 for p, im in zip(row, imgs)]
        aspects = [(b[2] - b[0]) / (b[3] - b[1]) for b in boxes]
        specs.append((row, imgs, boxes, aspects, (inner - GUT) / sum(aspects)))
    total = sum(s[4] for s in specs) + GUT * (len(rows) - 1)
    f = min(1.0, GRID_H / total)
    y = GRID_TOP + int((GRID_H - (total * f if f < 1 else total)) / 2)
    c = Image.new('RGB', (W, H), BG)
    for row, imgs, boxes, aspects, h in specs:
        h = int(h * f)
        widths = [int(a * h) for a in aspects]
        x = (W - (sum(widths) + GUT)) // 2
        for j, (p, im, b, w) in enumerate(zip(row, imgs, boxes, widths)):
            for msg in ([f'  warning: {p["file"]} enlarged x{w / (b[2] - b[0]):.2f}, may look soft']
                        if w / (b[2] - b[0]) > 1.3 else []):
                print(msg)
            place(c, im, b, x, y, w, h, labels[j], j == 1, p)
            x += w + GUT
        y += h + GUT
    return c


LAYOUTS = {'pairs': slide_pairs, 'pair_then_stacked': slide_pair_then_stacked,
           'justified': slide_justified}

if __name__ == '__main__':
    case_path = sys.argv[1]
    base = os.path.dirname(os.path.abspath(case_path))
    case = json.load(open(case_path, encoding='utf-8'))
    labels = case.get('labels', ['ДО', 'ПОСЛЕ'])
    for slide in case['slides']:
        print(f"slide {slide['name']}")
        canvas = LAYOUTS[slide['layout']](slide, labels, base)
        wm = case.get('footer_watermark')
        if wm and not os.path.isabs(wm):
            wm = os.path.join(HERE, wm)
        header_footer(canvas, slide['title'], case.get('subtitle', 'до и после'), wm)
        out = os.path.join(base, f"{slide['name']}.jpg")
        canvas.save(out, quality=95, subsampling=0)
        print(f'  -> {out}')
