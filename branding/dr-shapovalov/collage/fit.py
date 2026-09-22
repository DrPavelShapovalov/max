# Crops a before/after pair into boxes of one aspect (uniform scale only):
# the anchor lands at the same spot in both, must-include points stay inside
# with a margin, crops never leave the source. Scales are kept as close as the
# sources allow (mismatch = 1.0 means identical scale).
import itertools

def crop(p, W, H, D, ax, ay):
    s = p['ref'] / D                      # source px per output px; D = ref length in output px
    l = p['anchor'][0] - ax * W * s
    t = p['anchor'][1] - ay * H * s
    return (l, t, l + W * s, t + H * s)

def in_bounds(p, b):
    l, t, r, bt = b
    return l >= 0 and t >= 0 and r <= p['size'][0] and bt <= p['size'][1]

def covers(p, b, m):
    l, t, r, bt = b
    mx, my = (r - l) * m, (bt - t) * m
    return all(l + mx <= x <= r - mx and t + my <= y <= bt - my for x, y in p['include'])

def search(pred, lo, hi, want_high):
    for _ in range(40):
        mid = (lo + hi) / 2
        if pred(mid) == want_high: lo = mid
        else: hi = mid
    return lo if want_high else hi

def solve(photos, W, H, margin=0.03, step=0.01):
    best = None
    grid = [i * step for i in range(int(0.15 / step), int(0.85 / step) + 1)]
    for ax, ay in itertools.product(grid, grid):
        dmin, dmax = [], []
        for p in photos:
            if not covers(p, crop(p, W, H, 0.01, ax, ay), margin):
                break
            hi_ = search(lambda D: covers(p, crop(p, W, H, D, ax, ay), margin), 0.01, 5000, True)
            lo_ = search(lambda D: in_bounds(p, crop(p, W, H, D, ax, ay)), 0.01, 5000, False)
            if lo_ > hi_:
                break
            dmin.append(lo_); dmax.append(hi_)
        else:
            common = min(dmax)
            Ds = [max(common, d) for d in dmin]
            if any(D > dm for D, dm in zip(Ds, dmax)):
                continue
            mismatch = max(Ds) / min(Ds)
            key = (round(mismatch, 3), -common)
            if best is None or key < best[0]:
                best = (key, ax, ay, Ds)
    if best is None:
        return None
    _, ax, ay, Ds = best
    return dict(mismatch=best[0][0], ax=ax, ay=ay, D=Ds,
                boxes=[crop(p, W, H, D, ax, ay) for p, D in zip(photos, Ds)])
