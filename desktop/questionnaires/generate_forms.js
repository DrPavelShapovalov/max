// Генератор печатных Word-опросников «ДО лечения» и «ПОСЛЕ лечения».
// Запуск:  npm install docx  &&  node generate_forms.js
// Выход:   Опросник_ДО_лечения.docx, Опросник_ПОСЛЕ_лечения.docx
const docx = require('docx');
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ShadingType
} = docx;

const OUT = './';
const TEAL = '0D9488';
const GREY = 'BBBBBB';
const BOX = '☐'; // ☐

const TW = 9020;      // ширина таблицы (A4 рабочая ~ 9026 dxa)
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

// Таблица «вопрос + N вариантов с квадратиками»
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
  const rows = questions.map(q => new TableRow({
    children: [
      cell(p(q, { size: 19 }), qW),
      ...options.map(() => cell(p(BOX, { size: 26, align: AlignmentType.CENTER }), optW, null, 'center')),
    ],
  }));
  return new Table({ width: { size: TW, type: WidthType.DXA }, columnWidths: [qW, ...Array(n).fill(optW)], borders: borders(), rows: [header, ...rows] });
}

function sectionTitle(txt) {
  return new Paragraph({
    spacing: { before: 240, after: 90 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: TEAL } },
    children: [new TextRun({ text: txt, bold: true, size: 26, color: '0F766E' })],
  });
}
function legend(txt) { return p(txt, { italics: true, size: 17, color: '555555', spacing: { after: 80 } }); }
function line(label) {
  return new Paragraph({ spacing: { after: 120 }, children: [
    new TextRun({ text: label + '  ', size: 20 }),
    new TextRun({ text: ' '.repeat(1) + '_'.repeat(Math.max(10, 70 - label.length)), size: 20, color: '888888' }),
  ]});
}
function rating0to10(q) {
  return new Paragraph({ spacing: { after: 130 }, children: [
    new TextRun({ text: q + '  ', size: 20 }),
    new TextRun({ text: '(обведите)  ', size: 16, italics: true, color: '777777' }),
    new TextRun({ text: '0  1  2  3  4  5  6  7  8  9  10', size: 22, bold: true }),
  ]});
}

// ── данные ──
const SYMP = ['Никогда', 'Иногда', 'Часто', 'Всегда'];
const APP = ['Совсем не нравится', 'Скорее не нравится', 'Скорее нравится', 'Очень нравится'];

const g_breath = ['Храп во сне', 'Трудно дышать носом', 'Дыхание через рот', 'Остановки дыхания во сне (замечали родители)', 'Просыпались уставшим(ей)', 'Хотелось спать днём'];
const g_chew = ['Трудно откусывать (яблоко, бутерброд)', 'Трудно жевать твёрдую еду (мясо, яблоко)', 'Выбирали мягкую еду, потому что трудно жевать', 'Еда занимала больше времени, чем у других', 'Еда застревала или давились'];
const g_speech = ['Другие плохо понимали речь', 'Просили повторить сказанное', 'Трудно произносить некоторые звуки', 'Не хотелось разговаривать из-за речи'];
const g_jaw = ['Боль в челюсти или возле уха', 'Щелчки или хруст в челюсти', 'Трудно широко открыть рот', 'Болела голова'];
const g_mood = ['Стеснялись своего внешнего вида', 'Не хотелось фотографироваться', 'Не хотелось общаться со сверстниками', 'Дразнили или неприятно шутили про внешность', 'Переживали или тревожились из-за внешности'];
const g_app = ['Лицо сбоку (профиль)', 'Лицо спереди', 'Подбородок и нижняя челюсть', 'Одинаковость правой и левой половин лица', 'Зубы и то, как они смыкаются (прикус)'];

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

function header(titleText) {
  return [
    p('ФГБУ НМИЦ «ЦНИИС и ЧЛХ» Минздрава России', { size: 18, color: '555555' }),
    new Paragraph({ spacing: { after: 40 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: TEAL } }, children: [new TextRun({ text: titleText, bold: true, size: 32, color: '0F766E' })] }),
    p('Заполните, пожалуйста, анкету. Выбранный ответ отметьте галочкой (✔) в нужном квадратике. Отвечайте по состоянию ребёнка за последнее время.', { italics: true, size: 18, color: '555555', spacing: { after: 120 } }),
  ];
}

function meta() {
  return [
    line('Код пациента (выдаёт врач):'),
    line('Дата заполнения:'),
    new Paragraph({ spacing: { after: 120 }, children: [
      new TextRun({ text: 'Кто заполняет анкету:  ', size: 20 }),
      new TextRun({ text: `${BOX} родитель     ${BOX} ребёнок     ${BOX} вместе (ребёнок и родитель)`, size: 20 }),
    ]}),
    new Paragraph({ spacing: { after: 120 }, children: [
      new TextRun({ text: 'Возраст ребёнка (полных лет): ', size: 20 }),
      new TextRun({ text: '______     ', size: 20, color: '888888' }),
      new TextRun({ text: 'Пол ребёнка:  ', size: 20 }),
      new TextRun({ text: `${BOX} мальчик     ${BOX} девочка`, size: 20 }),
    ]}),
  ];
}

