/* Пререндер для поисковиков: открывает собранный dist/index.html в Chromium, ждёт, пока скрипт
   заполнит страницу из content.json, и вписывает получившийся HTML в пустые контейнеры исходника.
   Робот без JavaScript видит весь текст сайта; в браузере скрипт перерисовывает те же блоки, как раньше.
   Запуск: node prerender.cjs dist   (build.py вызывает сам, если есть Node и Playwright) */
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('playwright');

const DIST = path.resolve(process.argv[2] || 'dist');
const FILE = path.join(DIST, 'index.html');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

(async () => {
  const src = fs.readFileSync(FILE, 'utf8');
  // разметку внутри <script> не трогаем: в коде есть шаблоны с id, а изменённый скрипт заблокирует CSP (отпечаток SHA-256)
  const parts = src.split(/(<script\b[\s\S]*?<\/script>)/i);
  const markup = parts.filter((x, i) => i % 2 === 0).join('\n');
  // пустые контейнеры с id в разметке: <div id="x" ...></div>
  const empty = [...markup.matchAll(/<([a-z0-9]+)\b[^>]*\bid="([^"]+)"[^>]*><\/\1>/gi)].map((m) => m[2]);

  const server = http.createServer((req, res) => {
    const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!p.startsWith(DIST) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
  }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.route('**/*', (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));   // без счётчиков и шрифтов
  await page.goto(base + 'index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#contact-list')?.children.length > 0, null, { timeout: 15000 });

  const filled = await page.evaluate((ids) => Object.fromEntries(ids.map((id) => {
    const el = document.getElementById(id); if (!el) return [id, ''];
    const c = el.cloneNode(true);
    // служебные пометки скрипта: при загрузке он сам перерисует блоки и навесит обработчики заново
    c.querySelectorAll('[data-bound],[data-meta]').forEach((n) => { n.removeAttribute('data-bound'); n.removeAttribute('data-meta'); });
    return [id, c.innerHTML.trim()];
  })), empty);
  await browser.close(); server.close();

  let n = 0, chars = 0;
  for (const [id, html] of Object.entries(filled)) {
    if (!html) continue;
    const re = new RegExp(`(<([a-z0-9]+)\\b[^>]*\\bid="${id}"[^>]*>)(</\\2>)`, 'i');
    for (let i = 0; i < parts.length; i += 2) {
      if (!re.test(parts[i])) continue;
      parts[i] = parts[i].replace(re, (m, open, tag, close) => { n++; chars += html.length; return open + html + close; }); break;
    }
  }
  const out = parts.join('');
  const scripts = (t) => t.match(/<script\b[\s\S]*?<\/script>/gi).join('');
  if (scripts(out) !== scripts(src)) throw new Error('пререндер изменил <script>');
  if (/<script/i.test(Object.values(filled).join(''))) throw new Error('в пререндер попал <script>');
  fs.writeFileSync(FILE, out);
  console.log(`prerender: ${n} блоков, ${chars} символов HTML`);
})().catch((e) => { console.error(e); process.exit(1); });
