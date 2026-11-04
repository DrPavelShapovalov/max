# CONTEXT — полный контекст проекта (программы, калькулятор, планнер, Google-экосистема)

> Единый справочник, чтобы не потерять контекст и коды. Репозиторий `drpavelshapovalov/max`.
> Автор: Шаповалов П.И. (ФГБУ НМИЦ «ЦНИИС и ЧЛХ» Минздрава России).
> Рабочая ветка разработки: `claude/amazing-bell-gvc4xo`. Ветка по умолчанию: `main`.
>
> ⚠️ **Персональные данные.** В Google-таблице есть вкладка «РАСШИФРОВКА» с соответствием
> «код пациента → фамилия». Реальные фамилии сюда НЕ выписаны намеренно (152-ФЗ). Коды
> пациентов обезличены; расшифровка хранится только в закрытой таблице.

---

## 1. Что это за проект

Две самостоятельные медицинские программы + вспомогательная Google-экосистема
(опросники, сбор результатов, автоподсчёт баллов) вокруг темы **недоразвития нижней
челюсти и дистракционного остеогенеза (ДО)**:

| # | Программа | Папка | Назначение |
|---|-----------|-------|-----------|
| 1 | **Анализатор КДО** | `desktop/` | Расчёт показаний к дистракционному остеогенезу: морфометрия (ИА/ИНЧ), объективизация функциональных нарушений по доп. методам, индекс MOFI (0–100). Десктоп Windows (Electron) + автономный `index.html`. |
| 2 | **OSSA 3D (планнер)** | `viewer/` | 3D-планировщик черепно-лицевых операций: загрузка DICOM/STL, воксельная сегментация, эндопротез ВНЧС, цефалометрия, протокол PDF, анимация/видео. |

Также в репозитории: `web/` (сайт-визитка) — к медицинским программам прямого
отношения не имеет.

---

## 2. Карта репозитория

```
max/
├── CONTEXT.md                     ← этот файл
├── desktop/                       ПРОГРАММА 1 — Анализатор КДО
│   ├── app/index.html             всё приложение в одном файле (~5300 строк)
│   ├── main.js                    обёртка Electron (окно)
│   ├── build/icon.ico
│   ├── package.json               version 2.5.0
│   ├── README.md                  документация (v2.0 / v2.3 / v2.5)
│   ├── apps-script/Code.gs        серверный код облачного архива КДО (Apps Script)
│   └── questionnaires/            опросники для родителей
│       ├── EAT10_GoogleForm.gs    Apps Script: создать Google-форму EAT-10
│       ├── generate_forms.js      генератор Word: Опросник ДО + ПОСЛЕ
│       ├── generate_eat10.js      генератор Word: отдельный бланк EAT-10
│       ├── Опросник_ДО_лечения.docx
│       ├── Опросник_ПОСЛЕ_лечения.docx
│       └── Опросник_EAT-10.docx
├── viewer/                        ПРОГРАММА 2 — OSSA 3D планнер (version 3.3.0)
│   ├── index.html                 UI
│   ├── src/                       Three.js-логика, сегментация, STL, цефалометрия…
│   ├── electron-main.cjs
│   ├── vite.config.js
│   └── package.json
├── web/                           сайт-визитка (не медицинское)
└── .github/workflows/
    ├── build-desktop.yml          CI: desktop/** → Windows .exe (артефакт)
    ├── build-viewer.yml           CI: viewer
    └── deploy-pages.yml
```

---

## 3. ПРОГРАММА 1 — Анализатор КДО (`desktop/`)

### 3.1. Что делает

Свидетельство о госрегистрации программы для ЭВМ № RU 2026614230.
Приложение рассчитывает показания к дистракционному остеогенезу нижней челюсти:

1. **Морфометрия** — по треугольникам половин нижней челюсти (стороны AB, BC, CA)
   считает площади (формула Герона) и два индекса:
   - **ИА** (индекс асимметрии) — для одностороннего недоразвития;
   - **ИНЧ** (индекс недоразвития нижней челюсти) — для двустороннего (сравнение
     с возрастным референсом из диссертации, Таблица 5, n=127 здоровых детей).
2. **Функциональный блок** — объективизация по числам из заключений доп. методов
   (ПСГ, ЭМГ, T-scan, клиника, EAT-10, стабилометрия) + анализ текста логопеда.
   Если числа нет — резервная ручная галочка.
3. **MOFI** — единый индекс 0–100, объединяющий морфологию и функцию.
4. **Архив** пациентов (localStorage) + облачная синхронизация в Google-таблицу.
5. **PDF-протокол**, анимированный датчик индекса, мини-график динамики.

Технически — один автономный `index.html`: внутри инлайнятся React (production,
`createElement`, без JSX), Tailwind (`<style id="tw">`), jsPDF и дизайн-система
MORPHO-HUD (тёмная/светлая тема через CSS-токены). Electron (`main.js`) открывает
этот файл в окне. Работает офлайн.

