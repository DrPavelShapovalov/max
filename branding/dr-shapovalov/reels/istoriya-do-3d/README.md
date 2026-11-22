# Рилс «История ДО» — 3D, голос доктора

- `index.html` + `scene.js` — сцена three.js (r134), всё зависит от времени: `window.setT(t)`.
- `render.cjs` — рендер кадр за кадром в Chromium: `node render.cjs . --out <имя>` (кадры), `--still 5,12` (проверочные кадры).
- Звук (`voice.wav`, `music.wav`) и `out/` в git не идут. Голос — студийная запись доктора (Audacity), обрезана до 34 с.
- Субтитры — по таймингам слов (`assets/words.json`, faster-whisper small); ошибки распознавания исправлены в `scene.js`.

## Лицензии
- 3D-модель нижней челюсти `assets/mandible.stl` — BodyParts3D, © The Database Center for Life Science (DBCLS),
  CC BY-SA 2.1 Japan (FMA52748, через https://github.com/Kevin-Mattheus-Moerman/BodyParts3D). Mitsuhashi N. et al.
  Nucleic Acids Res. 2009;37:D782–5, https://doi.org/10.1093/nar/gkn613. Распил и аппараты добавлены в сцене.
- Шрифты Unbounded и Manrope — SIL OFL 1.1. three.js — MIT.
