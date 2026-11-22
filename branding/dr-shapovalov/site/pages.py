"""Отдельные страницы сайта для поисковиков: метод (дистракционный остеогенез) и каждый клинический случай.

Главная — одна страница, и поисковик находит её в основном по фамилии. Родители ищут по проблеме,
поэтому у метода и у каждого кейса своя страница со своим адресом, заголовком и описанием.
Все тексты — только из content.json (их пишет доктор в админке); здесь ничего не придумывается.

Запуск: python3 pages.py [папка сайта]   (по умолчанию — текущая)
Пишет: lechenie/distraktsionnyj-osteogenez/index.html, kejsy/index.html, kejsy/<адрес>/index.html,
pages.css, sitemap.xml. Только стандартная библиотека Python: скрипт запускается и в сборке (build.py),
и на GitHub после каждой публикации из админки (.github/workflows/indexnow.yml).
"""
import base64, datetime, hashlib, html, json, pathlib, re, sys

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
SITE = 'https://' + ((ROOT / 'CNAME').read_text().strip() if (ROOT / 'CNAME').exists() else 'drshapovalov.ru') + '/'
METHOD = 'lechenie/distraktsionnyj-osteogenez/'
CASES = 'kejsy/'
PRIVACY = 'privacy/'
e = lambda s: html.escape(str(s or ''), quote=True)


def slug(k):
    s = str(k.get('slug') or k.get('id') or '').strip().strip('/')
    return s if re.fullmatch(r'[a-z0-9][a-z0-9-]{0,80}', s) else ''


def sentences(t, drop=()):
    """Убирает фразы, которые относятся к интерактиву главной («прокрутите», «нажмите», «схема»)."""
    parts = re.split(r'(?<=[.!?])\s+', str(t or '').strip())
    return ' '.join(p for p in parts if p and not any(d in p.lower() for d in drop))


def snippet(*parts, limit=160):
    """Описание страницы: части через точку, не длиннее limit, обрезка по слову."""
    out = []
    for p in parts:
        p = plain(p).strip()
        if p:
            out.append(p if p[-1] in '.!?»' else p + '.')
    t = re.sub(r'\s+', ' ', ' '.join(out)).strip()
    if len(t) <= limit:
        return t
    cut = t[:limit - 1]
    cut = cut[:cut.rfind(' ')] if ' ' in cut else cut
    return cut.rstrip(',;:—- ') + '…'


def plain(t):
    t = re.sub(r'\*\*(.+?)\*\*', r'\1', str(t or ''))
    return re.sub(r'\[\[[a-z0-9_-]+\|(.+?)\]\]', r'\1', t, flags=re.I)


def rich(t, terms, used):
    """**жирный** и [[ключ|слово]] → ссылка на пояснение внизу страницы."""
    s = e(t)
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    def term(m):
        k, w = m.group(1), m.group(2)
        if k not in terms:
            return w
        used.setdefault(k, terms[k])
        return f'<a class="term" href="#t-{k}">{w}</a>'
    return re.sub(r'\[\[([a-z0-9_-]+)\|(.+?)\]\]', term, s, flags=re.I)


def glossary(used):
    if not used:
        return ''
    items = ''.join(f'<dt id="t-{k}">{e(t.get("title"))}</dt><dd>{e(t.get("text"))}</dd>' for k, t in used.items())
    return f'<section class="block"><h2>Термины</h2><dl class="gloss">{items}</dl></section>'


def num(v):
    return str(v).replace('.', ',')


def ld(obj):
    return '<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False).replace('</', '<\\/') + '</script>'


def page(c, path, title, desc, body, crumbs, schema, cta=True, head='', cls=''):
    """Общая обёртка: шапка, хлебные крошки, блок записи, автор, подвал, Метрика с целями."""
    h = c.get('hero', {})
    full = ' '.join(x for x in (h.get('lastName'), h.get('firstName'), h.get('middleName')) if x)
    ym = str((c.get('meta') or {}).get('metrika') or '').strip()
    # Метрика — только после согласия на cookie (как на главной, тот же ключ ck-consent в localStorage); цели — нажатия
    # на телефон, почту, Telegram, ПроДокторов. До «Принять» скрипт Метрики не загружается; отказ удаляет её cookie.
    js = ('(function(){var id=%s,K="ck-consent",b=document.getElementById("ck"),on=false;'
          'function g(){try{return localStorage.getItem(K)}catch(e){return null}}function st(v){try{localStorage.setItem(K,v)}catch(e){}}'
          'function drop(){document.cookie.split(";").forEach(function(c){var n=c.split("=")[0].trim();if(n.indexOf("_ym")===0)'
          '["","; domain="+location.hostname,"; domain=."+location.hostname.replace(/^www\\./,"")].forEach(function(d){'
          'document.cookie=n+"=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/"+d})})}'
          'function load(){if(on||!id)return;on=true;window.ym=window.ym||function(){(window.ym.a=window.ym.a||[]).push(arguments)};'
          'window.ym.l=+new Date;var s=document.createElement("script");s.async=1;s.src="https://mc.yandex.ru/metrika/tag.js?id="+id;'
          'document.head.appendChild(s);ym(id,"init",{ssr:true,clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:false})}'
          'document.getElementById("ck-yes").onclick=function(){st("yes");b.hidden=true;load()};'
          'document.getElementById("ck-no").onclick=function(){var w=on;st("no");b.hidden=true;drop();if(w)location.reload()};'
          'document.getElementById("ck-open").onclick=function(){b.hidden=false};'
          'if(id){var v=g();if(v==="yes")load();else if(v!=="no")b.hidden=false}'
          'document.addEventListener("click",function(ev){if(!on)return;var a=ev.target.closest&&ev.target.closest("a[href]");if(!a)return;var u=a.getAttribute("href"),t='
          '/^tel:/.test(u)?"phone":/^mailto:/.test(u)?"email":/t\\.me\\//.test(u)?"telegram":/prodoctorov/.test(u)?"prodoctorov":"";'
          'if(t)ym(id,"reachGoal",t)},true)})();') % (ym if re.fullmatch(r'\d{5,12}', ym) else '0')
    # снимки открываются крупно по нажатию, как на главной; без скрипта ссылка просто откроет картинку
    js += ('(function(){var d=document.getElementById("lb");if(!d||!d.showModal)return;var im=d.querySelector("img"),cp=d.querySelector("p");'
           'document.addEventListener("click",function(ev){var a=ev.target.closest&&ev.target.closest("a.zoom");if(!a)return;ev.preventDefault();'
           'im.src=a.getAttribute("href");im.alt=(a.querySelector("img")||{}).alt||"";cp.textContent=a.dataset.cap||"";d.showModal()});'
           'd.addEventListener("click",function(ev){if(ev.target===d||ev.target.closest("[data-close]"))d.close()})})();')
    sha = base64.b64encode(hashlib.sha256(js.encode()).digest()).decode()
    csp = ("default-src 'self'; script-src 'self' 'sha256-" + sha + "' https://mc.yandex.ru https://mc.yandex.com https://yastatic.net; "
           "style-src 'self'; font-src 'self'; "
           "img-src 'self' data: https://mc.yandex.ru https://mc.yandex.com; connect-src 'self' https://mc.yandex.ru https://mc.yandex.com; "
           "frame-src blob: https://mc.yandex.ru https://mc.yandex.com; base-uri 'self'; form-action 'none'; object-src 'none'")
    work = c.get('work', {})
    call = next((k for k in c.get('contacts', []) if str(k.get('url', '')).startswith('tel:')), None)
    tg = (c.get('meta') or {}).get('telegram')
    prodoc = next((l.get('url') for l in work.get('links', []) if 'prodoctorov' in str(l.get('url', ''))), '')
    crumbs_ld = {'@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': i + 1, 'name': n, 'item': SITE + u} for i, (n, u) in enumerate(crumbs)]}
    bc = ' <span aria-hidden="true">/</span> '.join(
        f'<a href="/{u}">{e(n)}</a>' if i < len(crumbs) - 1 else f'<span aria-current="page">{e(n)}</span>' for i, (n, u) in enumerate(crumbs))
    graph = {'@context': 'https://schema.org', '@graph': [schema, crumbs_ld]}
    return f'''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="{csp}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{SITE}{path}">
<meta property="og:type" content="article"><meta property="og:locale" content="ru_RU"><meta property="og:site_name" content="Dr. Shapovalov">
<meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}"><meta property="og:url" content="{SITE}{path}">
<meta property="og:image" content="{SITE}img/og-cover.jpg"><meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#05080a">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/fonts/fonts.css">
<link rel="stylesheet" href="/pages.css">
{head}

{ld(graph)}
</head>
<body{f' class="{cls}"' if cls else ''}>
<header class="top"><a class="brand" href="/"><span class="mark">Ш.</span> {e(h.get('firstName'))} {e(h.get('lastName'))}</a>
<nav><a href="/{METHOD}">Дистракция</a><a href="/{HIST}">История метода</a><a href="/{CASES}">Кейсы</a><a href="/#contacts">Контакты</a></nav></header>
<main>
<p class="crumbs">{bc}</p>
{body}
{'' if not cta else f"""<section class="block cta">
  <h2>Консультация</h2>
  <p>{e(work.get('name') or '')}{(', ' + e(work.get('address'))) if work.get('address') else ''}.</p>
  <p class="row">{f'<a class="btn" href="{e(call.get("url"))}">Записаться: {e(call.get("value"))}</a>' if call else ''}
  {f'<a class="btn ghost" href="{e(prodoc)}" target="_blank" rel="noopener">Отзывы на ПроДокторов ↗</a>' if prodoc else ''}
  {f'<a class="btn ghost" href="{e(tg)}" target="_blank" rel="noopener">Telegram-канал ↗</a>' if tg else ''}</p>
</section>
<section class="block author">
  <h2>Автор</h2>
  <p><a href="/"><strong>{e(full)}</strong></a> — {e(plain(h.get('lede')))}</p>
</section>"""}
</main>
<footer><p>© {datetime.date.today().year} {e(full)}. {e((c.get('footer') or {}).get('note'))}</p>
<p>Имеются противопоказания. Необходима консультация специалиста.</p>
<p class="legal"><a href="/">drshapovalov.ru</a> <a href="/{PRIVACY}">Политика конфиденциальности</a> <button type="button" class="linkish" id="ck-open">Настройки cookie</button></p></footer>
<div class="ck" id="ck" role="region" aria-label="Cookie-файлы" hidden>
  <p>Разрешить cookie Яндекс Метрики? <a href="/{PRIVACY}">Подробнее</a></p>
  <p class="ck-btns"><button type="button" id="ck-yes">Принять</button><button type="button" id="ck-no">Отклонить</button></p>
</div>
<dialog id="lb" class="lb" aria-label="Снимок крупно"><button type="button" class="lb-x" data-close aria-label="Закрыть">×</button><img alt=""><p></p></dialog>
<script>{js}</script>
</body>
</html>
'''


