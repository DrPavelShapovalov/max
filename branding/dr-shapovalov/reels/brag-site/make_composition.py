"""Собирает composition/index.html для ролика /brag-slim о сайте drshapovalov.ru.
Схема «Как растёт кость» — настоящий SVG с сайта (index.html), тексты и цифры — из content.json.
Каждый кадр — функция времени: window.renderAt(t)."""
import json, pathlib, re, html
HERE = pathlib.Path(__file__).resolve().parent
SITE = HERE.parent.parent / 'site'
src = (SITE / 'index.html').read_text(encoding='utf-8')
svg = re.search(r'<svg class="dx-svg".*?</svg>', src, re.S).group(0)
svg = re.sub(r'<title id="dx-t">.*?</title>', '', svg, flags=re.S)
css_dx = '\n'.join(l for l in src.splitlines() if l.strip().startswith('.dx-svg') and 'max-height' not in l)
c = json.loads((SITE / 'content.json').read_text(encoding='utf-8'))
e = lambda s: html.escape(str(s or ''))
ph = [p['title'] for p in c['distraction']['phases']]
rd = c['readings']
h = c['hero']
intro = c['distraction']['intro'].split('. ')[0] + '.'   # «Если нижняя челюсть недоразвита, её можно удлинить.»
first, second = intro.split(', ', 1)
maxmm = c['distraction'].get('maxMm', 15)

