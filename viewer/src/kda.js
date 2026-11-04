import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
//  Параметрическая модель внутриротового криволинейного КДА по патенту
//  RU2772023C1 (ООО «КОНМЕТ»). Узлы:
//   • РЕЙКА 1 — криволинейная (радиус R) зубчатая, с прямоугольным проксимальным
//     хвостовиком, входящим в паз 33 пластины (фиг. 7, 8, 11, 12);
//   • ПЛАСТИНА РЕЙКИ 2 — клеверная, с центральным хребтом 32 и двумя лепестками
//     отверстий под винты (фиг. 10) → неподвижный костный фрагмент;
//   • ПОЛЗУН 3 (корпус 9) — «туннель» над рейкой с выступами 36 и ЧЕРВЯКОМ 10;
//   • ПЛАСТИНА ПОЛЗУНА 4 — клеверная, центральная крестовина 38 + лепестки (фиг. 14)
//     → подвижный костный фрагмент;
//   • ПРИВОД 5 — стержень с шарнирной муфтой и шестигранным хвостовиком.
//  R = радиус дуги рейки (40/50/70/100/180 мм) — главный параметр кривизны.
//  Локальная система: начало рейки (0,0,0), дуга в XZ (выпуклость +Z), толщина
//  пластин по Y, привод выходит по +Y.
// ─────────────────────────────────────────────────────────────────────────────

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Mx = (pos, quat, scl) => new THREE.Matrix4().compose(pos || V(), quat || new THREE.Quaternion(), scl || V(1, 1, 1));
const qAxis = (axis, a) => new THREE.Quaternion().setFromAxisAngle(axis, a);
const qFromTo = (a, b) => new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());

function geoSoup(geo, mat) {
  const g = geo.toNonIndexed(); const p = g.attributes.position.array;
  if (!mat) return new Float32Array(p);
  const out = new Float32Array(p.length); const v = new THREE.Vector3();
  for (let i = 0; i < p.length; i += 3) { v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(mat); out[i] = v.x; out[i + 1] = v.y; out[i + 2] = v.z; }
  return out;
}
function concat(list) { let n = 0; list.forEach(s => n += s.length); const o = new Float32Array(n); let k = 0; list.forEach(s => { o.set(s, k); k += s.length; }); return o; }
function cyl(rT, rB, h, pos, quat, seg = 18) { return geoSoup(new THREE.CylinderGeometry(rT, rB, h, seg), Mx(pos, quat)); }
function box(sx, sy, sz, pos, quat) { return geoSoup(new THREE.BoxGeometry(sx, sy, sz), Mx(pos, quat)); }

// Шайба с отверстием (винтовое отверстие пластины 7), ось — Y.
function washer(Ro, Ri, thick, pos, seg = 18) {
  const A = []; const yT = thick / 2, yB = -thick / 2;
  const P = (a, b, c) => A.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const oc = (a, r, y) => V(pos.x + Math.cos(a) * r, pos.y + y, pos.z + Math.sin(a) * r);
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * 2 * Math.PI, a1 = (i + 1) / seg * 2 * Math.PI;
    const Oo0 = oc(a0, Ro, yT), Oo1 = oc(a1, Ro, yT), Oi0 = oc(a0, Ri, yT), Oi1 = oc(a1, Ri, yT);
    const Bo0 = oc(a0, Ro, yB), Bo1 = oc(a1, Ro, yB), Bi0 = oc(a0, Ri, yB), Bi1 = oc(a1, Ri, yB);
    P(Oo0, Oi0, Oi1); P(Oo0, Oi1, Oo1);          // верхнее кольцо
    P(Bo0, Bo1, Bi1); P(Bo0, Bi1, Bi0);          // нижнее кольцо
    P(Oo0, Oo1, Bo1); P(Oo0, Bo1, Bo0);          // наружная стенка
    P(Oi0, Bi0, Bi1); P(Oi0, Bi1, Oi1);          // стенка отверстия
  }
  return new Float32Array(A);
}
// Перемычка-шейка между двумя точками в плоскости пластины (толщина по Y).
function barBetween(A, B, width, thick) {
  const d = B.clone().sub(A); const len = d.length(); if (len < 1e-4) return new Float32Array(0);
  const mid = A.clone().add(B).multiplyScalar(0.5);
  const q = qFromTo(V(1, 0, 0), d);
  return box(len, thick, width, mid, q);
}
// Клеверная костная пластина: шайбы-отверстия + перемычки/хребет в плоскости (U,V).
function clover(origin, U, Vv, thick, holes, bars, Ro = 2.5, Ri = 1.25) {
  const parts = [];
  const at = (u, v) => origin.clone().add(U.clone().multiplyScalar(u)).add(Vv.clone().multiplyScalar(v));
  for (const b of bars) parts.push(barBetween(at(b[0][0], b[0][1]), at(b[1][0], b[1][1]), b[2] || 4, thick));
  for (const h of holes) parts.push(washer(Ro, Ri, thick, at(h[0], h[1])));
  return concat(parts);
}