def is_dist(k):
    """Кейс про дистракционный остеогенез: по словам в заголовке, ярлыках и пунктах."""
    t = plain(' '.join([str(k.get('title', ''))] + [str(x) for x in (k.get('tags') or []) + (k.get('points') or [])])).lower()
    return any(w in t for w in ('дистракц', 'кда', 'регенерат'))


def person(c):
    return {'@id': SITE + '#person'}


def case_card(k):
    s = slug(k)
    tags = ''.join(f'<span class="tag">{e(t)}</span>' for t in k.get('tags') or [])
    return (f'<li><a class="card" href="/{CASES}{s}/"><span class="tags">{tags}</span><strong>{e(k.get("title"))}</strong>'
            f'<span class="metric">{e(k.get("metric"))} {e(k.get("metricUnit"))} — {e(plain(k.get("metricCaption")))}</span></a></li>')


def method_page(c):
    d, terms = c.get('distraction', {}), {t['key']: t for t in c.get('terms', []) if t.get('key')}
    used = {}
    dirs = c.get('directions') or [{}]
    intro = sentences(d.get('intro'), ('прокрут', 'нажм'))
    note = sentences(d.get('note'), ('схем',))
    what = ''.join(f'<p><strong>{e(terms[k]["title"])}.</strong> {e(terms[k]["text"])}</p>' for k in ('dist', 'regen', 'kda') if k in terms)
    phases = ''.join(f'<li><h3>{e(p.get("title"))}</h3><p>{e(p.get("text"))}</p>'
                     + (f'<p class="pro">Для коллег — {e(p.get("titlePro"))}: {e(p.get("textPro"))}</p>' if p.get('textPro') else '') + '</li>'
                     for p in d.get('phases', []))
    st = c.get('steps', {})
    steps = ''.join(f'<li>{e(i.get("title"))} {e(i.get("detail"))}</li>' for i in st.get('items', []))
    st_intro = sentences(plain(st.get('intro')), ('фото', 'нажм'))
    # на странице метода — только кейсы с дистракцией
    cases = ''.join(case_card(k) for k in c.get('cases', []) if slug(k) and is_dist(k))
    sc = c.get('science', {}); ds = sc.get('dissertation', {})
    pubs = [p for p in sc.get('publications', []) if 'дистракц' in str(p.get('title', '')).lower()]
    publist = ''.join(f'<li>{e(p.get("authors"))} {e(p.get("title"))} // {e(p.get("journal"))}.'
                      + (f' <a href="https://doi.org/{e(p["doi"])}" target="_blank" rel="noopener">DOI {e(p["doi"])}</a>' if p.get('doi') else '') + '</li>'
                      for p in pubs)
    title = 'Дистракционный остеогенез нижней челюсти у детей | Шаповалов П. И.'
    desc = snippet(intro, dirs[0].get('text', ''))
    body = f'''<article>
<h1>Дистракционный остеогенез нижней челюсти у детей</h1>
<p class="lede">{e(intro)}</p>
<section class="block"><h2>Что это такое</h2>{what}<p>{e(dirs[0].get("text", ""))}</p></section>
<section class="block"><h2>Как проходит лечение</h2><ol class="phases">{phases}</ol>{f'<p class="note">{e(note)}</p>' if note else ''}</section>
{f'<section class="block"><h2>{e(st.get("heading"))}</h2><p>{e(st_intro)}</p><ol class="steps">{steps}</ol></section>' if steps else ''}
{f'<section class="block"><h2>Клинические случаи</h2><ul class="cards">{cases}</ul></section>' if cases else ''}
<section class="block"><h2>Научная работа</h2>
<p>Кандидатская диссертация: <strong>«{e(ds.get("title"))}»</strong>. {e(ds.get("summary"))}{f' <a href="{e(ds.get("link"))}" target="_blank" rel="noopener">Запись в РГБ ↗</a>' if ds.get('link') else ''}</p>
{f'<ul class="pubs">{publist}</ul>' if publist else ''}</section>
<section class="block"><h2>История метода</h2><p>От кольцевого аппарата Г. А. Илизарова до удлинения нижней челюсти у детей — с первоисточниками.</p><p><a href="/{HIST}">История дистракционного остеогенеза →</a></p></section>
{glossary(used)}
</article>'''
    schema = {'@type': 'MedicalWebPage', '@id': SITE + METHOD, 'url': SITE + METHOD, 'name': title, 'description': desc, 'inLanguage': 'ru',
              'about': {'@type': 'MedicalProcedure', 'name': 'Дистракционный остеогенез нижней челюсти', 'procedureType': 'https://schema.org/SurgicalProcedure'},
              'author': person(c), 'reviewedBy': person(c), 'isPartOf': {'@id': SITE + '#site'}}
    return title, desc, body, schema


def case_page(c, k):
    terms = {t['key']: t for t in c.get('terms', []) if t.get('key')}
    used = {}
    tags = ''.join(f'<span class="tag">{e(t)}</span>' for t in k.get('tags') or [])
    pts = ''.join(f'<li>{rich(p, terms, used)}</li>' for p in k.get('points') or [])
    bars = ''.join(f'<tr><th scope="row">{e(b.get("name"))}</th><td>{e(num(b.get("value")))} {e(b.get("unit"))}</td></tr>' for b in k.get('bars') or [])
    def fig(i):
        cap = f'<figcaption>{e(i.get("caption"))}</figcaption>' if i.get('caption') else ''
        sens = i.get('sensitive')
        note = '<span class="sens-note">Фото из операционной. Нажмите, чтобы открыть</span>' if sens else ''
        return (f'<figure><a class="zoom{" sens" if sens else ""}" href="/{e(i.get("src"))}" data-cap="{e(i.get("caption"))}">'
                f'<img src="/{e(i.get("src"))}" alt="{e(i.get("alt") or i.get("caption"))}" loading="lazy">{note}</a>{cap}</figure>')
    imgs = ''.join(fig(i) for i in k.get('images') or [] if re.match(r'^img/', str(i.get('src', ''))))
    consent = f'<p class="note">{e(k.get("consent"))}</p>' if k.get('consent') else ''
    others = ''.join(case_card(o) for o in c.get('cases', []) if o is not k and slug(o))
    title = f'{plain(k.get("title"))} | Шаповалов П. И.'
    desc = snippet(*(k.get('points') or [])[:2])
    body = f'''<article>
<p class="tags">{tags}</p>
<h1>{e(k.get("title"))}</h1>
<div class="result"><span class="big">{e(k.get("metric"))} <small>{e(k.get("metricUnit"))}</small></span><span>{rich(k.get("metricCaption"), terms, used)}</span></div>
<section class="block"><h2>Ход лечения</h2><ul class="points">{pts}</ul>
{f'<table class="bars"><caption>Цифры случая</caption>{bars}</table>' if bars else ''}</section>
{f'<section class="block"><h2>Фото и снимки</h2><div class="gal">{imgs}</div>{consent}</section>' if imgs else ''}
{f'<section class="block"><h2>О методе</h2><p><a href="/{METHOD}">Дистракционный остеогенез нижней челюсти у детей: как проходит лечение →</a></p></section>' if is_dist(k) else ''}
{glossary(used)}
{f'<section class="block"><h2>Другие случаи</h2><ul class="cards">{others}</ul></section>' if others else ''}
</article>'''
    s = slug(k)
    schema = {'@type': 'MedicalWebPage', '@id': f'{SITE}{CASES}{s}/', 'url': f'{SITE}{CASES}{s}/', 'name': title, 'description': desc, 'inLanguage': 'ru',
              'about': {'@type': 'MedicalCondition', 'name': plain((k.get('tags') or [k.get('title')])[0])},
              'author': person(c), 'reviewedBy': person(c), 'isPartOf': {'@id': SITE + '#site'}}
    return title, desc, body, schema


