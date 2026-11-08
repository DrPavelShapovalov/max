// ОРТОС — библиотека ориентиров + схематическая иллюстрация-подсказка (clean-room,
// собственная схема, не копия учебника). Для каждой точки — где её ставить.
// viewBox 0 0 320 300, профиль обращён ВПРАВО (нос справа).
window.ORTHOS_LM = [
  { id:'S',   abbr:'S',   ru:'Селла (турецкое седло)',        kind:'hard', seg:'skull',    pt:[150,122],
    hint:'Центр турецкого седла — середина гипофизарной ямки (контур «седла» в центре основания черепа).' },
  { id:'N',   abbr:'N',   ru:'Назион',                        kind:'hard', seg:'skull',    pt:[222,96],
    hint:'Самая передняя точка лобно-носового шва (переносье) в срединной плоскости.' },
  { id:'Or',  abbr:'Or',  ru:'Орбитале',                      kind:'hard', seg:'skull',    pt:[208,122],
    hint:'Самая нижняя точка нижнего края глазницы.' },
  { id:'Po',  abbr:'Po',  ru:'Порион',                        kind:'hard', seg:'skull',    pt:[96,131],
    hint:'Верхняя точка костного наружного слухового прохода. С Or образует франкфуртскую горизонталь.' },
  { id:'ANS', abbr:'ANS', ru:'Передняя носовая ость',         kind:'hard', seg:'maxilla',  pt:[230,150],
    hint:'Вершина передней носовой ости — передний край дна носа (spina nasalis anterior).' },
  { id:'PNS', abbr:'PNS', ru:'Задняя носовая ость',           kind:'hard', seg:'maxilla',  pt:[168,150],
    hint:'Задняя носовая ость — задний край твёрдого нёба. С ANS образует нёбную плоскость.' },
  { id:'A',   abbr:'A',   ru:'Точка A (субспинале)',          kind:'hard', seg:'maxilla',  pt:[228,163],
    hint:'Глубочайшая точка переднего контура верхней челюсти между ANS и альвеолярным краем.' },
  { id:'U1t', abbr:'U1✶', ru:'Режущий край верхнего резца',   kind:'hard', seg:'maxilla',  pt:[233,186],
    hint:'Режущий край самого выступающего верхнего центрального резца.' },
  { id:'U1a', abbr:'U1●', ru:'Верхушка корня верхнего резца', kind:'hard', seg:'maxilla',  pt:[220,163],
    hint:'Верхушка корня того же верхнего центрального резца (задаёт его ось).' },
  { id:'B',   abbr:'B',   ru:'Точка B (супраментале)',        kind:'hard', seg:'mandible', pt:[224,197],
    hint:'Глубочайшая точка переднего контура нижней челюсти между альвеолой и погонионом.' },
  { id:'L1t', abbr:'L1✶', ru:'Режущий край нижнего резца',    kind:'hard', seg:'mandible', pt:[229,188],
    hint:'Режущий край нижнего центрального резца.' },
  { id:'L1a', abbr:'L1●', ru:'Верхушка корня нижнего резца',  kind:'hard', seg:'mandible', pt:[214,207],
    hint:'Верхушка корня нижнего центрального резца (задаёт его ось).' },
  { id:'Pog', abbr:'Pog', ru:'Погонион',                      kind:'hard', seg:'chin',     pt:[226,213],
    hint:'Самая передняя точка костного подбородка.' },
  { id:'Gn',  abbr:'Gn',  ru:'Гнатион',                       kind:'hard', seg:'chin',     pt:[218,224],
    hint:'Передне-нижняя точка подбородка — между погонионом и ментоном.' },
  { id:'Me',  abbr:'Me',  ru:'Ментон',                        kind:'hard', seg:'chin',     pt:[206,230],
    hint:'Самая нижняя точка симфиза нижней челюсти.' },
  { id:'Go',  abbr:'Go',  ru:'Гонион',                        kind:'hard', seg:'skull',    pt:[112,206],
    hint:'Угол нижней челюсти — точка на биссектрисе угла между касательными к ветви и телу.' },
  { id:'Ar',  abbr:'Ar',  ru:'Артикуляре',                    kind:'hard', seg:'skull',    pt:[100,152],
    hint:'Пересечение заднего контура ветви нижней челюсти и основания черепа (ось авторотации).' },
  { id:'G',   abbr:"G",   ru:'Глабелла (мягк. ткани)',        kind:'soft', seg:'soft',     pt:[233,96],
    hint:'Самая выступающая точка лба на профиле мягких тканей.' },
  { id:'Prn', abbr:'Prn', ru:'Кончик носа (пронасале)',       kind:'soft', seg:'soft',     pt:[251,130],
    hint:'Самая передняя точка кончика носа.' },
  { id:'Sn',  abbr:'Sn',  ru:'Субназале',                     kind:'soft', seg:'soft',     pt:[243,152],
    hint:'Точка перехода нижнего края носа в верхнюю губу (основание колумеллы).' },
  { id:'Ls',  abbr:'Ls',  ru:'Верхняя губа (labrale sup.)',   kind:'soft', seg:'soft',     pt:[244,173],
    hint:'Самая выступающая точка красной каймы верхней губы.' },
  { id:'Li',  abbr:'Li',  ru:'Нижняя губа (labrale inf.)',    kind:'soft', seg:'soft',     pt:[239,192],
    hint:'Самая выступающая точка красной каймы нижней губы.' },
  { id:'Pog2',abbr:"Pog'",ru:'Мягкотканный погонион',         kind:'soft', seg:'soft',     pt:[235,214],
    hint:'Самая передняя точка мягкого подбородка.' },
  { id:'Me2', abbr:"Me'", ru:'Мягкотканный ментон',           kind:'soft', seg:'soft',     pt:[214,232],
    hint:'Самая нижняя точка мягкого подбородка.' },
];