// Пластина РЕЙКИ (фиг. 10): хребет 32 вдоль V + два лепестка по 4 отверстия,
// уходящие в +U (от рейки). Хвостовик рейки входит в хребет при u≈0.
const RAIL_HOLES = [
  [3, 6], [8, 8], [11, 4], [6, 12],       // верхний лепесток
  [3, -6], [8, -8], [11, -4], [6, -12],   // нижний лепесток
];
const RAIL_BARS = [
  [[0, -7.5], [0, 7.5], 4.6],              // хребет 32
  [[0, 5], [3, 6], 3.0], [[3, 6], [8, 8], 2.4], [[8, 8], [11, 4], 2.4], [[3, 6], [6, 12], 2.4], [[6, 12], [8, 8], 2.2],
  [[0, -5], [3, -6], 3.0], [[3, -6], [8, -8], 2.4], [[8, -8], [11, -4], 2.4], [[3, -6], [6, -12], 2.4], [[6, -12], [8, -8], 2.2],
];
// Пластина ПОЛЗУНА (фиг. 14): крестовина 38 по центру + два лепестка по 3 отверстия.
const SLD_HOLES = [
  [0, 7], [-5, 11], [5, 11],
  [0, -7], [-5, -11], [5, -11],
];
const SLD_BARS = [
  [[-4, 0], [4, 0], 3.2], [[0, -4.5], [0, 4.5], 3.2],   // крестовина 38 (центр, под ползун)
  [[0, 3], [0, 7], 3.0], [[0, 7], [-5, 11], 2.4], [[0, 7], [5, 11], 2.4], [[-5, 11], [5, 11], 2.2],
  [[0, -3], [0, -7], 3.0], [[0, -7], [-5, -11], 2.4], [[0, -7], [5, -11], 2.4], [[-5, -11], [5, -11], 2.2],
];

// Криволинейная зубчатая рейка радиуса R, дуга 0..theta в плоскости XZ, с зубьями.
function railArc(R, theta, Wr, Tr) {
  const at = (phi) => V(R * Math.sin(phi), 0, R * (1 - Math.cos(phi)));
  const inpl = (phi) => V(-Math.sin(phi), 0, Math.cos(phi));
  const Y = V(0, 1, 0);
  const steps = Math.max(26, Math.round(theta / (Math.PI / 100)));
  const A = []; const P = (a, b, c) => A.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const quad = (a, b, c, d) => { P(a, b, c); P(a, c, d); };
  const sect = (phi) => { const c = at(phi), m = inpl(phi).multiplyScalar(Wr / 2), y = Y.clone().multiplyScalar(Tr / 2);
    return { tl: c.clone().add(m).add(y), tr: c.clone().sub(m).add(y), bl: c.clone().add(m).sub(y), br: c.clone().sub(m).sub(y) }; };
  let prev = sect(0);
  for (let i = 1; i <= steps; i++) {
    const s = sect(theta * i / steps);
    quad(prev.tl, prev.tr, s.tr, s.tl); quad(prev.br, prev.bl, s.bl, s.br);
    quad(prev.tr, prev.br, s.br, s.tr); quad(prev.bl, prev.tl, s.tl, s.bl);
    prev = s;
  }
  const s0 = sect(0), s1 = sect(theta);
  P(s0.tl, s0.bl, s0.br); P(s0.tl, s0.br, s0.tr);
  P(s1.tr, s1.br, s1.bl); P(s1.tr, s1.bl, s1.tl);
  // зубья 6 — поперечные гребешки на верхней грани, под небольшим углом к радиусу
  const teeth = []; const n = Math.max(12, Math.round(R * theta / 1.4));
  for (let i = 1; i < n; i++) {
    const phi = theta * i / n; const c = at(phi).add(V(0, Tr / 2 + 0.2, 0));
    const q = qFromTo(V(0, 0, 1), inpl(phi)).multiply(qAxis(V(0, 1, 0), 0.16));
    teeth.push(box(Wr * 0.92, 0.55, 0.7, c, q));
  }
  return concat([new Float32Array(A), concat(teeth)]);
}

