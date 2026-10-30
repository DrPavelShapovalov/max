"""Обложки рилсов @dr__shapovalov: 1080x1920, чёрный + золото + изумруд, или светлая.

Запуск:  python3 render.py covers.json
Каждая обложка в covers.json:
  {"out": "...png", "photo": "вырезанное фото .png", "palette": "emerald|ivory",
   "title": [["7,93 → 2 ММ", "gold"], ["БЕЗ ОРТОГНАТИИ", "band"]],
   "note": "кейс с цифрами", "caption": "челюстно-лицевой хирург"}
Стили строк заголовка: plain (светлый), gold (золото), band (на плашке цвета-акцента).
Заголовок и подпись стоят внутри зоны 3:4 (y 240-1680): так их не обрежет сетка профиля.
"""
import json, sys, pathlib
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = pathlib.Path(__file__).resolve().parent
FONTS = HERE / '.fonts'
SIGN = HERE.parent / 'script' / 'footer-gold.png'
W, H = 1080, 1920
SAFE_TOP, SAFE_BOTTOM = 240, 1680
GOLD = {'gold': ((236, 206, 130), (176, 138, 58)), 'bronze': ((196, 156, 84), (122, 88, 34))}
GOLD_HI, GOLD_LO = GOLD['gold']

PALETTES = {
    'emerald':  dict(bg=(10, 14, 13), glow=(18, 52, 43), accent=(22, 66, 54), ink=(244, 236, 222), gold='gold'),
    'ivory':    dict(bg=(240, 235, 225), glow=(250, 247, 240), accent=(22, 22, 24), ink=(22, 22, 24), gold='bronze'),
}


def font(name, size):
    return ImageFont.truetype(str(FONTS / f'{name}.ttf'), size)


def gold_fill(size):
    w, h = size
    t = np.linspace(0, 1, h)[:, None]
    hi, lo = np.array(GOLD_HI), np.array(GOLD_LO)
    # блик посередине, как у металлической подписи
    k = np.clip(1 - np.abs(t - 0.38) * 1.6, 0, 1)
    rgb = lo + (hi - lo) * k[..., None] * np.ones((1, w, 1))
    return Image.fromarray(rgb.astype(np.uint8), 'RGB')


def paste_gold(canvas, mask, xy=(0, 0)):
    canvas.paste(gold_fill(mask.size), xy, mask)


def background(p):
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.sqrt(((xx - W / 2) / W) ** 2 + ((yy - H * 0.55) / H) ** 2)
    k = np.clip(1 - d * 1.9, 0, 1)[..., None]
    rgb = np.array(p['bg']) * (1 - k) + np.array(p['glow']) * k
    rng = np.random.default_rng(7)
    rgb += rng.normal(0, 4.5, (H, W, 1))          # зерно, чтобы фон не был пластиковым
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), 'RGB')


def frame(canvas):
    # золотой ободок: основная линия + тонкая внутренняя
    m = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle((30, 30, W - 31, H - 31), radius=28, outline=255, width=5)
    d.rounded_rectangle((46, 46, W - 47, H - 47), radius=20, outline=255, width=2)
    paste_gold(canvas, m)


