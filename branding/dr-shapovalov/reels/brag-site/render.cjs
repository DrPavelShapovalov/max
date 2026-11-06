// Рендер кадров: renderAt(t) для каждого кадра, скриншот, затем ffmpeg. node render.cjs stills|frames
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const http = require('http');
(async () => {
  const mode = process.argv[2] || 'stills', DIR = path.join(__dirname, 'composition'), OUT = path.join(__dirname, 'brag-output', 'work');
  const T = { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const srv = http.createServer((q, r) => { const f = path.join(DIR, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(DIR) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  await p.goto(`http://127.0.0.1:${srv.address().port}/index.html`); await p.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => {}))); });
  if (mode === 'stills') {
    fs.mkdirSync(path.join(OUT, 'stills'), { recursive: true });
    for (const t of (process.argv[3] || '1.6,2.9,3.15,5,6.5,8.6,9.4,11,13.3,15.5,17.6,19.5').split(',').map(Number)) {
      await p.evaluate((t) => window.renderAt(t), t); await p.screenshot({ path: path.join(OUT, 'stills', `t${t.toFixed(2)}.jpg`), type: 'jpeg', quality: 85 }); }
  } else {
    const FD = path.join(OUT, 'frames'); fs.rmSync(FD, { recursive: true, force: true }); fs.mkdirSync(FD, { recursive: true });
    const N = 20 * 30;
    for (let f = 0; f < N; f++) { await p.evaluate((t) => window.renderAt(t), f / 30);
      await p.screenshot({ path: path.join(FD, `${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92 }); if (f % 100 === 0) console.log('frame', f); }
  }
  await b.close(); srv.close(); console.log('done');
})();
