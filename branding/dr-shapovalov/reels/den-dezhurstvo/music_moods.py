"""Своя музыка по настроению частей дня (без чужих записей и мелодий):
   утро — мечтательный синтвейв 104 BPM; отдых и обед — бодрый поп-панк 168 BPM; вечер — спокойный эмбиент 72 BPM.
   python music_moods.py out.wav DUR REST_START EVENING_START '[переходы]'"""
import json, sys, wave
import numpy as np
from scipy.signal import butter, lfilter
SR = 48000
out, DUR, A, B = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]); WH = json.loads(sys.argv[5]) if len(sys.argv) > 5 else []
n = int(SR * (DUR + 2)); rng = np.random.default_rng(11)
hz = lambda m: 440 * 2 ** ((m - 69) / 12)
tt = lambda d: np.arange(int(d * SR)) / SR
def lp(x, fc): b, a = butter(2, min(fc, SR / 2 - 100) / (SR / 2)); return lfilter(b, a, x)
def hp(x, fc): b, a = butter(2, fc / (SR / 2), 'high'); return lfilter(b, a, x)
def bp(x, lo, hi): b, a = butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band'); return lfilter(b, a, x)
def saw(f, t, nh=None): nh = nh or max(1, int(8000 / f)); return sum(np.sin(2 * np.pi * k * f * t) / k for k in range(1, nh + 1)) * 0.6
def sq(f, t): return sum(np.sin(2 * np.pi * k * f * t) / k for k in range(1, max(2, int(6000 / f)), 2)) * 0.8
class Bus:
    def __init__(s): s.L = np.zeros(n); s.R = np.zeros(n)
    def put(s, sig, t0, pan=0.0, g=1.0):
        i = int(t0 * SR); j = min(n, i + len(sig))
        if i >= n or j <= 0 or i < 0: return
        x = sig[: j - i] * g; s.L[i:j] += x * (1 - pan) ** 0.5; s.R[i:j] += x * (1 + pan) ** 0.5
def kick(bus, t0, g=0.55):
    t = tt(0.32); f = 45 + 120 * np.exp(-t * 30); bus.put(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 10) * g, t0)
def snare(bus, t0, g=0.3):
    t = tt(0.22); bus.put((bp(rng.standard_normal(len(t)), 1200, 6000) * 0.8 + np.sin(2 * np.pi * 190 * t) * 0.5) * np.exp(-t * 16) * g, t0)
def hat(bus, t0, g=0.05, d=0.05):
    t = tt(d); bus.put(hp(rng.standard_normal(len(t)), 7000) * np.exp(-t * 70) * g, t0, rng.uniform(-0.3, 0.3))

def morning(t_end):
    """Мечтательный синтвейв: широкие расстроенные аккорды, арпеджио, гейт-барабаны. F–C–Dm–B♭ (светло и ностальгично)."""
    bus = Bus(); bpm = 104; beat = 60 / bpm; bar = 4 * beat
    prog = [(53, 57, 60, 65), (48, 55, 60, 64), (50, 57, 62, 65), (46, 53, 58, 62)]
    for b in range(int(t_end / bar) + 2):
        t0 = b * bar; ch = prog[b % 4]; drums = b >= 2
        t = tt(bar + 0.4); e = np.minimum(1, t / 0.05) * np.minimum(1, (bar + 0.4 - t) / 0.4)
        pad = sum(saw(hz(m + 12), t, 14) + saw(hz(m + 12) * 1.006, t, 14) + saw(hz(m + 12) * 0.994, t, 14) for m in ch)
        bus.put(lp(pad, 2400 if drums else 1300) * e * 0.022, t0, -0.25); bus.put(lp(pad, 2200) * e * 0.02, t0 + 0.015, 0.25)
        arp = [ch[0] + 24, ch[1] + 24, ch[2] + 24, ch[3] + 24, ch[2] + 24, ch[1] + 24, ch[3] + 24, ch[0] + 36]
        for k in range(16):
            m = arp[k % 8]; t = tt(0.22); s = lp(sq(hz(m), t), 3500) * np.exp(-t * 14)
            bus.put(s * 0.035, t0 + k * beat / 4, 0.4 if k % 2 else -0.4)
            bus.put(s * 0.015, t0 + k * beat / 4 + beat * 0.75, -0.6 if k % 2 else 0.6)       # эхо
        for q in range(8):                                                                    # бас восьмыми
            t = tt(beat / 2 - 0.02); f = hz(ch[0] - 12)
            bus.put(lp(saw(f, t, 8), 600) * np.minimum(1, t / 0.005) * np.exp(-t * 4) * 0.12, t0 + q * beat / 2)
        if drums:
            for q in range(4): kick(bus, t0 + q * beat, 0.5); hat(bus, t0 + q * beat + beat / 2)
            for q in (1, 3): snare(bus, t0 + q * beat, 0.3)
        # простая мелодия-«лид» на длинных нотах (своя)
        if drums and b % 2 == 0:
            for k, (m, l) in enumerate(((ch[3] + 24, 1.5), (ch[2] + 24, 1.0), (ch[1] + 24, 1.5))):
                t = tt(l * beat); s = lp(saw(hz(m), t, 10) + saw(hz(m) * 1.004, t, 10), 2600) * np.minimum(1, t / 0.04) * np.exp(-t * 0.8)
                bus.put(s * 0.03, t0 + sum((1.5, 1.0, 1.5)[:k]) * beat, 0.1)
    return bus