### 3.2. Как собрать установщик (.exe)

Собирается автоматически в GitHub Actions при изменении `desktop/`:
Actions → **Build Desktop (Windows)** → артефакт `AnalizatorKDO-Windows-Installer`
→ внутри `AnalizatorKDO-Setup-<версия>.exe`. Можно запустить вручную (Run workflow).

Локально:
```bash
cd desktop
npm install
npm start        # запустить приложение
npm run dist     # собрать установщик в dist/ (только на Windows)
```

### 3.3. Ключи localStorage

- `kdo_archive` — архив расчётов (массив записей пациентов)
- `kdo_sync_cfg` — настройки облака (url веб-приложения, token, имя кабинета)
- `kdo_sync_queue` — очередь отправки в облако
- `kdo_cloud_cache` — кэш подтянутых из облака записей
- `kdo_theme` — тема оформления

### 3.4. История версий (desktop)

| Версия | Коммит | Что добавлено |
|--------|--------|---------------|
| 2.5.0 | 87e3f71 | **MOFI** — индекс морфология+функция 0–100 |
| 2.4.5 | bf5951e | встроенный опросник EAT-10 |
| 2.4.4 | 35dd9fb | анимация мини-графика динамики (TrendSparkline) |
| 2.4.3 | 8d6fd25 | новый анимированный датчик индекса |
| 2.4.2 | a23e174 | калькулятор в стиле нового входа |
| 2.4.1 | 02afe22 | вернул резервную галочку (если нет цифры/текста) |
| 2.4 | 276febc | редизайн экрана входа и общего стиля |
| 2.3 | 551bad7 | окна ПСГ под реальный бланк + группировка |
| 2.2.1 | 267995e | код Google можно скачать/скопировать |
| 2.2 | cf76da4 | конкретные методы объективизации + анализ логопеда |
| 2.1 | 47dec3c | объективизация функц. нарушений по цифрам |
| 2.0 | 9f8e36f / bb80e0c | формула + анимации + облачная синхронизация |

---

## 4. Формулы и методология (КДО)

### 4.1. Площадь (формула Герона)

```
s = (a + b + c) / 2
S = √( s·(s−a)·(s−b)·(s−c) )
```

### 4.2. ИА — индекс асимметрии (односторонний дефект)

```
ИА = |S_right − S_left| / (S_right + S_left) × 100 %
```

### 4.3. ИНЧ — индекс недоразвития (двусторонний дефект)

```
S_avg = (S_right + S_left) / 2
ИНЧ  = (S_avg − S_ref) / S_ref × 100 %      (отрицательное = недоразвитие)
```

Возрастные референсы (из диссертации, стороны AB/BC/CA в мм):
- 9–11 лет: 18.5 / 56.3 / 64.2
- 12–14 лет: 20.3 / 59.8 / 69.1
- 15–17 лет: 21.8 / 63.2 / 73.5

### 4.4. MOFI — Mandibular Osteo-Functional Index (0–100)

Идея: каждое число объяснимо (без «почему 1, а не 0.9»).

1. **Объективная тяжесть** показателя `s ∈ [0…1]`:
   `s = (измерено − норма) / (тяжёлое − норма)`, обрезано в [0;1]. Для каждого
   метода заданы две опорные точки — норма (s=0) и «тяжёлое» (s=1). Только галочка
   без цифры → s = 0.5.
2. **Вес-потолок `w`** по рангу угрозы (жизнеугрожающее 1.0 … низкое 0.3);
   вклад метода `c = w · s`.
3. **Функция `F`** — «объединение» (noisy-OR): `F = 1 − Π(1 − cᵢ)`.
4. **Морфология `m`** нормируется из ИА/ИНЧ (ИА: 3→0, 20→1; ИНЧ: −5→0, −30→1).
5. **MOFI = 100 · (0.6·m + 0.4·F)** — морфология ведущая, функция усиливает.

Полосы: `<20` минимальны · `20–45` умеренные · `45–70` выраженные · `≥70` явные показания.

---

## 5. Ключевые коды Анализатора КДО (verbatim из `desktop/app/index.html`)

### 5.1. METHODS — таблица методов объективизации

Поля: `key`, `base` (вес), `group`, `title` (как в бланке), `what`, `source`
(откуда взять число), `unit`, `normText`, `dir` (`gte`/`lte`/`lt`), `norm`,
`severe` (точка «тяжёлое» для MOFI), `grade(v)` (повышающий коэффициент).
`ahiNorm` зависит от возраста: у детей <14 лет норма ИАГ строже (<1).

