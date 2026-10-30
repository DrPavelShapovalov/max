---
name: vanta
description: Animated 3D backgrounds with Vanta.js (MIT) — WAVES, FOG, NET, GLOBE, BIRDS, CELLS, CLOUDS, CLOUDS2, DOTS, HALO, RINGS, RIPPLE (three.js r134) and TOPOLOGY, TRUNK (p5.js). Covers pinned script tags, options and brand colours, setOptions/resize/destroy, React and Vue lifecycle, and keeping it light on phones and for reduced motion. Use when a hero or section needs a living animated background, or when the user names Vanta.
---

# Vanta — анимированный фон

Справочник автора, без изменений: `reference/README.md` (Vanta 0.5.24, коммит `f8b3519`, январь 2023).
Подбирать эффект и параметры удобнее в галерее автора: https://www.vantajs.com

## Подключение

Эффект вставляет canvas внутрь элемента и растягивается по его размеру. Остальное содержимое
элемента остаётся поверх фона. Версии фиксировать: в README автора ссылка на Vanta без версии.

```html
<div id="hero">…содержимое…</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/vanta@0.5.24/dist/vanta.waves.min.js"></script>
<script>
  const fx = VANTA.WAVES({ el: '#hero', color: 0x164236, shininess: 30, waveHeight: 14, zoom: 0.9 })
</script>
```

- three.js — версия **r134**, её указывает автор. Более новые версии могут не работать.
- TOPOLOGY и TRUNK рисуются на **p5.js** вместо three.js: подключить p5 и передать `p5` в опции,
  если он импортирован из npm.
- Цвета — числа `0xRRGGBB`. Фирменные для @dr__shapovalov: изумруд `0x164236`, тёмный `0x0a0e0d`,
  золото `0xc9a24d`.
- Общие опции: `mouseControls`, `touchControls` (по умолчанию `true`), `gyroControls` (`false`).
  Остальные свои у каждого эффекта — смотреть в галерее.

## Жизненный цикл

```js
fx.setOptions({ color: 0xc9a24d })   // поменять на лету
fx.resize()                          // если контейнер изменил размер
fx.destroy()                         // при уходе со страницы / размонтировании компонента
```

Без `destroy()` в React и Vue при каждом переходе копится новый WebGL-контекст.

## Чтобы не тормозило

Это общие правила для WebGL, в справочнике Vanta их нет:

- Один эффект на страницу, только в первом экране.
- При «уменьшить движение» эффект не запускать; оставить статичный фон того же цвета.
- Останавливать, когда блок ушёл с экрана: `IntersectionObserver` + `destroy()` / повторный запуск.
- На слабых телефонах проверить плавность вживую. Если тормозит, заменить фон картинкой.
- Под эффект всегда задавать `background` того же цвета, чтобы до загрузки не было белого пятна.
