"""Музыка и звуки для ролика: 120 BPM (доля 0,5 с), ре минор, 20 с. Всё на одной сетке от первого кадра.
Склейки 3 / 9 / 13 / 17 с, карточки 13,0 / 13,5 / 14,0 с. Выход: brag-output/work/music.wav (48 кГц, стерео)."""
import numpy as np, pathlib
from scipy.signal import fftconvolve, butter, sosfilt
SR = 48000; DUR = 20.0; BEAT = 0.5; N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(7)
def note(n): return 440.0 * 2 ** ((n - 69) / 12)           # MIDI → Гц
def env(length, a=0.005, d=0.3, curve=4.0):
    x = np.arange(int(length * SR)) / SR
    e = np.minimum(1, x / max(a, 1e-4)) * np.exp(-curve * x / d)
    return e
def place(buf, sig, at):
    i = int(round(at * SR)); j = min(len(buf), i + len(sig))
    if j > i: buf[i:j] += sig[:j - i]
def lp(x, f): return sosfilt(butter(2, f, 'low', fs=SR, output='sos'), x)
def hp(x, f): return sosfilt(butter(2, f, 'high', fs=SR, output='sos'), x)
def bp(x, lo, hi): return sosfilt(butter(2, [lo, hi], 'band', fs=SR, output='sos'), x)

# аккорды по 2 такта (4 с): Dm – B♭ – F – C – Dm
CH = [(62, 65, 69), (58, 62, 65), (65, 69, 72), (60, 64, 67), (62, 65, 69)]
ROOT = [38, 34, 41, 36, 38]
def chord_at(x): return min(int(x // 4), 4)

pad = np.zeros(N); arp = np.zeros(N); bass = np.zeros(N); kick = np.zeros(N); hat = np.zeros(N); clap = np.zeros(N)
bell = np.zeros(N); sfx = np.zeros(N)
# пэд: мягкие пилообразные гармоники, медленная атака, без резких краёв
for k, chs in enumerate(CH):
    a, b = k * 4.0, min(DUR, k * 4.0 + 4.0)
    seg = (t >= a) & (t < b + 0.3)
    tt = t[seg] - a
    s = np.zeros(seg.sum())
    for n in chs:
        for det in (-0.06, 0.06):
            f = note(n) * 2 ** (det / 12)
            for h in range(1, 6): s += np.sin(2 * np.pi * f * h * tt + rng.random() * 6) / h ** 1.6
    e = np.minimum(1, tt / 0.8) * np.minimum(1, np.maximum(0, (b + 0.3 - a - tt) / 0.5))
    pad[seg] += s * e
pad = lp(pad, 2200) * 0.018
# арпеджио восьмыми (пьяно-щипок) с 0 с
for i in range(int(DUR / (BEAT / 2))):
    x = i * BEAT / 2
    if x >= 19.0: break
    chs = CH[chord_at(x)]; n = [chs[0] + 12, chs[1] + 12, chs[2] + 12, chs[1] + 12][i % 4]
    L = 0.45; tt = np.arange(int(L * SR)) / SR; f = note(n)
    s = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(4 * np.pi * f * tt)) * env(L, 0.003, 0.22)
    place(arp, s * (0.6 if x < 3 else 1.0), x)
arp = lp(arp, 5000) * 0.05
# бас с 3 с, четвертями, глушится на финале
for i in range(int(3 / BEAT), int(19 / BEAT)):
    x = i * BEAT; f = note(ROOT[chord_at(x)]); L = 0.48; tt = np.arange(int(L * SR)) / SR
    s = np.tanh(1.6 * np.sin(2 * np.pi * f * tt)) * env(L, 0.006, 0.45, 2.5)
    place(bass, s, x)
bass = lp(bass, 700) * 0.16
# бочка: на 0 одна, с 3 с — на каждую долю, до 19 с
def kick_hit(level=1.0):
    L = 0.32; tt = np.arange(int(L * SR)) / SR
    ph = 2 * np.pi * np.cumsum(45 + 85 * np.exp(-tt / 0.03)) / SR
    return np.sin(ph) * env(L, 0.001, 0.22, 3.0) * level
place(kick, kick_hit(0.8), 0.0)
for i in range(int(3 / BEAT), int(19 / BEAT)): place(kick, kick_hit(0.75 if i % 2 else 0.9), i * BEAT)
kick *= 0.34
# хэты восьмыми с 5 с (офбиты), хлопок на 2 и 4 с 9 с
for i in range(int(5 / (BEAT / 2)), int(19 / (BEAT / 2))):
    if i % 2 == 1: place(hat, hp(rng.standard_normal(int(0.04 * SR)), 7000) * env(0.04, 0.001, 0.02), i * BEAT / 2)
hat *= 0.035
for i in range(int(9 / BEAT), int(19 / BEAT)):
    if i % 2 == 1: place(clap, bp(rng.standard_normal(int(0.18 * SR)), 900, 3500) * env(0.18, 0.002, 0.08), i * BEAT)
clap *= 0.07
# колокольчик-мелодия с 9 с: простой мотив в ре миноре, на долях
MEL = [(9.0, 74), (9.5, 77), (10.0, 81), (11.0, 79), (11.5, 77), (12.0, 74), (13.0, 72), (13.5, 74), (14.0, 77), (15.0, 76),
       (16.0, 77), (16.5, 76), (17.0, 74), (18.0, 81)]
for x, n in MEL:
    L = 1.2; tt = np.arange(int(L * SR)) / SR; f = note(n)
    s = (np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * f * 3.01 * tt)) * env(L, 0.004, 0.7, 3.0)
    place(bell, s, x)