```js
const ageN = parseFloat(age);
const ahiNorm = (ageN > 0 && ageN < 14) ? 1 : 5;   // у детей норма ИАГ строже (< 1)
const METHODS = [
  // ───── ПОЛИСОМНОГРАФИЯ (сон) ─────
  { key:'ahi', base:1.0, group:'Полисомнография (сон)',
    title:'Индекс апноэ-гипопноэ (ИАГ / «А+Г»), эп./час',
    what:'Сколько остановок/ослаблений дыхания во сне приходится на 1 час. Главный маркёр ночного апноэ при недоразвитии нижней челюсти.',
    source:'В заключении ПСГ или в блоке «Индекс эпизодов нарушения дыхания» — строка «А+Г» (апноэ+гипопноэ). У Горбатенко — 0,87.',
    unit:'эп./час', normText:'Норма < ' + ahiNorm + (ageN > 0 && ageN < 14 ? ' (ребёнок)' : '') + '. Балл — при ИАГ ≥ ' + ahiNorm + '.',
    dir:'gte', norm:ahiNorm, severe:30, grade:v=> v>=30?1.3 : v>=15?1.0 : v>=5?0.9 : 0.7 },

  { key:'odi', base:0.7, group:'Полисомнография (сон)',
    title:'Индекс десатураций (ODI), эп./час',
    what:'Сколько раз за час кислород крови падает на ≥ 3–4 %. Отражает кислородное голодание из-за ночной обструкции.',
    source:'В таблице десатурации — строка «Количество десатураций на один час сна (индекс)». У Горбатенко — 0,25.',
    unit:'эп./час', normText:'Норма < 5. Балл — при ODI ≥ 5.',
    dir:'gte', norm:5, severe:30, grade:v=> v>=15?1.2:1.0 },

  { key:'spo2', base:0.8, group:'Полисомнография (сон)',
    title:'Минимальная сатурация SpO₂ за время сна, %',
    what:'Самый низкий уровень кислорода за ночь. Чем ниже — тем тяжелее ночная гипоксия.',
    source:'В сводной таблице десатурации — строка «Минимальный уровень сатурации за время сна, %». У Горбатенко — 76.',
    unit:'%', normText:'Норма ≥ 90 %. Балл — при SpO₂ min ≤ 90 % (≤ 85 % — тяжёлая).',
    dir:'lte', norm:90, severe:80, grade:v=> v<=85?1.3:1.0 },

  { key:'snore', base:0.5, group:'Полисомнография (сон)',
    title:'Индекс храпа, эп./час',
    what:'Сколько эпизодов храпа в час. Высокий индекс = постоянный храп, косвенный признак сужения дыхательных путей.',
    source:'В блоке «Анализ храпа во время сна» — строка «Количество эпизодов храпа в час (индекс)», столбец NREM+REM. У Горбатенко — 192,6.',
    unit:'эп./час', normText:'Практический порог: норма < 30. Балл — при индексе ≥ 30.',
    dir:'gte', norm:30, severe:300, grade:v=> v>=100?1.2:1.0 },

  // ───── ЭМГ ЖЕВАТЕЛЬНЫХ МЫШЦ ─────
  { key:'emg', base:0.6, group:'ЭМГ жевательных мышц', dual:true,
    rLabel:'справа (D)', lLabel:'слева (S)',
    title:'Асимметрия сторон (по «Площадь, мкВ·мс»)',
    what:'Сила мышцы справа и слева. Введите два числа — программа посчитает асимметрию = |П−Л| / (П+Л) × 100 %.',
    source:'Проба «Сжатие зубных рядов», строка «Площадь (мкВ·мс)». Берите пару с наибольшей разницей: височные (1.temporalis D / 3.temporalis S) или жевательные (2.masseter D / 4.masseter S). У Ефимова височные 32,34 / 75,06.',
    unit:'%', normText:'Норма < 15 % разницы. Балл — при асимметрии ≥ 15 % (≥ 25 % — усиление).',
    dir:'gte', norm:15, severe:40, grade:v=> v>=25?1.2:1.0 },

  // ───── ОККЛЮЗИЯ ─────
  { key:'tscan', base:0.5, group:'Окклюзия (T-scan)',
    title:'Нагрузка на перегруженную сторону, %',
    what:'Какой процент силы смыкания приходится на одну сторону. При одностороннем недоразвитии нагрузка смещается.',
    source:'Внизу отчёта T-scan — «Левый … % / Право … %». Введите большее из двух. У Ефимова — «Право 63,7 %».',
    unit:'%', normText:'Норма 40–60 % на сторону. Балл — при перекосе ≥ 60 %.',
    dir:'gte', norm:60, severe:80, grade:v=> v>=70?1.2:1.0 },

  // ───── КЛИНИЧЕСКИЕ ПОКАЗАТЕЛИ ─────
  { key:'incisal', base:0.7, group:'Клинические показатели',
    title:'Открывание рта — межрезцовое расстояние, мм',
    what:'Расстояние между режущими краями верхних и нижних резцов при максимально открытом рте.',
    source:'Измеряется линейкой между резцами, в мм.',
    unit:'мм', normText:'Норма ≥ 35 мм (у детей ≥ 30 мм). Балл — при < 35 мм.',
    dir:'lt', norm:35, severe:20, grade:v=> v<25?1.2:1.0 },

  { key:'eat10', base:0.6, group:'Клинические показатели',
    title:'Дисфагия — сумма баллов опросника EAT-10',
    what:'Стандартный опросник из 10 вопросов о трудностях глотания (0–40 баллов).',
    source:'Сумма баллов опросника EAT-10, заполненного пациентом.',
    unit:'балл', normText:'Норма < 3. Балл — при сумме ≥ 3.',
    dir:'gte', norm:3, severe:15, grade:v=> v>=15?1.2:1.0 },

  { key:'saliva', base:0.3, group:'Клинические показатели',
    title:'Слюнотечение — саливация, мл/мин',
    what:'Объём не удерживаемой во рту слюны; связан с нарушением смыкания губ при микрогении.',
    source:'Сиалометрия — нестимулированная саливация, мл/мин.',
    unit:'мл/мин', normText:'Норма ≤ 7 мл/мин. Балл — при ≥ 7 мл/мин.',
    dir:'gte', norm:7, severe:20, grade:v=> 1.0 },

  // ───── РАВНОВЕСИЕ (справочно) ─────
  { key:'stab', base:0, group:'Равновесие (стабилометрия)', aux:true,
    title:'Площадь статокинезиограммы S (з), мм²',
    what:'Оценка равновесия/постурального баланса. При челюстно-лицевой асимметрии бывает повышена, но прямого балла к КДО не даёт.',
    source:'Таблица «Балансировочные параметры», столбец «S (з), мм²» — глаза закрыты. У Ефимова — 426,5.',
    unit:'мм²', normText:'Референс бланка < 99,5 мм². Выше — нарушение равновесия. В сумму баллов не входит.',
    dir:'gte', norm:99.5, grade:v=> 0 }
];
const SPEECH_BASE = 0.4;
```

