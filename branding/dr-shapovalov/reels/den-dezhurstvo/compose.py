"""Шаг 3: анимированные разноцветные подписи (PIL, кадр за кадром) поверх work/base.mp4 + музыка → out/den-dezhurstvo.mp4
   python compose.py [--still 12.3]   — один кадр в work/still.png для проверки."""
import math, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from segments import SEGS, SECTIONS, T, FINAL, FPS, W, H, timeline, dur
FONT = '/home/user/max/.claude/skills/reels-desk/engine/fonts/Rubik.ttf'
def font(px, w='Black'):
    f = ImageFont.truetype(FONT, px); f.set_variation_by_name(w); return f
PAL = [(255, 90, 95), (255, 180, 0), (61, 220, 132), (46, 196, 255), (139, 92, 246), (255, 102, 196)]
X0, MAXW = 64, 1080 - 64 - 150                    # слева 64 px, справа запас под кнопки Instagram
ST, TOTAL = timeline()
ease_back = lambda x: 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2 if x < 1 else 1.0
clamp = lambda x: max(0.0, min(1.0, x))

_cache = {}
def letter(ch, px, color):
    """Буква: цвет + толстая белая обводка + мягкая тень. Кэшируется."""
    key = (ch, px, color)
    if key in _cache: return _cache[key]
    f = font(px); sw = max(4, px // 11)
    l, t, r, b = f.getbbox(ch, stroke_width=sw); w, h = r - l + 24, b - t + 30
    im = Image.new('RGBA', (w, h)); d = ImageDraw.Draw(im)
    sh = Image.new('RGBA', (w, h)); ImageDraw.Draw(sh).text((12 - l, 18 - t), ch, font=f, fill=(20, 10, 40, 150), stroke_width=sw, stroke_fill=(20, 10, 40, 150))
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(6)))
    d.text((12 - l, 12 - t), ch, font=f, fill=color + (255,), stroke_width=sw, stroke_fill=(255, 255, 255, 255))
    _cache[key] = (im, f.getlength(ch), -t + 12)
    return _cache[key]

def word_layout(text, px):
    """Возвращает список (символ, x, цвет) и ширину строки."""
    out, x, k = [], 0.0, 0
    for ch in text:
        if ch != ' ': out.append((ch, x, PAL[k % len(PAL)])); k += 1
        x += font(px).getlength(ch) + px * 0.02
    return out, x

def fit_lines(text, px, maxw):
    """Подбирает размер; длинное — в две строки по пробелу."""
    for size in range(px, 70, -4):
        if word_layout(text, size)[1] <= maxw: return [text], size
    words = text.split(); best = None
    for i in range(1, len(words)):
        a, b = ' '.join(words[:i]), ' '.join(words[i:])
        for size in range(px, 60, -4):
            if max(word_layout(a, size)[1], word_layout(b, size)[1]) <= maxw:
                if not best or size > best[1]: best = ([a, b], size)
                break
    return best or ([text], 60)

def draw_colored(canvas, lines, px, x0, y0, t, t_in, t_out, align='left', stagger=0.035):
    """Рисует строки разноцветными буквами с «пружинным» появлением и уходом. Возвращает высоту блока."""
    y = y0; idx = 0; lh = int(px * 1.08)
    for line in lines:
        lay, lw = word_layout(line, px)
        xs = x0 if align == 'left' else (W - lw) / 2
        for ch, x, col in lay:
            a_in = clamp((t - t_in - idx * stagger) / 0.38); a_out = clamp((t_out - t) / 0.28)
            idx += 1
            if a_in <= 0 or a_out <= 0: continue
            s = ease_back(a_in) * (0.6 + 0.4 * a_out); al = min(1, a_in * 2) * a_out
            spr, adv, base = letter(ch, px, col)
            wob = math.sin(t * 3.2 + idx * 0.7) * px * 0.025       # еле заметное покачивание
            sw, shh = max(1, int(spr.width * s)), max(1, int(spr.height * s))
            im = spr.resize((sw, shh), Image.BILINEAR)
            if al < 1: im.putalpha(im.getchannel('A').point(lambda v: int(v * al)))
            cx, cy = xs + x + adv / 2, y + px * 0.55 + wob - (1 - a_in) * 30
            canvas.alpha_composite(im, (int(cx - sw / 2), int(cy - shh / 2)))
        y += lh
    return len(lines) * lh