page = f'''<!doctype html><html lang="ru"><head><meta charset="utf-8">
<link rel="stylesheet" href="fonts/fonts.css">
<style>
:root{{--void:#05080a;--deep:#0a1513;--emerald:#164236;--ivory:#ede8de;--mist:#93a19b;--soft:#c3ccc8;--line:rgba(237,232,222,.12);
--gold:#d6b266;--gold-hi:#f0d48e;--display:'Unbounded',sans-serif;--text:'Manrope',sans-serif}}
*{{box-sizing:border-box;margin:0}}
html,body{{width:1080px;height:1920px;overflow:hidden;background:var(--void)}}
body{{font-family:var(--text);color:var(--ivory);-webkit-font-smoothing:antialiased}}
#bg{{position:absolute;inset:0}}
.layer{{position:absolute;inset:0;padding:0 90px;opacity:0}}
.kick{{font:600 30px var(--text);letter-spacing:.02em;color:var(--gold)}}
h1,h2{{font-family:var(--display);font-weight:500;line-height:1.08;letter-spacing:-.01em}}
.ln{{display:block;will-change:transform,opacity}}
em{{font-style:normal;color:var(--gold)}}
/* 1 */
#s1{{display:flex;flex-direction:column;justify-content:center;gap:34px}}
#s1 h1{{font-size:112px}}
#s1 .rule{{height:3px;width:0;background:var(--gold);border-radius:3px}}
/* 2 */
#s2{{display:flex;flex-direction:column;justify-content:center}}
#s2 h2{{font-size:92px}}
#s2 .fig{{margin:60px -90px 0;width:1080px}}
#s2 svg{{width:1080px!important;height:auto;max-height:none!important;overflow:visible}}
{css_dx}
.mm{{margin-top:40px;font:700 200px/0.9 var(--display);letter-spacing:-.04em;font-variant-numeric:tabular-nums}}
.mm small{{margin-left:20px;font:500 56px var(--display);letter-spacing:0;color:var(--gold)}}
.steps{{list-style:none;padding:0;margin-top:56px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px}}
.steps li{{display:flex;flex-direction:column;gap:14px;font:600 34px var(--text);color:var(--mist)}}
.steps li.on{{color:var(--ivory)}}
.steps i{{display:block;height:6px;border-radius:6px;background:rgba(237,232,222,.14);overflow:hidden}}
.steps b{{display:block;height:100%;background:var(--gold);transform-origin:left;transform:scaleX(0)}}
/* 3 */
#s3 .photo{{position:absolute;left:0;right:0;top:120px;height:1120px;display:flex;justify-content:center;
-webkit-mask-image:linear-gradient(#000 70%,transparent 100%);mask-image:linear-gradient(#000 70%,transparent 100%)}}
#s3 .photo img{{height:100%;width:auto}}
#s3 .txt{{position:absolute;left:90px;right:90px;bottom:250px}}
#s3 h1{{font-size:104px;font-weight:300}}
#s3 h1 b{{display:block;font-weight:700;color:var(--gold)}}
#s3 p{{margin-top:34px;font-size:44px;line-height:1.35;color:var(--soft)}}
/* 4 */
#s4{{display:flex;flex-direction:column;justify-content:center;gap:34px}}
.card{{padding:52px 54px;border-radius:40px;border:2px solid rgba(214,178,102,.28);
background:linear-gradient(135deg,rgba(22,66,54,.55),rgba(10,21,19,.75));box-shadow:0 30px 80px rgba(0,0,0,.35)}}
.card .n{{font:700 170px/1 var(--display);color:var(--gold);letter-spacing:-.03em;font-variant-numeric:tabular-nums}}
.card .n small{{margin-left:16px;font:500 48px var(--display);color:var(--ivory)}}
.card p{{margin-top:16px;font-size:44px;line-height:1.3;color:var(--soft)}}
/* 5 */
#s5{{display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:40px}}
#s5 .mark{{width:180px;height:180px}}
#s5 .wm{{font:300 56px var(--display);letter-spacing:.08em;color:var(--gold)}}
#s5 .dom{{font:700 100px var(--display);letter-spacing:-.01em}}
#s5 p{{font-size:46px;color:var(--soft);max-width:860px;line-height:1.35}}
#s5 .sig{{width:720px;height:auto}}
</style></head><body>
<div id="bg"></div>
<section class="layer" id="s1">
  <span class="kick ln">drshapovalov.ru</span>
  <h1><span class="ln" id="s1a">{e(first)},</span><span class="ln" id="s1b"><em>{e(second)}</em></span></h1>
  <div class="rule" id="s1r"></div>
</section>
<section class="layer" id="s2">
  <h2 class="ln" id="s2h">{e(c['distraction']['heading']).replace('кость', '<em>кость</em>')}</h2>
  <div class="fig ln" id="s2f">{svg}</div>
  <div class="mm ln" id="s2m"><span id="mmv">0,0</span><small>мм</small></div>
  <ol class="steps ln" id="s2s">{''.join(f'<li><i><b></b></i>{e(t)}</li>' for t in ph)}</ol>
</section>
<section class="layer" id="s3">
  <div class="photo ln" id="s3p"><img src="hero-figure-2.webp" alt=""></div>
  <div class="txt"><h1><span class="ln" id="s3a">{e(h['firstName'])} {e(h.get('middleName',''))}</span><b class="ln" id="s3b">{e(h['lastName'])}</b></h1>
  <p class="ln" id="s3c">Челюстно-лицевой хирург, кандидат медицинских наук.<br>Лечу детей и подростков.</p></div>
</section>
<section class="layer" id="s4">
  {''.join(f'<div class="card ln" id="c{i}"><div class="n"><span data-to="{e(r["to"])}">0</span><small>{e(r["unit"])}</small></div><p>{e(r["label"].strip())}</p></div>' for i, r in enumerate(rd))}
</section>
<section class="layer" id="s5">
  <img class="mark ln" id="s5m" src="mark-white.svg" alt="">
  <div class="wm ln" id="s5w">S. H. A. P. O. V. A. L. O. V.</div>
  <div class="dom ln" id="s5d">drshapovalov.ru</div>
  <p class="ln" id="s5p">Как растёт кость, кейсы с цифрами, статьи и контакты</p>
  <img class="sig ln" id="s5s" src="signature-gold.png" alt="">
</section>
<script>
const $ = (id) => document.getElementById(id);
const cl = (v) => Math.max(0, Math.min(1, v)), seg = (t, a, b) => cl((t - a) / (b - a));
const eo = (x) => 1 - Math.pow(1 - x, 3), eio = (x) => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const MAX = {maxmm};
function show(el, t, a, d = .45, dy = 46) {{ const k = eo(seg(t, a, a + d)); el.style.opacity = k; el.style.transform = `translateY(${{(1 - k) * dy}}px)`; }}
function layer(id, t, a, b) {{ // вход 0,3 с, выход 0,25 с — без двойной экспозиции
  const L = $(id), k = t < a || t >= b ? 0 : Math.min(eo(seg(t, a, a + .3)), 1 - eio(seg(t, b - .25, b)));
  L.style.opacity = k; L.style.transform = `translateY(${{(1 - eo(seg(t, b - .25, b))) * 0 - eio(seg(t, b - .25, b)) * 40}}px)`; return t >= a && t < b; }}
const fmt = (v) => v.toFixed(1).replace('.', ',');
function dxSet(p) {{ // логика dxSet с сайта (index.html), без подписей интерфейса
  const s = (a, b) => cl((p - a) / (b - a));
  const cut = s(0, .1), dev = s(.05, .15), lat = s(.1, .22), act = s(.22, .82), con = s(.82, 1);
  const mm = act * MAX, dx = act * 90;
  $('dx-cut').setAttribute('y2', (210 + 139 * cut).toFixed(1));
  $('dx-dev').setAttribute('opacity', dev.toFixed(3)); $('dx-dev').setAttribute('transform', `translate(0 ${{((1 - dev) * -14).toFixed(2)}})`);
  $('dx-plate-a').setAttribute('opacity', dev.toFixed(3));
  $('dx-ant').setAttribute('transform', `translate(${{dx.toFixed(2)}} 0)`);
  $('dx-gap').setAttribute('width', dx.toFixed(2)); $('dx-cons').setAttribute('width', dx.toFixed(2));
  $('dx-cons').setAttribute('opacity', (con * .92).toFixed(3));
  $('dx-knob').setAttribute('transform', `rotate(${{(mm * 96).toFixed(1)}} 100 333)`);
  const dim = $('dx-dim'); if (dim) {{ dim.setAttribute('opacity', act > .02 ? 1 : 0); $('dx-dim-r').setAttribute('transform', `translate(${{dx.toFixed(2)}} 0)`);
    $('dx-dim-l').setAttribute('x2', (345 + dx).toFixed(2)); $('dx-dim-t').setAttribute('x', (345 + dx / 2).toFixed(2)); $('dx-dim-t').textContent = fmt(mm) + ' мм'; }}
  $('mmv').textContent = fmt(mm);
  const fills = [cut, lat, act, con], idx = p < .1 ? 0 : p < .22 ? 1 : p < .82 ? 2 : 3;
  document.querySelectorAll('#s2s li').forEach((li, i) => {{ li.querySelector('b').style.transform = `scaleX(${{fills[i]}})`; li.classList.toggle('on', i === idx); }});
}}
window.renderAt = (t) => {{
  // фон: изумрудное свечение медленно дрейфует, как на сайте
  const gx = 30 + 25 * Math.sin(t * .25), gy = 18 + 10 * Math.cos(t * .2);
  $('bg').style.background = `radial-gradient(70% 45% at ${{gx}}% ${{gy}}%, rgba(22,66,54,.95), transparent 70%),
    radial-gradient(60% 40% at ${{100 - gx}}% ${{88 - gy / 2}}%, rgba(214,178,102,.10), transparent 70%), #05080a`;
  if (layer('s1', t, 0, 3)) {{ show(document.querySelector('#s1 .kick'), t, .05); show($('s1a'), t, .2, .5, 70); show($('s1b'), t, .95, .5, 70);
    $('s1r').style.width = (eo(seg(t, 1.5, 2.3)) * 260) + 'px'; }}
  if (layer('s2', t, 3, 9)) {{ show($('s2h'), t, 3.05); show($('s2f'), t, 3.2, .5, 60); show($('s2m'), t, 3.4); show($('s2s'), t, 3.55);
    dxSet(eio(seg(t, 3.6, 8.4))); }}
  if (layer('s3', t, 9, 13)) {{ const k = eo(seg(t, 9, 9.7)); $('s3p').style.opacity = k; $('s3p').style.transform = `translateY(${{(1 - k) * 90}}px) scale(${{1.04 - .04 * k}})`;
    show($('s3a'), t, 9.25, .5, 60); show($('s3b'), t, 9.5, .5, 60); show($('s3c'), t, 10.0); }}
  if (layer('s4', t, 13, 17)) {{ [13.0, 13.5, 14.0].forEach((a, i) => {{ const el = $('c' + i); if (!el) return; show(el, t, a, .45, 60);
      const sp = el.querySelector('[data-to]'); sp.textContent = Math.round(eo(seg(t, a + .05, a + .65)) * (+sp.dataset.to)); }}); }}
  if (layer('s5', t, 17, 20.5)) {{ show($('s5m'), t, 17.05, .5, 30); show($('s5w'), t, 17.25); show($('s5d'), t, 17.45, .5, 60); show($('s5p'), t, 17.9);
    const s = $('s5s'); const k = eo(seg(t, 18.2, 19.3)); s.style.opacity = k > 0 ? 1 : 0; s.style.transform = 'none'; s.style.clipPath = `inset(0 ${{(1 - k) * 100}}% 0 0)`; }}
}};
window.renderAt(0);
</script></body></html>'''
import shutil
C = HERE / 'composition'; C.mkdir(exist_ok=True)
shutil.copytree(SITE / 'fonts', C / 'fonts', dirs_exist_ok=True)
for f in ('img/hero-figure-2.webp', 'img/signature-gold.png'): shutil.copy2(SITE / f, C)
shutil.copy2(HERE.parent.parent / 'mark-white.svg', C)
(HERE / 'composition' / 'index.html').write_text(page, encoding='utf-8')
print('ok', len(page), 'phases', ph, 'readings', [(r['to'], r['unit']) for r in rd])