### 5.2. methodVerdict — вердикт по одному числовому методу

```js
function methodVerdict(m, meas){
  let v, has, r, l;
  if(m.dual){
    r = parseFloat(meas[m.key+'_r']); l = parseFloat(meas[m.key+'_l']);
    has = !isNaN(r) && !isNaN(l) && (r+l) > 0;
    v = has ? +(Math.abs(r-l)/(r+l)*100).toFixed(1) : null;
  } else {
    const raw = meas[m.key];
    v = parseFloat(raw);
    has = raw!==undefined && raw!=='' && !isNaN(v);
  }
  if(!has) return { has:false, v:null, bad:null, add:0, r, l };
  const bad = m.dir==='gte' ? v>=m.norm : m.dir==='lte' ? v<=m.norm : v<m.norm;
  const add = (m.aux || !bad) ? 0 : +(m.base*m.grade(v)).toFixed(2);
  return { has:true, v, bad, add, r, l };
}
```

### 5.3. analyzeSpeech — эвристический разбор заключения логопеда

Решает, вызвано ли нарушение речи недоразвитием челюсти/прикуса (+0.4), иной
причиной (0) или обеими (+0.2). Учитывает отрицания («с прикусом не связано»).
⚠️ Важно: в JS `\w` не ловит кириллицу — используются классы `[а-я]*`.

