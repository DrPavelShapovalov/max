"""Profile covers (3:1) for X / GETTR (1500x500) and Parler (1200x400).

Mark and surname sit in the centre: avatars overlap the bottom-left corner,
and phones may show only a central strip of the header.
"""
import io, os, sys
import cairosvg
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'collage'))
from fonts import manrope

NAME = 'S. H. A. P. O. V. A. L. O. V.'
# Gold: a soft vertical gradient reads as metal, a flat fill reads as mustard.
GOLD_TOP, GOLD_BOTTOM = (236, 206, 130), (176, 138, 58)
THEMES = {
    'gold': dict(bg=(12, 12, 12)),
}
SIZES = {'x-gettr': (1500, 500), 'parler': (1200, 400)}
SS = 3                                  # supersample, then downscale for clean edges


def tracked_width(draw, text, font, track):
    return sum(draw.textlength(c, font=font) for c in text) + track * (len(text) - 1)


def cover(theme, W, H):
    t = THEMES[theme]
    w, h = W * SS, H * SS
    k = h / 500                         # layout designed at 500 px height
    mask = Image.new('L', (w, h), 0)    # everything golden is drawn into this mask
    d = ImageDraw.Draw(mask)

    mark_px = int(96 * k)
    png = cairosvg.svg2png(url=os.path.join(HERE, '..', 'mark-white.svg'),
                           output_width=mark_px, output_height=mark_px)
    mark_alpha = Image.open(io.BytesIO(png)).convert('RGBA').getchannel('A')

    font = ImageFont.truetype(manrope(700), int(38 * k))
    track = 4.5 * k
    tw = tracked_width(d, NAME, font, track)

    gap = int(34 * k)
    asc, _ = font.getmetrics()
    top = (h - (mark_px + gap + asc)) // 2
    mask.paste(mark_alpha, ((w - mark_px) // 2, top), mark_alpha)

    x, base = (w - tw) / 2, top + mark_px + gap + asc
    for ch in NAME:
        d.text((x, base), ch, font=font, fill=255, anchor='ls')
        x += d.textlength(ch, font=font) + track

    # Gradient spans only the content block, so mark and letters both get the full range.
    y0, y1 = top, base
    grad = Image.new('RGB', (1, h))
    for y in range(h):
        f = min(1.0, max(0.0, (y - y0) / max(1, y1 - y0)))
        grad.putpixel((0, y), tuple(int(a + (b - a) * f) for a, b in zip(GOLD_TOP, GOLD_BOTTOM)))
    img = Image.new('RGB', (w, h), t['bg'])
    img.paste(grad.resize((w, h)), (0, 0), mask)
    return img.resize((W, H), Image.LANCZOS)


if __name__ == '__main__':
    for theme in THEMES:
        for name, (W, H) in SIZES.items():
            out = os.path.join(HERE, f'cover-{name}-{theme}.png')
            cover(theme, W, H).save(out, optimize=True)
            print(out)
