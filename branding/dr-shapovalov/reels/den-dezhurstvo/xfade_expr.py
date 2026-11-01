"""Выражение для xfade=custom: плавный «зум с размытием» (как в современных рилсах).
   A уезжает в камеру, B выезжает из лёгкого приближения; 3 отсчёта вдоль радиуса дают смаз движения; смесь — smoothstep."""
def samp(f, s):
    taps = [s, f'({s})*1.035', f'({s})*1.07']
    return '(' + '+'.join(f"{f}(W/2+(X-W/2)/({t}),H/2+(Y-H/2)/({t}))" for t in taps) + ')/3'
def expr():
    m = '(P*P*(3-2*P))'
    parts = []
    for k in range(3):
        a, b = samp(f'a{k}', '1+0.28*(1-P)*(1-P)'), samp(f'b{k}', '1+0.22*P*P')
        parts.append(f"{a}*{m}+{b}*(1-{m})")
    return f"if(eq(PLANE,0),{parts[0]},if(eq(PLANE,1),{parts[1]},{parts[2]}))"
if __name__ == '__main__':
    print(expr())
