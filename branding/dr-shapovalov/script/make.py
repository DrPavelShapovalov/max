"""Gold script wordmark "Dr. Shapovalov" on matte black.

Mood borrowed from the black-and-gold Coke Zero can (script + ribbon + gold on black),
nothing copied from that trademark. Fonts (SIL OFL) are fetched by getfont.py into .fonts/.
"""
import math
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SS = 3
BG = (12, 12, 12)
# metallic gold: darker edges, a light band just above the middle
STOPS = [(0.0, (178, 138, 58)), (0.42, (246, 224, 160)), (0.62, (214, 176, 94)), (1.0, (150, 112, 42))]
SCRIPT = '.fonts/GreatVibes.ttf'
CAPS = '.fonts/CormorantGaramond-600.ttf'
NAME, PREFIX, TAGLINE = 'Shapovalov', 'DR.', 'MAXILLOFACIAL SURGEON'


TAIL = (208, 172, 96)                   # flat gold below the gradient span (the tagline)


def gold(size, y0, y1):
    w, h = size
    col = Image.new('RGB', (1, h))
    for y in range(h):
        if y > y1:
            col.putpixel((0, y), TAIL)
            continue
        f = min(1, max(0, (y - y0) / max(1, y1 - y0)))
        for (a, ca), (b, cb) in zip(STOPS, STOPS[1:]):
            if a <= f <= b:
                t = (f - a) / (b - a)
                col.putpixel((0, y), tuple(int(p + (q - p) * t) for p, q in zip(ca, cb)))
                break
    return col.resize((w, h))


def tracked(d, xy, text, font, fill, track):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=font, fill=fill, anchor='ls')
        x += d.textlength(ch, font=font) + track


def tracked_len(d, text, font, track):
    return sum(d.textlength(c, font=font) for c in text) + track * (len(text) - 1)


def ribbon(d, p0, p1, p2, p3, max_w):
    """Tapered cubic-bezier swash: hairline at both ends, fullest just past the middle."""
    n = 1400
    for i in range(n + 1):
        t = i / n
        x = (1-t)**3*p0[0] + 3*(1-t)**2*t*p1[0] + 3*(1-t)*t**2*p2[0] + t**3*p3[0]
        y = (1-t)**3*p0[1] + 3*(1-t)**2*t*p1[1] + 3*(1-t)*t**2*p2[1] + t**3*p3[1]
        r = max_w / 2 * math.sin(math.pi * t) ** 1.4 + 0.6
        d.ellipse([x - r, y - r, x + r, y + r], fill=255)


def lockup(name_h, with_tagline=True):
    """Draws the whole mark into an 'L' mask; returns the mask cropped to its content."""
    script = ImageFont.truetype(SCRIPT, name_h)
    probe = Image.new('L', (name_h * 8, name_h * 3), 0)
    ImageDraw.Draw(probe).text((name_h, name_h), NAME, font=script, fill=255,
                               stroke_width=max(1, name_h // 60), stroke_fill=255)
    l, t, r, b = probe.getbbox()
    wm = probe.crop((l, t, r, b)); W, H = wm.size

    caps = ImageFont.truetype(CAPS, int(H * 0.16))
    tag = ImageFont.truetype(CAPS, int(H * 0.12))
    pad = int(H * 0.5)
    canvas = Image.new('L', (W + 2 * pad, int(H * 2.1) + 2 * pad), 0)
    d = ImageDraw.Draw(canvas)
    ox, oy = pad, pad + int(H * 0.28)
    canvas.paste(wm, (ox, oy), wm)

    # "DR." tucked above the S's upper swash, small and widely tracked
    tracked(d, (ox + int(W * 0.03), oy + int(H * 0.02)), PREFIX, caps, 255, H * 0.045)

    # ribbon under the name, like the can's wave but quiet
    y_rib = oy + H * 1.02
    ribbon(d, (ox + W * 0.02, y_rib + H * 0.02), (ox + W * 0.34, y_rib + H * 0.16),
           (ox + W * 0.70, y_rib - H * 0.10), (ox + W * 1.03, y_rib - H * 0.06), H * 0.038)

    if with_tagline:
        tw = tracked_len(d, TAGLINE, tag, H * 0.05)
        tracked(d, (ox + (W - tw) / 2, y_rib + H * 0.42), TAGLINE, tag, 255, H * 0.05)
    return canvas.crop(canvas.getbbox())


def compose(Wc, Hc, frac_w, with_tagline):
    w, h = Wc * SS, Hc * SS
    mark = lockup(400 * SS, with_tagline)
    k = min(w * frac_w / mark.width, h * 0.72 / mark.height)
    mark = mark.resize((int(mark.width * k), int(mark.height * k)), Image.LANCZOS)
    mask = Image.new('L', (w, h), 0)
    x0, y0 = (w - mark.width) // 2, (h - mark.height) // 2
    mask.paste(mark, (x0, y0), mark)
    img = Image.new('RGB', (w, h), BG)
    img.paste(gold((w, h), y0, y0 + int(mark.height * 0.8)), (0, 0), mask)   # gradient on name + ribbon
    vig = Image.new('L', (w, h), 0)
    ImageDraw.Draw(vig).ellipse([-w * 0.25, -h * 0.7, w * 1.25, h * 1.7], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(w // 10))
    img = Image.composite(img, Image.new('RGB', (w, h), (3, 3, 3)), vig)
    return img.resize((Wc, Hc), Image.LANCZOS)


def transparent(width):
    mark = lockup(400 * SS, True)
    out = Image.new('RGBA', mark.size, (0, 0, 0, 0))
    out.paste(gold(mark.size, 0, int(mark.height * 0.8)), (0, 0), mark)
    return out.resize((width, int(mark.height * width / mark.width)), Image.LANCZOS)


if __name__ == '__main__':
    compose(1080, 1080, 0.74, True).save('shapovalov-square.png')
    compose(1500, 500, 0.40, True).save('shapovalov-cover-1500x500.png')
    compose(1200, 400, 0.40, True).save('shapovalov-cover-1200x400.png')
    transparent(1600).save('shapovalov-wordmark-gold.png')
    print('ok')
