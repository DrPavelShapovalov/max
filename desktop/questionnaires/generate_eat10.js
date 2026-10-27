// Генератор печатного Word-опросника EAT-10 (глотание) — отдельный бланк.
// Заполняется дважды: ДО лечения и ПОСЛЕ (внизу есть галочка «этап»).
// Запуск:  npm install docx  &&  node generate_eat10.js
// Выход:   Опросник_EAT-10.docx
const docx = require('docx');
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ShadingType
} = docx;

const OUT = './';
const TEAL = '0D9488';
const GREY = 'BBBBBB';
const BOX = '☐';
const TW = 9020;

const borders = () => {
  const b = { style: BorderStyle.SINGLE, size: 2, color: GREY };
  return { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
};
function cell(children, width, shade, align) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: shade ? { type: ShadingType.CLEAR, fill: shade, color: 'auto' } : undefined,
    margins: { top: 40, bottom: 40, left: 90, right: 90 },
    verticalAlign: 'center',
    children: Array.isArray(children) ? children : [children],
  });
}
function p(text, opts = {}) {
  return new Paragraph({
    alignment: opts.align || AlignmentType.LEFT,
    spacing: opts.spacing || { after: 0 },
    children: [new TextRun({ text: text || '', bold: !!opts.bold, italics: !!opts.italics, size: opts.size || 20, color: opts.color || '000000' })],
  });
}
function line(label) {
  return new Paragraph({ spacing: { after: 120 }, children: [
    new TextRun({ text: label + '  ', size: 20 }),
    new TextRun({ text: '_'.repeat(Math.max(10, 70 - label.length)), size: 20, color: '888888' }),
  ]});
}
function sectionTitle(txt) {
  return new Paragraph({
    spacing: { before: 240, after: 90 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: TEAL } },
    children: [new TextRun({ text: txt, bold: true, size: 26, color: '0F766E' })],
  });
}

// Таблица «вопрос + 0..4 с квадратиками»
function scaleTable(questions, options) {
  const n = options.length;
  const optW = Math.floor((TW - 4680) / n);
  const qW = TW - optW * n;
  const header = new TableRow({
    tableHeader: true,
    children: [
      cell(p('Вопрос', { bold: true, size: 18 }), qW, 'E8F5F4'),
      ...options.map(o => cell(p(o, { bold: true, size: 15, align: AlignmentType.CENTER }), optW, 'E8F5F4', 'center')),
    ],
  });
  const rows = questions.map((q, i) => new TableRow({
    children: [
      cell(p((i + 1) + '. ' + q, { size: 19 }), qW),
      ...options.map(() => cell(p(BOX, { size: 26, align: AlignmentType.CENTER }), optW, null, 'center')),
    ],
  }));
  return new Table({ width: { size: TW, type: WidthType.DXA }, columnWidths: [qW, ...Array(n).fill(optW)], borders: borders(), rows: [header, ...rows] });
}

const EAT10 = [
  'Из-за проблемы с глотанием я теряю вес',
  'Из-за проблемы с глотанием мне трудно питаться вне дома',
  'Проглатывание жидкостей требует усилий',
  'Проглатывание твёрдой пищи требует усилий',
  'Проглатывание таблеток требует усилий',
  'Глотание болезненно',
  'Из-за проблемы с глотанием удовольствие от еды снижено',
  'При глотании пища застревает в горле',
  'Во время еды я кашляю',
  'Глотание вызывает стресс',
];

function doc() {
  const kids = [
    p('ФГБУ НМИЦ «ЦНИИС и ЧЛХ» Минздрава России', { size: 18, color: '555555' }),
    new Paragraph({ spacing: { after: 40 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: TEAL } }, children: [new TextRun({ text: 'EAT-10 — опросник глотания', bold: true, size: 32, color: '0F766E' })] }),
    p('По каждому пункту отметьте галочкой (✔) значение от 0 до 4: 0 — нет проблемы, 4 — серьёзная проблема. Отвечайте по состоянию за последнее время.', { italics: true, size: 18, color: '555555', spacing: { after: 120 } }),

    line('Код пациента (выдаёт врач):'),
    line('Дата заполнения:'),
    new Paragraph({ spacing: { after: 140 }, children: [
      new TextRun({ text: 'Этап заполнения:  ', bold: true, size: 20 }),
      new TextRun({ text: `${BOX} ДО лечения      ${BOX} ПОСЛЕ лечения`, size: 20 }),
    ]}),

    scaleTable(EAT10, ['0', '1', '2', '3', '4']),

    new Paragraph({ spacing: { before: 200, after: 60 }, children: [
      new TextRun({ text: 'Сумма баллов (0–40): ', bold: true, size: 20 }),
      new TextRun({ text: '________', size: 20, color: '888888' }),
      new TextRun({ text: '     (заполняет врач)', italics: true, size: 16, color: '777777' }),
    ]}),
    p('Для справки: 3 балла и больше — есть нарушение глотания (дисфагия).', { italics: true, size: 16, color: '777777', spacing: { after: 120 } }),

    sectionTitle('Согласие'),
    new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: `${BOX} `, size: 22 }), new TextRun({ text: 'Я, родитель (законный представитель), согласен(на) на обработку указанных данных в обезличенном виде для медицинских целей.', size: 19 })] }),
    line('Подпись / ФИО:'),
  ];
  return new Document({ sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children: kids }] });
}

(async () => {
  fs.writeFileSync(OUT + 'Опросник_EAT-10.docx', await Packer.toBuffer(doc()));
  console.log('OK');
})();