```js
function analyzeSpeech(text){
  const t = (text||'').toLowerCase().replace(/ё/g,'е');
  if(!t.trim()) return { status:'none', add:0, text:'Заключение логопеда не введено — балл за речь не начисляется.' };
  const normMatch = /(в норме|не наруш[а-я]*|сформирован[а-я]*|соответству[а-я]* возраст|без [а-я ]{0,15}наруш|наруш[а-я]* не выявл|патологии не выявл|речь чист)/.test(t);
  const strongDisorder = /(сигматизм|ротацизм|ламбдацизм|дизартри|дислали|ринолали|искажен|межзубн|косноязыч|нечетк|невнятн|смаз[а-я]* речь|горлов)/.test(t);
  if(normMatch && !strongDisorder) return { status:'normal', add:0, text:'В заключении речь оценена как нормальная / без нарушений — балл не начисляется.' };
  const hasDisorder = strongDisorder || /(наруш|дефект|искаж|звукопроизнош|артикуляц|боков[а-я]* сигм|шепеляв|картав)/.test(t);
  if(!hasDisorder) return { status:'normal', add:0, text:'В заключении не выявлено речевого нарушения — балл не начисляется.' };
  const jawNeg = /не\s+(связан[а-я]*\s+с\s+|обусловлен[а-я]*\s+)[^.!?;]{0,40}(челюст|прикус|окклюз)/.test(t)
    || /(челюст[а-я]*|прикус[а-я]*|окклюз[а-я]*)[^.!?;]{0,25}не\s+связан/.test(t)
    || /прикус[а-я]*\s+(физиологическ|ортогнатическ|правильн|в норме)/.test(t);
  const skeletalRaw = /(нижн[а-я]* челюст|челюст[а-я]* (недоразв|укорочен|асимметри|деформ)|микрогени|ретрогнати|прикус|окклюз|зубочелюстн|скелетн|анатомическ|механическ|межзубн|сужени[а-я]* челюст|деформац[а-я]* челюст|недоразвити[а-я]* (нижн[а-я]* )?челюст)/.test(t);
  const skeletal = skeletalRaw && !jawNeg;
  const other = /(неврологи|дизартри|алали|зрр|задержк[а-я]* (речев|психоречев)|сенсоневральн|тугоухост|снижени[а-я]* слуха|аденоид|функциональн[а-я]* дислали|возрастн|педагогическ|социальн|билингв|заикани|логоневроз)/.test(t) || jawNeg;
  if(skeletal && !other) return { status:'confirmed', add:SPEECH_BASE, text:'Нарушение речи по заключению связано с анатомией нижней челюсти / прикуса → балл начислен (+'+SPEECH_BASE+').' };
  if(skeletal && other)  return { status:'uncertain', add:+(SPEECH_BASE/2).toFixed(2), text:'Названы и скелетная, и иная причина — вклад челюсти вероятен, но не единственный → половинный балл (+'+(SPEECH_BASE/2)+').' };
  if(other && !skeletal) return { status:'other', add:0, text:'Нарушение речи обусловлено иной причиной (неврология / слух / дислалия и т. п.), не связанной с недоразвитием челюсти → балл не начислен.' };
  return { status:'uncertain', add:+(SPEECH_BASE/2).toFixed(2), text:'Причина нарушения речи из текста неоднозначна → половинный балл (+'+(SPEECH_BASE/2)+'). Уточните заключение.' };
}
```

### 5.4. evalFunctional — итоговый балл функционального блока

Объективное число побеждает; если числа нет, но стоит резервная галочка → балл
по галке; для речи — текст, иначе галка.

```js
function evalFunctional(subjChecks, meas, speech){
  const sc = subjChecks || {};
  const per={}; let score=0;
  for(const m of METHODS){
    const vv = methodVerdict(m, meas);
    if(vv.has){
      if(vv.add>0) score += vv.add;
      per[m.key] = { source:'num', confirmed: m.aux? null : vv.bad, bad: vv.bad, v:vv.v, add:vv.add, r:vv.r, l:vv.l };
    } else if(!m.aux && sc[m.key]){
      score += m.base; per[m.key]={ source:'sub', confirmed:null, add:m.base };
    } else {
      per[m.key]={ source:'none', confirmed:null, add:0 };
    }
  }
  const sp = speech || { status:'none', add:0 };
  if(sp.status === 'none' && sc.speech){
    score += SPEECH_BASE;
    per.speech = { source:'sub', status:'sub', add:SPEECH_BASE, text:'Нарушение речи отмечено вручную (без заключения) → балл начислен (+'+SPEECH_BASE+').' };
  } else {
    if(sp.add>0) score += sp.add;
    per.speech = { source:'text', status:sp.status, add:sp.add, text:sp.text };
  }
  return { score:+score.toFixed(2), per };
}
```

### 5.5. MOFI — движок расчёта индекса

```js
const methodSeverity = (m, meas, subjChecks, speechRes) => {
  if (m.aux) return { has: false, s: 0 };
  const vv = methodVerdict(m, meas);
  if (vv.has) {
    if (!vv.bad || m.severe == null) return { has: true, s: 0 };
    const s = m.dir === 'gte' ? (vv.v - m.norm) / (m.severe - m.norm) : (m.norm - vv.v) / (m.norm - m.severe);
    return { has: true, s: Math.max(0, Math.min(1, s)) };
  }
  if (subjChecks && subjChecks[m.key]) return { has: true, s: 0.5 };
  return { has: false, s: 0 };
};
const morphoSeverity = (index, val) => {
  const x = parseFloat(val);
  if (isNaN(x)) return 0;
  if (index === 'ИА') return Math.max(0, Math.min(1, (x - 3) / (20 - 3)));
  return Math.max(0, Math.min(1, (-5 - x) / 25)); // ИНЧ: недоразвитие (отрицательное)
};
const mofiBand = v => v >= 70 ? { t: 'явные показания к ДО', c: 'var(--crit)' }
  : v >= 45 ? { t: 'выраженные показания', c: '#ea580c' }
  : v >= 20 ? { t: 'умеренные показания', c: 'var(--warn)' }
  : { t: 'показания минимальны', c: 'var(--good)' };
const computeMOFI = (index, indexValue) => {
  const sp = analyzeSpeech(logoText);
  const parts = [];
  let prod = 1;
  for (const m of METHODS) {
    if (m.aux) continue;
    const { has, s } = methodSeverity(m, objMeas, subj, sp);
    if (has && s > 0) { const c = m.base * s; prod *= (1 - c); parts.push({ key: m.key, title: m.title, w: m.base, s, c }); }
  }
  const ss = sp.status === 'confirmed' ? 1 : sp.status === 'sub' ? 0.6 : sp.status === 'uncertain' ? 0.5 : 0;
  if (ss > 0) { const c = SPEECH_BASE * ss; prod *= (1 - c); parts.push({ key: 'speech', title: 'Нарушение речи', w: SPEECH_BASE, s: ss, c }); }
  const F = 1 - prod;
  const m = morphoSeverity(index, indexValue);
  const mofi = Math.max(0, Math.min(100, Math.round(100 * (0.6 * m + 0.4 * F))));
  parts.sort((a, b) => b.c - a.c);
  return { mofi, m, F, band: mofiBand(mofi), parts };
};
```

