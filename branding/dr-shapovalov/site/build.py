"""Собирает сайт для своего хостинга (GitHub Pages и любой статический) в папку dist/.

index.html написан для Artifact: тот сам добавляет <!doctype>, <head> и <body>.
Здесь эта обёртка добавляется явно. admin.html, content.json и img/ копируются как есть.

Безопасность сборки:
- библиотеки (three, vanta, lenis, gsap) берутся из vendor/ — свои копии закреплённых версий
  из npm, а не со сторонних CDN: взлом CDN не даст чужому коду доступ к сайту и токену админки;
- в <head> обеих страниц ставится Content-Security-Policy: выполняются только свои файлы и
  встроенные скрипты с известным отпечатком SHA-256 (он считается здесь при каждой сборке);
- Referrer-Policy: внешним сайтам уходит только адрес сайта, без пути;
- из img/ публикуются только картинки, у JPEG и PNG вырезаются метаданные (EXIF, GPS, XMP).
GitHub Pages не даёт задавать заголовки, поэтому всё это — через <meta>.

Запуск: python3 build.py
"""
import subprocess, sys
import base64, hashlib, pathlib, re, shutil

HERE = pathlib.Path(__file__).resolve().parent
DIST = HERE / 'dist'

CDN_TO_VENDOR = {
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js': 'vendor/three.min.js',
    'https://cdn.jsdelivr.net/npm/vanta@0.5.24/dist/vanta.waves.min.js': 'vendor/vanta.waves.min.js',
    'https://unpkg.com/lenis@1.3.27/dist/lenis.min.js': 'vendor/lenis.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js': 'vendor/gsap.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js': 'vendor/ScrollTrigger.min.js',
}

COMMON = ("default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; "
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; "
          "upgrade-insecure-requests")
# Яндекс Метрика (https://yandex.ru/support/metrica/code/install-counter-csp.html): счётчик, отправка данных,
# карты кликов в интерфейсе Метрики (blob:). Вебвизор выключен, поэтому mc.webvisor.com и wss:// не нужны.
YM = "https://mc.yandex.ru https://mc.yandex.com"
CSP_SITE = (COMMON + "; script-src 'self' {hashes} " + YM + " https://yastatic.net; img-src 'self' data: blob: " + YM
            + "; connect-src 'self' " + YM + "; frame-src https://yandex.ru blob: " + YM + "; child-src blob: " + YM)
CSP_ADMIN = COMMON + "; script-src {hashes}; img-src 'self' data: blob:; connect-src 'self' https://api.github.com https://api-metrika.yandex.net; frame-src 'self'"


def inline_hashes(html):
    """SHA-256 каждого встроенного <script> без src — для script-src."""
    out = []
    for body in re.findall(r'<script>(.*?)</script>', html, flags=re.S):
        out.append("'sha256-" + base64.b64encode(hashlib.sha256(body.encode('utf-8')).digest()).decode() + "'")
    return ' '.join(out)


IMG_EXT = {'.jpg', '.jpeg', '.png', '.webp'}


def strip_jpeg(data):
    """Убирает из JPEG метаданные (APP1 Exif/XMP, APP13 и комментарии); картинка не пережимается."""
    assert data[:2] == b'\xff\xd8', 'не JPEG'
    out, i = bytearray(b'\xff\xd8'), 2
    while i < len(data):
        assert data[i] == 0xff, 'битый JPEG'
        marker = data[i + 1]
        if marker == 0xda:                          # начало данных изображения — дальше всё как есть
            out += data[i:]
            break
        size = int.from_bytes(data[i + 2:i + 4], 'big')
        seg = data[i:i + 2 + size]
        if not (marker in (0xe1, 0xed, 0xfe) or 0xe3 <= marker <= 0xef):   # оставить JFIF (E0), ICC (E2), таблицы
            out += seg
        i += 2 + size
    return bytes(out)


def strip_png(data):
    """Убирает из PNG текстовые чанки и EXIF (tEXt, iTXt, zTXt, eXIf, tIME)."""
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'не PNG'
    out, i = bytearray(data[:8]), 8
    while i < len(data):
        n = int.from_bytes(data[i:i + 4], 'big'); kind = data[i + 4:i + 8]
        if kind not in (b'tEXt', b'iTXt', b'zTXt', b'eXIf', b'tIME'):
            out += data[i:i + 12 + n]
        i += 12 + n
    return bytes(out)