// Ползун: «туннель» над рейкой (две стенки + крыша) с выступами 36 по углам.
function slider(c, tang, inpl, Wr) {
  const q = qFromTo(V(1, 0, 0), tang);
  const parts = []; const side = inpl.clone().normalize();
  const put = (sx, sy, sz, off) => parts.push(box(sx, sy, sz, c.clone().add(off), q));
  put(6.4, 4.8, 1.8, side.clone().multiplyScalar(Wr / 2 + 1.2).setY(0).add(V(0, 1.3, 0)));
  put(6.4, 4.8, 1.8, side.clone().multiplyScalar(-(Wr / 2 + 1.2)).setY(0).add(V(0, 1.3, 0)));
  put(6.4, 1.7, Wr + 4.6, V(0, 3.1, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    put(1.7, 2.6, 1.7, tang.clone().multiplyScalar(sx * 3.2).add(side.clone().multiplyScalar(sz * (Wr / 2 + 1.0))).add(V(0, -0.3, 0)));
  return concat(parts);
}

export function buildKDA(R) {
  const Wr = 4.0, Tr = 1.7, pThick = 1.25;
  const chord = Math.min(34, R * 0.82);
  const theta = 2 * Math.asin(Math.min(0.96, chord / (2 * R)));
  const at = (phi) => V(R * Math.sin(phi), 0, R * (1 - Math.cos(phi)));
  const tang = (phi) => V(Math.cos(phi), 0, Math.sin(phi));
  const inpl = (phi) => V(-Math.sin(phi), 0, Math.cos(phi));
  const parts = {};

  // рейка + проксимальный хвостовик (входит в хребет пластины)
  const tab = box(7.5, Tr + 0.8, Wr + 1.2, V(-3.4, 0, 0));
  parts.rail = concat([railArc(R, theta, Wr, Tr), tab]);

  // пластина рейки: хребет при x≈-6 перекрывает хвостовик → соединение, лепестки в -X
  parts.plateFixed = clover(V(-6.2, 0, 0), V(-1, 0, 0), V(0, 0, 1), pThick, RAIL_HOLES, RAIL_BARS);

  // ползун у свободного конца дуги
  const phiS = theta * 0.78;
  const cS = at(phiS), tS = tang(phiS), mS = inpl(phiS);
  parts.slider = slider(cS, tS, mS, Wr);
  parts.worm = cyl(1.5, 1.5, 6.0, cS.clone().add(V(0, 3.6, 0)), qFromTo(V(0, 1, 0), tS), 16);

  // пластина ползуна: крестовина у основания ползуна, лепестки ±вдоль касательной
  parts.plateMobile = clover(cS.clone(), mS.clone().normalize(), tS.clone().normalize(), pThick, SLD_HOLES, SLD_BARS);

  // привод от червяка наружу
  const driveDir = V(0, 1, 0).add(tS.clone().multiplyScalar(0.5)).normalize();
  const qD = qFromTo(V(0, 1, 0), driveDir);
  const d0 = cS.clone().add(V(0, 4.2, 0)); const drive = [];
  drive.push(cyl(1.1, 1.1, 64, d0.clone().add(driveDir.clone().multiplyScalar(32)), qD, 14));
  drive.push(cyl(1.9, 1.9, 3.2, d0.clone().add(driveDir.clone().multiplyScalar(6)), qD, 12));
  [26, 45, 60].forEach(d => drive.push(cyl(1.7, 1.7, 2.4, d0.clone().add(driveDir.clone().multiplyScalar(d)), qD, 12)));
  drive.push(cyl(1.9, 1.9, 4.0, d0.clone().add(driveDir.clone().multiplyScalar(66)), qD, 6));
  parts.drive = concat(drive);

  const soup = concat([parts.rail, parts.plateFixed, parts.slider, parts.worm, parts.plateMobile, parts.drive]);
  return { soup, parts, R, theta, chord };
}

export function transformSoup(soup, mat) {
  const out = new Float32Array(soup.length); const v = new THREE.Vector3();
  for (let i = 0; i < soup.length; i += 3) { v.set(soup[i], soup[i + 1], soup[i + 2]).applyMatrix4(mat); out[i] = v.x; out[i + 1] = v.y; out[i + 2] = v.z; }
  return out;
}
