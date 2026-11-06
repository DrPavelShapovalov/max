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


def page(c, path, title, desc, body, crumbs, schema, cta=True):
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

{ld(graph)}
</head>
<body>
<header class="top"><a class="brand" href="/"><span class="mark">Ш.</span> {e(h.get('firstName'))} {e(h.get('lastName'))}</a>
<nav><a href="/{METHOD}">Дистракция</a><a href="/{CASES}">Кейсы</a><a href="/#contacts">Контакты</a></nav></header>
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
    title = 'Дистракционный остеогенез нижней челюсти у детей — детский челюстно-лицевой хирург Шаповалов П. И.'
    desc = plain(f'{intro} {dirs[0].get("text", "")}')[:300]
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
    title = f'{plain(k.get("title"))} — клинический случай | Шаповалов П. И., детский челюстно-лицевой хирург'
    desc = plain(' '.join((k.get('points') or [])[:2]))[:300]
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
    title = 'Клинические случаи детского челюстно-лицевого хирурга Шаповалова П. И.'
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


def main():
    c = json.loads((ROOT / 'content.json').read_text(encoding='utf-8'))
    (ROOT / 'pages.css').write_text(CSS, encoding='utf-8')
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
    urls = [SITE, SITE + '?lang=en'] + [SITE + p for p in out]
    (ROOT / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + ''.join(f'  <url><loc>{u}</loc><lastmod>{today}</lastmod></url>\n' for u in urls) + '</urlset>\n', encoding='utf-8')
    print('pages:', ', '.join(out))


if __name__ == '__main__':
    main()
