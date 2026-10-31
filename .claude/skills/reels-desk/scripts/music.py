"""Фоновая музыка для reels-desk: спокойный трек Am–F–C–G, 84 BPM, синтез numpy (своя, без лицензий).
   python3 music.py out.wav [длительность_с]
   Потом приглушить под голос: см. SKILL.md, раздел «Голос и музыка»."""
import numpy as np, wave, sys
SR, BPM = 48000, 84
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 44.0
beat = 60 / BPM; bar = 4 * beat
n = int(SR * DUR); L = np.zeros(n); Rr = np.zeros(n)
mid = lambda m: 440 * 2 ** ((m - 69) / 12)
# Am  F  C  G  (корень, терция, квинта)
prog = [(57, 60, 64), (53, 57, 60), (48, 55, 60, 64), (55, 59, 62)]
rng = np.random.default_rng(3)
def add(buf, start, sig):
    i = int(start * SR); j = min(n, i + len(sig))
    if i < n: buf[i:j] += sig[: j - i]
def env(length, a, r):
    t = np.arange(int(length * SR)) / SR
    e = np.minimum(1, t / a) * np.minimum(1, np.maximum(0, (length - t) / r))
    return t, e
t_bar = 0; k = 0
while t_bar < DUR:
    ch = prog[k % 4]
    # пэд: мягкие синусы с лёгкой расстройкой, медленная атака
    t, e = env(bar + 0.6, 0.9, 1.2)
    for m in ch:
        f = mid(m + 12)
        for det, side in ((-0.15, 0), (0.15, 1)):
            s = (np.sin(2*np.pi*(f+det)*t) + 0.18*np.sin(2*np.pi*2*(f+det)*t) + 0.06*np.sin(2*np.pi*3*(f+det)*t)) * e * 0.035
            add(L if side == 0 else Rr, t_bar, s); add(Rr if side == 0 else L, t_bar, s * 0.6)
    # бас: корень на 1-ю и 3-ю долю
    for b in (0, 2):
        t, e = env(beat * 1.8, 0.02, 0.6)
        f = mid(ch[0] - 12)
        s = (np.sin(2*np.pi*f*t) + 0.25*np.sin(2*np.pi*2*f*t)) * e * np.exp(-t * 1.2) * 0.11
        add(L, t_bar + b*beat, s); add(Rr, t_bar + b*beat, s)
    # перебор восьмыми со второго такта
    if k >= 1:
        notes = [ch[0]+24, ch[1]+24, ch[2]+24, ch[1]+24 + (12 if len(ch) > 3 else 0), ch[2]+24, ch[1]+24, ch[0]+36, ch[2]+24]
        for i, m in enumerate(notes):
            t, _ = env(1.2, 0.004, 0.3)
            f = mid(m); v = 0.05 * (0.8 + 0.4 * rng.random()) * (1.15 if i % 4 == 0 else 1)
            s = (np.sin(2*np.pi*f*t) + 0.3*np.sin(2*np.pi*2*f*t) * np.exp(-t*6)) * np.exp(-t * 3.2) * v
            pan = 0.35 if i % 2 else -0.35
            add(L, t_bar + i*beat/2, s * (1 - pan) / 1.2); add(Rr, t_bar + i*beat/2, s * (1 + pan) / 1.2)
    t_bar += bar; k += 1
# общий плавный вход и выход
tt = np.arange(n) / SR
fade = np.minimum(1, tt / 1.5) * np.minimum(1, np.maximum(0, (DUR - tt) / 3.0))
L *= fade; Rr *= fade
pk = max(np.abs(L).max(), np.abs(Rr).max()); L /= pk * 1.12; Rr /= pk * 1.12
data = (np.stack([L, Rr], 1) * 32767).astype('<i2').tobytes()
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data)
