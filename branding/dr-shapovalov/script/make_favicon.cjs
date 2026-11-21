// Иконка сайта из знака «Ш.» (геометрия mark-white.svg, штрих 5.5, без кольца — как аватарка).
// Пишет в site/icons/: favicon.svg, favicon.ico (16/32/48), apple-touch-icon.png (180), icon-512.png.
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const OUT = path.join(__dirname, '..', 'site', 'icons');
// знак занимает x 22.25–80.4, y 26.25–75.4; квадрат 84 с центром на знаке — поле ≥ 15% диаметра
const svg = (pad = true) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="9.3 8.8 84 84">
  <rect x="9.3" y="8.8" width="84" height="84" rx="${pad ? 16 : 0}" fill="#05080a"/>
  <g fill="none" stroke="#ffffff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M 31 29 L 31 62"/><path d="M 48 29 L 48 62"/><path d="M 65 29 L 65 62"/><path d="M 25 64 L 71 64"/>
  </g>
  <circle cx="76" cy="71" r="4.4" fill="#ffffff"/>
</svg>
`;
(async () => {
  fs.writeFileSync(path.join(OUT, 'favicon.svg'), svg(true));
  const b = await chromium.launch();
  const p = await b.newPage();
  const png = async (size, rounded) => {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg(rounded)}`);
    return p.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  };
  fs.writeFileSync(path.join(OUT, 'apple-touch-icon.png'), await png(180, false)); // iOS сам скругляет углы
  fs.writeFileSync(path.join(OUT, 'icon-512.png'), await png(512, false));
  // ICO с PNG внутри (поддерживается всеми современными браузерами)
  const sizes = [16, 32, 48], imgs = [];
  for (const s of sizes) imgs.push(await png(s, true));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let off = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(s, e); head.writeUInt8(s, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(imgs[i].length, e + 8); head.writeUInt32LE(off, e + 12); off += imgs[i].length;
  });
  fs.writeFileSync(path.join(OUT, 'favicon.ico'), Buffer.concat([head, ...imgs]));
  await b.close();
  console.log('ok', fs.readdirSync(OUT));
})();
