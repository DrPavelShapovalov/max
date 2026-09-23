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
    return img


def shifted(photo, size):
    """Landmarks are measured on the full image; "precrop" (e.g. a screenshot's frame)
    moves the origin, so the solver gets coordinates inside the cropped area."""
    q = dict(photo)
    if photo.get('precrop'):
        l, t, r, b = photo['precrop']
        q['anchor'] = [photo['anchor'][0] - l, photo['anchor'][1] - t]
        q['include'] = [[x - l, y - t] for x, y in photo['include']]
        q['size'] = (r - l, b - t)
    else:
        q['size'] = size
    return q


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
                                            fill=INK + (235,) if dark else WHITE + (240,))
    layer = layer.resize((w, h), Image.LANCZOS)
    canvas.paste(layer, (x, y), layer)
    tracked(d, x + 15, y + 7, label, F_PILL, WHITE if dark else INK, 1.6)


def enhance(im, kind):
    """Levels, colour and sharpness only: nothing is added to or removed from the anatomy."""
    if kind == 'photo':
        im = ImageOps.autocontrast(im, cutoff=0.5)
        im = ImageEnhance.Brightness(im).enhance(1.04)
        im = ImageEnhance.Color(im).enhance(1.08)
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


def header_footer(canvas, title, subtitle):
    d = ImageDraw.Draw(canvas)
    sub = f' · {subtitle}'
    tw = d.textlength(title, font=F_TITLE) + d.textlength(sub, font=F_SUB)
    x, base = (W - tw) / 2, TOP + 44
    d.text((x, base), title, font=F_TITLE, fill=INK, anchor='ls')
    d.text((x + d.textlength(title, font=F_TITLE), base), sub, font=F_SUB, fill=MUTED, anchor='ls')
    png = cairosvg.svg2png(url=MARK_SVG, output_width=34 * SS, output_height=34 * SS)
    mark = Image.open(io.BytesIO(png)).convert('RGBA').resize((34, 34), Image.LANCZOS)
    hw = d.textlength(HANDLE, font=F_HANDLE)
    fx, fy = int((W - (34 + 10 + hw)) / 2), H - BOTTOM - FOOT + 3
    canvas.paste(mark, (fx, fy), mark)
    d.text((fx + 44, fy + 17), HANDLE, font=F_HANDLE, fill=INK, anchor='lm')


def fitted(pair, w, h, margin, base):
    pair = [shifted(p, open_upright(os.path.join(base, p['file'])).size) for p in pair]
    r = solve(pair, w, h, margin=margin)
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
            fits = [fitted([p], cw, rh, slide.get('margin', 0.025), base) for p in row]
            imgs, boxes = [f[0][0] for f in fits], [f[1][0] for f in fits]
        else:
            imgs, boxes = fitted(row, cw, rh, slide.get('margin', 0.025), base)
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


LAYOUTS = {'pairs': slide_pairs, 'pair_then_stacked': slide_pair_then_stacked}

if __name__ == '__main__':
    case_path = sys.argv[1]
    base = os.path.dirname(os.path.abspath(case_path))
    case = json.load(open(case_path, encoding='utf-8'))
    labels = case.get('labels', ['ДО', 'ПОСЛЕ'])
    for slide in case['slides']:
        print(f"slide {slide['name']}")
        canvas = LAYOUTS[slide['layout']](slide, labels, base)
        header_footer(canvas, slide['title'], case.get('subtitle', 'до и после'))
        out = os.path.join(base, f"{slide['name']}.jpg")
        canvas.save(out, quality=95, subsampling=0)
        print(f'  -> {out}')
