"""Transparent watermarks for case collages, with padding on every side.

  watermark-<gold|bronze>.png   full lockup with tagline
  footer-<gold|bronze>.png      no tagline, for the collage footer strip

Gold for dark backgrounds, bronze-gold for light ones. Watermarks go in the footer
strip, never over the photos, so they can never cover a patient's face."""
from PIL import Image
import make

BRONZE = [(0.0, (112, 80, 26)), (0.42, (172, 134, 58)), (0.62, (138, 102, 36)), (1.0, (92, 64, 20))]
BRONZE_TAIL = (120, 88, 30)


def build(palette, tagline, width):
    mask = make.lockup(400 * make.SS, tagline)
    pad = int(mask.height * 0.10)
    full = Image.new('L', (mask.width + 2 * pad, mask.height + 2 * pad), 0)
    full.paste(mask, (pad, pad))
    saved = make.STOPS, make.TAIL
    if palette == 'bronze':
        make.STOPS, make.TAIL = BRONZE, BRONZE_TAIL
    fill = make.gold(full.size, pad, pad + int(mask.height * (0.8 if tagline else 1.0)))
    make.STOPS, make.TAIL = saved
    out = Image.new('RGBA', full.size, (0, 0, 0, 0))
    out.paste(fill, (0, 0), full)
    return out.resize((width, int(out.height * width / out.width)), Image.LANCZOS)


if __name__ == '__main__':
    for pal in ('gold', 'bronze'):
        build(pal, True, 1600).save(f'watermark-{pal}.png')
        build(pal, False, 1200).save(f'footer-{pal}.png')
        print(pal)