def chip(canvas, text, x, y, t, t_in, t_out, px=40, icon=None, center=False):
    """Стеклянная плашка с радужной рамкой."""
    a = clamp((t - t_in) / 0.3) * clamp((t_out - t) / 0.25)
    if a <= 0: return 0
    f = font(px, 'Bold'); tw = f.getlength(text); ic = px * 1.15 if icon else 0
    w, h = int(tw + ic + px * 1.2), int(px * 1.75)
    if center: x = (W - w) / 2
    S = 3; im = Image.new('RGBA', (w * S, h * S)); d = ImageDraw.Draw(im)
    grad = Image.new('RGBA', (w * S, h * S))
    gd = ImageDraw.Draw(grad)
    for i in range(w * S):                                                     # радужная рамка
        c = PAL[int(i / (w * S) * len(PAL)) % len(PAL)]; c2 = PAL[(int(i / (w * S) * len(PAL)) + 1) % len(PAL)]
        fr = (i / (w * S) * len(PAL)) % 1; gd.line([(i, 0), (i, h * S)], fill=tuple(int(c[j] * (1 - fr) + c2[j] * fr) for j in range(3)) + (255,))
    mask = Image.new('L', (w * S, h * S)); ImageDraw.Draw(mask).rounded_rectangle([0, 0, w * S - 1, h * S - 1], h * S // 2, fill=255)
    im.paste(grad, (0, 0), mask)
    d.rounded_rectangle([5 * S, 5 * S, w * S - 5 * S, h * S - 5 * S], h * S // 2 - 5 * S, fill=(18, 14, 40, 225))
    im = im.resize((w, h), Image.LANCZOS); d = ImageDraw.Draw(im)
    tx = px * 0.6
    if icon == 'sun':
        cx, cy, r = tx + px * 0.42, h / 2, px * 0.24
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 196, 40))
        for k in range(8):
            an = k * math.pi / 4; d.line([(cx + math.cos(an) * r * 1.5, cy + math.sin(an) * r * 1.5), (cx + math.cos(an) * r * 2.0, cy + math.sin(an) * r * 2.0)], fill=(255, 196, 40), width=3)
        tx += ic
    elif icon == 'moon':
        cx, cy, r = tx + px * 0.42, h / 2, px * 0.38
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 220, 120)); d.ellipse([cx - r + r * 0.6, cy - r - r * 0.2, cx + r + r * 0.6, cy + r - r * 0.2], fill=(18, 14, 40))
        tx += ic
    d.text((tx, h / 2), text, font=f, fill=(255, 255, 255), anchor='lm')
    if a < 1: im.putalpha(im.getchannel('A').point(lambda v: int(v * a)))
    dy = (1 - clamp((t - t_in) / 0.3)) * 24
    canvas.alpha_composite(im, (int(x), int(y + dy)))
    return h

def sparkles(canvas, t, t0, cx, cy, spread, seed, n=7):
    """Разноцветные звёздочки, вспыхивают при появлении заголовка."""
    rnd = np.random.default_rng(seed); d = ImageDraw.Draw(canvas)
    for k in range(n):
        ang, dist, dl, sz = rnd.uniform(0, 2 * math.pi), rnd.uniform(0.5, 1.0) * spread, rnd.uniform(0, 0.25), rnd.uniform(14, 30)
        p = clamp((t - t0 - dl) / 0.9)
        if p <= 0 or p >= 1: continue
        r = sz * math.sin(p * math.pi); x = cx + math.cos(ang) * dist * (0.6 + 0.4 * p); y = cy + math.sin(ang) * dist * 0.5 * (0.6 + 0.4 * p)
        col = PAL[k % len(PAL)] + (int(255 * (1 - p)),)
        pts = [(x + math.cos(a) * (r if i % 2 == 0 else r * 0.35), y + math.sin(a) * (r if i % 2 == 0 else r * 0.35))
               for i, a in enumerate(np.linspace(0, 2 * math.pi, 9)[:-1] + p * 2)]
        d.polygon(pts, fill=col)

def shade(canvas, y0, y1, a):
    """Мягкое затемнение под подписью, чтобы читалась на любом фоне."""
    if a <= 0: return
    g = np.zeros((H, 1), np.float32); ys = np.arange(H)
    mid, half = (y0 + y1) / 2, (y1 - y0) / 2 + 140
    g[:, 0] = np.clip(1 - np.abs(ys - mid) / half, 0, 1) ** 1.5 * 150 * a
    al = Image.fromarray(np.repeat(g, W, 1).astype(np.uint8), 'L')
    layer = Image.new('RGBA', (W, H), (10, 6, 30, 0)); layer.putalpha(al); canvas.alpha_composite(layer)

# --- расписание подписей ---
sec_spans = {}
for i, s in enumerate(SEGS):
    a, b = ST[i], ST[i] + dur(s)
    sp = sec_spans.setdefault(s['sec'], [a, b]); sp[1] = b