### 5.6. Морфометрия — calculateArea / calculateIA / calculateINCh

```js
const calculateArea = (a, b, c) => {
  const s = (a + b + c) / 2;
  return Math.sqrt(s * (s - a) * (s - b) * (s - c));
};
// ИА
const calculateIA = () => {
  const aRight = parseFloat(rightAB), bRight = parseFloat(rightBC), cRight = parseFloat(rightCA);
  const aLeft  = parseFloat(leftAB),  bLeft  = parseFloat(leftBC),  cLeft  = parseFloat(leftCA);
  if ([aRight,bRight,cRight,aLeft,bLeft,cLeft].some(isNaN)) return null;
  const areaRight = calculateArea(aRight, bRight, cRight);
  const areaLeft  = calculateArea(aLeft, bLeft, cLeft);
  const ia = Math.abs(areaRight - areaLeft) / (areaRight + areaLeft) * 100;
  return { value: ia.toFixed(1), areaRight: areaRight.toFixed(1), areaLeft: areaLeft.toFixed(1) };
};
// ИНЧ
const calculateINCh = () => {
  const aRight=parseFloat(rightAB), bRight=parseFloat(rightBC), cRight=parseFloat(rightCA);
  const aLeft =parseFloat(leftAB),  bLeft =parseFloat(leftBC),  cLeft =parseFloat(leftCA);
  const aRef  =parseFloat(refAB),   bRef  =parseFloat(refBC),   cRef  =parseFloat(refCA);
  if ([aRight,bRight,cRight,aLeft,bLeft,cLeft,aRef,bRef,cRef].some(isNaN)) return null;
  const areaRight=calculateArea(aRight,bRight,cRight);
  const areaLeft =calculateArea(aLeft,bLeft,cLeft);
  const areaRef  =calculateArea(aRef,bRef,cRef);
  const avgArea  =(areaRight+areaLeft)/2;
  const inch     =(avgArea-areaRef)/areaRef*100;
  return { value: inch.toFixed(1), avgArea: avgArea.toFixed(1), refArea: areaRef.toFixed(1) };
};
```

---

## 6. ПРОГРАММА 2 — OSSA 3D планнер (`viewer/`, version 3.3.0)

### 6.1. Что делает

3D-планировщик черепно-лицевых операций:
- загрузка **DICOM** (dicom-parser, cornerstone codecs) и **STL** (импорт/экспорт);
- воксельная **сегментация** (кисть-«Mimics» с прокруткой колёсиком);
- **эндопротез ВНЧС** в стиле BonaByte (медная пластина + головка + винты + ямка);
- **цефалометрия**, измерения;
- **протокол PDF**;
- **анимация/видео** плана;
- сохранение сцены в файл **.ossa**, undo/redo;
- тёмная/светлая тема.

### 6.2. Стек

Three.js 0.160, dicom-parser, cornerstone (WADO) codecs, Vite (`vite.config.js`),
Electron (`electron-main.cjs`). Сборка — через `build-viewer.yml`.

### 6.3. Запуск / сборка

```bash
cd viewer
npm install
npm run dev      # Vite dev-сервер
npm run build    # сборка
```
(в `viewer/` есть `node_modules` для локального Playwright-тестирования — headless
Chromium лежит в `/opt/pw-browsers/chromium`).

---

## 7. Google-экосистема опросников

Три опросника заполняют родители/пациенты; ответы собираются в одну Google-таблицу,
где автоматически считаются баллы (6 доменов качества жизни 0–100 + EAT-10 0–40,
по этапам ДО/ПОСЛЕ).

### 7.1. Google-формы (ссылки для пациентов)