def person(canvas, photo, top, height):
    cut = Image.open(photo).convert('RGBA')
    cut = cut.crop(cut.getbbox())
    # заполнить дыры внутри силуэта (телефон в руке, просвет между рукой и телом)
    a0 = (np.array(cut.split()[3]) > 128).astype(np.uint8) * 255
    cs, _ = cv2.findContours(a0, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(a0)
    cv2.drawContours(filled, cs, -1, 255, thickness=cv2.FILLED)
    cut.putalpha(Image.fromarray(np.maximum(np.array(cut.split()[3]), filled)))
    s = height / cut.height
    cut = cut.resize((round(cut.width * s), height), Image.LANCZOS)
    x = (W - cut.width) // 2
    a = np.array(cut.split()[3])
    # золотой контур вплотную и пунктир дальше, как на стикере
    pad = 60
    big = np.zeros((cut.height + 2 * pad, cut.width + 2 * pad), np.uint8)
    big[pad:pad + cut.height, pad:pad + cut.width] = (a > 128) * 255
    near = cv2.dilate(big, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (19, 19)))
    far = cv2.dilate(big, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (61, 61)))
    m = Image.new('L', (W, H), 0)
    m.paste(Image.fromarray(near), (x - pad, top - pad))
    shadow = m.filter(ImageFilter.GaussianBlur(24))
    canvas.paste((0, 0, 0), (0, 0), shadow.point(lambda v: v * 0.55))
    paste_gold(canvas, m)
    cs, _ = cv2.findContours(far, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    dm = Image.new('L', (W, H), 0)
    dd = ImageDraw.Draw(dm)
    for c in cs:
        pts = c[:, 0, :] + np.array([x - pad, top - pad])
        for i in range(0, len(pts) - 14, 28):           # штрих 14 точек, пробел 14
            seg = [tuple(map(int, p)) for p in pts[i:i + 14]]
            if all(p[1] < H - 70 for p in seg):          # низ кадра не обводим
                dd.line(seg, fill=255, width=5)
    paste_gold(canvas, dm)
    canvas.paste(cut, (x, top), cut)


def fit(text, name, max_w, start):
    size = start
    while size > 40:
        f = font(name, size)
        if f.getlength(text) <= max_w:
            return f
        size -= 4
    return font(name, size)


ARROW = '→'


def text_width(d, text, f):
    if ARROW not in text:
        l, t, r, b = d.textbbox((0, 0), text, font=f)
        return r - l
    a, b = text.split(ARROW, 1)
    return d.textlength(a, font=f) + f.size * 0.9 + d.textlength(b, font=f)


def draw_text(d, xy, text, f, fill):
    """Текст; символ → рисуется стрелкой (в Oswald его нет)."""
    x, y = xy
    if ARROW not in text:
        d.text((x, y), text, font=f, fill=fill)
        return
    a, b = text.split(ARROW, 1)
    d.text((x, y), a, font=f, fill=fill)
    x += d.textlength(a, font=f)
    l, t, r, bb = d.textbbox((0, 0), 'М', font=f)
    cy = y + (t + bb) / 2
    s = f.size
    x0, x1 = x + s * 0.12, x + s * 0.78
    d.line((x0, cy, x1 - s * 0.08, cy), fill=fill, width=max(4, int(s * 0.09)))
    d.polygon([(x1, cy), (x1 - s * 0.26, cy - s * 0.2), (x1 - s * 0.26, cy + s * 0.2)], fill=fill)
    d.text((x + s * 0.9, y), b, font=f, fill=fill)


def title(canvas, p, lines, y):
    d = ImageDraw.Draw(canvas)
    for text, style in lines:
        f = fit(text.replace(ARROW, 'МM'), 'Oswald-700', 880 if style == 'band' else 920, 150)
        l, t, r, b = d.textbbox((0, 0), text.replace(ARROW, 'М'), font=f)
        tw, th = text_width(d, text, f), b - t
        x = (W - tw) // 2 - l
        if style == 'band':
            bx0, by0, bx1, by1 = (W - tw) // 2 - 34, y - 14, (W + tw) // 2 + 34, y + th + 26
            d.rounded_rectangle((bx0, by0, bx1, by1), radius=14, fill=p['accent'])
            m = Image.new('L', (W, H), 0)
            ImageDraw.Draw(m).rounded_rectangle((bx0, by0, bx1, by1), radius=14, outline=255, width=4)
            paste_gold(canvas, m)
            ink = (244, 236, 222)
            draw_text(d, (x, y - t + 6), text, f, ink)
            y += th + 64
        elif style == 'gold':
            m = Image.new('L', (W, H), 0)
            draw_text(ImageDraw.Draw(m), (x, y - t), text, f, 255)
            paste_gold(canvas, m)
            y += th + 30
        else:
            draw_text(d, (x, y - t), text, f, p['ink'])
            y += th + 30
    return y


def note(canvas, text, y):
    f = font('Cormorant-600i', 62)
    m = Image.new('L', (W, H), 0)
    w = ImageDraw.Draw(m).textlength(text, font=f)
    ImageDraw.Draw(m).text(((W - w) / 2, y), text, font=f, fill=255)
    paste_gold(canvas, m)


def sparkle(canvas, cx, cy, r):
    m = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(m)
    q = r * 0.22
    d.polygon([(cx, cy - r), (cx + q, cy - q), (cx + r, cy), (cx + q, cy + q),
               (cx, cy + r), (cx - q, cy + q), (cx - r, cy), (cx - q, cy - q)], fill=255)
    paste_gold(canvas, m)


def shadow(canvas, mask, blur, strength):
    """Мягкая тень под знаком: читается поверх фото без подложки."""
    sh = mask.filter(ImageFilter.GaussianBlur(blur)).point(lambda v: min(255, int(v * strength)))
    canvas.paste((0, 0, 0), (0, 0), sh)


def tracked(draw, xy, text, f, fill, tracking):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=f, fill=fill)
        x += draw.textlength(ch, font=f) + tracking


