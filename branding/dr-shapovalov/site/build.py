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
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
          "upgrade-insecure-requests")
CSP_SITE = COMMON + "; script-src 'self' {hashes}; img-src 'self' data: blob:; connect-src 'self'; frame-src https://yandex.ru"
CSP_ADMIN = COMMON + "; script-src {hashes}; img-src 'self' data: blob:; connect-src 'self' https://api.github.com; frame-src 'self'"


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
    (DIST / 'index.html').write_text(HEAD + metas(csp) + head + '</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n',
                                     encoding='utf-8')

    admin = (HERE / 'admin.html').read_text(encoding='utf-8')
    assert '<script src=' not in admin, 'в админке не должно быть внешних скриптов'
    csp = CSP_ADMIN.format(hashes=inline_hashes(admin))
    anchor = '<meta name="robots" content="noindex">\n'
    assert anchor in admin
    (DIST / 'admin.html').write_text(admin.replace(anchor, anchor + metas(csp), 1), encoding='utf-8')

    shutil.copy2(HERE / 'content.json', DIST / 'content.json')
    copy_images(HERE / 'img', DIST / 'img')
    shutil.copytree(HERE / 'vendor', DIST / 'vendor')
    (DIST / '.nojekyll').touch()                    # GitHub Pages: отдавать файлы как есть, без Jekyll
    print('ok', DIST)


if __name__ == '__main__':
    main()