bell *= 0.05
# звуки склеек: мягкий подъём шума к склейке + тихий низкий удар ре в момент склейки (в тональности)
for cut in (3.0, 9.0, 13.0, 17.0):
    L = 0.5; noise = bp(rng.standard_normal(int(L * SR)), 500, 4000)
    swell = noise * np.linspace(0, 1, len(noise)) ** 2.5
    place(sfx, swell * 0.035, cut - L)
    tt = np.arange(int(0.9 * SR)) / SR
    place(sfx, np.sin(2 * np.pi * note(38) * tt) * env(0.9, 0.004, 0.6, 3) * 0.10, cut)
# щелчки карточек — на долях 13,0 / 13,5 / 14,0, тихо, нота ля
for x in (13.0, 13.5, 14.0):
    tt = np.arange(int(0.12 * SR)) / SR
    place(sfx, np.sin(2 * np.pi * note(81) * tt) * env(0.12, 0.001, 0.05) * 0.05, x)

# сайдчейн от бочки на пэд и бас — музыка «дышит» в долю
side = np.ones(N)
for i in range(int(3 / BEAT), int(19 / BEAT)):
    a = int(i * BEAT * SR); L = int(0.25 * SR); side[a:a + L] = np.minimum(side[a:a + L], 1 - 0.35 * np.exp(-np.arange(L) / (0.08 * SR)))
# общее пространство: короткий ревёрб для пэда, колокольчика и звуков склеек
ir = rng.standard_normal(int(1.6 * SR)) * np.exp(-np.arange(int(1.6 * SR)) / (0.45 * SR)); ir = lp(ir, 6000); ir /= np.abs(ir).sum() / 6
wet_src = pad * 0.5 + bell + sfx * 0.6 + arp * 0.4
wet = fftconvolve(wet_src, ir)[:N] * 0.35
dry = pad * side + arp + bass * side + kick + hat + clap + bell + sfx
mix = dry + wet
# финал: затухание 19,0 → 20,0
mix *= np.where(t > 19.0, np.clip((20.0 - t) / 1.0, 0, 1) ** 1.5, 1)
mix = np.tanh(mix * 1.2) / 1.2
mix /= np.abs(mix).max() / 0.89                     # пик ≈ −1 дБFS
stereo = np.stack([mix, np.concatenate([mix[48:], np.zeros(48)]) * 0.98 + mix * 0.02], 1)   # лёгкая ширина
out = pathlib.Path(__file__).resolve().parent / 'brag-output' / 'work' / 'music.wav'
import wave
with wave.open(str(out), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((stereo * 32767).astype('<i2').tobytes())
print('ok', out, f'{DUR}s', 'rms', round(float(np.sqrt((mix ** 2).mean())), 3))