def cases_index(c):
    cards = ''.join(case_card(k) for k in c.get('cases', []) if slug(k))
    title = 'Клинические случаи | детский хирург Шаповалов П. И.'
    topics = list(dict.fromkeys(str((k.get('tags') or [''])[0]).strip() for k in c.get('cases', []) if slug(k)))
    desc = 'Реальные случаи лечения детей и подростков' + (': ' + ', '.join(t[:1].lower() + t[1:] if not t[:2].isupper() else t for t in topics if t) if topics else '') + '. Цифры до и после лечения, снимки и фото.'
    body = f'<article><h1>Клинические случаи</h1><p class="lede">{e(desc)}</p><ul class="cards">{cards}</ul></article>'
    schema = {'@type': 'CollectionPage', '@id': SITE + CASES, 'url': SITE + CASES, 'name': title, 'description': desc, 'inLanguage': 'ru',
              'author': person(c), 'isPartOf': {'@id': SITE + '#site'}}
    return title, desc, body, schema


PRIVACY_DATE = '07.11.2026'    # дата редакции политики: меняйте, когда меняете текст


def privacy_page(c):
    """Политика конфиденциальности (ст. 18.1 152-ФЗ). Факты — по устройству сайта: форм нет, Метрика по согласию,
    хостинг Yandex Cloud (Россия). Черновик подготовлен без юриста — перед публикацией в новой редакции стоит показать юристу."""
    h = c.get('hero', {})
    full = ' '.join(x for x in (h.get('lastName'), h.get('firstName'), h.get('middleName')) if x)
    mail = next((str(k.get('url'))[7:] for k in c.get('contacts', []) if str(k.get('url', '')).startswith('mailto:')), '')
    m = f'<a href="mailto:{e(mail)}">{e(mail)}</a>' if mail else 'по контактам на главной странице'
    title = 'Политика конфиденциальности — drshapovalov.ru'
    desc = 'Какие данные обрабатываются на сайте drshapovalov.ru, зачем, как долго и как отозвать согласие или удалить данные.'
    body = f'''<article class="legaltext">
<h1>Политика конфиденциальности</h1>
<p class="lede">Сайт drshapovalov.ru. Редакция от {PRIVACY_DATE}.</p>
<section class="block"><h2>1. Кто обрабатывает данные</h2>
<p>Оператор — {e(full)} (физическое лицо), владелец сайта drshapovalov.ru. Связь по любым вопросам о данных: {m}.</p></section>
<section class="block"><h2>2. Посетители сайта</h2>
<p>На сайте нет форм, регистрации, входа через другие сервисы, оплаты и рассылок. Сайт не просит ввести имя, телефон или почту.</p>
<p><strong>Яндекс Метрика — только с вашего согласия.</strong> Если вы нажали «Принять» в окне о cookie-файлах, сервис Яндекс Метрика (ООО «Яндекс», Россия) получает: cookie-файлы Метрики, IP-адрес, сведения о браузере, устройстве и экране, адреса открытых страниц, источник перехода, примерное местоположение (город), нажатия на ссылки и прокрутку. Запись действий на странице (вебвизор) выключена. Цель — считать посещения и понимать, какие разделы полезны. Данные обрабатываются, пока действует согласие; в отчётах Метрики оператор видит обобщённую статистику, без имён и контактов. Отказаться можно в любой момент: «Настройки cookie» внизу любой страницы → «Отклонить». Сайт при отказе работает полностью.</p>
<p><strong>Без согласия</strong> в браузере сохраняются только технические настройки: ваш ответ про cookie-файлы и выбор вкладки «Родителям / Коллегам» (хранилище localStorage). Они не передаются оператору.</p>
<p><strong>Хостинг.</strong> Сайт размещён в Yandex Cloud (ООО «Яндекс.Облако», Россия), файлы сайта и технические журналы хранятся на серверах в России. Как любой веб-сервер, хостинг получает IP-адрес и сведения о браузере при открытии страниц (технические журналы). Оператор эти журналы не получает и не использует.</p>
<p><strong>Карта и внешние ссылки.</strong> Карта Яндекса загружается только после нажатия «Показать карту». При переходе по ссылкам на другие сайты (Telegram, ПроДокторов, научные журналы и т. п.) действуют правила этих сайтов.</p>
<p><strong>Если вы пишете или звоните</strong> по контактам с сайта, оператор использует ваше имя, телефон, почту и текст обращения только для ответа на него и не передаёт их третьим лицам, кроме случаев, предусмотренных законом.</p></section>
<section class="block"><h2>3. Пациенты в клинических случаях</h2>
<p>Клинические случаи публикуются только с письменного согласия пациента или его законного представителя. Публикуются описание случая, возраст, снимки (КТ, ОТПГ) и фото с закрытыми глазами. Имена, даты рождения, номера медицинских карт и другие сведения, по которым можно узнать человека, со снимков вырезаются. Цель — научно-просветительская: показать результаты лечения пациентам и коллегам.</p>
<p>Пациент или законный представитель может в любой момент отозвать согласие и потребовать убрать материалы: напишите на {m}. Материалы будут удалены с сайта не позднее трёх рабочих дней с получения требования.</p></section>
<section class="block"><h2>4. Ваши права и сроки</h2>
<p>Вы можете узнать, какие ваши данные обрабатываются, потребовать их уточнить, удалить, прекратить обработку, отозвать согласие, а также обжаловать действия оператора в Роскомнадзоре или в суде. Запрос отправьте на {m}; в нём укажите, как с вами связаться и о каких данных речь.</p>
<p>Ответ на запрос — в течение 10 рабочих дней с его получения; срок может быть продлён не более чем на 5 рабочих дней, о причинах оператор сообщит. После отзыва согласия данные уничтожаются не позднее 30 дней, если закон не требует хранить их дольше.</p></section>
<section class="block"><h2>5. Дети</h2>
<p>Сайт не собирает данные детей. Клинические случаи детей и подростков публикуются только с письменного согласия законных представителей.</p></section>
<section class="block"><h2>6. Изменения</h2>
<p>Оператор может обновлять эту политику. Действующая редакция всегда на этой странице, дата редакции указана вверху.</p></section>
</article>'''
    schema = {'@type': 'WebPage', '@id': SITE + PRIVACY, 'url': SITE + PRIVACY, 'name': title, 'description': desc, 'inLanguage': 'ru',
              'isPartOf': {'@id': SITE + '#site'}}
    return title, desc, body, schema


