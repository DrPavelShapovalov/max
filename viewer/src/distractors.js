import * as THREE from 'three';

// Библиотека компрессионно-дистракционных аппаратов (КДА).
// «Цифра» аппарата = угловая кривизна дуги (градусы). Радиус — радиус кривизны
// дуги (мм). Значения радиусов — ОРИЕНТИРОВОЧНЫЕ (placeholder); уточняются по
// паспортам конкретных аппаратов. Ёмкость = длина дуги = R * angle(рад).
export const DEVICES = [
  { name: 'R30',  angle: 30,  radius: 80 },
  { name: 'R40',  angle: 40,  radius: 60 },
  { name: 'R50',  angle: 50,  radius: 48 },
  { name: 'R70',  angle: 70,  radius: 36 },
  { name: 'R100', angle: 100, radius: 26 },
  { name: 'R180', angle: 180, radius: 16 },
];

export function arcCapacity(dev) { return dev.radius * dev.angle * Math.PI / 180; }

// Подбор аппарата по требуемому удлинению (мм): наименьшая кривизна,
// чья длина дуги перекрывает требуемое; иначе — максимальный (R180).
export function selectDevice(requiredMm) {
  for (const d of DEVICES) if (arcCapacity(d) >= requiredMm) return d;
  return DEVICES[DEVICES.length - 1];
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

// Точки дуги для визуализации (полная ёмкость аппарата).
export function arcPoints(frame, angleRad, seg = 48) {
  const pts = [];
  for (let i = 0; i <= seg; i++) pts.push(frame.pointAt(angleRad * i / seg));
  return pts;
}
