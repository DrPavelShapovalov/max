"""Список кусков рилса «Один день на дежурстве»: файл, начало, длительность, подпись, где подпись (top/low), фильтр."""
FPS, W, H, T = 30, 1080, 1920, 0.45          # T — длительность перехода
# blur: прямоугольники [x, y, w, h] в кадре 1080×1920, которые размываются (мониторы с данными пациентов)
SEGS = [
  dict(f='01a-IMG_9119', ss=0.0, d=2.43, sec='title', speed=0.7),   # замедлено: под заголовок нужно ~3,5 с
  dict(f='01b-IMG_9120', ss=0.4, d=3.0, sec='wake'),
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
  dict(f='12c-IMG_9167', ss=0.2, d=3.0, sec='lunch', blur=[[0, 0, 1080, 800]]),
  dict(f='13b-IMG_9189', ss=0.2, d=3.6, sec='evening'),
  dict(f='13a-IMG_9183', ss=0.0, d=2.46, sec='turn', speed=0.8),     # подкрутка в 20:03 — после вечернего отдыха
]
SECTIONS = {   # время, заголовок, позиция подписи, подзаголовок секции
  'title':   dict(),
  'wake':    dict(time='06:30', title='Подъём!', pos='low'),
  'road':    dict(time='06:47', title='Дорога на работу', pos='low'),
  'work':    dict(time='07:22', title='Я на работе', pos='low'),
  'coffee':  dict(time='07:40', title='Утренний кофе', note='с синнабоном из ВкусВилла', pos='top'),
  'docs':    dict(time='07:49', title='Документы', pos='top'),
  'dress':   dict(time='10:03', title='Перевязки', pos='top'),
  'rest':    dict(time='10:54', title='Отдых', note='выдохнуть и расслабиться', pos='top'),
  'lunch':   dict(time='13:13', title='Обедик', pos='top'),
  'turn':    dict(time='20:03', title='Подкрутка дистрактора', note='вечерняя, по расписанию', pos='top'),
  'evening': dict(time='17:18', title='Вечер', note='пилю свой сайт и смотрю кино', pos='low'),
}
TRANS = ['smoothup', 'circleopen', 'slideleft', 'zoomin', 'smoothleft', 'radial', 'circleopen', 'diagtl', 'smoothright',
         'pixelize', 'slideup', 'zoomin', 'radial', 'smoothleft', 'circleopen', 'fadewhite', 'circlecrop']
FINAL = 3.4   # финальная карточка «Отбой»
dur = lambda s: s['d'] / s.get('speed', 1)
def timeline():
    """Начало каждого куска на итоговой ленте (с учётом наложения переходов) и общая длительность."""
    st, t = [], 0.0
    for s in SEGS: st.append(t); t += dur(s) - T
    return st, t + FINAL + T          # финал (длина FINAL + T) начинается переходом с последнего куска