def tracked_width(draw, text, f, tracking):
    return sum(draw.textlength(ch, font=f) for ch in text) + tracking * (len(text) - 1)


def signature(canvas, p, caption, y):
    """Знак без подложки: подпись мелкими буквами между золотыми чертами,
    под ней золотая подпись Dr. Shapovalov. Читаемость держит мягкая тень."""
    sig = Image.open(SIGN).convert('RGBA')
    sig = sig.crop(sig.getbbox())
    sw = 560
    sig = sig.resize((sw, round(sig.height * sw / sig.width)), Image.LANCZOS)
    f = font('Manrope-700', 26)
    text = caption.upper()
    probe = ImageDraw.Draw(Image.new('L', (1, 1)))
    tw = tracked_width(probe, text, f, 5)
    tx = (W - tw) / 2
    # маска всего знака: текст, черты по бокам, подпись
    m_text = Image.new('L', (W, H), 0)
    tracked(ImageDraw.Draw(m_text), (tx, y), text, f, 255, 5)
    m_rules = Image.new('L', (W, H), 0)
    dr = ImageDraw.Draw(m_rules)
    cy = y + 17
    dr.line((tx - 86, cy, tx - 22, cy), fill=255, width=2)
    dr.line((tx + tw + 22, cy, tx + tw + 86, cy), fill=255, width=2)
    sx, sy = (W - sig.width) // 2, y + 40
    m_sig = Image.new('L', (W, H), 0)
    m_sig.paste(sig.split()[3], (sx, sy))
    whole = Image.fromarray(np.maximum.reduce([np.array(m_text), np.array(m_rules), np.array(m_sig)]))
    shadow(canvas, whole, 26, 1.6)
    shadow(canvas, whole, 5, 1.2)
    paste_gold(canvas, m_rules)
    canvas.paste((240, 232, 216), (0, 0), m_text)
    canvas.paste(sig, (sx, sy), sig)


def render(spec, base):
    global GOLD_HI, GOLD_LO
    p = PALETTES[spec.get('palette', 'emerald')]
    GOLD_HI, GOLD_LO = GOLD[p['gold']]
    c = background(p)
    person(c, base / spec['photo'], top=760, height=1160)
    y = title(c, p, spec['title'], 300)
    if spec.get('note'):
        note(c, spec['note'], y + 4)
    sparkle(c, 112, 250, 30)
    sparkle(c, W - 112, 250, 20)
    signature(c, p, spec.get('caption', 'челюстно-лицевой хирург'), 1440)
    frame(c)
    out = base / spec['out']
    c.save(out)
    # как обложка выглядит в сетке профиля (центр 3:4)
    c.crop((0, SAFE_TOP, W, SAFE_BOTTOM)).resize((540, 720), Image.LANCZOS).save(out.with_name(out.stem + '-grid.png'))
    print('ok', out)


if __name__ == '__main__':
    cfg = pathlib.Path(sys.argv[1]).resolve()
    for spec in json.loads(cfg.read_text(encoding='utf-8')):
        render(spec, cfg.parent)
