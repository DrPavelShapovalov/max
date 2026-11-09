// ОРТОС — библиотека ориентиров + реалистичная рентген-подобная боковая ТРГ
// (clean-room, собственная схема в стиле лат. цефалограммы; профиль обращён ВПРАВО).
// Для каждой точки — где её ставить. viewBox 0 0 460 520.
window.ORTHOS_LM = [
  { id:'S',   abbr:'S',   ru:'Селла (турецкое седло)',        kind:'hard', seg:'skull',    pt:[196,210],
    hint:'Центр турецкого седла — середина гипофизарной ямки (контур «седла» в центре основания черепа).' },
  { id:'N',   abbr:'N',   ru:'Назион',                        kind:'hard', seg:'skull',    pt:[330,192],
    hint:'Самая передняя точка лобно-носового шва (переносье) в срединной плоскости.' },
  { id:'Or',  abbr:'Or',  ru:'Орбитале',                      kind:'hard', seg:'skull',    pt:[312,224],
    hint:'Самая нижняя точка нижнего края глазницы.' },
  { id:'Po',  abbr:'Po',  ru:'Порион',                        kind:'hard', seg:'skull',    pt:[150,232],
    hint:'Верхняя точка костного наружного слухового прохода. С Or образует франкфуртскую горизонталь.' },
  { id:'ANS', abbr:'ANS', ru:'Передняя носовая ость',         kind:'hard', seg:'maxilla',  pt:[344,262],
    hint:'Вершина передней носовой ости — передний край дна носа (spina nasalis anterior).' },
  { id:'PNS', abbr:'PNS', ru:'Задняя носовая ость',           kind:'hard', seg:'maxilla',  pt:[258,262],
    hint:'Задняя носовая ость — задний край твёрдого нёба. С ANS образует нёбную плоскость.' },
  { id:'A',   abbr:'A',   ru:'Точка A (субспинале)',          kind:'hard', seg:'maxilla',  pt:[338,282],
    hint:'Глубочайшая точка переднего контура верхней челюсти между ANS и альвеолярным краем.' },
  { id:'U1t', abbr:'U1✶', ru:'Режущий край верхнего резца',   kind:'hard', seg:'maxilla',  pt:[344,322],
    hint:'Режущий край самого выступающего верхнего центрального резца.' },
  { id:'U1a', abbr:'U1●', ru:'Верхушка корня верхнего резца', kind:'hard', seg:'maxilla',  pt:[330,286],
    hint:'Верхушка корня того же верхнего центрального резца (задаёт его ось).' },
  { id:'B',   abbr:'B',   ru:'Точка B (супраментале)',        kind:'hard', seg:'mandible', pt:[330,338],
    hint:'Глубочайшая точка переднего контура нижней челюсти между альвеолой и погонионом.' },
  { id:'L1t', abbr:'L1✶', ru:'Режущий край нижнего резца',    kind:'hard', seg:'mandible', pt:[340,324],
    hint:'Режущий край нижнего центрального резца.' },
  { id:'L1a', abbr:'L1●', ru:'Верхушка корня нижнего резца',  kind:'hard', seg:'mandible', pt:[322,352],
    hint:'Верхушка корня нижнего центрального резца (задаёт его ось).' },
  { id:'Pog', abbr:'Pog', ru:'Погонион',                      kind:'hard', seg:'chin',     pt:[334,360],
    hint:'Самая передняя точка костного подбородка.' },
  { id:'Gn',  abbr:'Gn',  ru:'Гнатион',                       kind:'hard', seg:'chin',     pt:[322,378],
    hint:'Передне-нижняя точка подбородка — между погонионом и ментоном.' },
  { id:'Me',  abbr:'Me',  ru:'Ментон',                        kind:'hard', seg:'chin',     pt:[300,388],
    hint:'Самая нижняя точка симфиза нижней челюсти.' },
  { id:'Go',  abbr:'Go',  ru:'Гонион',                        kind:'hard', seg:'skull',    pt:[158,342],
    hint:'Угол нижней челюсти — точка на биссектрисе угла между касательными к ветви и телу.' },
  { id:'Ar',  abbr:'Ar',  ru:'Артикуляре',                    kind:'hard', seg:'skull',    pt:[150,262],
    hint:'Пересечение заднего контура ветви нижней челюсти и основания черепа (ось авторотации).' },
  { id:'G',   abbr:"G",   ru:'Глабелла (мягк. ткани)',        kind:'soft', seg:'soft',     pt:[352,186],
    hint:'Самая выступающая точка лба на профиле мягких тканей.' },
  { id:'Prn', abbr:'Prn', ru:'Кончик носа (пронасале)',       kind:'soft', seg:'soft',     pt:[384,234],
    hint:'Самая передняя точка кончика носа.' },
  { id:'Sn',  abbr:'Sn',  ru:'Субназале',                     kind:'soft', seg:'soft',     pt:[366,262],
    hint:'Точка перехода нижнего края носа в верхнюю губу (основание колумеллы).' },
  { id:'Ls',  abbr:'Ls',  ru:'Верхняя губа (labrale sup.)',   kind:'soft', seg:'soft',     pt:[368,296],
    hint:'Самая выступающая точка красной каймы верхней губы.' },
  { id:'Li',  abbr:'Li',  ru:'Нижняя губа (labrale inf.)',    kind:'soft', seg:'soft',     pt:[362,324],
    hint:'Самая выступающая точка красной каймы нижней губы.' },
  { id:'Pog2',abbr:"Pog'",ru:'Мягкотканный погонион',         kind:'soft', seg:'soft',     pt:[352,360],
    hint:'Самая передняя точка мягкого подбородка.' },
  { id:'Me2', abbr:"Me'", ru:'Мягкотканный ментон',           kind:'soft', seg:'soft',     pt:[318,394],
    hint:'Самая нижняя точка мягкого подбородка.' },
];

