/* Рендер ролика кадр за кадром: node render.cjs <папка> [--still t1,t2,...] [--out name] [--fps 30]
   Сервер раздаёт папку ролика; страница рисует кадр по window.setT(t); кадры JPEG идут в ffmpeg. */
const fs = require('fs'), path = require('path'), http = require('http'), { spawn } = require('child_process');
const { chromium } = require('playwright');
const DIR = path.resolve(process.argv[2] || '.'); const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FPS = +arg('--fps', 30), STILL = arg('--still', ''), OUT = path.join(DIR, 'out'), NAME = arg('--out', 'video');
const DUR = +arg('--dur', 36.4), FROM = +arg('--from', 0), TO = +arg('--to', DUR);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.webp': 'image/webp', '.stl': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg' };
fs.mkdirSync(OUT, { recursive: true });
const server = http.createServer((q, s) => { const p = path.join(DIR, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(DIR) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(s); }).listen(0);
(async () => {
  const base = `http://127.0.0.1:${server.address().port}/`;
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(base + 'index.html', { waitUntil: 'networkidle' }); await p.evaluate(() => window.ready);
  if (errs.length) console.log('ошибки:', errs);
  if (STILL) {
    for (const t of STILL.split(',').map(Number)) { await p.evaluate((t) => window.setT(t), t); await p.screenshot({ path: path.join(OUT, `still-${t}.jpg`), type: 'jpeg', quality: 90 }); }
  } else {
    const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', path.join(OUT, NAME + '-video.mp4')], { stdio: ['pipe', 'inherit', 'inherit'] });
    const n0 = Math.round(FROM * FPS), n1 = Math.round(TO * FPS), t0 = Date.now();
    for (let f = n0; f < n1; f++) {
      await p.evaluate((t) => window.setT(t), f / FPS);
      const buf = await p.screenshot({ type: 'jpeg', quality: 92 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (f % 60 === 0) process.stdout.write(`${f}/${n1} ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
    }
    ff.stdin.end(); await new Promise((r) => ff.on('close', r));
  }
  await b.close(); server.close(); console.log('ok', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