def copy_images(src, dst):
    """Публикуются только картинки; JPEG и PNG — без метаданных. Остальное в img/ не попадает на сайт."""
    for f in sorted(src.rglob('*')):
        if not f.is_file():
            continue
        if f.suffix.lower() not in IMG_EXT:
            print('  пропущен (не картинка):', f.relative_to(src))
            continue
        data = f.read_bytes()
        if f.suffix.lower() in ('.jpg', '.jpeg'):
            data = strip_jpeg(data)
        elif f.suffix.lower() == '.png':
            data = strip_png(data)
        target = dst / f.relative_to(src)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def metas(csp):
    return (f'<meta http-equiv="Content-Security-Policy" content="{csp}">\n'
            '<meta name="referrer" content="strict-origin-when-cross-origin">\n')


HEAD = ('<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n')

# --- SEO: адрес сайта, превью ссылок в соцсетях, разметка «врач» для поисковиков, robots.txt и sitemap.xml ---
YANDEX_VERIFY = '7bd5bbc6ed6ea4f4'          # Яндекс Вебмастер: подтверждение прав (мета-тег и HTML-файл)
GOOGLE_VERIFY = 'VwSnJcJLyzA6f2kcEjWkf8xvmopvSX1PFDmwRdQkYRI'   # Google Search Console: подтверждение прав (мета-тег)
INDEXNOW_KEY = '4b3c078de10cb0485816cd596851f717'
SITE = 'https://' + ((HERE / 'CNAME').read_text().strip() if (HERE / 'CNAME').exists() else 'drshapovalov.ru') + '/'
def seo_head(c):
    import html, json
    h = c.get('hero', {}); m = c.get('meta', {})
    name = ' '.join(x for x in (h.get('firstName'), h.get('middleName'), h.get('lastName')) if x)
    full = ' '.join(x for x in (h.get('lastName'), h.get('firstName'), h.get('middleName')) if x)   # «Шаповалов Павел Игоревич» — так ищут врача
    title = f'{full} — детский челюстно-лицевой хирург, к.м.н.'
    desc = ('Детский челюстно-лицевой хирург, к.м.н., ЦНИИСиЧЛХ, Москва. Дистракционный остеогенез нижней челюсти, '
            'сужение челюстей, кисты, костная пластика. Клинические случаи и статьи.')
    e = lambda v: html.escape(v, quote=True)
    work = c.get('work', {})
    same = [u for u in (m.get('instagram'), m.get('telegram')) if u] + \
           [k.get('url') for k in c.get('contacts', []) if str(k.get('url', '')).startswith('https://') and k.get('url') not in (m.get('instagram'), m.get('telegram'))] + \
           [x.get('url') for x in c.get('science', {}).get('profiles', []) if x.get('url')]
    same = list(dict.fromkeys(same))
    org = {'@type': 'MedicalOrganization', 'name': work.get('name') or 'ФГБУ НМИЦ «ЦНИИСиЧЛХ» Минздрава России'}
    addr = {'@type': 'PostalAddress', 'streetAddress': 'ул. Тимура Фрунзе, д. 16, стр. 5', 'addressLocality': 'Москва', 'addressCountry': 'RU'}
    alt = [full, 'Шаповалов Павел', f"Шаповалов {h.get('firstName', '')[:1]}. {h.get('middleName', '')[:1]}.", 'Pavel Shapovalov', 'Dr. Shapovalov', 'Доктор Шаповалов']
    ld = {'@context': 'https://schema.org', '@graph': [
        {'@type': 'WebSite', '@id': SITE + '#site', 'url': SITE, 'name': f'{full} — официальный сайт', 'inLanguage': ['ru', 'en'],
         'about': {'@id': SITE + '#person'}},
        {'@type': 'Person', '@id': SITE + '#person', 'name': name, 'alternateName': alt, 'givenName': h.get('firstName'),
         'additionalName': h.get('middleName'), 'familyName': h.get('lastName'), 'url': SITE, 'image': SITE + 'img/og-cover.jpg',
         'jobTitle': 'Детский челюстно-лицевой хирург', 'honorificSuffix': 'к.м.н.', 'description': desc, 'worksFor': org, 'sameAs': same},
        {'@type': 'Physician', '@id': SITE + '#physician', 'name': name, 'url': SITE, 'image': SITE + 'img/og-cover.jpg',
         'description': desc, 'address': addr, 'parentOrganization': org, 'sameAs': same}]}
    return (f'<link rel="canonical" href="{SITE}">\n'
            f'<link rel="alternate" hreflang="ru" href="{SITE}">\n<link rel="alternate" hreflang="en" href="{SITE}?lang=en">\n'
            f'<link rel="alternate" hreflang="x-default" href="{SITE}">\n'
            '<meta property="og:type" content="website">\n<meta property="og:locale" content="ru_RU">\n'
            f'<meta property="og:site_name" content="Dr. Shapovalov">\n<meta property="og:title" content="{e(title)}">\n'
            f'<meta property="og:description" content="{e(desc)}">\n<meta property="og:url" content="{SITE}">\n'
            f'<meta property="og:image" content="{SITE}img/og-cover.jpg">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n'
            '<meta name="twitter:card" content="summary_large_image">\n'
            '<meta name="theme-color" content="#05080a">\n'
            f'<meta name="yandex-verification" content="{YANDEX_VERIFY}">\n'
            f'<meta name="google-site-verification" content="{GOOGLE_VERIFY}">\n'
            '<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False).replace('</', '<\\/') + '</script>\n')


def main():
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()

    page = (HERE / 'index.html').read_text(encoding='utf-8')
    for cdn, local in CDN_TO_VENDOR.items():
        assert f'<script src="{cdn}"></script>' in page, f'нет скрипта {cdn} — обновите CDN_TO_VENDOR'
        page = page.replace(f'<script src="{cdn}"></script>', f'<script src="{local}"></script>')
    assert 'https://' not in ''.join(re.findall(r'<script[^>]*src="[^"]*"', page)), 'остался внешний скрипт'
    head, body = page.split('</style>', 1)          # всё до конца <style> — в <head>
    csp = CSP_SITE.format(hashes=inline_hashes(page))
    import json as _j
    content = _j.loads((HERE / 'content.json').read_text(encoding='utf-8'))
    (DIST / 'index.html').write_text(HEAD + metas(csp) + seo_head(content) + head + '</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n',
                                     encoding='utf-8')

    admin = (HERE / 'admin.html').read_text(encoding='utf-8')
    assert '<script src=' not in admin, 'в админке не должно быть внешних скриптов'
    csp = CSP_ADMIN.format(hashes=inline_hashes(admin))
    anchor = '<meta name="robots" content="noindex">\n'
    assert anchor in admin
    (DIST / 'admin.html').write_text(admin.replace(anchor, anchor + metas(csp), 1), encoding='utf-8')

    shutil.copy2(HERE / 'content.json', DIST / 'content.json')
    if (HERE / 'content.en.json').exists():                # английская версия сайта (?lang=en)
        shutil.copy2(HERE / 'content.en.json', DIST / 'content.en.json')
    copy_images(HERE / 'img', DIST / 'img')
    shutil.copytree(HERE / 'vendor', DIST / 'vendor')
    shutil.copytree(HERE / 'fonts', DIST / 'fonts')            # шрифты на своём сайте (SIL OFL), без Google
    if (HERE / 'CNAME').exists():                          # свой домен для GitHub Pages (drshapovalov.ru)
        shutil.copy2(HERE / 'CNAME', DIST / 'CNAME')
    (DIST / 'robots.txt').write_text(f'User-agent: *\nAllow: /\nDisallow: /admin.html\nSitemap: {SITE}sitemap.xml\n', encoding='utf-8')
    import datetime
    # отдельные страницы (метод и кейсы) и sitemap.xml со всеми адресами; тот же скрипт GitHub запускает после публикации из админки
    shutil.copy2(HERE / 'pages.py', DIST / 'pages.py')
    subprocess.run([sys.executable, str(DIST / 'pages.py'), str(DIST)], check=True)
    # IndexNow (Яндекс, Bing и др.): ключ лежит в корне сайта, по нему поисковик проверяет, что уведомление от владельца
    (DIST / f'yandex_{YANDEX_VERIFY}.html').write_text('<html>\n    <head>\n        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">\n'
        f'    </head>\n    <body>Verification: {YANDEX_VERIFY}</body>\n</html>\n', encoding='utf-8')
    (DIST / f'{INDEXNOW_KEY}.txt').write_text(INDEXNOW_KEY, encoding='utf-8')
    # пререндер: текст из content.json вписывается в HTML, чтобы робот без JavaScript видел весь сайт
    if shutil.which('node'):
        subprocess.run(['node', str(HERE / 'prerender.cjs'), str(DIST)], check=True)
    else:
        print('внимание: нет Node — пререндер пропущен, текст сайта виден роботам только после JavaScript')
    (DIST / '.github' / 'workflows').mkdir(parents=True)          # уведомление поисковиков после выкладки
    shutil.copy2(HERE / 'github-workflows' / 'indexnow.yml', DIST / '.github' / 'workflows' / 'indexnow.yml')
    (DIST / '.nojekyll').touch()                    # GitHub Pages: отдавать файлы как есть, без Jekyll
    print('ok', DIST)


if __name__ == '__main__':
    main()
