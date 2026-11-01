"""Список кусков рилса «Один день на дежурстве»: файл, начало, длительность, подпись, где подпись (top/low), фильтр."""
FPS, W, H, T = 30, 1080, 1920, 0.5           # T — длительность перехода
# blur: прямоугольники [x, y, w, h] в кадре 1080×1920, которые размываются (мониторы с данными пациентов)
SEGS = [
  dict(f='01a-IMG_9119', ss=0.0, d=2.43, sec='wake', speed=0.48),   # замедлено: сначала титр, потом «Подъём»
  dict(f='01b-IMG_9120', ss=0.4, d=3.0, sec='leave'),
  dict(f='02-IMG_9121',  ss=1.0, d=2.7, sec='road', sub='иду по паркингу'),
  dict(f='03-IMG_9122',  ss=1.8, d=3.0, sec='road', sub='сажусь в машину'),
  dict(f='05-IMG_9125',  ss=0.8, d=3.4, sec='road', sub='еду на рассвете'),
  dict(f='06-IMG_9128',  ss=0.3, d=3.0, sec='road', sub='подъезжаю к ЦНИИСиЧЛХ'),
  dict(f='07a-IMG_9129', ss=0.0, d=1.83, sec='work', speed=0.65),        # замедлено: подпись успевает прочитаться
  dict(f='07b-IMG_9131', ss=4.3, d=2.8, sec='coffee'),
  dict(f='08-IMG_9132',  ss=7.6, d=3.0, sec='docs', sub='дежурные дневники'),
  dict(f='09-IMG_9133',  ss=0.2, d=2.8, sec='docs', sub='подписываю бумаги'),
  dict(f='10-IMG_9134',  ss=0.0, d=3.2, sec='dress'),
  dict(f='11a-IMG_9135', ss=0.1, d=2.4, sec='dress', sub='готовлю стол'),
  dict(f='11b-IMG_9136', ss=0.0, d=1.36, sec='dress', sub='маска, шапочка — поехали', speed=0.7),
  dict(f='12a-IMG_9143', ss=0.4, d=2.6, sec='rest'),
  dict(f='12b-IMG_9156', ss=4.7, d=3.1, sec='rest', sub='кола — и снова в строй'),
  dict(f='12c-IMG_9167', ss=0.2, d=3.0, sec='lunch', blur_top=(800, 980)),   # мониторы: полностью размыто выше 800 px, мягкий переход до 980 px
  dict(f='13b-IMG_9189', ss=0.2, d=3.6, sec='evening'),
  dict(f='13a-IMG_9183', ss=0.0, d=2.46, sec='turn', speed=0.8),     # подкрутка в 20:03 — после вечернего отдыха
  dict(f='14-IMG_9205',  ss=0.0, d=3.03, sec='science', speed=0.85),  # статья на мониторах; подпись внизу, над клавиатурой
]
SECTIONS = {   # время, заголовок, позиция подписи, подзаголовок секции
  'wake':    dict(time='06:30', title='Подъём!', pos='low', delay=2.75),        # на первом кадре сначала титр
  'leave':   dict(time='06:45', title='Вышел из дома', pos='low'),
  'road':    dict(time='06:47', title='Дорога на работу', pos='low'),
  'work':    dict(time='07:22', title='Я на работе', pos='low'),
  'coffee':  dict(time='07:40', title='Утренний кофе', note='с синнабоном из ВкусВилла', pos='top'),
  'docs':    dict(time='07:49', title='Документы', pos='top'),
  'dress':   dict(time='10:03', title='Перевязки', pos='top'),
  'rest':    dict(time='10:54', title='Отдых', note='выдохнуть и расслабиться', pos='top'),
  'lunch':   dict(time='13:13', title='Обедик', pos='top'),
  'turn':    dict(time='20:03', title='Подкрутка дистрактора', note='вечерняя, по расписанию', pos='top'),
  'science': dict(time='20:19', title='Наука', note='кандидатская — не предел', pos='low'),
  'evening': dict(time='17:18', title='Вечер', note='пилю свой сайт и смотрю кино', pos='low'),
}
TITLE_END = 2.6     # до этого момента на первом кадре — титр
# переходы: между частями дня — «зум с размытием» (xfade_expr.py), внутри части — мягкое растворение
def trans(i):
    if i >= len(SEGS): return 'fade'
    return 'zoom' if SEGS[i]['sec'] != SEGS[i - 1]['sec'] else 'fade'
FINAL = 5.6   # финал: «Отбой», «Завтра операция» и плашка с подписью, которая пишется пером
dur = lambda s: s['d'] / s.get('speed', 1)
def timeline():
    """Начало каждого куска на итоговой ленте (с учётом наложения переходов) и общая длительность."""
    st, t = [], 0.0
    for s in SEGS: st.append(t); t += dur(s) - T
    return st, t + FINAL + T          # финал (длина FINAL + T) начинается переходом с последнего куска
