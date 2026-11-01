"""Своя музыка для рилса (без лицензий): светлый «футуристичный» синт-поп, 112 BPM, C–G–Am–F.
   python music_future.py out.wav DUR '[t1, t2, ...]'   — t: моменты переходов, на них мягкий «вжух»."""
import json, sys, wave
import numpy as np
from scipy.signal import butter, lfilter
SR, BPM = 48000, 112
out, DUR = sys.argv[1], float(sys.argv[2]); WH = json.loads(sys.argv[3]) if len(sys.argv) > 3 else []
beat = 60 / BPM; bar = 4 * beat; n = int(SR * (DUR + 1)); L = np.zeros(n); R = np.zeros(n)
rng = np.random.default_rng(7)
hz = lambda m: 440 * 2 ** ((m - 69) / 12)
def put(sig, t0, pan=0.0, g=1.0):
    i = int(t0 * SR); j = min(n, i + len(sig))
    if i >= n or j <= 0: return
    s = sig[: j - i] * g; L[i:j] += s * (1 - pan) ** 0.5; R[i:j] += s * (1 + pan) ** 0.5
def tt(d): return np.arange(int(d * SR)) / SR
def saw(f, t, nh=None):
    nh = nh or max(1, int(9000 / f)); return sum(np.sin(2 * np.pi * k * f * t) / k for k in range(1, nh + 1)) * 0.6
def lp(x, fc, order=2): b, a = butter(order, fc / (SR / 2)); return lfilter(b, a, x)
def hp(x, fc, order=2): b, a = butter(order, fc / (SR / 2), 'high'); return lfilter(b, a, x)
def bp(x, lo, hi): b, a = butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band'); return lfilter(b, a, x)
PROG = [(60, 64, 67), (55, 59, 62), (57, 60, 64), (53, 57, 60)]           # C G Am F
nbars = int(np.ceil(DUR / bar)); FULL0, END = 2, DUR - 3.4                  # барабаны со 2-го такта, финал — без барабанов
side = np.ones(n)                                                            # «пампинг» от бочки
for b in range(nbars):
    t0 = b * bar; ch = PROG[b % 4]; drums = FULL0 <= b and t0 < END
    # пэд — расстроенные пилы через фильтр
    t = tt(bar + 0.3); e = np.minimum(1, t / 0.25) * np.minimum(1, (bar + 0.3 - t) / 0.3)
    pad = sum(saw(hz(m), t, 12) + saw(hz(m) * 1.004, t, 12) for m in ch)
    put(lp(pad, 1800 if drums else 1100) * e * 0.05, t0, -0.2); put(lp(pad, 1600) * e * 0.04, t0 + 0.012, 0.3)
    # «стеклянный» перебор 16-ми (как колокольчики)
    arp = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[0] + 24]
    for k in range(16 if drums else 8):
        step = beat / 4 if drums else beat / 2
        m = arp[k % 4] + (12 if (k // 4) % 2 and drums else 0); t = tt(0.35)
        s = (np.sin(2 * np.pi * hz(m) * t) + 0.35 * np.sin(2 * np.pi * hz(m) * 2.76 * t)) * np.exp(-t * 11)
        put(s * 0.07, t0 + k * step, 0.5 if k % 2 else -0.5)
    if drums:
        for q in range(4):                                                   # бочка + бас восьмыми
            tk = t0 + q * beat; t = tt(0.35); f = 45 + 110 * np.exp(-t * 32)
            put(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * 0.55, tk)
            i = int(tk * SR); m = min(n, i + int(beat * SR)); side[i:m] = np.minimum(side[i:m], 1 - 0.55 * np.exp(-np.arange(m - i) / SR / 0.11))
            for h in (0, 0.5):
                t = tt(beat / 2 - 0.02); fb = hz(ch[0] - 24)
                put((np.sin(2 * np.pi * fb * t) + 0.3 * np.sin(4 * np.pi * fb * t)) * np.minimum(1, t / 0.01) * np.exp(-t * 3) * 0.16, tk + h * beat)
            t = tt(0.06); put(hp(rng.standard_normal(len(t)), 7000) * np.exp(-t * 70) * 0.05, tk + beat / 2, 0.3)   # хэт на слабую
        for q in (1, 3):                                                     # хлопок на 2 и 4
            t = tt(0.25); s = bp(rng.standard_normal(len(t)), 900, 3500) * np.exp(-t * 18)
            put(s * 0.15, t0 + q * beat - 0.01, -0.1); put(s * 0.11, t0 + q * beat + 0.012, 0.1)
    # мелодия-колокольчик раз в такт (детская, простая)
    mel = [ch[2] + 24, ch[1] + 24, ch[2] + 24, ch[0] + 36]
    for k, m in enumerate(mel[: 2 if not drums else 4]):
        t = tt(0.9); s = (np.sin(2 * np.pi * hz(m) * t) + 0.25 * np.sin(2 * np.pi * hz(m) * 3.0 * t)) * np.exp(-t * 4)
        put(s * 0.06, t0 + k * beat + beat * 0.5, 0.15)
L *= side; R *= side
# подъём (riser) к первому удару и «вжух» на переходах
t = tt(bar); x = rng.standard_normal(len(t)); r = bp(x, 800, 5000) * (t / t[-1]) ** 3 * 0.035; put(r, (FULL0 - 1) * bar)
for w in WH:
    t = tt(0.5); x = bp(rng.standard_normal(len(t)), 300, 5000) * np.sin(np.pi * t / 0.5) ** 2 * 0.045; put(x, w - 0.25, rng.uniform(-0.5, 0.5))
# финальный аккорд C с колокольчиками
t = tt(3.4); e = np.minimum(1, t / 0.4) * np.exp(-t * 0.6)
put(lp(sum(saw(hz(m), t, 10) for m in (48, 60, 64, 67, 72)), 1500) * e * 0.06, END)
for k, m in enumerate((72, 76, 79, 84)):
    tb = tt(1.6); put((np.sin(2 * np.pi * hz(m) * tb) + 0.3 * np.sin(2 * np.pi * hz(m) * 2.76 * tb)) * np.exp(-tb * 3) * 0.08, END + 0.15 + k * 0.18)
mix = np.stack([L, R], 1)[: int(SR * DUR)]
fade = np.ones(len(mix)); k = int(1.2 * SR); fade[-k:] = np.linspace(1, 0, k); mix *= fade[:, None]
mix = np.tanh(mix * 1.15) / np.tanh(1.15); mix /= np.max(np.abs(mix)) * 1.12
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
print(out, round(DUR, 2), 's')
