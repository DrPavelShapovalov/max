import * as THREE from 'three';

// Библиотека компрессионно-дистракционных аппаратов (КДА).
// «Цифра» аппарата = максимальная угловая кривизна дуги в ГРАДУСАХ (не мм,
// не радиус). Линейка: 30, 50, 70, 100, 180. Аппарат перемещает фрагмент по
// дуге, разворачивая его максимум на столько градусов, сколько указано.
//
// Радиус дуги НЕ является паспортной величиной — он выводится из плана:
// при заданной длине дистракции s (мм, длина дуги) и угле разворота α (рад)
//   R = s / α.
// Чем «острее» аппарат (больше градус) — тем сильнее криволинейность
// (при той же длине меньше радиус, круче дуга).
// deg — «цифра» аппарата. 180° = ПРЯМОЙ КДА (линейная дистракция),
// меньше = сильнее криволинейность (полный поворот регенерата = 180−deg).
export const DEVICES = [
  { name: 'КДА-30',  deg: 30  },
  { name: 'КДА-40',  deg: 40  },
  { name: 'КДА-50',  deg: 50  },
  { name: 'КДА-70',  deg: 70  },
  { name: 'КДА-100', deg: 100 },
  { name: 'КДА-180', deg: 180 },
];

// Подбор аппарата по требуемому углу коррекции (градусы): наименьший аппарат,
// чья дуга (deg) перекрывает требуемый разворот; иначе — максимальный (180).
export function selectDevice(requiredDeg) {
  for (const d of DEVICES) if (d.deg >= requiredDeg) return d;
  return DEVICES[DEVICES.length - 1];
}

// Радиус дуги (мм) из длины дистракции s (мм) и угла разворота angleDeg (град).
export function arcRadius(lengthMm, angleDeg) {
  const a = angleDeg * Math.PI / 180;
  return a > 1e-4 ? lengthMm / a : lengthMm * 1e4; // почти прямая при малом угле
}

// Геометрия криволинейной дистракции.
// P0 — точка остеотомии, d — направление выдвижения (наружу, ед.),
// axis — ось дуги (ед., в плоскости распила). Возвращает центр дуги C,
// радиальный вектор w и функцию точки арки.
export function arcFrame(P0, d, axis, radius) {
  const a = axis.clone().normalize();
  const w = new THREE.Vector3().crossVectors(a, d).normalize(); // радиальное направление
  const C = P0.clone().sub(w.clone().multiplyScalar(radius));    // центр дуги
  const r0 = P0.clone().sub(C);                                  // = w*radius
  const pointAt = (theta) => C.clone().add(r0.clone().applyAxisAngle(a, theta));
  return { C, a, w, r0, pointAt };
}

// Точки дуги для визуализации (на угол angleRad).
export function arcPoints(frame, angleRad, seg = 48) {
  const pts = [];
  for (let i = 0; i <= seg; i++) pts.push(frame.pointAt(angleRad * i / seg));
  return pts;
}
