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
THEMES = {
    'light': dict(bg=(244, 243, 240), ink=(22, 24, 26), mark='mark-dark.svg'),
    'dark': dict(bg=(22, 24, 26), ink=(244, 243, 240), mark='mark-white.svg'),
}
SIZES = {'x-gettr': (1500, 500), 'parler': (1200, 400)}
SS = 3                                  # supersample, then downscale for clean edges


def tracked_width(draw, text, font, track):
    return sum(draw.textlength(c, font=font) for c in text) + track * (len(text) - 1)


def cover(theme, W, H):
    t = THEMES[theme]
    w, h = W * SS, H * SS
    k = h / 500                         # layout designed at 500 px height
    img = Image.new('RGB', (w, h), t['bg'])
    d = ImageDraw.Draw(img)

    mark_px = int(96 * k)
    png = cairosvg.svg2png(url=os.path.join(HERE, '..', t['mark']),
                           output_width=mark_px, output_height=mark_px)
    mark = Image.open(io.BytesIO(png)).convert('RGBA')

    font = ImageFont.truetype(manrope(700), int(38 * k))
    track = 4.5 * k
    tw = tracked_width(d, NAME, font, track)

    gap = int(34 * k)
    asc, desc = font.getmetrics()
    block = mark_px + gap + asc
    top = (h - block) // 2
    img.paste(mark, ((w - mark_px) // 2, top), mark)

    x, base = (w - tw) / 2, top + mark_px + gap + asc
    for ch in NAME:
        d.text((x, base), ch, font=font, fill=t['ink'], anchor='ls')
        x += d.textlength(ch, font=font) + track
    return img.resize((W, H), Image.LANCZOS)


if __name__ == '__main__':
    for theme in THEMES:
        for name, (W, H) in SIZES.items():
            out = os.path.join(HERE, f'cover-{name}-{theme}.png')
            cover(theme, W, H).save(out, optimize=True)
            print(out)