CSS = '''/* отдельные страницы: те же цвета и шрифты, что на главной, без анимации */
:root{--void:#05080a;--deep:#0a1513;--emerald:#164236;--ivory:#ede8de;--mist:#93a19b;--soft:#c3ccc8;--line:rgba(237,232,222,.12);
--gold:#d6b266;--gold-hi:#f0d48e;--display:'Unbounded','Arial Black',system-ui,sans-serif;--text:'Manrope','Segoe UI',system-ui,sans-serif;color-scheme:dark}
*{box-sizing:border-box}
html{background:var(--void)}
body{margin:0;background:radial-gradient(120% 60% at 100% 0%,rgba(22,66,54,.55),transparent 60%),var(--void);color:var(--ivory);
font:16px/1.65 var(--text);-webkit-font-smoothing:antialiased;padding:0 20px 40px}
a{color:var(--gold-hi)}
a:hover{color:var(--gold)}
:focus-visible{outline:2px solid var(--gold);outline-offset:3px;border-radius:6px}
.top{max-width:880px;margin:0 auto;padding:18px 0;display:flex;flex-wrap:wrap;gap:10px 24px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}
.brand{color:var(--ivory);text-decoration:none;font-weight:700}
.mark{font-family:var(--display);color:var(--gold)}
.top nav{display:flex;flex-wrap:wrap;gap:6px 18px}
.top nav a{color:var(--soft);text-decoration:none;font-size:15px}
.top nav a:hover{color:var(--gold-hi)}
main{max-width:880px;margin:0 auto}
.crumbs{margin:22px 0 0;font-size:14px;color:var(--mist)}
.crumbs a{color:var(--mist)}
h1{font-family:var(--display);font-weight:500;font-size:clamp(24px,5vw,44px);line-height:1.12;margin:14px 0 18px;overflow-wrap:break-word;hyphens:auto}
h2{overflow-wrap:break-word;hyphens:auto}
h2{font-family:var(--display);font-weight:500;font-size:clamp(20px,3vw,26px);line-height:1.2;margin:0 0 14px;color:var(--gold-hi)}
h3{font-size:18px;margin:0 0 4px}
.lede{font-size:clamp(17px,2.2vw,19px);color:var(--soft);max-width:62ch}
.block{margin-top:40px;padding:26px;border:1px solid var(--line);border-radius:22px;background:rgba(12,26,23,.55)}
.block p+p{margin-top:12px}
.block p{margin:0}
.phases,.steps,.points,.pubs{margin:0;padding-left:22px}
.phases li+li,.points li+li,.pubs li+li{margin-top:14px}
.steps li+li{margin-top:6px}
.pro{color:var(--mist);font-size:15px;margin-top:6px!important}
.note{margin-top:16px!important;color:var(--mist);font-size:15px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin:0}
.tag{padding:3px 10px;border-radius:999px;border:1px solid var(--line);font-size:13px;color:var(--soft)}
.tag:first-child{border-color:var(--gold);color:var(--gold-hi)}
.result{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 16px;color:var(--soft)}
.big{font-family:var(--display);font-size:clamp(34px,7vw,56px);color:var(--gold)}
.big small{font-size:.4em;color:var(--soft)}
.bars{margin-top:20px;border-collapse:collapse;min-width:min(100%,360px)}
.bars caption{text-align:left;color:var(--mist);font-size:14px;padding-bottom:6px}
.bars th,.bars td{padding:8px 14px 8px 0;border-top:1px solid var(--line);text-align:left;font-weight:400}
.bars td{color:var(--gold-hi);font-weight:700}
.gal{display:grid;gap:16px}
.gal figure{margin:0}
.gal img{display:block;width:100%;height:auto;border-radius:16px;background:#0d1a17}
.gal figcaption{margin-top:6px;font-size:14px;color:var(--mist)}
.zoom{display:block;position:relative;border-radius:16px;overflow:hidden;cursor:zoom-in}
.zoom img{transition:transform .4s ease}
.zoom:hover img{transform:scale(1.02)}
.zoom.sens img{filter:blur(16px) saturate(.35) brightness(.7)}
.sens-note{position:absolute;left:12px;right:12px;bottom:12px;padding:10px 12px;border-radius:12px;background:rgba(10,21,19,.8);color:var(--ivory);font-size:14px;text-align:center}
.lb{max-width:min(96vw,1200px);max-height:94vh;padding:12px;border:1px solid var(--line);border-radius:18px;background:#0a1513;color:var(--ivory)}
.lb::backdrop{background:rgba(3,6,7,.86)}
.lb img{display:block;max-width:100%;max-height:82vh;margin:0 auto;border-radius:12px}
.lb p{margin:10px 4px 2px;font-size:15px;color:var(--soft)}
.lb-x{position:absolute;top:8px;right:8px;width:44px;height:44px;border:0;border-radius:999px;background:rgba(10,21,19,.85);color:var(--ivory);font-size:26px;line-height:1;cursor:pointer;z-index:1}
.cards{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.card{display:flex;flex-direction:column;gap:8px;padding:18px;border-radius:18px;border:1px solid var(--line);background:rgba(22,66,54,.25);text-decoration:none;color:var(--ivory)}
.card:hover{border-color:var(--gold)}
.card strong{font-size:18px;line-height:1.3}
.card .metric{color:var(--gold-hi);font-size:15px}
.term{color:inherit;text-decoration:underline dashed var(--gold);text-underline-offset:4px}
.gloss{margin:0}
.gloss dt{font-weight:700;margin-top:12px}
.gloss dt:first-child{margin-top:0}
.gloss dd{margin:2px 0 0;color:var(--soft)}
.row{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px!important}
.btn{display:inline-flex;padding:12px 18px;border-radius:999px;background:var(--gold);color:#140f06;font-weight:700;text-decoration:none}
.btn:hover{background:var(--gold-hi);color:#140f06}
.btn.ghost{background:none;border:1px solid var(--line);color:var(--ivory)}
.btn.ghost:hover{border-color:var(--gold);color:var(--gold-hi)}
footer{max-width:880px;margin:48px auto 0;padding-top:18px;border-top:1px solid var(--line);font-size:14px;color:var(--mist)}
footer p{margin:0 0 6px}
footer .legal{display:flex;flex-wrap:wrap;gap:6px 18px}
.linkish{font:inherit;color:var(--gold-hi);background:none;border:0;padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.ck{position:fixed;z-index:20;left:0;right:0;bottom:0;padding:8px 16px calc(8px + env(safe-area-inset-bottom,0px));display:flex;flex-wrap:wrap;
align-items:center;justify-content:center;gap:6px 14px;font-size:13px;line-height:1.4;color:var(--soft);background:rgba(5,8,10,.94);border-top:1px solid var(--line)}
.ck p{margin:0}
.ck a{color:var(--soft)}
.ck-btns{display:flex;gap:8px}
@media (max-width:640px){.ck{flex-wrap:nowrap;justify-content:space-between;gap:10px;padding:7px 12px calc(7px + env(safe-area-inset-bottom,0px))}.ck button{padding:5px 10px}}
.ck button{font:inherit;font-weight:600;padding:5px 12px;border-radius:999px;cursor:pointer;border:1px solid var(--line);background:none;color:var(--ivory)}
.ck #ck-yes{background:var(--gold);border-color:var(--gold);color:#140f06}
.legaltext .block p+p{margin-top:12px}
.pubs li,.block p{overflow-wrap:anywhere}
@media (min-width:720px){.gal{grid-template-columns:1fr 1fr}.cards{grid-template-columns:1fr 1fr}.block{padding:32px}}
'''


# ---------- История метода ----------
# Все даты и цифры — из первоисточников в PubMed (список SOURCES внизу страницы); о докторе — из content.json.
HIST = METHOD + 'istoriya/'

SOURCES = [
    ('Ilizarov G. A. The tension-stress effect on the genesis and growth of tissues. Part I. The influence of stability of fixation '
     'and soft-tissue preservation // Clin Orthop Relat Res. 1989; (238): 249–281.', 'https://pubmed.ncbi.nlm.nih.gov/2910611/', 'PubMed 2910611'),
    ('Ilizarov G. A. The tension-stress effect on the genesis and growth of tissues. Part II. The influence of the rate and frequency '
     'of distraction // Clin Orthop Relat Res. 1989; (239): 263–285.', 'https://pubmed.ncbi.nlm.nih.gov/2912628/', 'PubMed 2912628'),
    ('Ilizarov G. A. Clinical application of the tension-stress effect for limb lengthening // Clin Orthop Relat Res. 1990; (250): 8–26.',
     'https://pubmed.ncbi.nlm.nih.gov/2403497/', 'PubMed 2403497'),
    ('Snyder C. C., Levine G. A., Swanson H. M., Browne E. Z. Mandibular lengthening by gradual distraction. Preliminary report // '
     'Plast Reconstr Surg. 1973; 51 (5): 506–508.', 'https://doi.org/10.1097/00006534-197305000-00003', 'DOI 10.1097/00006534-197305000-00003'),
    ('McCarthy J. G., Schreiber J., Karp N., Thorne C. H., Grayson B. H. Lengthening the human mandible by gradual distraction // '
     'Plast Reconstr Surg. 1992; 89 (1): 1–8.', 'https://pubmed.ncbi.nlm.nih.gov/1727238/', 'PubMed 1727238'),
    ('McCarthy J. G., Staffenberg D. A., Wood R. J., Cutting C. B., Grayson B. H., Thorne C. H. Introduction of an intraoral '
     'bone-lengthening device // Plast Reconstr Surg. 1995; 96 (4): 978–981.', 'https://doi.org/10.1097/00006534-199509001-00034',
     'DOI 10.1097/00006534-199509001-00034'),
]


def ref(*n):
    return '<sup class="ref">' + ', '.join(f'<a href="#src-{i}">{i}</a>' for i in n) + '</sup>'


# контуры ветви и тела челюсти — те же, что на схеме «Как растёт кость» на главной
JAW_POST = ('M122 80 C118 62 140 50 162 52 C182 54 190 66 184 80 C180 92 186 104 196 116 C210 134 236 138 252 116 C260 102 263 84 268 64 '
            'C280 96 286 150 300 196 C310 212 326 216 345 216 L345 343 C300 340 262 334 238 326 C220 320 206 322 194 316 C168 304 156 286 '
            '154 262 C150 220 140 150 132 108 C128 96 124 88 122 80 Z')
JAW_ANT = ('M345 216 C420 220 520 216 590 198 C600 196 606 196 610 200 C606 222 600 244 604 262 C610 286 626 306 624 330 C622 350 604 362 '
           '580 364 C500 366 420 352 345 343 Z')


def jaw_svg(kind):
    """kind: 'ext' — наружный аппарат (1992), 'int' — внутриротовой (1995). Схема, не снимок."""
    cols = ''.join(f'<path d="M{345 + i * 4} 222 V337"/>' for i in range(8))
    if kind == 'ext':
        dev = ('<path class="skin" d="M120 372 C260 392 470 396 640 380"/>'
               '<g class="dev"><path class="pin" d="M300 270 V420"/><path class="pin" d="M322 268 V420"/>'
               '<path class="pin" d="M410 276 V420"/><path class="pin" d="M432 278 V420"/>'
               '<rect class="steel" x="282" y="414" width="170" height="16" rx="6"/><circle class="steel" cx="468" cy="422" r="13"/></g>'
               '<text class="lbl" x="380" y="436">снаружи, через кожу</text>')
        title = 'Схема: наружный аппарат на нижней челюсти, штифты выходят через кожу.'
    else:
        dev = ('<g class="dev"><rect class="steel" x="296" y="262" width="56" height="30" rx="7"/><rect class="steel" x="372" y="262" width="56" height="30" rx="7"/>'
               '<rect class="steel" x="340" y="270" width="44" height="14" rx="4"/><circle class="screw" cx="310" cy="277" r="4"/><circle class="screw" cx="338" cy="277" r="4"/>'
               '<circle class="screw" cx="386" cy="277" r="4"/><circle class="screw" cx="414" cy="277" r="4"/></g>'
               '<text class="lbl" x="380" y="436">аппарат внутри, разреза кожи нет</text>')
        title = 'Схема: внутриротовой аппарат на нижней челюсти, без разреза кожи.'
    return (f'<svg class="jaw-svg {kind}" viewBox="90 40 580 410" role="img"><title>{title}</title>'
            f'<g class="post"><path class="bone" d="{JAW_POST}"/></g>'
            f'<g class="regen">{cols}</g>'
            f'<g class="ant"><path class="bone" d="{JAW_ANT}"/></g>{dev}</svg>')


