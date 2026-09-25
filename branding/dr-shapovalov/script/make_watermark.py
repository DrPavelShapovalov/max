"""Transparent watermarks for case collages: Dr. Shapovalov lockup, with or without a
schematic mandible, in metallic gold (dark backgrounds and dark photo areas) or deep
bronze-gold (light backgrounds). Padding on every side so nothing touches the edge."""
import io
import cairosvg
from PIL import Image
import make

BRONZE = [(0.0, (112, 80, 26)), (0.42, (172, 134, 58)), (0.62, (138, 102, 36)), (1.0, (92, 64, 20))]
BRONZE_TAIL = (120, 88, 30)
SS = 3


def jaw_mask(height):
    w = int(height * 240 / 170)
    png = cairosvg.svg2png(url='jaw.svg', output_width=w, output_height=height)
    a = Image.open(io.BytesIO(png)).convert('RGBA').getchannel('A')
    return a.crop(a.getbbox())


def build(with_jaw, palette, width):
    lock = make.lockup(400 * SS, True)
    if with_jaw:
        jaw = jaw_mask(int(lock.height * 0.62))
        gap = int(lock.height * 0.12)
        W, H = jaw.width + gap + lock.width, lock.height
        mask = Image.new('L', (W, H), 0)
        mask.paste(jaw, (0, int(H * 0.40 - jaw.height / 2)), jaw)   # centred on the script line
        mask.paste(lock, (jaw.width + gap, 0), lock)
    else:
        mask = lock
    pad = int(mask.height * 0.10)
    full = Image.new('L', (mask.width + 2 * pad, mask.height + 2 * pad), 0)
    full.paste(mask, (pad, pad))

    if palette == 'bronze':
        stops, tail = make.STOPS, make.TAIL
        make.STOPS, make.TAIL = BRONZE, BRONZE_TAIL
    fill = make.gold(full.size, pad, pad + int(mask.height * 0.8))
    if palette == 'bronze':
        make.STOPS, make.TAIL = stops, tail

    out = Image.new('RGBA', full.size, (0, 0, 0, 0))
    out.paste(fill, (0, 0), full)
    return out.resize((width, int(out.height * width / out.width)), Image.LANCZOS)


if __name__ == '__main__':
    for jaw in (False, True):
        for pal in ('gold', 'bronze'):
            name = f"watermark-{pal}{'-jaw' if jaw else ''}.png"
            build(jaw, pal, 1600).save(name)
            print(name)