const ratings = [
  rating0to10('Оцените внешний вид лица в целом'),
  rating0to10('Оцените функцию жевания, дыхания и речи в целом'),
  rating0to10('Оцените качество жизни в связи с состоянием челюсти'),
  p('0 — очень плохо, 10 — отлично.', { italics: true, size: 16, color: '777777', spacing: { after: 80 } }),
];

function eatSection() {
  return [
    sectionTitle('Глотание (опросник EAT-10)'),
    legend('По каждому пункту обведите цифру: 0 — нет проблемы, 4 — серьёзная проблема.'),
    scaleTable(EAT10, ['0', '1', '2', '3', '4']),
    p('Сумму (0–40) и вывод врач вносит в программу. Для справки: 3 балла и больше — есть нарушение глотания.', { italics: true, size: 16, color: '777777', spacing: { before: 80 } }),
  ];
}

function consent() {
  return [
    sectionTitle('Согласие'),
    new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: `${BOX} `, size: 22 }), new TextRun({ text: 'Я, родитель (законный представитель), согласен(на) на обработку указанных данных в обезличенном виде для медицинских целей.', size: 19 })] }),
    new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: `${BOX} `, size: 22 }), new TextRun({ text: 'Согласие ребёнка (если отвечает ребёнок).', size: 19 })] }),
    line('Подпись / ФИО:'),
  ];
}

function docDO() {
  const kids = [
    ...header('Опросник пациента — ДО лечения'),
    ...meta(),
    sectionTitle('Немного истории'),
    line('В каком возрасте заметили асимметрию или недоразвитие челюсти?'),
    line('Как, по вашему мнению, это возникло?'),
    new Paragraph({ spacing: { after: 120 }, children: [
      new TextRun({ text: 'Менялась ли выраженность со временем:  ', size: 20 }),
      new TextRun({ text: `${BOX} не менялась     ${BOX} усиливалась     ${BOX} уменьшалась`, size: 20 }),
    ]}),
    new Paragraph({ spacing: { after: 120 }, children: [
      new TextRun({ text: 'Было ли ранее лечение челюсти (операции, брекеты, аппараты):  ', size: 20 }),
      new TextRun({ text: `${BOX} нет     ${BOX} да`, size: 20 }),
    ]}),
    line('Если да — какое:'),
    line('Что беспокоит больше всего?'),
    sectionTitle('Дыхание и сон'), legend('Как часто это бывает?'), scaleTable(g_breath, SYMP),
    sectionTitle('Жевание и еда'), legend('Как часто это бывает?'), scaleTable(g_chew, SYMP),
    sectionTitle('Речь'), legend('Как часто это бывает?'), scaleTable(g_speech, SYMP),
    sectionTitle('Челюсть и боль'), legend('Как часто это бывает?'), scaleTable(g_jaw, SYMP),
    sectionTitle('Внешний вид'), legend('Насколько нравится?'), scaleTable(g_app, APP),
    sectionTitle('Настроение и общение'), legend('Как часто это бывает?'), scaleTable(g_mood, SYMP),
    sectionTitle('Общие оценки'), ...ratings,
    ...eatSection(),
    ...consent(),
  ];
  return new Document({ sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children: kids }] });
}

function docPOSLE() {
  const change5 = ['Намного хуже', 'Хуже', 'Без изменений', 'Лучше', 'Намного лучше'];
  const kids = [
    ...header('Опросник пациента — ПОСЛЕ лечения'),
    ...meta(),
    sectionTitle('Дыхание и сон'), legend('Как часто это бывает сейчас?'), scaleTable(g_breath, SYMP),
    sectionTitle('Жевание и еда'), legend('Как часто это бывает сейчас?'), scaleTable(g_chew, SYMP),
    sectionTitle('Речь'), legend('Как часто это бывает сейчас?'), scaleTable(g_speech, SYMP),
    sectionTitle('Челюсть и боль'), legend('Как часто это бывает сейчас?'), scaleTable(g_jaw, SYMP),
    sectionTitle('Внешний вид'), legend('Насколько нравится сейчас?'), scaleTable(g_app, APP),
    sectionTitle('Настроение и общение'), legend('Как часто это бывает сейчас?'), scaleTable(g_mood, SYMP),
    sectionTitle('Общие оценки'), ...ratings,
    sectionTitle('Что изменилось по сравнению с состоянием до лечения'),
    scaleTable(['Внешний вид', 'Дыхание и сон', 'Жевание'], change5),
    new Paragraph({ spacing: { before: 140, after: 120 }, children: [
      new TextRun({ text: 'Рекомендовали бы вы такое лечение другому человеку с похожей проблемой?  ', size: 20 }),
      new TextRun({ text: `${BOX} да     ${BOX} скорее да     ${BOX} скорее нет     ${BOX} нет`, size: 20 }),
    ]}),
    line('Что вы отмечали в ходе лечения (кратко):'),
    ...eatSection(),
    ...consent(),
  ];
  return new Document({ sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children: kids }] });
}

(async () => {
  fs.writeFileSync(OUT + 'Опросник_ДО_лечения.docx', await Packer.toBuffer(docDO()));
  fs.writeFileSync(OUT + 'Опросник_ПОСЛЕ_лечения.docx', await Packer.toBuffer(docPOSLE()));
  console.log('OK');
})();
