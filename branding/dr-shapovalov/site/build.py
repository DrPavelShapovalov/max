"""Собирает сайт для своего хостинга (GitHub Pages и любой статический) в папку dist/.

index.html написан для Artifact: тот сам добавляет <!doctype>, <head> и <body>.
Здесь эта обёртка добавляется явно. admin.html, content.json и img/ копируются как есть.
Запуск: python3 build.py
"""
import pathlib, shutil

HERE = pathlib.Path(__file__).resolve().parent
DIST = HERE / 'dist'

HEAD = ('<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n')


def main():
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    page = (HERE / 'index.html').read_text(encoding='utf-8')
    head, body = page.split('</style>', 1)          # всё до конца <style> — в <head>
    (DIST / 'index.html').write_text(HEAD + head + '</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n', encoding='utf-8')
    for name in ('admin.html', 'content.json'):
        shutil.copy2(HERE / name, DIST / name)
    shutil.copytree(HERE / 'img', DIST / 'img')
    print('ok', DIST)


if __name__ == '__main__':
    main()
