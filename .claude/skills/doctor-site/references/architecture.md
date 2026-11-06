# Архитектура: статичный сайт, который врач правит сам

Код: `branding/dr-shapovalov/site/` (README — подробности).

- `content.json` / `content.en.json` — **весь текст**; `index.html` строит страницу из него.
- `admin.html` — админка: разделы слева, форма, живой предпросмотр; публикует в репозиторий сайта через GitHub API
  (fine-grained токен только на этот репозиторий, Contents: Read/Write). Загрузка фото — проверка сигнатур, очистка имени.
- `build.py` → `dist/`: `<head>`, CSP с SHA-256 встроенных скриптов, вендорные библиотеки вместо CDN, шрифты, мета SEO
  (verification Яндекса/Google, JSON-LD Physician), удаление EXIF, `robots.txt`, ключ IndexNow, `pages.py`, `prerender.cjs`.
- `pages.py` — отдельные страницы (`/lechenie/…/`, `/kejsy/`, `/kejsy/<slug>/`, `/privacy/`), `pages.css`, `sitemap.xml`.
- `prerender.cjs` — заполняет пустые контейнеры HTML для поисковиков (скрипты не трогает — иначе ломается CSP-хеш).
- Workflow `github-workflows/indexnow.yml` (копируется в `.github/workflows/`): после push пересобирает страницы,
  коммитит, выкладывает в Yandex Cloud, пингует IndexNow, если менялись тексты.
- Выкладка вручную: `python3 build.py` → `cp -r dist/. <site-repo>/` → push. **Перед сборкой** `git pull` репозитория
  сайта и сравнить `content.json` — врач мог править через админку.

Безопасность: CSP без внешних скриптов (кроме Метрики после согласия), `form-action 'none'`, `object-src 'none'`,
предпросмотр в `sandbox`, сообщения предпросмотра — только от своей админки, ссылки — только `https:`/`mailto:`/`tel:`/`#`/свои пути.
