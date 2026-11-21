# Хостинг статического сайта в Yandex Cloud (проверено на drshapovalov.ru, 06.11.2026)

Схема: Object Storage (бакет = домен) + Cloud DNS (ANAME для корня) + Certificate Manager (Let's Encrypt) +
GitHub Actions копирует сайт после каждого push. Ключей в чат не просить — всё через секреты GitHub.

## Что делает врач (с телефона, ~20 минут за 4 захода)

1. console.yandex.cloud → вход Яндекс ID → платёжный аккаунт «физлицо», карта (давали грант 4 000 ₽ на 60 дней).
2. IAM → Сервисные аккаунты → создать `site-deploy`, роль **editor** → «Создать авторизованный ключ» → скачать
   `authorized_key.json` → вставить **весь текст файла** в GitHub-секрет `YC_SA_KEY` репозитория сайта
   (`github.com/<owner>/<repo>/settings/secrets/actions/new`). Предупредить: окно и файл не фотографировать.
3. В DNS регистратора добавить две CNAME для проверки сертификата (имена и значение даёт `certificate get --full`):
   `_acme-challenge` и `_acme-challenge.www` → `<cert-id>.cm.yandexcloud.net.` (частая ошибка — добавлена только одна).
4. В самом конце — сменить NS у регистратора на `ns1.yandexcloud.net`, `ns2.yandexcloud.net`.

## Что делаешь ты (workflow `yc-setup.yml` в репозитории сайта, шаги через workflow_dispatch)

- `inspect`: yc CLI, вход по ключу, folder из `yc iam service-account get`, текущие DNS-записи (`dig`), справка по командам.
- `create`: бакеты `domain` (website: index.html) и `www.domain` (redirect_all_requests → https://domain),
  `certificate request --domains domain,www.domain --challenge dns`, зона `dns zone create --public-visibility`,
  записи `@ ANAME domain.website.yandexcloud.net.`, `www CNAME www.domain.website.yandexcloud.net.`, `_acme-challenge*` CNAME.
- `deploy`: временный статический ключ `yc iam access-key create` → `::add-mask::` → `aws s3 sync . s3://domain
  --endpoint-url https://storage.yandexcloud.net --delete --exclude '.git/*' --exclude '.github/*'` → удалить ключ.
- `https`: ждать `status == ISSUED` (у нас ~40 мин после добавления CNAME у REG.RU), затем
  `yc storage bucket set-https --name <bucket> --certificate-id <id>` для обоих бакетов.
- `verify`: `curl --resolve domain:443:<IP website-эндпоинта>`; сертификат расходится по узлам **5–15 минут**
  после set-https — ждать 3 успешных серии подряд, только потом просить менять NS.

Подводные камни, на которые наступили:
- без `actions/checkout` sync молча заливает пустоту (404 на всём);
- логи публичного репозитория публичны — секреты только через `::add-mask::`, ключ — во временный файл и удалить;
- основной workflow выкладки должен копировать в бакет **после** автокоммита сгенерированных страниц;
- политика конфиденциальности: сменить строку о хостинге и дату редакции;
- GitHub Pages оставить резервом до проверки, что NS переключились.

Стоимость: хранение и трафик малого сайта — в бесплатном лимите (по обзорам); платна DNS-зона.
Факт: ~0,12 ₽ за первые ~5 часов (включая настройку) — порядок десятков рублей в месяц; точное — «Детализация».

Юрлицо для уведомления РКН: ООО «ЯНДЕКС.ОБЛАКО», ИНН 7704458262, ОГРН 1187746678580,
119021, Москва, ул. Льва Толстого, д. 16, помещ. 528 (официальная карточка: storage.yandexcloud.net/doc-files/Yandex.Cloud_requisites.pdf).
Адрес ЦОД публично не найден — спросить поддержку Yandex Cloud.