FIN0 = TOTAL - FINAL - T

def frame(t):
    c = Image.new('RGBA', (W, H))
    if t < sec_spans['title'][1]:                                              # титр
        t_out = sec_spans['title'][1] - T - 0.05
        shade(c, 440, 1340, clamp(t / 0.4) * clamp((t_out + 0.3 - t) / 0.3))
        sparkles(c, t, 0.4, W / 2, 920, 540, 3, 14)
        y = 470
        for text, px, d0 in (('Один день', 96, 0.15), ('из жизни', 96, 0.4), ('челюстно-', 118, 0.65), ('лицевого', 118, 0.85),
                             ('хирурга', 118, 1.05)):
            y += draw_colored(c, [text], px, 0, y, t, d0, t_out, align='center')
        y += 26
        chip(c, 'на дежурстве', 0, y, t, 1.35, t_out, px=58, icon='moon', center=True)
    for key, (a, b) in sec_spans.items():                                     # разделы дня
        if key == 'title': continue
        S = SECTIONS[key]; t_in, t_out = a + 0.28, b - T - 0.04
        if not (t_in - 0.1 < t < t_out + 0.3): continue
        lines, px = fit_lines(S['title'], 104, MAXW)
        segs_in = [(i, s) for i, s in enumerate(SEGS) if s['sec'] == key]
        sub = next(((ST[i] + 0.35, ST[i] + dur(s) - T - 0.04, s['sub']) for i, s in segs_in if s.get('sub') and ST[i] - 0.1 <= t < ST[i] + dur(s)), None)
        note = S.get('note')
        h_title = len(lines) * int(px * 1.08); h_block = 82 + 12 + h_title + (90 if (sub or note) else 0)
        y = 262 if S['pos'] == 'top' else 1490 - h_block
        shade(c, y, y + h_block, clamp((t - t_in + 0.2) / 0.3) * clamp((t_out + 0.3 - t) / 0.3) * 0.8)
        icon = 'sun' if int(S['time'][:2]) < 18 else 'moon'
        chip(c, S['time'], X0, y, t, t_in, t_out, px=44, icon=icon); y += 94
        sparkles(c, t, t_in + 0.1, X0 + 300, y + h_title / 2, 380, sum(map(ord, key)), 8)   # звёздочки — под буквами
        draw_colored(c, lines, px, X0, y, t, t_in + 0.12, t_out)
        y += h_title + 14
        if sub: chip(c, sub[2], X0, y, t, sub[0], min(sub[1], t_out), px=40)
        elif note: chip(c, note, X0, y, t, t_in + 0.45, t_out, px=40)
    if t >= FIN0 + 0.2:                                                        # финал
        t0 = FIN0 + 0.35; y = 640
        chip(c, '23:00', 0, y, t, t0, TOTAL + 1, px=52, icon='moon', center=True); y += 130
        y += draw_colored(c, ['Отбой!'], 150, 0, y, t, t0 + 0.2, TOTAL + 1, align='center') + 30
        chip(c, 'утром — операция', 0, y, t, t0 + 0.7, TOTAL + 1, px=50, center=True); y += 150
        chip(c, '@dr__shapovalov', 0, y, t, t0 + 1.1, TOTAL + 1, px=40, center=True)
        sparkles(c, t, t0 + 0.2, W / 2, 900, 520, 11, 16)
        sparkles(c, t, t0 + 1.4, W / 2, 900, 520, 12, 12)
    return c

if __name__ == '__main__':
    if '--still' in sys.argv:
        t = float(sys.argv[sys.argv.index('--still') + 1])
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(t), '-i', 'work/base.mp4', '-frames:v', '1', 'work/bg.png'], check=True)
        bg = Image.open('work/bg.png').convert('RGBA'); bg.alpha_composite(frame(t)); bg.convert('RGB').save('work/still.jpg', quality=90); print('work/still.jpg'); sys.exit()
    os.makedirs('out', exist_ok=True); N = int(round(TOTAL * FPS))
    ff = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-i', 'work/base.mp4', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                           '-i', 'work/music.wav', '-filter_complex', '[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v];[2:a]loudnorm=I=-14:TP=-1.5:LRA=9[a]',
                           '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-r', str(FPS),
                           '-c:a', 'aac', '-b:a', '192k', '-t', f'{TOTAL:.3f}', '-movflags', '+faststart', 'out/den-dezhurstvo.mp4'], stdin=subprocess.PIPE)
    for k in range(N):
        ff.stdin.write(frame(k / FPS).tobytes())
        if k % 150 == 0: print(f'{k}/{N}', flush=True)
    ff.stdin.close(); ff.wait(); print('out/den-dezhurstvo.mp4')