def punk(t0s, t_end):
    """Бодрый поп-панк: быстрые прямые барабаны, «перегруженные» квинты восьмыми, бас — I–V–vi–IV в E."""
    bus = Bus(); bpm = 168; beat = 60 / bpm; bar = 4 * beat
    prog = [40, 47, 49, 45]                                                                   # E B C# A (корни)
    t0 = t0s; b = 0
    while t0 < t_end + bar:
        r = prog[b % 4]
        for q in range(8):
            tq = t0 + q * beat / 2; t = tt(beat / 2 - 0.01)
            g = np.tanh(4 * (saw(hz(r + 12), t, 20) + saw(hz(r + 19), t, 20) + saw(hz(r + 24), t, 16)))        # «гитара»: квинта + октава с перегрузом
            s = lp(g, 3200) * np.minimum(1, t / 0.003) * np.exp(-t * 2.5)
            bus.put(s * 0.07, tq, -0.5); bus.put(s * 0.065, tq + 0.008, 0.5)
            bus.put(lp(saw(hz(r - 12), t, 10), 500) * np.exp(-t * 3) * 0.13, tq)
            hat(bus, tq, 0.045, 0.04)
        for q in range(4):
            kick(bus, t0 + q * beat, 0.5)
            if q % 2: snare(bus, t0 + q * beat, 0.36)
        if b % 4 == 3:
            t = tt(0.9); bus.put(hp(rng.standard_normal(len(t)), 4000) * np.exp(-t * 4) * 0.07, t0)          # тарелка
        t0 += bar; b += 1
    return bus

def evening(t0s, t_end):
    """Спокойный финал: мягкий пэд, «колокольчики» и тёплый бас, без барабанов. C–Am–F–G, 72 BPM."""
    bus = Bus(); bpm = 72; beat = 60 / bpm; bar = 4 * beat
    prog = [(48, 55, 60, 64), (45, 52, 57, 60), (41, 48, 57, 60), (43, 50, 55, 59)]
    t0 = t0s; b = 0
    while t0 < t_end:
        ch = prog[b % 4]; t = tt(bar + 1.0); e = np.minimum(1, t / 0.8) * np.minimum(1, (bar + 1.0 - t) / 1.0)
        pad = sum(np.sin(2 * np.pi * hz(m + 12) * t) + 0.3 * np.sin(2 * np.pi * hz(m + 12) * 2.002 * t) for m in ch)
        bus.put(pad * e * 0.05, t0, -0.2); bus.put(pad * e * 0.04, t0 + 0.02, 0.2)
        t = tt(bar); bus.put(np.sin(2 * np.pi * hz(ch[0] - 12) * t) * np.minimum(1, t / 0.1) * np.exp(-t * 0.6) * 0.15, t0)
        for k, m in enumerate((ch[3] + 24, ch[2] + 24, ch[1] + 24, ch[2] + 24, ch[3] + 24, ch[2] + 36)):
            t = tt(1.6); s = (np.sin(2 * np.pi * hz(m) * t) + 0.3 * np.sin(2 * np.pi * hz(m) * 2.76 * t)) * np.exp(-t * 2.6)
            bus.put(s * 0.07, t0 + k * beat * 0.66, 0.3 if k % 2 else -0.3)
        t0 += bar; b += 1
    return bus

X = 0.5                                                                                     # перекрёстное затухание между частями
def env(start, end, fin=True, fout=True):
    t = np.arange(n) / SR; e = np.ones(n)
    if fin: e *= np.clip((t - start + X) / X, 0, 1)
    if fout: e *= np.clip((end + X - t) / X, 0, 1)
    return e
parts = [(morning(A + 1), env(0, A, fin=False)), (punk(A - X, B + 1), env(A, B)), (evening(B - X, DUR + 1), env(B, DUR + 2, fout=False))]
L = sum(p.L * e for p, e in parts); R = sum(p.R * e for p, e in parts)
fx = Bus()
for w in WH:
    t = tt(0.5); fx.put(bp(rng.standard_normal(len(t)), 300, 5000) * np.sin(np.pi * t / 0.5) ** 2 * 0.04, w - 0.25, rng.uniform(-0.5, 0.5))
L += fx.L; R += fx.R
mix = np.stack([L, R], 1)[: int(SR * DUR)]
fade = np.ones(len(mix)); k = int(1.5 * SR); fade[-k:] = np.linspace(1, 0, k); fade[: int(0.3 * SR)] = np.linspace(0, 1, int(0.3 * SR)); mix *= fade[:, None]
mix = np.tanh(mix * 1.2) / np.tanh(1.2); mix /= np.max(np.abs(mix)) * 1.12
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
print(out)