| Опросник | Ссылка для заполнения (родителям) | ID формы (для редактирования) |
|----------|-----------------------------------|-------------------------------|
| **ДО лечения** | https://docs.google.com/forms/d/e/1FAIpQLSfZwLAmzD5e3nyE49R9QGAXNLgcC9HE2DkPRPnNeu4VEyBK_w/viewform | `1kM3EH9TJAsNqNeFp_vUrbiahnPPZLz7s--8gMStGEVo` |
| **ПОСЛЕ лечения** | https://docs.google.com/forms/d/e/1FAIpQLScWYv7IQEbJ0Cuc3X4QwWkpjSEAWZsOs7O_UzNRGeTd8cTJrQ/viewform | `1D6XwYMWPEviybPLscJGiIkPlUuSo5BlX_QWvXGGJQ28` |
| **EAT-10 (глотание)** | https://docs.google.com/forms/d/e/1FAIpQLSdT0wOTWN21nHpk63UDddWil3va7EqjRykOi0Nvs-At5cOMYg/viewform | `1bnaGWKeFKurOfWhEFnpwRCqMzQqiV516-qyUSo0KOpo` |

> EAT-10 заполняется **дважды** — до лечения и после (поле «Этап заполнения»
> различает). Большие опросники ДО и ПОСЛЕ — разные формы.
> Формат ссылки для заполнения: `…/forms/d/e/{id}/viewform`; для редактирования: `…/forms/d/{id}/edit`.

### 7.2. Таблица сбора ответов

- **ID:** `16Vf-PdtZl2jEh_OchhWfxrHEvBX3Fo16QFjc6qvrAU4`
- **Название:** «Ответы: опросник пациентов (ДО и ПОСЛЕ)»
- **Локаль:** ru_RU → разделитель аргументов в формулах — **точка с запятой `;`** (не запятая!).
- **Вкладки:**

| Вкладка | Что |
|---------|-----|
| `Ответы на форму (1)` | ответы формы **ДО** (44 столбца A–AR). Домены считаются в столбцах AS:AX. |
| `Ответы на форму (2)` | ответы формы **ПОСЛЕ** (44 столбца). Домены в AS:AX. |
| `Ответы на форму (3)` | ответы формы **EAT-10** (A–M): A=время, B=код, C=этап, D–M=10 пунктов. Сумма в N, вывод в O. |
| `EAT-10` | карточка пациента: по коду показывает сумму EAT-10 для ДО и ПОСЛЕ + динамику (AVERAGEIFS по коду+этапу). |
| `Баллы` | сводка доменных баллов. |
| `Кодовая_книга` | методика подсчёта всех доменов (см. 7.4). |
| `Ссылки` | ссылки на формы. |
| `РАСШИФРОВКА` | код пациента → фамилия (ПДн, не выгружать). |
| `Лист1` | черновик. |

### 7.3. EAT-10 — автоподсчёт (вкладка «Ответы на форму (3)»)

- `N1` = «Сумма EAT-10 (0–40)», `O1` = «Вывод (≥3 = дисфагия)».
- `N2` — `ARRAYFORMULA`, построчно суммирует пункты `D:M` (0–4 каждый).
- `O2` — `ARRAYFORMULA`: если сумма ≥ 3 → «есть нарушение глотания (дисфагия)», иначе «норма».
- Вкладка-карточка `EAT-10` достаёт суммы по коду пациента и этапу через `AVERAGEIFS`
  (столбцы: код `B`, этап `C`, сумма `N`) и считает динамику «ПОСЛЕ − ДО»
  (отрицательное число = улучшение).

### 7.4. Домены качества жизни (0–100) — методика (из «Кодовая_книга»)

Шесть доменов считаются в `Ответы на форму (1)` и `(2)`, столбцы **AS:AX**,
через `ARRAYFORMULA` (текст ответа → код → нормировка 0–100, где **100 = лучшее состояние**):

| Домен | Пунктов | Шкала симптома |
|-------|--------:|----------------|
| Дыхание и сон | 6 | Никогда=3, Иногда=2, Часто=1, Всегда=0 |
| Жевание и еда | 5 | то же |
| Речь | 4 | то же |
| Челюсть и боль | 4 | то же |
| Внешний вид | 5 | Совсем не нравится=0 … Очень нравится=3 (REGEXMATCH по «очень»/«скорее нрав»/«скорее не») |
| Настроение и общение | 5 | Никогда=3, Иногда=2, Часто=1, Всегда=0 |

Формула домена: `Балл = 100 × сумма_кодов / (3 × число_пунктов)`.
Три общие оценки (внешность / функция / качество жизни) — шкалы 0–10 без пересчёта.
Парный анализ ДО/ПОСЛЕ по коду пациента: критерий Вилкоксона (непарам.) или парный
t-тест (при нормальности). Статус инструмента: авторская разработка, не валидирован
(для валидации — пилот, α Кронбаха по доменам, тест-ретест).

> ⚠️ EAT-10 — шкала **обратная** к доменам: там больше = хуже (0–40, ≥3 — дисфагия).

### 7.5. Печатные Word-версии (для родителей без техники)

Генерируются скриптами в `desktop/questionnaires/` (docx-js):
```bash
cd desktop/questionnaires
npm install docx
node generate_forms.js   # → Опросник_ДО_лечения.docx, Опросник_ПОСЛЕ_лечения.docx
node generate_eat10.js   # → Опросник_EAT-10.docx
```
Стиль: бирюзовый (TEAL `0D9488`), шапка ЦНИИС, таблицы «вопрос + квадратики ☐»,
поля «Код пациента», «Дата», согласие. Готовые `.docx` лежат рядом в папке.