def ring_svg():
    """Кольцевой чрескостный аппарат: спицы через кость, натянуты на кольцах. Нижняя часть медленно «уходит» вниз — дистракция."""
    def ring(y, back):
        arc = f'M50 {y} A150 32 0 0 1 350 {y}' if back else f'M50 {y} A150 32 0 0 0 350 {y}'
        return f'<path class="ring{" back" if back else ""}" pathLength="1" d="{arc}"/>'
    def wires(y):
        return (f'<path class="wire" pathLength="1" d="M58 {y - 12} L342 {y + 12}"/><path class="wire" pathLength="1" d="M72 {y + 16} L328 {y - 16}"/>')
    top, bot = (70, 190), (370, 490)
    rods = lambda ys: ''.join(f'<path class="rod" d="M{x} {ys[0] + (24 if x in (80, 320) else 30)} V{ys[1] + (24 if x in (80, 320) else 30)}"/>'
                              for x in (80, 320, 140, 260))
    cols = ''.join(f'<path d="M{178 + i * 6} 252 V{308}"/>' for i in range(8))
    return ('<svg class="ring-svg" viewBox="0 0 400 560" role="img"><title>Схема кольцевого аппарата Г. А. Илизарова: '
            'спицы проходят через кость и натянуты на кольцах, между фрагментами растёт новая кость.</title>'
            '<defs><linearGradient id="hb" x1="0" x2="1"><stop offset="0" stop-color="#9a7c4e"/><stop offset=".5" stop-color="#efe3c8"/>'
            '<stop offset="1" stop-color="#b89868"/></linearGradient>'
            '<linearGradient id="hs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f5f6"/><stop offset="1" stop-color="#7d898d"/></linearGradient></defs>'
            f'<g class="top">{ring(top[0], 1)}{ring(top[1], 1)}</g><g class="bot">{ring(bot[0], 1)}{ring(bot[1], 1)}</g>'
            '<g class="regen">' + cols + '<path class="zone" d="M172 280 H228"/></g>'
            '<g class="top"><rect class="hbone" x="170" y="14" width="60" height="238" rx="26"/>'
            f'{wires(top[0])}{wires(top[1])}{ring(top[0], 0)}{ring(top[1], 0)}{rods(top)}</g>'
            '<g class="bot"><rect class="hbone" x="170" y="308" width="60" height="238" rx="26"/>'
            f'{wires(bot[0])}{wires(bot[1])}{ring(bot[0], 0)}{ring(bot[1], 0)}{rods(bot)}</g>'
            '<g class="link"><path class="rod long" d="M80 94 V394"/><path class="rod long" d="M320 94 V394"/></g></svg>')


def rate_widget():
    """Опыт Илизарова (часть II, 1989): темп 0,5 / 1 / 2 мм в сутки. Работает без скрипта — на :checked и :has()."""
    opts = (('05', '0,5', 40, 'Кость часто срасталась раньше времени — удлинение останавливалось.'),
            ('10', '1', 20, 'Лучший результат. Новая кость росла параллельными колоннами в обе стороны от центральной зоны роста — '
                            'структура, похожая на ростковую пластинку.'),
            ('20', '2', 10, 'Часто — нежелательные изменения в удлиняемых тканях.'))
    radios = ''.join(f'<label class="chip"><input type="radio" name="rate" id="r{k}" value="{k}"{" checked" if k == "10" else ""}>'
                     f'<span>{v}&nbsp;мм/сут</span></label>' for k, v, _, _ in opts)
    outs = ''.join(f'<p class="out o{k}"><strong>{v} мм в сутки.</strong> {t} <span class="days">20 мм при таком темпе — {d} дней '
                   f'(20 ÷ {v}).</span></p>' for k, v, d, t in opts)
    cols = ''.join(f'<path d="M{257 + i * 7} 66 V154"/>' for i in range(14))
    return f'''<div class="rate glass rv">
<fieldset><legend>Темп удлинения в эксперименте</legend><div class="chips">{radios}</div></fieldset>
<svg class="rate-svg" viewBox="0 40 640 175" role="img"><title>Схема: фрагменты кости и новая кость между ними при разном темпе удлинения.</title>
<rect class="frag" x="30" y="60" width="222" height="100" rx="20"/>
<g class="g05"><rect class="fused" x="250" y="60" width="34" height="100"/></g>
<g class="g10">{cols}<path class="zone" d="M302 62 V158"/></g>
<g class="g20"><path d="M262 70 V100 M262 120 V150 M292 66 V90 M322 132 V156 M354 70 V96 M386 120 V152 M404 74 V98"/></g>
<g class="fr"><rect class="frag" x="282" y="60" width="222" height="100" rx="20"/></g>
<text class="lbl" x="30" y="200">фрагмент</text><text class="lbl gap-l" x="320" y="200" text-anchor="middle">новая кость</text></svg>
<div class="outs" aria-live="polite">{outs}</div>
<p class="note">Эксперимент на голени собак: темп 0,5, 1 и 2 мм в сутки, по 1, 4 и 60 шагов в сутки. Чем чаще шаги, тем лучше результат.{ref(2)} Рисунок условный.</p>
</div>'''


