"""Полный /brag (HyperFrames) о сайте drshapovalov.ru.

Собирает <run>/composition/: index.html + assets/ (шрифты, картинки сайта, музыка, звуки).
Схема «Как растёт кость» и подпись — настоящий SVG с сайта (site/index.html),
логика раздвигания — функция dxSet() с сайта, тексты и цифры — из site/content.json.
Свечение фона «дышит» по басам музыки (audio-data.json из скилла media-use).

Запуск:  python3 make_full.py brag-output-YYYY-MM-DD-HHMMSS
"""
import html, json, pathlib, re, shutil, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent
SITE = HERE.parent.parent / 'site'
RUN = HERE / sys.argv[1]
C = RUN / 'composition'
BRAG = pathlib.Path('/root/.claude/skills/brag/assets')
MEDIA = pathlib.Path('/root/.claude/skills/media-use/audio/scripts/extract-audio-data.py')
TRACK = 'happy-beats-business-moves-vol-12-by-ende-dot-app.mp3'
DUR = 23.0

# ---------- ассеты ----------
for d in ('assets/fonts', 'assets/img', 'assets/music', 'assets/sfx/interface', 'assets/sfx/impact', 'vendor'):
    (C / d).mkdir(parents=True, exist_ok=True)
for f in (SITE / 'fonts').iterdir():
    if f.suffix in ('.woff2', '.txt'): shutil.copy2(f, C / 'assets/fonts' / f.name)
for f in ('img/hero-figure-2.webp', 'img/signature-gold.png'): shutil.copy2(SITE / f, C / 'assets/img')
shutil.copy2(HERE.parent.parent / 'mark-white.svg', C / 'assets/img')
shutil.copy2(BRAG / 'music' / TRACK, C / 'assets/music')
for f in ('interface/bong_001.ogg', 'interface/drop_002.ogg', 'impact/impactSoft_medium_001.ogg'):
    shutil.copy2(BRAG / 'sfx' / f, C / 'assets/sfx' / f)
shutil.copy2('/root/.cache/hyperframes-vendor/node_modules/gsap/dist/gsap.min.js', C / 'vendor')
AD = RUN / 'work' / 'audio-data.json'
if not AD.exists():
    AD.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['python3', str(MEDIA), str(C / 'assets/music' / TRACK), '--fps', '30', '--bands', '8', '-o', str(AD)], check=True)

# ---------- материал сайта ----------
src = (SITE / 'index.html').read_text(encoding='utf-8')
svg = re.search(r'<svg class="dx-svg".*?</svg>', src, re.S).group(0)
svg = re.sub(r'<title id="dx-t">.*?</title>', '', svg, flags=re.S).replace(' role="img" aria-labelledby="dx-t"', ' aria-hidden="true"')
css_dx = '\n'.join(l.strip() for l in src.splitlines()
                   if l.strip().startswith('.dx-svg') and 'max-height' not in l and 'font-size:24px' not in l)
sig = re.search(r'<svg[^>]*id="sig".*?</svg>', src, re.S).group(0)
sig = sig.replace('img/signature-gold.png', 'assets/img/signature-gold.png').replace(' role="img" aria-label="Dr. Shapovalov"', ' aria-hidden="true"')
sig = sig.replace('<image ', '<image mask="url(#sig-mask)" ')
fonts = (SITE / 'fonts' / 'fonts.css').read_text(encoding='utf-8').replace('url(/fonts/', 'url(assets/fonts/')

c = json.loads((SITE / 'content.json').read_text(encoding='utf-8'))
e = lambda s: html.escape(str(s or '').strip())
D, H, R = c['distraction'], c['hero'], c['readings']
hook = D['intro'].split('. ')[0] + '.'                 # «Если нижняя челюсть недоразвита, её можно удлинить.»
hook_a, hook_b = hook.split(', ', 1)
phases = [p['title'] for p in D['phases']]
note = D['phases'][2]['text'].split('. ')[0] + '.'     # «Аппарат понемногу раскручивают, обычно около миллиметра в сутки.»
role = H['ledePro'].split(' (')[0].rstrip('.') + '.'               # «Челюстно-лицевой хирург, к.м.н.»
kids = H['lede'].split('. ')[-1].strip()               # «Лечу детей и подростков.»
assert hook_a == 'Если нижняя челюсть недоразвита' and 'миллиметра' in note and role.startswith('Челюстно') and kids.startswith('Лечу'), (hook, note, role, kids)
labels = [r['label'].strip() for r in R]
labels[1] = labels[1].replace('в научных журналах рецензируемых', 'в журналах')   # сокращение подписи с сайта
labels[2] = labels[2].replace('на конференциях, ', '')
MAXMM = D.get('maxMm', 15)


