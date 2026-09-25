from PIL import Image, ImageDraw, ImageFilter, ImageFont

SS = 3
BG = (13, 13, 13)
GOLD_TOP, GOLD_BOTTOM = (240, 212, 138), (172, 134, 54)
SCRIPT = '.fonts/GreatVibes.ttf'
SERIF = '.fonts/DMSerifText.ttf'
NAME = 'Shapovalov'
LINES = [('maxillofacial surgeon', True), ('pediatric department', False), ('PhD · Moscow', False)]


def gold(size, y0, y1):
    w, h = size
    col = Image.new('RGB', (1, h))
    for y in range(h):
        f = min(1, max(0, (y - y0) / max(1, y1 - y0)))
        col.putpixel((0, y), tuple(int(a + (b - a) * f) for a, b in zip(GOLD_TOP, GOLD_BOTTOM)))
    return col.resize((w, h))


def wordmark_mask(px_height):
    """Script surname, slightly emboldened (stroke in the same fill), tight-cropped mask."""
    font = ImageFont.truetype(SCRIPT, px_height)
    tmp = Image.new('L', (px_height * 8, px_height * 3), 0)
    ImageDraw.Draw(tmp).text((px_height, px_height), NAME, font=font, fill=255,
                             stroke_width=max(1, px_height // 55), stroke_fill=255)
    return tmp.crop(tmp.getbbox())


def compose(W, H, with_lines, name_h_frac):
    w, h = W * SS, H * SS
    mask = Image.new('L', (w, h), 0)
    wm = wordmark_mask(int(h * name_h_frac))
    if wm.width > w * 0.8:                              # keep side margins on narrow canvases
        k = w * 0.8 / wm.width
        wm = wm.resize((int(wm.width * k), int(wm.height * k)), Image.LANCZOS)
    if with_lines:
        serif = ImageFont.truetype(SERIF, int(wm.height * 0.13))
        d = ImageDraw.Draw(mask)
        asc, desc = serif.getmetrics()
        lh = int((asc + desc) * 1.08)
        block_h = wm.height + int(wm.height * 0.12) + lh * len(LINES)
        top = (h - block_h) // 2
        x0 = (w - wm.width) // 2
        mask.paste(wm, (x0, top), wm)
        y = top + wm.height + int(wm.height * 0.12)
        tx = x0 + int(wm.width * 0.16)                # tagline starts under the "h", like the can
        inverse = []
        for text, boxed in LINES:
            if boxed:
                tw = d.textlength(text, font=serif)
                pad = int(lh * 0.12)
                inverse.append((tx - pad, y, tx + tw + pad, y + lh, text))
            else:
                d.text((tx, y), text, font=serif, fill=255)
            y += lh
        for l, t, r, b, text in inverse:                # gold plate with the text knocked out
            d.rectangle([l, t + int(lh * 0.06), r, b - int(lh * 0.02)], fill=255)
            d.text((l + int(lh * 0.12), t), text, font=serif, fill=0)
        y0, y1 = top, y
    else:
        top = (h - wm.height) // 2
        mask.paste(wm, ((w - wm.width) // 2, top), wm)
        y0, y1 = top, top + wm.height
    img = Image.new('RGB', (w, h), BG)
    img.paste(gold((w, h), y0, y1), (0, 0), mask)
    # soft vignette for a matte-can feel
    vig = Image.new('L', (w, h), 0)
    ImageDraw.Draw(vig).ellipse([-w * 0.2, -h * 0.6, w * 1.2, h * 1.6], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(w // 12))
    img = Image.composite(img, Image.new('RGB', (w, h), (4, 4, 4)), vig)
    return img.resize((W, H), Image.LANCZOS), mask


def transparent(px_height):
    wm = wordmark_mask(px_height * SS)
    out = Image.new('RGBA', wm.size, (0, 0, 0, 0))
    out.paste(gold(wm.size, 0, wm.height), (0, 0), wm)
    return out.resize((wm.width // SS, wm.height // SS), Image.LANCZOS)


compose(1080, 1080, True, 0.30)[0].save('shapovalov-square.png')
compose(1500, 500, False, 0.42)[0].save('shapovalov-cover-1500x500.png')
compose(1200, 400, False, 0.42)[0].save('shapovalov-cover-1200x400.png')
transparent(400).save('shapovalov-wordmark-gold.png')
print('ok')