---

## 8. Коды Apps Script

### 8.1. Облачный архив Анализатора КДО

Отдельная Google-таблица-архив (НЕ та, что собирает опросники):
**ID `1UejmQiMUDXp4aFJGSgrHB7RKqLITQO2jZXoXfGC4O0s`**.
Серверный код развёрнут как веб-приложение (Расширения → Apps Script → Развернуть →
Веб-приложение, доступ «Все», выполнять от своего имени). Приложение шлёт расчёты
через JSONP. Файл в репозитории: `desktop/apps-script/Code.gs`. Та же версия
встроена в `index.html` как строка `APPS_SCRIPT_CODE` (кнопки ⚙ → «Показать код» /
«Скачать Code.gs»):

```js
const TOKEN = "ПОСТАВЬТЕ_СВОЙ_СЕКРЕТ";  // тот же, что в приложении
function doGet(e){ return handle(e); }
function doPost(e){ return handle(e); }
function handle(e){
  var p = e.parameter || {};
  var cb = p.callback || "";
  function out(o){ var t = cb ? (cb+"("+JSON.stringify(o)+")") : JSON.stringify(o);
    return ContentService.createTextOutput(t).setMimeType(cb?ContentService.MimeType.JAVASCRIPT:ContentService.MimeType.JSON); }
  if (p.token !== TOKEN) return out({ok:false, error:"auth"});
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("Архив") || ss.getSheets()[0];
  var HEAD = ["timestamp","datetime","user","device","fio","age","gender","defectType","indexType","indexValue","severity","recommendation","rightArea","leftArea","functionalScore","id"];
  if (sh.getLastRow()===0) sh.appendRow(HEAD);
  if (p.action==="ping") return out({ok:true});
  if (p.action==="add"){ var r=JSON.parse(p.record);
    sh.appendRow(HEAD.map(function(k){ return r[k]!==undefined ? r[k] : ""; }));
    return out({ok:true}); }
  if (p.action==="list"){ return out({ok:true, rows: sh.getDataRange().getValues()}); }
  return out({ok:false, error:"unknown action"});
}
```

> 152-ФЗ: без галки «Отправлять ФИО» в облако уходят только инициалы + год рождения.

### 8.2. Создание Google-формы EAT-10

Файл `desktop/questionnaires/EAT10_GoogleForm.gs` — функция `createEAT10Form()`:
создаёт форму с полями «Код пациента», «Этап заполнения» (До/После) и 10 шкальными
пунктами (0–4). Запуск: script.google.com → новый проект → вставить код → выполнить
`createEAT10Form` → в «Журнале выполнения» появятся ссылки для заполнения и для
редактирования.

---

## 9. Шаблон письма родителям

> Здравствуйте! Для объективной оценки состояния ребёнка до и после лечения
> (дистракционный остеогенез нижней челюсти) просим заполнить короткие анкеты.
> Это важно для точности лечения и наблюдения в динамике.
>
> **Код пациента:** `________` (его выдаёт врач — указывайте во всех анкетах одинаково).
>
> **Сейчас, ДО начала лечения, заполните:**
> 1. Основной опросник «ДО лечения»: <ссылка ДО>
> 2. Опросник глотания EAT-10 — выберите этап «ДО лечения»: <ссылка EAT-10>
>
> **После завершения лечения (через назначенный врачом срок) заполните:**
> 3. Основной опросник «ПОСЛЕ лечения»: <ссылка ПОСЛЕ>
> 4. Опросник глотания EAT-10 ещё раз — выберите этап «ПОСЛЕ лечения»: <ссылка EAT-10>
>
> Анкеты анонимны (используется только код). Заполнение — 5–10 минут.
> Если удобнее на бумаге — попросите у врача распечатанные бланки. Спасибо!

Ссылки подставляются из раздела 7.1.

---

## 10. CI / сборка (GitHub Actions)

- `build-desktop.yml` — при изменении `desktop/**` собирает Windows-установщик,
  публикует артефакт `AnalizatorKDO-Windows-Installer`.
- `build-viewer.yml` — сборка планнера.
- `deploy-pages.yml` — публикация страниц.

---

## 11. Открытые вопросы / возможные доработки

- **Саливация (saliva)**: сейчас норма в мл/мин (сиалометрия). Обсуждалось заменить
  на шкалу слюнотечения Томаса-Стонелла (drooling scale) — не подтверждено.
- **Калибровка MOFI**: пороги `norm`/`severe` и веса можно откалибровать по
  накопленной базе (архив/облако), убрав остаток субъективности.
- **Валидация опросника**: пилот, α Кронбаха по доменам, тест-ретест.
- **Памятка для родителей** в виде отдельного Word/PDF — при необходимости.