def words(text, cls, gold=()):
    out = []
    for w in text.split():
        g = ' gold' if w.strip('.,') in gold else ''
        out.append(f'<span class="w {cls}{g}">{e(w)}</span>')
    return ' '.join(out)


def letters(text, cls):  # буквы внутри неразрывного слова, пробелы между словами сохраняются
    return ' '.join('<span class="word">' + ''.join(f'<span class="l {cls}">{e(ch)}</span>' for ch in w) + '</span>' for w in text.split())


# ---------- аудио-реакция: басы музыки → яркость свечения (выборка при сборке) ----------
a = json.loads(AD.read_text())
fps = a['fps']
STEP = 0.2
env = []
for i in range(int(DUR / STEP)):
    f0, f1 = int(i * STEP * fps), int((i + 1) * STEP * fps)
    seg = a['frames'][f0:f1]
    env.append(sum((fr['bands'][0] + fr['bands'][1] + fr['bands'][2]) / 3 for fr in seg) / max(1, len(seg)))
mx = max(env) or 1
env = [round(v / mx, 3) for v in env]
sm = [round((env[max(0, i - 1)] + 2 * env[i] + env[min(len(env) - 1, i + 1)]) / 4, 3) for i in range(len(env))]

rows = ''.join(
    f'<div class="row" id="s4-r{i}"><div class="num"><span class="cnt" id="s4-n{i}" data-to="{e(r["to"])}">{e(r["to"])}</span>'
    f'<small>{e(r["unit"])}</small></div><p>{e(labels[i])}</p></div>' for i, r in enumerate(R))
steps = ''.join(f'<li id="s2-st{i}"><i><b id="s2-sb{i}"></b></i><span>{e(t)}</span></li>' for i, t in enumerate(phases))