// Реалистичная боковая цефалограмма (рентген-стиль) с подсветкой активной точки.
window.skullSVG = function(hiId){
  const LM = window.ORTHOS_LM;
  const hi = LM.find(l=>l.id===hiId);
  const dots = LM.map(l=>{
    if(l.id===hiId) return '';
    return `<circle cx="${l.pt[0]}" cy="${l.pt[1]}" r="2.4" fill="${l.kind==='soft'?'#8fe9ff':'#ffd98a'}" opacity="0.65"/>`;
  }).join('');
  let hiMark='';
  if(hi){
    const [x,y]=hi.pt, right=x>230;
    const lx=right?x+34:x-34, ly=y<70?y+22:y-24;
    hiMark = `
      <circle cx="${x}" cy="${y}" r="13" fill="none" stroke="#ffd54a" stroke-width="2" opacity="0.6">
        <animate attributeName="r" values="8;16;8" dur="1.8s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.7;0;0.7" dur="1.8s" repeatCount="indefinite"/></circle>
      <circle cx="${x}" cy="${y}" r="5" fill="#ffcf33" stroke="#fff" stroke-width="2"/>
      <line x1="${x}" y1="${y}" x2="${lx}" y2="${ly}" stroke="#ffd54a" stroke-width="1.2" opacity="0.8"/>
      <text x="${lx+(right?4:-4)}" y="${ly+4}" text-anchor="${right?'start':'end'}" font-size="15" font-weight="800" fill="#fff" font-family="Inter,sans-serif" style="paint-order:stroke;stroke:#1a1f33;stroke-width:3px">${hi.abbr}</text>`;
  }
  return `<svg viewBox="0 0 460 520" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="bg" cx="48%" cy="42%" r="70%">
        <stop offset="0" stop-color="#2a3350"/><stop offset="0.55" stop-color="#1b2138"/><stop offset="1" stop-color="#11162a"/>
      </radialGradient>
      <linearGradient id="bone" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#eef2ff" stop-opacity="0.92"/><stop offset="1" stop-color="#aeb8dd" stop-opacity="0.78"/>
      </linearGradient>
      <filter id="soft"><feGaussianBlur stdDeviation="1.1"/></filter>
    </defs>
    <rect x="0" y="0" width="460" height="520" rx="16" fill="url(#bg)"/>
    <!-- мягкотканный профиль головы (вправо), полупрозрачный как на рентгене -->
    <path d="M150,92 C150,55 230,34 300,52 C345,64 360,120 352,160 C350,176 346,184 352,190
             C372,204 390,222 386,236 C382,248 368,252 366,262 C372,276 372,286 368,296
             C362,310 362,316 362,324 C360,338 358,350 352,360 C344,374 330,388 318,396
             C296,410 240,420 190,410 C150,402 120,374 112,320 C104,260 108,150 150,92 Z"
          fill="#cdd7f2" opacity="0.14"/>
    <!-- свод черепа -->
    <path d="M86,196 C78,120 150,56 232,62 C312,68 344,120 338,196" fill="none" stroke="url(#bone)" stroke-width="7" opacity="0.5" filter="url(#soft)"/>
    <path d="M90,196 C82,122 152,62 232,68 C308,74 340,122 334,196" fill="none" stroke="#e7ecff" stroke-width="2.4" opacity="0.85"/>
    <path d="M100,196 C96,140 160,86 232,92 C300,98 328,140 322,196" fill="none" stroke="#9fa9cf" stroke-width="1.4" opacity="0.6"/>
    <!-- основание черепа + турецкое седло -->
    <path d="M120,236 C150,246 176,224 196,210 C214,198 244,206 268,214 C286,220 300,226 318,230"
          fill="none" stroke="#dfe5ff" stroke-width="2.2" opacity="0.8"/>
    <path d="M186,208 q10,13 20,0" fill="none" stroke="#fff" stroke-width="2" opacity="0.9"/>
    <path d="M182,206 q14,-6 28,0" fill="none" stroke="#aeb8dd" stroke-width="1.3" opacity="0.6"/>
    <!-- лобная пазуха -->
    <path d="M322,196 q16,6 12,22 q-14,2 -18,-10 z" fill="#1b2138" stroke="#cfd7f4" stroke-width="1.4" opacity="0.85"/>
    <!-- орбита -->
    <ellipse cx="304" cy="212" rx="22" ry="16" fill="none" stroke="#d7deff" stroke-width="1.8" opacity="0.8"/>
    <!-- носовая кость -->
    <path d="M336,196 L362,232" stroke="#e7ecff" stroke-width="2" opacity="0.8"/>
    <!-- скуловая дуга -->
    <path d="M196,224 C240,234 280,236 300,236" fill="none" stroke="#b9c2e6" stroke-width="2" opacity="0.5"/>
    <!-- верхняя челюсть + твёрдое нёбо (ANS–PNS) -->
    <path d="M258,262 L344,262" stroke="#eef2ff" stroke-width="2.4" opacity="0.85"/>
    <path d="M344,262 C348,272 342,286 338,292 L330,286" fill="none" stroke="#dfe5ff" stroke-width="2" opacity="0.8"/>
    <!-- верхние зубы -->
    <path d="M330,292 L344,322 L352,300 Z" fill="url(#bone)" opacity="0.9"/>
    <g stroke="#cfd7f4" stroke-width="1.1" opacity="0.6"><path d="M318,290 L316,312"/><path d="M304,289 L302,310"/><path d="M290,288 L289,308"/></g>
    <!-- нижняя челюсть: ветвь, мыщелок, венечный, тело, симфиз -->
    <path d="M150,230 C146,250 150,300 158,342 C170,372 220,392 270,396 L300,388"
          fill="none" stroke="url(#bone)" stroke-width="6" opacity="0.5" filter="url(#soft)"/>
    <path d="M152,232 C148,252 152,300 160,340 C172,370 220,390 268,394 L300,388 L322,378 L334,360 L330,338 L322,352"
          fill="none" stroke="#e7ecff" stroke-width="2.4" opacity="0.88"/>
    <path d="M150,230 C142,214 150,196 166,196 C182,196 186,214 178,230" fill="none" stroke="#dfe5ff" stroke-width="2.2" opacity="0.8"/>
    <!-- нижние зубы -->
    <path d="M322,352 L340,324 L330,348 Z" fill="url(#bone)" opacity="0.9"/>
    <g stroke="#cfd7f4" stroke-width="1.1" opacity="0.6"><path d="M312,336 L314,356"/><path d="M298,338 L300,358"/><path d="M284,340 L286,360"/></g>
    <!-- шейные позвонки -->
    <g fill="none" stroke="#aeb8dd" stroke-width="1.6" opacity="0.5">
      <rect x="150" y="372" width="34" height="26" rx="6"/><rect x="150" y="402" width="34" height="26" rx="6"/><rect x="150" y="432" width="34" height="26" rx="6"/></g>
    <!-- наружный слуховой проход (порион) -->
    <circle cx="150" cy="232" r="8" fill="#11162a" stroke="#cfd7f4" stroke-width="1.4" opacity="0.8"/>
    <!-- мягкотканный профиль (яркая линия) -->
    <path d="M352,160 C350,176 346,184 352,190 C372,204 390,222 386,236 C382,248 368,252 366,262
             C372,276 372,286 368,296 C362,310 362,316 362,324 C360,338 358,350 352,360 C344,374 330,388 318,396"
          fill="none" stroke="#8fe9ff" stroke-width="1.6" opacity="0.55" stroke-dasharray="1 5" stroke-linecap="round"/>
    ${dots}
    ${hiMark}
  </svg>`;
};