// схематическая иллюстрация головы в профиль с подсветкой активной точки
window.skullSVG = function(hiId){
  const LM = window.ORTHOS_LM;
  const hi = LM.find(l=>l.id===hiId);
  const dots = LM.map(l=>{
    const on = l.id===hiId;
    if(on) return '';
    return `<circle cx="${l.pt[0]}" cy="${l.pt[1]}" r="2.1" fill="${l.kind==='soft'?'#9aa3c2':'#b9c0da'}" opacity="0.7"/>`;
  }).join('');
  let hiMark='';
  if(hi){
    const [x,y]=hi.pt;
    hiMark = `
      <circle cx="${x}" cy="${y}" r="11" fill="none" stroke="#5b6cff" stroke-width="1.5" opacity="0.5">
        <animate attributeName="r" values="7;13;7" dur="1.8s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.55;0;0.55" dur="1.8s" repeatCount="indefinite"/>
      </circle>
      <circle cx="${x}" cy="${y}" r="4.6" fill="#5b6cff" stroke="#fff" stroke-width="1.8"/>
      <line x1="${x}" y1="${y}" x2="${x>160?x+26:x-26}" y2="${y<60?y+18:y-20}" stroke="#5b6cff" stroke-width="1" opacity="0.6"/>
      <text x="${x>160?x+30:x-30}" y="${y<60?y+22:y-22}" text-anchor="${x>160?'start':'end'}" font-size="12" font-weight="800" fill="#4150c8" font-family="Inter,sans-serif">${hi.abbr}</text>`;
  }
  return `<svg viewBox="0 0 320 300" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sk" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#e9ecff"/><stop offset="1" stop-color="#f4ecff"/>
      </linearGradient>
    </defs>
    <!-- мягкотканный профиль головы (вправо) -->
    <path d="M78,72 C92,40 150,24 206,52 C228,64 234,82 233,96 C232,108 239,118 247,126
             C253,132 253,138 246,141 C241,144 240,148 243,152 C248,158 247,167 243,173
             C238,180 240,188 238,193 C244,201 240,210 234,215 C226,222 220,228 210,231
             C190,237 150,240 120,232 C92,224 72,196 68,160 C65,128 68,96 78,72 Z"
          fill="url(#sk)" stroke="#cdd4ee" stroke-width="1.4"/>
    <!-- череп: свод -->
    <path d="M86,110 C86,70 130,48 168,56 C200,63 214,86 210,112" fill="none" stroke="#c3cae6" stroke-width="1.3"/>
    <!-- основание черепа + седло -->
    <path d="M96,132 C120,140 140,128 150,122 C160,116 180,120 198,124" fill="none" stroke="#c3cae6" stroke-width="1.2"/>
    <path d="M144,120 q6,8 12,0" fill="none" stroke="#aeb7da" stroke-width="1.4"/>
    <!-- орбита -->
    <ellipse cx="204" cy="118" rx="10" ry="8" fill="none" stroke="#c3cae6" stroke-width="1.2"/>
    <!-- нёбо (ANS–PNS) -->
    <path d="M168,150 L230,150" stroke="#c3cae6" stroke-width="1.2"/>
    <!-- нижняя челюсть -->
    <path d="M100,150 L112,206 C140,224 180,228 206,230 L214,224 L224,197"
          fill="none" stroke="#c3cae6" stroke-width="1.3"/>
    <!-- ухо (порион) -->
    <path d="M90,126 a7,8 0 1,0 0.1,0" fill="none" stroke="#c3cae6" stroke-width="1.1"/>
    ${dots}
    ${hiMark}
  </svg>`;
};
