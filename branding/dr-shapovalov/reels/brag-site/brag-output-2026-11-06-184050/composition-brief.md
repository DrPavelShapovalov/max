# Hyperframes Composition Brief: drshapovalov.ru

## Objective
Короткий спокойный ролик о сайте детского челюстно-лицевого хирурга Шаповалова П. И.

## Output
- Composition directory: `composition/` (генерируется `../make_full.py`)
- Rendered video: `brag.mp4`
- Format: vertical, 1080×1920, 30 fps
- Duration: 23,0 s

## Source Material
- Project root: `branding/dr-shapovalov/site/`
- Primary files read: `index.html` (SVG `.dx-svg`, функция `dxSet()`, SVG подписи `#sig`, CSS), `content.json`, `fonts/fonts.css`
- Product name: drshapovalov.ru
- Strongest claim: «Если нижняя челюсть недоразвита, её можно удлинить.»
- Key UI moment: интерактивная схема «Как растёт кость» (раздвигание до 15,0 мм)
- Copy verbatim: хук; «Как растёт кость»; этапы; «Аппарат понемногу раскручивают, обычно около миллиметра в сутки.»; имя; «Челюстно-лицевой хирург, к.м.н.»; «Лечу детей и подростков.»; 6 лет / 10 статей / 7 докладов с подписями (подпись статей и докладов сокращена).

## Creative Direction
- Tone preset: polished
- Creative direction: «без пафоса, факты только с сайта» (пожелание доктора)
- Interpretation: длинные удержания, одно движение за раз, без хлёстких эффектов
- Angle: сайт объясняет метод на живой схеме; ролик показывает эту схему в работе, потом кто это делает и где читать
- Hook: фраза сайта + контур челюсти, в котором проводится распил
- Outro: знак «Ш.», drshapovalov.ru, «Как растёт кость, кейсы, статьи и контакты», подпись пером
- Avoid: фото пациентов и снимки; утверждения не с сайта; общий «SaaS»-язык

## Visual Identity
- Background: #05080a (глубокий #0a1513, изумруд #164236)
- Text: #ede8de (вторичный #c3ccc8, #93a19b)
- Accent: #d6b266 / #f0d48e
- Display font: Unbounded (локальный woff2 с сайта)
- Body font: Manrope (локальный woff2 с сайта)

## Storyboard
См. `brag-plan.md`:
1. Хук: 4,39 с
2. Схема: 6,54 с
3. Кто: 3,80 с
4. Цифры: 4,37 с
5. Финал: 3,90 с

## Audio
- Audio role: тёплая подложка + редкие тихие акценты
- Music: happy-beats-business-moves-vol-12-by-ende-dot-app.mp3, громкость 0,35, fade-in 0,3 с, fade-out 2 с
- Cue guidance: бандл-пресет vol-12; привязки 8,74 (15,0 мм), 10,93 (фото), 19,66 (знак); строки цифр на долях 14,73 / 15,29 / 15,84
- Audio-reactive: subtle; басы → яркость изумрудного свечения фона и ореола знака (`extract-audio-data.py` из media-use, выборка 0,2 с)
- SFX: impactSoft_medium_001 (4,39), drop_002 ×3 (строки цифр), bong_001 (19,66), всё тихо (0,2–0,32)
