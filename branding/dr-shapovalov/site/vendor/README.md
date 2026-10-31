# vendor — свои копии библиотек

Сайт на своём хостинге берёт скрипты отсюда, а не со сторонних CDN (см. build.py).
Источник — пакеты npm закреплённых версий (`npm pack`), файлы не изменялись.

| Файл | Пакет | Лицензия | SHA-256 |
|---|---|---|---|
| three.min.js | three@0.134.0 (build/three.min.js) | MIT (LICENSE-three.txt) | `74782bdbcf6518f7…` |
| vanta.waves.min.js | vanta@0.5.24 (dist/) | MIT (package.json) | `60a30382a898ae57…` |
| lenis.min.js | lenis@1.3.27 (dist/) | MIT (LICENSE-lenis.txt) | `80f53e77f1c13e37…` |
| gsap.min.js | gsap@3.12.5 (dist/) | GreenSock Standard License (README-gsap.md) | `28033e449a31ebcc…` |
| ScrollTrigger.min.js | gsap@3.12.5 (dist/) | GreenSock Standard License | `ad33c2df9ada8a66…` |

Обновлять только вместе с CDN_TO_VENDOR в build.py и проверкой сайта.