def history_page(c):
    sc = c.get('science', {}); ds = sc.get('dissertation', {})
    pubs = [p for p in sc.get('publications', []) if 'дистракц' in str(p.get('title', '')).lower()]
    def cover(p):
        img = str(p.get('image') or '')
        card = img.replace('.jpg', '-card.jpg')
        src = card if (ROOT / card).exists() else img
        pic = f'<img src="/{e(src)}" alt="Первая страница статьи «{e(p.get("title"))}»" loading="lazy" width="300" height="400">' if img else ''
        link = f'https://doi.org/{p["doi"]}' if p.get('doi') else p.get('link')
        return (f'<li class="pub glass"><a href="{e(link)}" target="_blank" rel="noopener">{pic}<span class="pt">{e(p.get("title"))}</span>'
                f'<span class="pj">{e(p.get("journal"))}</span></a></li>')
    pubs_html = ''.join(cover(p) for p in pubs)
    talks = [t for t in sc.get('talks', []) if 'European Association' in str(t.get('event', ''))]
    talks_html = ''.join(f'<li>{e(t.get("title"))} <span class="pj">— {e(t.get("type"))} доклад, {e(t.get("event"))}</span></li>' for t in talks)
    srcs = ''.join(f'<li id="src-{i + 1}">{e(t)} <a href="{e(u)}" target="_blank" rel="noopener">{e(l)} ↗</a></li>'
                   for i, (t, u, l) in enumerate(SOURCES))
    years = (('y1950', '≈1950'), ('y1973', '1973'), ('y1989', '1989'), ('y1992', '1992'), ('y1995', '1995'), ('y2026', '2026'), ('src', 'Источники'))
    chips = ''.join(f'<a href="#{i}">{t}</a>' for i, t in years)
    rules = ('Бережная остеотомия: сохранить кровоснабжение кости и костного мозга', 'Стабильная фиксация аппаратом',
             'Пауза перед началом удлинения', '1 мм в сутки, частыми маленькими шагами',
             'Период неподвижной фиксации после удлинения', 'Нагрузка на удлиняемую конечность')
    rules_html = ''.join(f'<li>{r}</li>' for r in rules)
    title = 'История дистракционного остеогенеза | Шаповалов П. И.'
    desc = ('Г. А. Илизаров, опыт на собаках (1973), J. G. McCarthy и дети (1992), внутриротовой аппарат (1995) — '
            'история метода со ссылками на PubMed.')
    body = f'''<svg class="lg-defs" width="0" height="0" aria-hidden="true" focusable="false"><filter id="lg" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.006 0.011" numOctaves="2" seed="11" result="n"/><feGaussianBlur in="n" stdDeviation="3" result="nb"/>
<feDisplacementMap in="SourceGraphic" in2="nb" scale="38" xChannelSelector="R" yChannelSelector="G"/></filter></svg>
<div class="orbs" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
<article class="hist">
<header class="hero">
  <div class="hero-t rv">
    <h1>История дистракционного <span class="gold">остеогенеза</span></h1>
    <p class="lede">Как кость научились удлинять: от кольцевого аппарата Илизарова до нижней челюсти у детей. У каждой даты — ссылка на первоисточник.</p>
    <p class="row"><a class="btn" href="#y1950">Читать по годам ↓</a><a class="btn ghost" href="/{METHOD}">Как лечим сейчас →</a></p>
  </div>
  <figure class="hero-f glass rv">{ring_svg()}<figcaption>Кольцевой чрескостный аппарат — схема</figcaption></figure>
</header>
<nav class="years glass" aria-label="Годы">{chips}</nav>
<div class="tl">
<section class="ch" id="y1950"><p class="yr rv" aria-hidden="true">≈1950</p><div class="card glass rv">
  <p class="where">Курган, СССР</p>
  <h2>Кость растёт, если её растягивать</h2>
  <p>Г. А. Илизаров работал в Кургане, во Всесоюзном центре восстановительной травматологии и ортопедии.{ref(1, 3)} Он создал кольцевой чрескостный аппарат: спицы проходят через кость и натягиваются на кольцах снаружи. Аппарат держит фрагменты кости и позволяет понемногу их разводить.{ref(3)}</p>
  <p class="calc">В обзоре 1990 года Илизаров пишет, что развивает эту систему 40 лет.{ref(3)} Отсюда дата: 1990 − 40 ≈ 1950.</p>
  <h3>Условия, которые он считал важными{ref(3)}</h3>
  <ol class="rules">{rules_html}</ol>
  <p class="note">Те же этапы — операция, пауза, удлинение, покой — на схеме <a href="/#distraction">«Как растёт кость»</a>.</p>
</div></section>
<section class="ch" id="y1973"><p class="yr rv" aria-hidden="true">1973</p><div class="card glass rv">
  <p class="where">Plastic and Reconstructive Surgery</p>
  <h2>Нижняя челюсть: опыт на собаках</h2>
  <p>C. C. Snyder и соавторы публикуют «Удлинение нижней челюсти постепенной дистракцией. Предварительное сообщение». Эксперимент — на собаках.{ref(4)}</p>
</div></section>
<section class="ch" id="y1989"><p class="yr rv" aria-hidden="true">1989</p><div class="card glass rv">
  <p class="where">Clinical Orthopaedics and Related Research</p>
  <h2>1 миллиметр в сутки</h2>
  <p>Выходят две экспериментальные работы Илизарова об «эффекте напряжения растяжения» — как ткани растут под медленным натяжением.{ref(1, 2)} На голени собак он сравнил разный темп и ритм удлинения. Выберите темп:</p>
  {rate_widget()}
</div></section>
<section class="ch" id="y1992"><p class="yr rv" aria-hidden="true">1992</p><div class="card glass rv">
  <p class="where">Нью-Йоркский университет</p>
  <h2>Нижняя челюсть у детей</h2>
  <p>J. G. McCarthy и коллеги удлинили нижнюю челюсть постепенной дистракцией у четырёх детей. Авторы отметили: без костных трансплантатов, переливания крови и межчелюстной фиксации.{ref(5)}</p>
  <dl class="stats">
    <div><dt>пациента</dt><dd data-count="4">4</dd></div>
    <div><dt>мес — средний возраст<br><span class="calc">78 ÷ 12 = 6,5 года</span></dt><dd data-count="78">78</dd></div>
    <div><dt>мм — удлинение</dt><dd>18–24</dd></div>
    <div><dt>недель фиксации после</dt><dd data-count="9">≈9</dd></div>
  </dl>
  <figure class="jaw rv">{jaw_svg("ext")}</figure>
</div></section>
<section class="ch" id="y1995"><p class="yr rv" aria-hidden="true">1995</p><div class="card glass rv">
  <p class="where">Нью-Йоркский университет</p>
  <h2>Аппарат уходит в рот</h2>
  <p>Главный упрёк наружному аппарату — рубцы на коже от разреза и от пути аппарата. Группа McCarthy сделала миниатюрный аппарат для установки через рот и проверила его на 10 собаках: те же возможности, но без разреза кожи и рубца.{ref(6)}</p>
  <figure class="jaw rv">{jaw_svg("int")}</figure>
</div></section>
<section class="ch now" id="y2026"><p class="yr rv" aria-hidden="true">2026</p><div class="card glass rv">
  <p class="where">Москва, ФГБУ НМИЦ «ЦНИИСиЧЛХ»</p>
  <h2>Показания — по измерениям</h2>
  <p>П. И. Шаповалов защитил кандидатскую диссертацию <strong>«{e(ds.get("title"))}»</strong>. {e(ds.get("place"))}. Научный руководитель — {e(ds.get("supervisor"))}.</p>
  <p>{e(ds.get("summary"))}{f' <a href="{e(ds.get("link"))}" target="_blank" rel="noopener">Запись в РГБ ↗</a>' if ds.get('link') else ''}</p>
  {f'<h3>Статьи о дистракции</h3><ul class="pubs-g">{pubs_html}</ul>' if pubs_html else ''}
  {f'<h3>Конгресс EACMFS, 2026</h3><ul class="talks">{talks_html}</ul>' if talks_html else ''}
  <p class="row"><a class="btn" href="/{METHOD}">Метод сегодня: как проходит лечение →</a><a class="btn ghost" href="/{CASES}">Клинические случаи →</a></p>
</div></section>
</div>
<section class="block srcs" id="src"><h2>Источники</h2><ol>{srcs}</ol>
<p class="note">Записи и аннотации — по PubMed. Рисунки на странице — схемы, не снимки пациентов.</p></section>
</article>'''
    schema = {'@type': 'Article', '@id': SITE + HIST, 'url': SITE + HIST, 'headline': 'История дистракционного остеогенеза',
              'name': title, 'description': desc, 'inLanguage': 'ru', 'author': person(c), 'isPartOf': {'@id': SITE + '#site'},
              'dateModified': datetime.date.today().isoformat(),
              'about': {'@type': 'MedicalProcedure', 'name': 'Дистракционный остеогенез', 'procedureType': 'https://schema.org/SurgicalProcedure'},
              'mentions': [{'@type': 'Person', 'name': 'Г. А. Илизаров'}, {'@type': 'Person', 'name': 'J. G. McCarthy'}],
              'citation': [{'@type': 'ScholarlyArticle', 'name': t, 'url': u} for t, u, _ in SOURCES]}
    return title, desc, body, schema


