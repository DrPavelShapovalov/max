---
name: lenis
description: Smooth scrolling for web pages with Lenis (darkroom.engineering, MIT) — setup from npm or a pinned CDN script, the recommended CSS, syncing with GSAP ScrollTrigger, anchors, modals and nested scroll areas, and reduced-motion handling. Use when a site or landing page should scroll smoothly, when scroll-linked animation (ScrollTrigger, parallax, WebGL scroll sync) feels jumpy, or when the user names Lenis.
---

# Lenis — плавная прокрутка

Справочник автора, без изменений: `reference/README.md` (Lenis 1.3.27, коммит `e01eefb`).
Все настройки, свойства, методы и события — там. Здесь только то, что нужно чаще всего.

## Подключение

npm: `npm i lenis`, затем `import Lenis from 'lenis'` и `import 'lenis/dist/lenis.css'`.

Без сборки (так же работает внутри Artifact: unpkg разрешён). Версию всегда фиксировать:

```html
<link rel="stylesheet" href="https://unpkg.com/lenis@1.3.27/dist/lenis.css">
<script src="https://unpkg.com/lenis@1.3.27/dist/lenis.min.js"></script>
<script>
  new Lenis({ autoRaf: true, anchors: true, allowNestedScroll: true })
</script>
```

CSS из `lenis.css` обязателен: без него ломаются `scroll-behavior` и вложенные области.

## С GSAP ScrollTrigger

Один цикл кадров на двоих, иначе анимации отстают от прокрутки:

```js
const lenis = new Lenis()
lenis.on('scroll', ScrollTrigger.update)
gsap.ticker.add((time) => lenis.raf(time * 1000))
gsap.ticker.lagSmoothing(0)
```

Здесь `autoRaf` не включать: кадры даёт `gsap.ticker`.

## Частые проблемы

- **Модальные окна и прокручиваемые блоки внутри страницы** — `allowNestedScroll: true` или атрибут
  `data-lenis-prevent` на блоке (быстрее, если страница длинная).
- **Якорные ссылки** не работают по умолчанию — `anchors: true`.
- **`position: sticky` и `100vh`** — см. раздел Limitations в справочнике.

## Уменьшение движения

Если у человека включено «уменьшить движение», плавную прокрутку не запускать:

```js
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  new Lenis({ autoRaf: true, anchors: true })
}
```

Это общее правило доступности, в справочнике Lenis его нет.
