"""Обложка рилса 1080×1920: кадр в маске и шапочке + разноцветный заголовок в стиле ролика.
   Весь текст — внутри центральной зоны 3:4 (y 240…1680), чтобы в сетке профиля ничего не обрезалось."""
import numpy as np
from PIL import Image, ImageEnhance
import compose as C
bg = Image.open('work/cover/11b-IMG_9136.png').convert('RGB')
bg = ImageEnhance.Color(bg).enhance(1.2); bg = ImageEnhance.Contrast(bg).enhance(1.05)
c = bg.convert('RGBA')
C.shade(c, 260, 780, 1.15); C.shade(c, 1440, 1640, 0.9)
over = Image.new('RGBA', c.size); T = 10.0                                      # «финальное» состояние анимаций
C.sparkles(over, 0.45, 0.0, 540, 520, 560, 5, 14)                                # звёздочки — под буквами
y = 300
for text, px in (('Один день из жизни', 84), ('челюстно-', 118), ('лицевого', 118), ('хирурга', 118)):
    y += C.draw_colored(over, [text], px, 0, y, T, -5, 99, align='center')
C.chip(over, 'на дежурстве', 0, 1500, T, -5, 99, px=62, icon='moon', center=True)
c.alpha_composite(over)
c.convert('RGB').save('out/cover.jpg', quality=93)
c.crop((0, 240, 1080, 1680)).convert('RGB').resize((540, 720)).save('work/cover-grid.jpg', quality=90)   # так обложка выглядит в сетке 3:4
print('out/cover.jpg')
