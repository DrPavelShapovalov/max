# Ролик /brag-slim о сайте drshapovalov.ru

20 с, 1080×1920, 30 к/с. Схема «Как растёт кость» — настоящий SVG и логика dxSet с сайта, тексты — из `site/content.json`.
Музыка написана кодом (`music.py`, 120 BPM, ре минор) — лицензия на неё не нужна.

```
python3 make_composition.py          # composition/index.html (+ шрифты и картинки с сайта)
python music.py                      # brag-output/work/music.wav (нужны numpy и scipy)
node render.cjs stills               # проверочные кадры
node render.cjs frames               # 600 кадров → brag-output/work/frames
# обложка (кадр 8,5 с) — нулевым кадром, затем ffmpeg (см. историю коммита)
```
План — `brag-output/brag-plan.md`, подпись — `brag-output/share-copy.txt`.

## Полный /brag (HyperFrames), 06.11.2026
`make_full.py <папка запуска>` собирает композицию HyperFrames в `brag-output-2026-11-06-184050/composition/`:
настоящая схема «Как растёт кость» и подпись с сайта, тексты из `content.json`, музыка Sascha Ende (CC BY 4.0),
звуки Kenney (CC0), свечение фона реагирует на басы. Дальше:
`cd <папка>/composition && npx hyperframes@0.8.223 check && npx hyperframes@0.8.223 render --quality delivery --output ../brag.mp4`.
План, бриф и подпись лежат в папке запуска; видео и кадры в git не кладутся.