page = f'''<!doctype html>
<html lang="ru" data-resolution="portrait" data-composition-variables='[
  {{"id":"color-ground","type":"color","label":"Фон","default":"#05080a"}},
  {{"id":"color-ink","type":"color","label":"Текст","default":"#ede8de"}},
  {{"id":"color-accent","type":"color","label":"Акцент","default":"#d6b266"}},
  {{"id":"font-display","type":"string","label":"Шрифт заголовков","default":"Unbounded"}}
]'>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1080, height=1920">
<script src="vendor/gsap.min.js"></script>
<style>
{fonts}
:root {{
  --color-ground: #05080a; --color-ink: #ede8de; --color-accent: #d6b266; --font-display: 'Unbounded';
  --deep: #0a1513; --emerald: #164236; --mist: #93a19b; --soft: #c3ccc8; --gold-hi: #f0d48e; --text: 'Manrope';
  --gold: var(--color-accent);
}}
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
html, body {{ width: 1080px; height: 1920px; overflow: hidden; background: var(--color-ground); }}
body {{ font-family: var(--text), sans-serif; color: var(--color-ink); -webkit-font-smoothing: antialiased; }}
#root {{ position: relative; width: 100%; height: 100%; overflow: hidden; }}
.full {{ position: absolute; inset: 0; }}
#bg {{ background: var(--color-ground); }}
#glow {{ position: absolute; left: -300px; top: -260px; width: 1500px; height: 1300px; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(22,66,54,.95), rgba(22,66,54,.35) 55%, rgba(22,66,54,0)); }}
#glow2 {{ position: absolute; left: 280px; top: 1240px; width: 1100px; height: 900px; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(214,178,102,.16), rgba(214,178,102,0)); }}
#flood {{ background: radial-gradient(120% 80% at 50% 42%, #1b4d40 0%, #164236 45%, #0d2a22 100%); opacity: 0; }}
.scene {{ position: absolute; inset: 0; }}
.inner {{ position: absolute; inset: 0; }}
.w, .l {{ display: inline-block; }}
.word {{ display: inline-block; white-space: nowrap; }}
.gold {{ color: var(--gold); }}
h1, h2 {{ font-family: var(--font-display), sans-serif; font-weight: 500; line-height: 1.1; letter-spacing: -.01em; }}
.kick {{ font: 600 32px var(--text), sans-serif; letter-spacing: .04em; color: var(--gold); }}
/* 1 — хук */
#s1-txt {{ position: absolute; left: 96px; right: 96px; top: 330px; }}
#s1-txt h1 {{ margin-top: 40px; font-size: 100px; }}
#s1-rule {{ margin-top: 48px; width: 280px; height: 4px; border-radius: 4px; background: var(--gold); transform-origin: left center; }}
/* схема — общий слой для сцен 1–2 */
#jaw-move {{ position: absolute; left: 0; top: 560px; width: 1080px; transform-origin: 50% 0%; }}
#jaw-move svg {{ width: 1080px; height: auto; overflow: visible; }}
{css_dx}
.dx-svg .dim-t {{ font-size: 20px; }}
.dx-svg .lbl-t {{ font-size: 18px; }}
/* 2 — схема */
#s2-h {{ position: absolute; left: 96px; right: 96px; top: 250px; font-size: 92px; }}
#s2-mm {{ position: absolute; left: 96px; top: 1215px; font: 700 180px/1 var(--font-display), sans-serif; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }}
#s2-mm small {{ margin-left: 18px; font: 500 54px var(--font-display), sans-serif; letter-spacing: 0; color: var(--gold); }}
#s2-steps {{ position: absolute; left: 96px; right: 96px; top: 1440px; list-style: none; display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }}
#s2-steps li {{ display: flex; flex-direction: column; gap: 14px; font: 600 30px var(--text), sans-serif; color: var(--mist); }}
#s2-steps i {{ display: block; height: 6px; border-radius: 6px; background: rgba(237,232,222,.16); overflow: hidden; }}
#s2-steps b {{ display: block; height: 100%; background: var(--gold); transform-origin: left center; }}
#s2-note {{ position: absolute; left: 96px; right: 96px; top: 1540px; font-size: 38px; line-height: 1.35; color: var(--soft); }}
/* 3 — кто */
#s3-photo {{ position: absolute; left: 90px; top: 140px; width: 900px; height: 1002px;
  -webkit-mask-image: radial-gradient(110% 88% at 50% 28%, #000 58%, transparent 86%); mask-image: radial-gradient(110% 88% at 50% 28%, #000 58%, transparent 86%); }}
#s3-photo img {{ width: 900px; height: 1002px; display: block; }}
#s3-txt {{ position: absolute; left: 96px; right: 96px; top: 1160px; }}
#s3-txt h1 {{ font-size: 84px; font-weight: 300; }}
#s3-txt h1 .last {{ font-size: 104px; margin-top: 6px; }}
#s3-txt h1 .last {{ display: block; font-weight: 700; color: var(--gold); }}
#s3-role {{ margin-top: 40px; font-size: 44px; line-height: 1.4; color: var(--soft); }}
/* 4 — цифры */
#s4-list {{ position: absolute; left: 96px; right: 96px; top: 430px; display: flex; flex-direction: column; gap: 90px; }}
.row .num {{ font: 700 176px/1 var(--font-display), sans-serif; color: var(--gold); letter-spacing: -.03em; font-variant-numeric: tabular-nums; }}
.row .num small {{ margin-left: 18px; font: 500 50px var(--font-display), sans-serif; color: var(--color-ink); letter-spacing: 0; }}
.row p {{ margin-top: 18px; font-size: 42px; line-height: 1.3; color: var(--soft); }}
.row {{ padding-left: 34px; border-left: 4px solid rgba(214,178,102,.45); }}
/* 5 — финал */
#s5-box {{ position: absolute; left: 96px; right: 96px; top: 470px; display: flex; flex-direction: column; align-items: center; text-align: center; }}
#s5-halo {{ position: absolute; left: 50%; top: 100px; width: 520px; height: 520px; margin: -260px 0 0 -260px; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(240,212,142,.30), rgba(240,212,142,0)); }}
#s5-mark {{ position: relative; width: 200px; height: 200px; }}
#s5-wm {{ margin-top: 54px; font: 300 46px var(--font-display), sans-serif; letter-spacing: .1em; color: var(--gold-hi); }}
#s5-dom {{ margin-top: 30px; font: 700 96px var(--font-display), sans-serif; letter-spacing: -.01em; }}
#s5-line {{ margin-top: 40px; font-size: 44px; line-height: 1.35; color: var(--color-ink); max-width: 860px; }}
#s5-sig {{ margin-top: 70px; width: 560px; }}
#s5-sig svg {{ width: 560px; height: auto; display: block; }}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="{DUR}" data-width="1080" data-height="1920">

  <div id="bg" class="clip full" data-start="0" data-duration="{DUR}" data-track-index="0">
    <div id="glow" data-layout-ignore></div><div id="glow2" data-layout-ignore></div>
    <div id="flood" class="full"></div>
  </div>

  <div id="jaw" class="clip full" data-start="0" data-duration="10.93" data-track-index="1">
    <div id="jaw-move">{svg}</div>
  </div>

  <section id="s1" class="clip scene" data-start="0" data-duration="4.39" data-track-index="2">
    <div class="inner" id="s1-in"><div id="s1-txt">
      <div class="kick" id="s1-k">drshapovalov.ru</div>
      <h1>{words(hook_a + ',', 's1w')} {words(hook_b, 's1w', gold=('удлинить',))}</h1>
      <div id="s1-rule"></div>
    </div></div>
  </section>

  <section id="s2" class="clip scene" data-start="4.39" data-duration="6.54" data-track-index="3">
    <div class="inner" id="s2-in">
      <h2 id="s2-h">{words(D['heading'], 's2w', gold=('кость',))}</h2>
      <div id="s2-mm"><span id="s2-mmv">0,0</span><small>мм</small></div>
      <ol id="s2-steps">{steps}</ol>
      <p id="s2-note">{e(note)}</p>
    </div>
  </section>

  <section id="s3" class="clip scene" data-start="10.93" data-duration="3.8" data-track-index="4">
    <div class="inner" id="s3-in">
      <div id="s3-photo"><img src="assets/img/hero-figure-2.webp" alt=""></div>
      <div id="s3-txt">
        <h1><span id="s3-first">{letters(H['firstName'] + ' ' + H.get('middleName', ''), 's3l')}</span><span class="last" id="s3-last">{letters(H['lastName'], 's3l2')}</span></h1>
        <p id="s3-role"><span id="s3-r1">{e(role)}</span><br><span id="s3-r2">{e(kids)}</span></p>
      </div>
    </div>
  </section>

  <section id="s4" class="clip scene" data-start="14.73" data-duration="4.37" data-track-index="5">
    <div class="inner" id="s4-in"><div id="s4-list">{rows}</div></div>
  </section>

  <section id="s5" class="clip scene" data-start="19.1" data-duration="3.9" data-track-index="6">
    <div class="inner" id="s5-in"><div id="s5-box">
      <div id="s5-halo"></div>
      <img id="s5-mark" src="assets/img/mark-white.svg" alt="">
      <div id="s5-wm">S. H. A. P. O. V. A. L. O. V.</div>
      <div id="s5-dom">drshapovalov.ru</div>
      <p id="s5-line">Как растёт кость, кейсы, статьи и&nbsp;контакты</p>
      <div id="s5-sig">{sig}</div>
    </div></div>
  </section>

  <audio id="music" class="clip" data-start="0" data-duration="{DUR}" data-track-index="10" data-volume="0.35" data-fade-in="0.3" data-fade-out="2" src="assets/music/{TRACK}"></audio>
  <audio id="sfx-hit" class="clip" data-start="4.39" data-track-index="11" data-volume="0.3" src="assets/sfx/impact/impactSoft_medium_001.ogg"></audio>
  <audio id="sfx-d0" class="clip" data-start="14.78" data-track-index="12" data-volume="0.2" src="assets/sfx/interface/drop_002.ogg"></audio>
  <audio id="sfx-d1" class="clip" data-start="15.29" data-track-index="13" data-volume="0.2" src="assets/sfx/interface/drop_002.ogg"></audio>
  <audio id="sfx-d2" class="clip" data-start="15.84" data-track-index="14" data-volume="0.2" src="assets/sfx/interface/drop_002.ogg"></audio>
  <audio id="sfx-bong" class="clip" data-start="19.66" data-track-index="15" data-volume="0.32" src="assets/sfx/interface/bong_001.ogg"></audio>
</div>

<script>
(function () {{
  const $ = (id) => document.getElementById(id);
  const tl = gsap.timeline({{ paused: true }});
  const ENV = {json.dumps(sm)}, STEP = {STEP};

  // ---------- вспомогательные входы (motion.md: per word blur, per letter) ----------
  const wordsIn = (sel, at, gap = 0.08) => tl.fromTo(sel, {{ opacity: 0, filter: 'blur(8px)' }},
    {{ opacity: 1, filter: 'blur(0px)', duration: 0.22, ease: 'power3.out', stagger: gap }}, at);
  const out = (sel, at, d = 0.22) => tl.to(sel, {{ opacity: 0, filter: 'blur(8px)', duration: d, ease: 'power2.in' }}, at);
  const rise = (sel, at, dy = 60, d = 0.6) => tl.fromTo(sel, {{ opacity: 0, y: dy }}, {{ opacity: 1, y: 0, duration: d, ease: 'expo.out' }}, at);

  // ---------- фон: медленный дрейф изумрудного света + дыхание по басам ----------
  tl.fromTo('#glow', {{ x: -60, y: 0 }}, {{ x: 120, y: 80, duration: {DUR}, ease: 'sine.inOut' }}, 0);
  tl.fromTo('#glow2', {{ x: 0 }}, {{ x: -160, duration: {DUR}, ease: 'sine.inOut' }}, 0);
  tl.set('#glow', {{ opacity: 0.7 }}, 0);
  // audio-reactive: яркость свечения по энергии басов, выборка {STEP} с
  ENV.forEach((v, i) => tl.to('#glow', {{ opacity: 0.62 + 0.38 * v, duration: STEP, ease: 'sine.inOut' }}, i * STEP));

  // ---------- 1. хук 0–4.39 ----------
  tl.fromTo('#s1-k', {{ opacity: 0 }}, {{ opacity: 1, duration: 0.3, ease: 'power2.out' }}, 0.05);
  wordsIn('#s1 .s1w', 0.12, 0.09);
  tl.fromTo('#s1-rule', {{ scaleX: 0 }}, {{ scaleX: 1, duration: 0.8, ease: 'expo.out' }}, 1.64);
  // контур челюсти тихо проступает внизу, распил проводится (схема сайта, p 0 → 0.1)
  tl.fromTo('#jaw-move', {{ opacity: 0, y: 560, scale: 0.72 }}, {{ opacity: 0.55, y: 520, scale: 0.72, duration: 1.4, ease: 'power2.out' }}, 0.6);
  tl.set('.dx-svg .lbl-t', {{ opacity: 0 }}, 0);
  tl.to('.dx-svg .lbl-t', {{ opacity: 1, duration: 0.3, ease: 'power2.out' }}, 4.8);
  out('#s1-k, #s1 .s1w, #s1-rule', 4.02, 0.24);
  // переход «объект становится миром»: челюсть вырастает в полную схему
  tl.to('#jaw-move', {{ opacity: 1, y: 0, scale: 1, duration: 0.9, ease: 'power2.inOut' }}, 4.05);

  // ---------- 2. схема 4.39–10.93 ----------
  wordsIn('#s2 .s2w', 4.5, 0.09);
  rise('#s2-mm', 4.85, 50);
  rise('#s2-steps', 5.0, 40);
  tl.fromTo('#s2-note', {{ opacity: 0, filter: 'blur(8px)' }}, {{ opacity: 1, filter: 'blur(0px)', duration: 0.2, ease: 'power3.out' }}, 5.6);
  // уход: blur swap, фон не режется
  out('#s2-h, #s2-mm, #s2-steps, #s2-note', 10.6, 0.25);
  tl.to('#jaw-move', {{ opacity: 0, filter: 'blur(10px)', duration: 0.25, ease: 'power2.in' }}, 10.6);

  // ---------- 3. кто 10.93–14.73 ----------
  // beat-locked: 10.93s — фото доктора поднимается на сильную долю
  tl.fromTo('#s3-photo', {{ opacity: 0, y: 90, scale: 1.04 }}, {{ opacity: 1, y: 0, scale: 1, duration: 0.9, ease: 'expo.out' }}, 10.93);
  tl.fromTo('#s3 .s3l', {{ opacity: 0.0, filter: 'blur(4px)' }}, {{ opacity: 1, filter: 'blur(0px)', duration: 0.2, ease: 'power2.out', stagger: 0.04 }}, 11.2);
  tl.fromTo('#s3 .s3l2', {{ opacity: 0.0, filter: 'blur(4px)' }}, {{ opacity: 1, filter: 'blur(0px)', duration: 0.2, ease: 'power2.out', stagger: 0.05 }}, 11.62);
  tl.fromTo('#s3-r1, #s3-r2', {{ opacity: 0, filter: 'blur(8px)' }}, {{ opacity: 1, filter: 'blur(0px)', duration: 0.2, ease: 'power3.out', stagger: 0.3 }}, 12.02);
  // уход: вертикальный свайп вверх с размытием
  tl.to('#s3-in', {{ y: -280, opacity: 0, filter: 'blur(14px)', duration: 0.3, ease: 'power3.in' }}, 14.42);

  // ---------- 4. цифры 14.73–19.10 ----------
  // beat-grid: строка 1 на 14.73s (приход свайпа), 2 на 15.29s, 3 на 15.84s
  [14.73, 15.29, 15.84].forEach((at, i) => {{
    tl.fromTo('#s4-r' + i, {{ opacity: 0, y: 160, filter: 'blur(12px)' }}, {{ opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.5, ease: 'expo.out' }}, at);
  }});
  out('#s4-list', 18.86, 0.22);

  // ---------- 5. финал 19.10–23.0 ----------
  // переход: заливка цветом — фон становится изумрудным
  tl.to('#flood', {{ opacity: 1, duration: 0.45, ease: 'power2.inOut' }}, 18.95);
  // beat-locked: 19.66s — знак «Ш.» на сильную долю
  tl.fromTo('#s5-mark', {{ opacity: 0, scale: 0.86 }}, {{ opacity: 1, scale: 1, duration: 0.7, ease: 'expo.out' }}, 19.66);
  tl.fromTo('#s5-halo', {{ opacity: 0 }}, {{ opacity: 1, duration: 0.8, ease: 'power2.out' }}, 19.66);
  ENV.forEach((v, i) => {{ const t = i * STEP; if (t >= 20.5 && t < {DUR} - STEP) tl.to('#s5-halo', {{ opacity: 0.7 + 0.3 * v, duration: STEP, ease: 'sine.inOut' }}, t); }});
  tl.fromTo('#s5-wm', {{ opacity: 0, filter: 'blur(8px)' }}, {{ opacity: 1, filter: 'blur(0px)', duration: 0.2, ease: 'power3.out' }}, 19.9);
  tl.fromTo('#s5-dom', {{ opacity: 0, y: 40 }}, {{ opacity: 1, y: 0, duration: 0.6, ease: 'expo.out' }}, 20.05);
  tl.fromTo('#s5-line', {{ opacity: 0, filter: 'blur(8px)' }}, {{ opacity: 1, filter: 'blur(0px)', duration: 0.2, ease: 'power3.out' }}, 20.45);
  // подпись пишется пером — те же штрихи маски, что на сайте
  const strokes = Array.from(document.querySelectorAll('#sig-mask path'));
  tl.fromTo('#s5-sig', {{ opacity: 0 }}, {{ opacity: 1, duration: 0.01 }}, 20.68);
  let at = 20.7;
  strokes.forEach((p) => {{
    const L = p.getTotalLength();
    const d = Math.max(0.06, L / 1700);
    // штрих начинается за пределами пути, чтобы круглые концы не проступали точками заранее
    tl.fromTo(p, {{ strokeDasharray: L + ' ' + (L + 400), strokeDashoffset: L + 200 }}, {{ strokeDashoffset: 0, duration: d, ease: 'none' }}, at);
    at += d;
  }});

  // ---------- часы: схема сайта (dxSet) и счётчики — функция времени ----------
  const MAX = {MAXMM};
  const cl = (v) => Math.max(0, Math.min(1, v));
  const io = (x) => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  const fmt = (v) => v.toFixed(1).replace('.', ',');
  // p: распил в хуке (2.4–3.4 с), затем 0.1 → 1 линейно с 5.0 по 9.675 с;
  // beat-locked: 8.74s — 15,0 мм достигается ровно на сильной доле (p = 0.82)
  const pAt = (t) => t < 2.4 ? 0 : t < 3.4 ? 0.1 * io((t - 2.4) / 1.0) : t < 5.0 ? 0.1 : 0.1 + 0.9 * cl((t - 5.0) / 4.675);
  function dxSet(p) {{ // логика dxSet() из site/index.html
    const s = (a, b) => cl((p - a) / (b - a));
    const cut = s(0, 0.1), dev = s(0.05, 0.15), lat = s(0.1, 0.22), act = s(0.22, 0.82), con = s(0.82, 1);
    const mm = act * MAX, dx = act * 90;
    $('dx-cut').setAttribute('y2', (210 + 139 * cut).toFixed(1));
    $('dx-dev').setAttribute('opacity', dev.toFixed(3));
    $('dx-dev').setAttribute('transform', `translate(0 ${{((1 - dev) * -14).toFixed(2)}})`);
    $('dx-plate-a').setAttribute('opacity', dev.toFixed(3));
    $('dx-ant').setAttribute('transform', `translate(${{dx.toFixed(2)}} 0)`);
    $('dx-gap').setAttribute('width', dx.toFixed(2)); $('dx-cons').setAttribute('width', dx.toFixed(2));
    $('dx-cons').setAttribute('opacity', (con * 0.92).toFixed(3));
    $('dx-knob').setAttribute('transform', `rotate(${{(mm * 96).toFixed(1)}} 100 333)`);
    $('dx-dim').setAttribute('opacity', act > 0.02 ? 1 : 0);
    $('dx-dim-r').setAttribute('transform', `translate(${{dx.toFixed(2)}} 0)`);
    $('dx-dim-l').setAttribute('x2', (345 + dx).toFixed(2));
    $('dx-dim-t').setAttribute('x', (345 + dx / 2).toFixed(2)); $('dx-dim-t').textContent = fmt(mm) + ' мм';
    $('s2-mmv').textContent = fmt(mm);
    const fills = [cut, lat, act, con], idx = p < 0.1 ? 0 : p < 0.22 ? 1 : p < 0.82 ? 2 : 3;
    for (let i = 0; i < 4; i++) {{
      $('s2-sb' + i).style.transform = `scaleX(${{fills[i]}})`;
      $('s2-st' + i).style.color = i === idx ? 'var(--color-ink)' : 'var(--mist)';
    }}
  }}
  const counters = [14.73, 15.29, 15.84];
  function render(t) {{
    dxSet(pAt(t));
    counters.forEach((a, i) => {{
      const el = $('s4-n' + i), to = +el.dataset.to;
      el.textContent = String(Math.round(to * (1 - Math.pow(1 - cl((t - a - 0.05) / 0.6), 3))));
    }});
  }}
  const clock = {{ t: 0 }};
  tl.fromTo(clock, {{ t: 0 }}, {{ t: {DUR}, duration: {DUR}, ease: 'none', onUpdate: () => render(clock.t) }}, 0);
  render(0);

  window.__timelines = window.__timelines || {{}};
  window.__timelines['main'] = tl;
  tl.seek(0);
}})();
</script>
</body>
</html>
'''
(C / 'index.html').write_text(page, encoding='utf-8')
for f, k in (('package.json', 'name'), ('meta.json', 'id')):
    p = C / f
    if p.exists():
        j = json.loads(p.read_text()); j[k] = 'brag-drshapovalov'
        if 'name' in j: j['name'] = 'brag-drshapovalov'
        p.write_text(json.dumps(j, ensure_ascii=False, indent=2))
print('ok', len(page), 'env', len(sm), 'labels', labels)
