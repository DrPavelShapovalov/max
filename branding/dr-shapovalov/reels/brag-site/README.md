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