HIST_CSS = r'''/* «История метода»: жидкое стекло, хронология с золотой линией, интерактив темпа. Только для этой страницы. */
html{background:var(--void)}
body.wide{background:transparent;padding:0 20px 40px}
.wide .top,.wide main{max-width:1160px}
.wide .top{position:relative;z-index:2}
.wide main{position:relative;z-index:1}
.lg-defs{position:absolute;width:0;height:0;overflow:hidden}
.orbs{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none}
.orbs i{position:absolute;border-radius:50%;filter:blur(70px);opacity:.7;will-change:transform}
.orbs i:nth-child(1){width:46vmax;height:46vmax;left:-12vmax;top:-10vmax;background:radial-gradient(closest-side,#1f5a49,transparent);animation:drift1 26s ease-in-out infinite alternate}
.orbs i:nth-child(2){width:30vmax;height:30vmax;right:-8vmax;top:22vh;background:radial-gradient(closest-side,rgba(214,178,102,.42),transparent);animation:drift2 32s ease-in-out infinite alternate}
.orbs i:nth-child(3){width:38vmax;height:38vmax;left:20vw;bottom:-18vmax;background:radial-gradient(closest-side,#164236,transparent);animation:drift1 38s ease-in-out infinite alternate-reverse}
.orbs i:nth-child(4){width:16vmax;height:16vmax;left:55vw;top:8vh;background:radial-gradient(closest-side,rgba(240,212,142,.30),transparent);animation:drift2 22s ease-in-out infinite alternate-reverse}
@keyframes drift1{to{transform:translate3d(14vw,10vh,0) scale(1.15)}}
@keyframes drift2{to{transform:translate3d(-12vw,18vh,0) scale(.9)}}

/* жидкое стекло: размытие + насыщенность, блик по краю, свет за курсором; в Chromium ещё и преломление (SVG-фильтр #lg) */
.glass{position:relative;isolation:isolate;border-radius:28px;border:1px solid rgba(237,232,222,.16);
background:linear-gradient(150deg,rgba(237,232,222,.10),rgba(237,232,222,.025) 40%,rgba(10,21,19,.35));
-webkit-backdrop-filter:blur(18px) saturate(170%);backdrop-filter:blur(18px) saturate(170%);
box-shadow:inset 0 1px 0 rgba(255,250,235,.28),inset 0 -1px 0 rgba(0,0,0,.35),inset 0 0 0 1px rgba(255,255,255,.03),0 24px 70px -20px rgba(0,0,0,.65)}
.glass::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;pointer-events:none;z-index:-1;
background:linear-gradient(135deg,rgba(255,244,214,.55),rgba(255,244,214,0) 30%,rgba(255,244,214,0) 70%,rgba(214,178,102,.45));
-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0)}
.glass::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:-1;opacity:0;transition:opacity .4s;
background:radial-gradient(420px circle at var(--mx,50%) var(--my,0%),rgba(255,246,222,.13),transparent 60%)}
.glass:hover::after{opacity:1}
.lg .glass{-webkit-backdrop-filter:url(#lg) blur(10px) saturate(180%) brightness(1.06);backdrop-filter:url(#lg) blur(10px) saturate(180%) brightness(1.06)}
@media (prefers-reduced-transparency:reduce){.glass,.lg .glass{backdrop-filter:none;-webkit-backdrop-filter:none;background:#0d1c19}}

/* герой */
.hero{display:grid;gap:28px;align-items:center;margin-top:18px}
.hero h1{font-size:clamp(26px,4.1vw,58px);line-height:1.06;letter-spacing:-.02em;margin:6px 0 20px;hyphens:manual;-webkit-hyphens:manual}
.gold{background:linear-gradient(100deg,var(--gold) 0%,var(--gold-hi) 30%,#fff3cf 45%,var(--gold-hi) 60%,var(--gold) 100%);background-size:220% 100%;
-webkit-background-clip:text;background-clip:text;color:transparent;animation:shine 7s linear infinite}
@keyframes shine{from{background-position:120% 0}to{background-position:-100% 0}}
.hero .lede{font-size:clamp(17px,2vw,20px);max-width:44ch;color:var(--soft)}
.row{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px!important}
.btn{display:inline-block;padding:12px 20px;border-radius:999px;background:var(--gold);color:#140f06;font-weight:700;text-decoration:none;transition:transform .2s,box-shadow .2s}
.btn:hover{color:#140f06;transform:translateY(-2px);box-shadow:0 10px 30px -8px rgba(214,178,102,.6)}
.btn.ghost{background:rgba(237,232,222,.06);color:var(--ivory);border:1px solid var(--line)}
.btn.ghost:hover{color:var(--gold-hi)}
.hero-f{margin:0;padding:22px 22px 14px;display:flex;flex-direction:column;align-items:center}
.hero-f figcaption{font-size:13px;color:var(--mist);margin-top:6px}
.ring-svg{width:min(100%,360px);height:auto;overflow:visible}
.ring-svg .ring{fill:none;stroke:url(#hs);stroke-width:9;stroke-linecap:round}
.ring-svg .ring.back{opacity:.45;stroke-width:7}
.ring-svg .wire{stroke:#dfe6e8;stroke-width:1.6;opacity:.85}
.ring-svg .rod{stroke:#aab6ba;stroke-width:5;stroke-dasharray:2 3}
.ring-svg .rod.long{stroke:#c9d2d5;stroke-dasharray:3 2;stroke-width:6}
.ring-svg .hbone{fill:url(#hb)}
.ring-svg .regen path{stroke:#4fc39b;stroke-width:3;stroke-linecap:round;opacity:.9}
.ring-svg .regen .zone{stroke:#f0d48e;stroke-width:2;stroke-dasharray:4 4}
.js .ring-svg .ring,.js .ring-svg .wire{stroke-dasharray:1;stroke-dashoffset:1;animation:draw 1.6s cubic-bezier(.6,.1,.2,1) forwards}
.js .ring-svg .wire{animation-delay:.9s}
@keyframes draw{to{stroke-dashoffset:0}}
.ring-svg .bot{animation:dist 6s ease-in-out 2s infinite alternate}
.ring-svg .regen{transform-origin:200px 252px;animation:grow 6s ease-in-out 2s infinite alternate}
.ring-svg .link{animation:stretch 6s ease-in-out 2s infinite alternate;transform-origin:200px 94px}
@keyframes dist{to{transform:translateY(16px)}}
@keyframes grow{to{transform:scaleY(1.28)}}
@keyframes stretch{to{transform:scaleY(1.053)}}

/* липкая лента годов */
.years{position:sticky;top:10px;z-index:5;display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;margin:44px 0 10px;padding:6px;border-radius:999px;width:max-content;max-width:100%}
.years::-webkit-scrollbar{display:none}
.years a{flex:none;padding:8px 14px;border-radius:999px;color:var(--soft);text-decoration:none;font:600 14px/1 var(--text);transition:background .3s,color .3s}
.years a:hover{color:var(--gold-hi)}
.years a[aria-current]{background:rgba(214,178,102,.18);color:var(--gold-hi);box-shadow:inset 0 0 0 1px rgba(214,178,102,.45)}

/* хронология */
.tl{position:relative;--p:0;padding:20px 0 10px}
.tl::before,.tl::after{content:"";position:absolute;left:18px;top:0;bottom:0;width:2px;border-radius:2px}
.tl::before{background:var(--line)}
.tl::after{background:linear-gradient(var(--gold-hi),var(--gold));transform-origin:top;transform:scaleY(var(--p));box-shadow:0 0 16px rgba(240,212,142,.55)}
.ch{position:relative;padding:34px 0 34px 40px;scroll-margin-top:64px}
.ch::before{content:"";position:absolute;left:11px;top:52px;width:16px;height:16px;border-radius:50%;background:var(--void);border:2px solid var(--gold);z-index:1;box-shadow:0 0 0 6px rgba(214,178,102,.12)}
.yr{margin:0 0 10px;font:500 clamp(54px,11vw,132px)/.9 var(--display);letter-spacing:-.03em;color:transparent;
-webkit-text-stroke:1.2px rgba(240,212,142,.75);background:linear-gradient(180deg,rgba(240,212,142,.35),rgba(240,212,142,0) 80%);-webkit-background-clip:text;background-clip:text}
.card{padding:clamp(22px,3.4vw,40px)}
.card h2{font-size:clamp(22px,3.4vw,38px);color:var(--ivory);margin-bottom:16px;hyphens:manual;-webkit-hyphens:manual}
.card h3{font:500 17px/1.3 var(--display);color:var(--gold-hi);margin:26px 0 10px}
.card p{margin:0;max-width:66ch}
.card p+p{margin-top:12px}
.where{font-size:13px!important;letter-spacing:.06em;text-transform:uppercase;color:var(--gold)!important;margin-bottom:10px!important}
.calc{color:var(--mist);font-size:15px}
.ref{font-size:.7em;margin-left:2px}
.ref a{text-decoration:none;color:var(--gold)}
.rules{margin:0;padding:0;list-style:none;counter-reset:r;display:grid;gap:8px}
.rules li{counter-increment:r;display:flex;gap:12px;align-items:baseline;padding:10px 14px;border-radius:14px;background:rgba(237,232,222,.04);border:1px solid var(--line)}
.rules li::before{content:counter(r);font:500 14px var(--display);color:var(--gold)}
.note{color:var(--mist);font-size:15px;margin-top:16px!important}

/* интерактив: темп */
.rate{margin-top:22px;padding:20px;border-radius:22px}
.rate fieldset{border:0;margin:0;padding:0}
.rate legend{font-size:14px;color:var(--mist);margin-bottom:10px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{position:relative;cursor:pointer}
.chip input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}
.chip span{display:block;padding:10px 16px;border-radius:999px;border:1px solid var(--line);background:rgba(237,232,222,.05);font-weight:700;transition:all .25s}
.chip input:checked+span{background:var(--gold);color:#140f06;border-color:var(--gold);box-shadow:0 8px 24px -8px rgba(214,178,102,.7)}
.chip input:focus-visible+span{outline:2px solid var(--gold-hi);outline-offset:3px}
.rate-svg{display:block;width:100%;height:auto;margin:16px 0 8px}
.rate-svg .frag{fill:url(#hb)}
.rate-svg .fused{fill:#c9b58c}
.rate-svg .g10 path{stroke:#4fc39b;stroke-width:3.2;stroke-linecap:round}
.rate-svg .g10 .zone{stroke:#f0d48e;stroke-width:2;stroke-dasharray:4 4}
.rate-svg .g20 path{stroke:#4fc39b;stroke-width:2;opacity:.55;stroke-dasharray:6 5}
.rate-svg .lbl{fill:var(--mist);font:20px var(--text)}
.rate-svg .fr,.rate-svg .gap-l{transition:transform .8s cubic-bezier(.5,0,.1,1)}
.rate-svg g[class^="g"]{transition:opacity .5s;opacity:0}
.rate-svg g.g10{opacity:1}
.outs .out{margin:0;display:none}
.outs .o10{display:block}
.days{display:block;color:var(--mist);font-size:15px;margin-top:6px}
@supports selector(:has(*)){
 .rate:has(#r05:checked) .g05,.rate:has(#r20:checked) .g20{opacity:1}
 .rate:has(#r05:checked) .g10,.rate:has(#r20:checked) .g10{opacity:0}
 .rate:has(#r05:checked) .fr{transform:translateX(0)}
 .rate:has(#r10:checked) .fr{transform:translateX(70px)}
 .rate:has(#r20:checked) .fr{transform:translateX(130px)}
 .rate:has(#r05:checked) .gap-l{transform:translateX(-50px)}
 .rate:has(#r20:checked) .gap-l{transform:translateX(30px)}
 .rate:has(#r05:checked) .o05,.rate:has(#r20:checked) .o20{display:block}
 .rate:has(#r05:checked) .o10,.rate:has(#r20:checked) .o10{display:none}
}
@supports not selector(:has(*)){.outs .out{display:block;margin-top:8px}.rate-svg .fr{transform:translateX(70px)}}

/* цифры 1992 */
.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:22px 0 0}
.stats div{padding:16px;border-radius:18px;background:rgba(237,232,222,.04);border:1px solid var(--line);display:flex;flex-direction:column-reverse;gap:4px}
.stats dd{margin:0;font:500 clamp(28px,3.4vw,42px)/1 var(--display);color:var(--gold);white-space:nowrap}
.stats dt{font-size:14px;color:var(--soft)}
.jaw{margin:22px auto 0;max-width:560px}
.jaw-svg{width:100%;height:auto;display:block}
.jaw-svg .bone{fill:url(#hb);stroke:rgba(20,15,6,.35);stroke-width:1.5}
.jaw-svg .ant,.jaw-svg .dev .moving{transition:transform 1.4s cubic-bezier(.5,0,.1,1)}
.jaw-svg .regen path{stroke:#4fc39b;stroke-width:2.4;stroke-linecap:round;opacity:0;transition:opacity 1s .5s}
.jaw-svg .steel{fill:url(#hs)}
.jaw-svg .screw{fill:#566266}
.jaw-svg .pin{stroke:#c9d2d5;stroke-width:5;stroke-linecap:round}
.jaw-svg .skin{fill:none;stroke:rgba(237,232,222,.35);stroke-width:2;stroke-dasharray:7 6}
.jaw-svg .lbl{fill:var(--mist);font:22px var(--text);text-anchor:middle}
.jaw.in .ant{transform:translateX(30px)}
.jaw.in .regen path{opacity:.9}
.jaw-svg.ext .dev path:nth-child(n+3),.jaw-svg.ext .dev rect,.jaw-svg.ext .dev circle{transition:transform 1.4s cubic-bezier(.5,0,.1,1)}
.jaw.in .jaw-svg.ext .dev path:nth-child(n+3){transform:translateX(30px)}
.jaw.in .jaw-svg.int .dev rect:nth-of-type(2),.jaw.in .jaw-svg.int .dev circle:nth-of-type(n+3){transform:translateX(30px)}
.jaw-svg.int .dev rect,.jaw-svg.int .dev circle{transition:transform 1.4s cubic-bezier(.5,0,.1,1)}

/* 2026 */
.now .yr{-webkit-text-stroke:0;background:linear-gradient(100deg,var(--gold),var(--gold-hi),#fff3cf,var(--gold-hi),var(--gold));background-size:220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shine 7s linear infinite}
.pubs-g{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.pub{border-radius:20px;overflow:hidden;transition:transform .35s cubic-bezier(.3,.7,.3,1)}
.pub:hover{transform:translateY(-4px) rotate(-.4deg)}
.pub a{display:flex;flex-direction:column;height:100%;color:var(--ivory);text-decoration:none}
.pub img{display:block;width:100%;height:auto;aspect-ratio:3/4;object-fit:cover;object-position:top;border-bottom:1px solid var(--line)}
.pt{padding:12px 14px 4px;font-weight:700;font-size:14px;line-height:1.35}
.pj{display:block;padding:0 14px 14px;color:var(--mist);font-size:13px;line-height:1.4}
.talks{margin:0;padding-left:20px}
.talks li+li{margin-top:10px}
.talks .pj{display:inline;padding:0}
.srcs ol{margin:0;padding-left:22px}
.srcs li{overflow-wrap:anywhere}
.srcs li+li{margin-top:10px}
.srcs li:target{color:var(--gold-hi)}

/* появление при прокрутке — только когда работает скрипт */
.js .rv{opacity:0;transform:translateY(28px);filter:blur(8px);transition:opacity .9s cubic-bezier(.2,.7,.2,1),transform .9s cubic-bezier(.2,.7,.2,1),filter .9s}
.js .rv.in{opacity:1;transform:none;filter:none}

@media (min-width:720px){
 .stats{grid-template-columns:repeat(4,1fr)}
 .pubs-g{grid-template-columns:repeat(3,1fr)}
}
@media (min-width:980px){
 .hero{grid-template-columns:1.25fr .9fr;gap:48px;min-height:min(78vh,760px)}
 .tl::before,.tl::after{left:290px}
 .ch{display:grid;grid-template-columns:260px 1fr;gap:0 60px;padding:40px 0}
 .ch::before{left:283px;top:66px}
 .yr{position:sticky;top:90px;align-self:start;text-align:right;font-size:clamp(48px,4.6vw,62px);margin-top:44px;padding-left:4px}
}
@media (prefers-reduced-motion:reduce){
 .orbs i,.gold,.now .yr,.ring-svg .bot,.ring-svg .regen,.ring-svg .link{animation:none}
 .js .ring-svg .ring,.js .ring-svg .wire{animation:none;stroke-dashoffset:0}
 .js .rv{opacity:1;transform:none;filter:none;transition:none}
 .rate-svg .fr,.rate-svg .gap-l,.jaw-svg *{transition:none!important}
}
'''

