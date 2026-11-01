"""Подпись «Dr. Shapovalov» с сайта, которая пишется «пером»: те же штрихи маски, что в site/index.html (writeSignature)."""
import math, os, re
import numpy as np
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, '..', '..', 'site', 'img', 'signature-gold.png')
STROKES = [   # (ширина, путь) — из <mask id="sig-mask"> на сайте, координаты 640×213
    (30, 'M14 15 L84 15'),
    (42, 'M38 74 C10 95 0 135 30 155 C60 172 110 162 128 138 C146 114 120 95 100 78 C75 55 70 25 105 18 C135 12 160 25 152 45 C149 55 138 56 132 52'),
    (30, 'M208 46 C192 80 162 122 142 152'),
    (72, 'M150 96 L172 134 L194 96 L216 134 L238 96'),
    (28, 'M246 118 C240 150 236 172 232 192'),
    (72, 'M250 96 L272 134 L294 96 L316 134 L338 96 L360 134 L382 96 L404 134 L426 96 L448 134 L470 96 L492 134'),
    (28, 'M526 46 C518 80 510 112 504 146'),
    (72, 'M500 96 L522 134 L544 96 L566 134 L588 96 L610 134'),
    (16, 'M16 203 C200 196 420 188 628 186'),
]
def polyline(d):
    tok = re.findall(r'[MLC]|-?\d+(?:\.\d+)?', d); pts, i, cur = [], 0, None
    while i < len(tok):
        c = tok[i]
        if c == 'M': cur = (float(tok[i + 1]), float(tok[i + 2])); pts.append(cur); i += 3
        elif c == 'L': cur = (float(tok[i + 1]), float(tok[i + 2])); pts.append(cur); i += 3
        elif c == 'C':
            p1, p2, p3 = [(float(tok[i + k]), float(tok[i + k + 1])) for k in (1, 3, 5)]
            for s in np.linspace(0, 1, 24)[1:]:
                u = 1 - s; pts.append(tuple(u**3 * cur[j] + 3 * u * u * s * p1[j] + 3 * u * s * s * p2[j] + s**3 * p3[j] for j in range(2)))
            cur = p3; i += 7
        else: i += 1
    return pts
PATHS = []
for w, d in STROKES:
    pts = polyline(d); seg = [math.dist(a, b) for a, b in zip(pts, pts[1:])]
    PATHS.append((w, pts, seg, sum(seg)))
DURS = [max(0.14, L / 1150) for *_, L in PATHS]          # как на сайте: скорость 1150 px/с, минимум 0,14 с на штрих
TOTAL = sum(DURS)
_SRC = None
def written(t, width):
    """Подпись к моменту t (с) от начала письма, шириной width px. Возвращает (RGBA, позиция пера или None)."""
    global _SRC
    if _SRC is None: _SRC = Image.open(IMG).convert('RGBA')
    k = width / _SRC.width; S = 2
    mask = Image.new('L', (int(_SRC.width * S), int(_SRC.height * S))); d = ImageDraw.Draw(mask); pen = None
    left = t
    for (w, pts, seg, L), du in zip(PATHS, DURS):
        if left <= 0: break
        f = min(1, left / du); left -= du; need = f * L; acc = 0; drawn = [pts[0]]
        for a, b, sl in zip(pts, pts[1:], seg):
            if acc + sl >= need:
                r = (need - acc) / sl if sl else 0; drawn.append((a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r)); break
            drawn.append(b); acc += sl
        sp = [(x * S, y * S) for x, y in drawn]
        if len(sp) > 1: d.line(sp, fill=255, width=int(w * S), joint='curve')
        for x, y in (sp[0], sp[-1]): d.ellipse([x - w * S / 2, y - w * S / 2, x + w * S / 2, y + w * S / 2], fill=255)
        if f < 1: pen = drawn[-1]
    mask = mask.resize(_SRC.size, Image.LANCZOS)
    im = _SRC.copy(); im.putalpha(Image.fromarray((np.asarray(_SRC.getchannel('A'), np.float32) * np.asarray(mask, np.float32) / 255).astype(np.uint8)))
    im = im.resize((int(width), int(_SRC.height * k)), Image.LANCZOS)
    return im, (pen[0] * k, pen[1] * k) if pen else None
