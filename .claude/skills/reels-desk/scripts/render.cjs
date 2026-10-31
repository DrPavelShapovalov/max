#!/usr/bin/env node
/* reels-desk: собирает ролик из reel.json.
   node render.cjs <папка-ролика>                 → <папка>/out/reel.mp4
   node render.cjs <папка> --still 3.2 [--guides] → кадр в PNG (с полосами запретных зон)
   node render.cjs <папка> --lint                 → текст в запретных зонах и «две вещи в движении сразу»
   node render.cjs <папка> --sheet                → контактный лист: кадр каждые 1,5 с
   Нужны Chromium (Playwright) и ffmpeg. Шрифты и звуки — свои, сеть не нужна. */
const fs = require('fs'), path = require('path'), { spawn, execFileSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Нет playwright: npm i -g playwright или запустите из среды, где он установлен'); process.exit(1); }

const args = process.argv.slice(2);
const dir = path.resolve(args[0] || '.');
const opt = (k) => { const i = args.indexOf(k); return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const reel = JSON.parse(fs.readFileSync(path.join(dir, 'reel.json'), 'utf8'));
const FPS = reel.fps || 30, DUR = reel.duration, W = reel.w || 1080, H = reel.h || 1920;
const OUT = path.join(dir, 'out'); fs.mkdirSync(OUT, { recursive: true });
const ENGINE = path.join(__dirname, '..', 'engine', 'desk.html');
const exe = fs.existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : undefined;

async function open() {
  const browser = await chromium.launch({ executablePath: exe, args: ['--allow-file-access-from-files', '--disable-web-security'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.addInitScript(([r, base]) => { window.REEL = r; window.REEL_BASE = base; }, [reel, 'file://' + dir + '/']);
  await page.goto('file://' + ENGINE); await page.evaluate(() => window.REEL_READY);
  if (errs.length) { console.error('Ошибки в сцене:\n' + errs.join('\n')); }
  return { browser, page };
}

async function still(t) {
  const { browser, page } = await open();
  if (opt('--guides')) await page.evaluate(() => window.guides(true));
  await page.evaluate((t) => window.render(t), t);
  const f = path.join(OUT, `still-${String(t).replace('.', '_')}.png`);
  await page.locator('#view').screenshot({ path: f }); await browser.close(); console.log(f);
}

async function sheet() {
  const { browser, page } = await open(); await page.evaluate(() => window.guides(true));
  const step = +(opt('--step') || 1.5), shots = [];
  for (let t = 0.5; t < DUR; t += step) { await page.evaluate((t) => window.render(t), t); const f = path.join(OUT, `s_${String(shots.length).padStart(3, '0')}.jpg`); await page.locator('#view').screenshot({ path: f, type: 'jpeg', quality: 70 }); shots.push(f); }
  await browser.close();
  const cols = 6, rows = Math.ceil(shots.length / cols), list = path.join(OUT, 'sheet.txt');
  const sheetPath = path.join(OUT, 'sheet.jpg');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-pattern_type', 'glob', '-i', path.join(OUT, 's_*.jpg'), '-vf', `scale=270:-1,tile=${cols}x${rows}:padding=8:color=white`, '-frames:v', '1', sheetPath]);
  shots.forEach((f) => fs.unlinkSync(f)); try { fs.unlinkSync(list); } catch (e) {}
  console.log(sheetPath);
}

async function lint() {
  const { browser, page } = await open(); const bad = new Map(), busy = [];
  for (let t = 0; t <= DUR; t += 0.1) {
    for (const v of await page.evaluate((t) => window.lintText(t), t)) { const k = v.zone + ' · ' + v.text; if (!bad.has(k)) bad.set(k, t.toFixed(1)); }
    const m = await page.evaluate((t) => window.moversAt(t), t);
    if (m.length > 1) { const k = m.join(' + '); if (!busy.find((b) => b.k === k)) busy.push({ k, t: t.toFixed(1) }); }
  }
  await browser.close();
  console.log(bad.size ? 'Текст в запретной зоне (верх 220 px / низ 420 px):\n' + [...bad].map(([k, t]) => `  ${t} с — ${k}`).join('\n') : 'Запретные зоны чистые.');
  console.log(busy.length ? 'Двигается больше одной вещи сразу:\n' + busy.map((b) => `  ${b.t} с — ${b.k}`).join('\n') : 'В каждый момент двигается одна вещь.');
  return !bad.size && !busy.length;
}

/* звуки: синтез ffmpeg, без чужих файлов */
const SFX = {
  marker: (d) => `anoisesrc=d=${d}:c=pink:a=0.55:r=48000,highpass=f=1500,lowpass=f=7000,tremolo=f=17:d=0.75,afade=t=in:d=0.03,afade=t=out:st=${Math.max(0, d - 0.12)}:d=0.12,volume=3.6`,
  paper: (d) => `anoisesrc=d=${Math.min(d, 0.5)}:c=brown:a=0.8:r=48000,highpass=f=250,lowpass=f=3200,afade=t=in:d=0.04,afade=t=out:st=${Math.max(0, Math.min(d, 0.5) - 0.25)}:d=0.25,volume=1.4`,
  tape: () => `anoisesrc=d=0.32:c=white:a=0.5:r=48000,bandpass=f=2600:w=1800,tremolo=f=45:d=0.9,afade=t=out:st=0.18:d=0.14,volume=0.7`,
  whoosh: (d) => `anoisesrc=d=${d}:c=brown:a=0.5:r=48000,lowpass=f=900,afade=t=in:d=${(d * 0.45).toFixed(2)},afade=t=out:st=${(d * 0.45).toFixed(2)}:d=${(d * 0.55).toFixed(2)},volume=0.35`,
};

function buildAudio(events) {
  const wav = path.join(OUT, 'sfx.wav'), a = reel.audio || {};
  const inputs = [], filters = [], labels = [];
  inputs.push('-f', 'lavfi', '-t', String(DUR), '-i', 'anullsrc=r=48000:cl=stereo'); labels.push('[0:a]');
  events.forEach((e, i) => {
    const d = Math.max(0.2, +e.dur.toFixed(2));
    inputs.push('-f', 'lavfi', '-i', SFX[e.kind](d));
    const ms = Math.round(e.t * 1000);
    filters.push(`[${i + 1}:a]aformat=channel_layouts=stereo,adelay=${ms}|${ms}[e${i}]`); labels.push(`[e${i}]`);
  });
  let n = events.length + 1;
  if (a.voice) { inputs.push('-i', path.join(dir, a.voice)); filters.push(`[${n}:a]aformat=channel_layouts=stereo,adelay=${Math.round((a.voiceAt || 0) * 1000)}|${Math.round((a.voiceAt || 0) * 1000)},volume=${a.voiceGain ?? 1}[vo]`); labels.push('[vo]'); n++; }
  if (a.music) { inputs.push('-i', path.join(dir, a.music)); filters.push(`[${n}:a]aformat=channel_layouts=stereo,volume=${a.musicGain ?? 0.15},afade=t=out:st=${DUR - 1}:d=1[mu]`); labels.push('[mu]'); n++; }
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=first,alimiter=limit=0.9[out]`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-t', String(DUR), '-ar', '48000', wav]);
  return wav;
}

async function full() {
  const { browser, page } = await open();
  const events = await page.evaluate(() => window.audioEvents());
  const wav = buildAudio(events);
  const mp4 = path.join(OUT, (opt('--name') || 'reel') + '.mp4'), N = Math.round(DUR * FPS);
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-i', wav,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', mp4], { stdio: ['pipe', 'inherit', 'inherit'] });
  const view = page.locator('#view'); const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    await page.evaluate((t) => window.render(t), i / FPS);
    const buf = await view.screenshot({ type: 'jpeg', quality: 93 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % FPS === 0) process.stdout.write(`\r${i}/${N} кадров`);
  }
  ff.stdin.end(); await new Promise((r) => ff.on('close', r)); await browser.close();
  console.log(`\r${N}/${N} кадров за ${((Date.now() - t0) / 1000).toFixed(0)} с → ${mp4}`);
}

(async () => {
  if (opt('--still') != null) return still(+opt('--still'));
  if (opt('--lint')) { const ok = await lint(); process.exit(ok ? 0 : 2); }
  if (opt('--sheet')) return sheet();
  return full();
})().catch((e) => { console.error(e); process.exit(1); });