HIST_JS = r'''(function(){var d=document.documentElement;d.classList.add('js');
var rm=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
try{var b=navigator.userAgentData&&navigator.userAgentData.brands;if(b&&b.some(function(x){return /Chromium/.test(x.brand)})&&CSS.supports('backdrop-filter','url(#lg) blur(1px)'))d.classList.add('lg')}catch(e){}
function ready(){
 var rv=[].slice.call(document.querySelectorAll('.rv'));
 function show(el){el.classList.add('in');[].forEach.call(el.querySelectorAll('[data-count]'),count)}
 function count(el){if(rm||el.dataset.done)return;el.dataset.done=1;var to=+el.dataset.count,t0=0,txt=el.textContent,pre=txt.charAt(0)==='≈'?'≈':'';
  function f(t){t0=t0||t;var k=Math.min(1,(t-t0)/1200),v=Math.round(to*(1-Math.pow(1-k,3)));el.textContent=pre+v;if(k<1)requestAnimationFrame(f);else el.textContent=txt}requestAnimationFrame(f)}
 if(rm||!('IntersectionObserver' in window))rv.forEach(show);
 else{var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){show(x.target);io.unobserve(x.target)}})},{rootMargin:'0px 0px -10% 0px'});rv.forEach(function(el){io.observe(el)})}
 var tl=document.querySelector('.tl'),raf=0;
 function upd(){raf=0;if(!tl)return;var r=tl.getBoundingClientRect(),p=(innerHeight*.55-r.top)/r.height;tl.style.setProperty('--p',Math.max(0,Math.min(1,p)).toFixed(4))}
 addEventListener('scroll',function(){if(!raf)raf=requestAnimationFrame(upd)},{passive:true});addEventListener('resize',upd);upd();
 var links={};[].forEach.call(document.querySelectorAll('.years a'),function(a){links[a.getAttribute('href').slice(1)]=a});
 if('IntersectionObserver' in window){var yo=new IntersectionObserver(function(es){es.forEach(function(x){if(!x.isIntersecting)return;
  for(var k in links)links[k].removeAttribute('aria-current');var a=links[x.target.id];if(a){a.setAttribute('aria-current','true');
  var bar=a.parentNode;bar.scrollTo({left:a.offsetLeft-bar.clientWidth/2+a.clientWidth/2,behavior:rm?'auto':'smooth'})}})},{rootMargin:'-40% 0px -55% 0px'});
  Object.keys(links).forEach(function(id){var s=document.getElementById(id);if(s)yo.observe(s)})}
 if(!rm)document.addEventListener('pointermove',function(ev){var g=ev.target.closest&&ev.target.closest('.glass');if(!g)return;var r=g.getBoundingClientRect();
  g.style.setProperty('--mx',(ev.clientX-r.left)+'px');g.style.setProperty('--my',(ev.clientY-r.top)+'px')},{passive:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();
'''


def main():
    c = json.loads((ROOT / 'content.json').read_text(encoding='utf-8'))
    (ROOT / 'pages.css').write_text(CSS, encoding='utf-8')
    (ROOT / 'history.css').write_text(HIST_CSS, encoding='utf-8')
    (ROOT / 'history.js').write_text(HIST_JS, encoding='utf-8')
    for d in ('lechenie', 'kejsy', 'privacy'):                       # страницы удалённых кейсов не должны оставаться
        p = ROOT / d
        if p.exists():
            for f in sorted(p.rglob('*'), reverse=True):
                f.unlink() if f.is_file() else f.rmdir()
    out = []
    def write(path, crumbs, parts):
        title, desc, body, schema = parts
        f = ROOT / path / 'index.html'
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(page(c, path, title, desc, body, crumbs, schema), encoding='utf-8')
        out.append(path)
    home = ('Главная', '')
    write(METHOD, [home, ('Дистракционный остеогенез у детей', METHOD)], method_page(c))
    title, desc, body, schema = history_page(c)
    f = ROOT / HIST / 'index.html'; f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(page(c, HIST, title, desc, body, [home, ('Дистракционный остеогенез у детей', METHOD), ('История метода', HIST)], schema,
                      head='<link rel="stylesheet" href="/history.css">\n<script src="/history.js"></script>', cls='wide'), encoding='utf-8')
    out.append(HIST)
    write(CASES, [home, ('Клинические случаи', CASES)], cases_index(c))
    title, desc, body, schema = privacy_page(c)
    f = ROOT / PRIVACY / 'index.html'; f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(page(c, PRIVACY, title, desc, body, [home, ('Политика конфиденциальности', PRIVACY)], schema, cta=False), encoding='utf-8')
    out.append(PRIVACY)
    seen = set()
    for k in c.get('cases', []):
        s = slug(k)
        if not s or s in seen:
            continue
        seen.add(s)
        write(f'{CASES}{s}/', [home, ('Клинические случаи', CASES), (plain(k.get('title')), f'{CASES}{s}/')], case_page(c, k))
    today = datetime.date.today().isoformat()
    urls = [SITE, SITE + 'en/'] + [SITE + p for p in out]
    (ROOT / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + ''.join(f'  <url><loc>{u}</loc><lastmod>{today}</lastmod></url>\n' for u in urls) + '</urlset>\n', encoding='utf-8')
    # llms.txt: краткое описание сайта для ИИ-поисковиков (ChatGPT, Perplexity, Claude) — только факты из content.json
    h = c.get('hero', {}); w = c.get('work', {})
    name = ' '.join(x for x in (h.get('lastName'), h.get('firstName'), h.get('middleName')) if x)
    dirs = [plain(d.get('title')) for d in c.get('directions', []) if d.get('title')]
    lines = [f'# {name} — детский челюстно-лицевой хирург, к.м.н.', '',
             f'> {snippet(h.get("lede"), limit=300)}', '']
    if w.get('name'):
        lines += [f'Место работы: {plain(w.get("name"))}' + (f', {plain(w.get("address"))}' if w.get('address') else '') + '.', '']
    if dirs:
        lines += ['## Направления', ''] + [f'- {d}' for d in dirs] + ['']
    lines += ['## Страницы', '', f'- [Главная]({SITE}): о враче, направления, наука, контакты',
              f'- [Дистракционный остеогенез у детей]({SITE}{METHOD}): как проходит лечение',
              f'- [История дистракционного остеогенеза]({SITE}{HIST}): Г. А. Илизаров, Snyder (1973), McCarthy (1992, 1995), диссертация 2026 — с источниками',
              f'- [Клинические случаи]({SITE}{CASES}): все кейсы с цифрами до и после']
    for k in c.get('cases', []):
        if slug(k):
            lines.append(f'- [{plain(k.get("title"))}]({SITE}{CASES}{slug(k)}/)')
    lines += [f'- [English version]({SITE}en/)', '']
    (ROOT / 'llms.txt').write_text('\n'.join(lines), encoding='utf-8')
    print('pages:', ', '.join(out))


if __name__ == '__main__':
    main()
