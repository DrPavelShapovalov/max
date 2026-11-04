import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
//  ВЫСОКОДЕТАЛЬНАЯ параметрическая модель внутриротового криволинейного КДА
//  по патенту RU2772023C1 (ООО «КОНМЕТ»). Детализация:
//   • РЕЙКА 1 — криволинейная (R) с настоящими трапециевидными ЗУБЬЯМИ 6,
//     наклонёнными к радиусу, + проксимальный хвостовик в паз 33;
//   • ЧЕРВЯК 10 — цилиндро-конический со СПИРАЛЬНОЙ резьбой (зацепление с зубьями);
//   • ПОЛЗУН 3 (корпус 9) — сквозной паз 12 под рейку, гнездо 44 под червяк,
//     выступы 36, пружинящие элементы 15;
//   • ПЛАСТИНЫ 2 и 4 — клеверные (хребет 32 / крестовина 38 + лепестки) с
//     ЗЕНКОВАННЫМИ отверстиями 29/7;
//   • ПРИВОД 5 — хвостовик червяка 13 с пазами 14, КАРДАН (вилки 16/35, крестовина
//     17), стержень с шестигранными участками 26/27/28 и кольцевыми проточками 25.
//  R = радиус дуги рейки (40/50/70/100/180 мм). Локально: начало рейки (0,0,0),
//  дуга в XZ (выпуклость +Z), толщина пластин по Y, привод по +Y.
// ─────────────────────────────────────────────────────────────────────────────

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Mx = (pos, quat, scl) => new THREE.Matrix4().compose(pos || V(), quat || new THREE.Quaternion(), scl || V(1, 1, 1));
const qAxis = (ax, a) => new THREE.Quaternion().setFromAxisAngle(ax, a);
const qFromTo = (a, b) => new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());
const basisM = (X, Y, Z, pos) => { const m = new THREE.Matrix4().makeBasis(X, Y, Z); if (pos) m.setPosition(pos); return m; };

function geoSoup(geo, mat) {
  const g = geo.toNonIndexed(); const p = g.attributes.position.array;
  if (!mat) return new Float32Array(p);
  const out = new Float32Array(p.length); const v = new THREE.Vector3();
  for (let i = 0; i < p.length; i += 3) { v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(mat); out[i] = v.x; out[i + 1] = v.y; out[i + 2] = v.z; }
  return out;
}
function soupXform(soup, mat) {
  const out = new Float32Array(soup.length); const v = new THREE.Vector3();
  for (let i = 0; i < soup.length; i += 3) { v.set(soup[i], soup[i + 1], soup[i + 2]).applyMatrix4(mat); out[i] = v.x; out[i + 1] = v.y; out[i + 2] = v.z; }
  return out;
}
function concat(list) { let n = 0; list.forEach(s => n += s.length); const o = new Float32Array(n); let k = 0; list.forEach(s => { o.set(s, k); k += s.length; }); return o; }
const cyl = (rT, rB, h, pos, quat, seg = 24) => geoSoup(new THREE.CylinderGeometry(rT, rB, h, seg), Mx(pos, quat));
const box = (sx, sy, sz, pos, quat) => geoSoup(new THREE.BoxGeometry(sx, sy, sz), Mx(pos, quat));
const sph = (r, pos, seg = 18) => geoSoup(new THREE.SphereGeometry(r, seg, seg), Mx(pos));

// быстрый конструктор полигональной ленты
function tris(verts, faces) {
  const A = []; for (const [a, b, c] of faces) { A.push(verts[a].x, verts[a].y, verts[a].z, verts[b].x, verts[b].y, verts[b].z, verts[c].x, verts[c].y, verts[c].z); }
  return new Float32Array(A);
}

// ── Зенкованное отверстие пластины (седло 29 сверху) ──
function washer(Ro, Ri, thick, pos, seg = 22) {
  const A = []; const yT = thick / 2, yB = -thick / 2, Rcs = Ri * 1.65, cs = thick * 0.55;
  const P = (a, b, c) => A.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const oc = (a, r, y) => V(pos.x + Math.cos(a) * r, pos.y + y, pos.z + Math.sin(a) * r);
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * 2 * Math.PI, a1 = (i + 1) / seg * 2 * Math.PI;
    const To = (a) => oc(a, Ro, yT), Tcs = (a) => oc(a, Rcs, yT), Tin = (a) => oc(a, Ri, yT - cs), Bin = (a) => oc(a, Ri, yB), Bo = (a) => oc(a, Ro, yB);
    P(To(a0), Tcs(a0), Tcs(a1)); P(To(a0), Tcs(a1), To(a1));     // верхняя плоская кайма
    P(Tcs(a0), Tin(a0), Tin(a1)); P(Tcs(a0), Tin(a1), Tcs(a1));   // конус зенковки 29
    P(Tin(a0), Bin(a0), Bin(a1)); P(Tin(a0), Bin(a1), Tin(a1));   // цилиндр отверстия
    P(Bo(a0), Bo(a1), oc(a1, Ri, yB)); P(Bo(a0), oc(a1, Ri, yB), oc(a0, Ri, yB)); // нижняя кайма
    P(To(a0), To(a1), Bo(a1)); P(To(a0), Bo(a1), Bo(a0));         // наружная стенка
  }
  return new Float32Array(A);
}
function barBetween(A, B, width, thick) {
  const d = B.clone().sub(A); const len = d.length(); if (len < 1e-4) return new Float32Array(0);
  return box(len, thick, width, A.clone().add(B).multiplyScalar(0.5), qFromTo(V(1, 0, 0), d));
}
function clover(origin, U, Vv, thick, holes, bars, Ro = 2.5, Ri = 1.2) {
  const parts = [];
  const at = (u, v) => origin.clone().add(U.clone().multiplyScalar(u)).add(Vv.clone().multiplyScalar(v));
  for (const b of bars) parts.push(barBetween(at(b[0][0], b[0][1]), at(b[1][0], b[1][1]), b[2] || 4, thick));
  for (const h of holes) parts.push(washer(Ro, Ri, thick, at(h[0], h[1])));
  return concat(parts);
}
const RAIL_HOLES = [[3, 6], [8, 8], [11, 4], [6, 12], [3, -6], [8, -8], [11, -4], [6, -12]];
const RAIL_BARS = [[[0, -7.5], [0, 7.5], 4.6],
  [[0, 5], [3, 6], 3.0], [[3, 6], [8, 8], 2.4], [[8, 8], [11, 4], 2.4], [[3, 6], [6, 12], 2.4], [[6, 12], [8, 8], 2.2],
  [[0, -5], [3, -6], 3.0], [[3, -6], [8, -8], 2.4], [[8, -8], [11, -4], 2.4], [[3, -6], [6, -12], 2.4], [[6, -12], [8, -8], 2.2]];
const SLD_HOLES = [[0, 7], [-5, 11], [5, 11], [0, -7], [-5, -11], [5, -11]];
const SLD_BARS = [[[-4, 0], [4, 0], 3.2], [[0, -4.5], [0, 4.5], 3.2],
  [[0, 3], [0, 7], 3.0], [[0, 7], [-5, 11], 2.4], [[0, 7], [5, 11], 2.4], [[-5, 11], [5, 11], 2.2],
  [[0, -3], [0, -7], 3.0], [[0, -7], [-5, -11], 2.4], [[0, -7], [5, -11], 2.4], [[-5, -11], [5, -11], 2.2]];

// ── Трапециевидный зуб рейки (локально: X — шаг, Y — высота, Z — ширина) ──
function trapTooth(bl, tl, W, h) {
  const xb = bl / 2, xt = tl / 2, z = W / 2;
  const v = [V(-xb, 0, -z), V(xb, 0, -z), V(xb, 0, z), V(-xb, 0, z), V(-xt, h, -z), V(xt, h, -z), V(xt, h, z), V(-xt, h, z)];
  return tris(v, [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]);
}
// ── Криволинейная зубчатая рейка ──
function toothedRail(R, theta, Wr, Tr) {
  const at = (p) => V(R * Math.sin(p), 0, R * (1 - Math.cos(p)));
  const inpl = (p) => V(-Math.sin(p), 0, Math.cos(p));
  const Y = V(0, 1, 0);
  const steps = Math.max(40, Math.round(R * theta / 0.7));
  const A = []; const P = (a, b, c) => A.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const quad = (a, b, c, d) => { P(a, b, c); P(a, c, d); };
  const sect = (p) => { const c = at(p), m = inpl(p).multiplyScalar(Wr / 2), y = Y.clone().multiplyScalar(Tr / 2);
    return { tl: c.clone().add(m).add(y), tr: c.clone().sub(m).add(y), bl: c.clone().add(m).sub(y), br: c.clone().sub(m).sub(y) }; };
  let prev = sect(0);
  for (let i = 1; i <= steps; i++) { const s = sect(theta * i / steps);
    quad(prev.tl, prev.tr, s.tr, s.tl); quad(prev.br, prev.bl, s.bl, s.br); quad(prev.tr, prev.br, s.br, s.tr); quad(prev.bl, prev.tl, s.tl, s.bl); prev = s; }
  const s0 = sect(0), s1 = sect(theta);
  P(s0.tl, s0.bl, s0.br); P(s0.tl, s0.br, s0.tr); P(s1.tr, s1.br, s1.bl); P(s1.tr, s1.bl, s1.tl);
  // зубья: трапеции по верхней грани с шагом ~1.2 мм, наклон 0.18 рад к радиусу
  const teeth = []; const pitch = 1.2; const n = Math.max(12, Math.round(R * theta / pitch));
  for (let i = 1; i < n; i++) {
    const p = theta * i / n; const c = at(p).add(V(0, Tr / 2, 0));
    const X = V(Math.cos(p), 0, Math.sin(p)), Z = inpl(p);
    const m = basisM(X, Y, Z, c).multiply(Mx(V(), qAxis(V(0, 1, 0), 0.18)));
    teeth.push(soupXform(trapTooth(1.0, 0.35, Wr * 0.94, 0.85), m));
  }
  return concat([new Float32Array(A), concat(teeth)]);
}

// ── Червяк: конический сердечник + спиральная резьба (ось локально Y) ──
function wormBody(rCore, rTip, Lw, turns, threadW) {
  const parts = [];
  // сердечник (слегка конический)
  parts.push(cyl(rCore * 0.92, rCore, Lw, V(0, 0, 0), null, 24));
  // спиральная резьба
  const A = []; const P = (a, b, c) => A.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const N = Math.max(40, Math.round(turns * 48));
  const st = (i) => { const u = i / N, ang = 2 * Math.PI * turns * u, y = -Lw / 2 + Lw * u;
    const rc = rCore * (0.92 + 0.08 * u), rt = rTip * (0.9 + 0.1 * u); const dx = Math.cos(ang), dz = Math.sin(ang);
    return { back: V(dx * rc, y - threadW / 2, dz * rc), front: V(dx * rc, y + threadW / 2, dz * rc), tip: V(dx * rt, y, dz * rt) }; };
  let s = st(0);
  for (let i = 1; i <= N; i++) { const t = st(i);
    P(s.back, t.back, t.tip); P(s.back, t.tip, s.tip);      // задний скат витка
    P(s.tip, t.tip, t.front); P(s.tip, t.front, s.front);   // передний скат витка
    s = t; }
  parts.push(new Float32Array(A));
  return concat(parts);
}

// ── Детальный корпус ползуна ──
function sliderBody(c, tS, mS, Wr) {
  const q = basisM(tS.clone().normalize(), V(0, 1, 0), mS.clone().normalize(), c);
  const L = (soup) => soupXform(soup, q);           // локально: X=касательная, Y=верх, Z=ширина
  const parts = [];
  const half = Wr / 2 + 1.3;
  // боковые стенки паза 12
  parts.push(L(box(7.0, 4.6, 1.7, V(0, 1.2, half))));
  parts.push(L(box(7.0, 4.6, 1.7, V(0, 1.2, -half))));
  // крыша-арка 44/45 (полуцилиндр) с гнездом под червяк
  parts.push(L(geoSoup(new THREE.CylinderGeometry(half + 0.2, half + 0.2, 7.0, 20, 1, false, 0, Math.PI), Mx(V(0, 3.2, 0), qAxis(V(1, 0, 0), -Math.PI / 2).multiply(qAxis(V(0, 0, 1), Math.PI / 2))))));
  parts.push(L(box(7.0, 2.2, Wr + 5.0, V(0, 3.2, 0))));
  // выступы 36 по углам
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(L(box(1.8, 3.0, 1.8, V(sx * 3.4, -0.4, sz * half))));
  // пружинящие элементы 15 — две тонкие дужки по бокам
  for (const sz of [-1, 1]) {
    parts.push(L(cyl(0.45, 0.45, 5.4, V(4.2, 0.6, sz * (half + 0.3)), qAxis(V(1, 0, 0), 0), 10)));
    parts.push(L(cyl(0.45, 0.45, 1.8, V(2.1, 0.6, sz * (half + 0.3)), qAxis(V(0, 0, 1), Math.PI / 2), 10)));
  }
  return concat(parts);
}

// ── Карданный привод ──
function drive(cS, tS) {
  const dir = V(0, 1, 0).add(tS.clone().multiplyScalar(0.5)).normalize();
  const q = qFromTo(V(0, 1, 0), dir);
  const o = cS.clone().add(V(0, 4.0, 0));
  const at = (d) => o.clone().add(dir.clone().multiplyScalar(d));
  const parts = [];
  // ортонормальный репер привода (ось Y = dir)
  const refU = Math.abs(dir.dot(V(0, 1, 0))) > 0.9 ? V(1, 0, 0) : V(0, 1, 0);
  const px = new THREE.Vector3().crossVectors(dir, refU).normalize();
  const pz = new THREE.Vector3().crossVectors(dir, px).normalize();
  // хвостовик червяка 13
  parts.push(cyl(1.5, 1.5, 2.6, at(1.0), q, 16));
  // вилка 35 (две щёки, смещены по px)
  for (const s of [-1, 1]) parts.push(soupXform(box(0.7, 2.6, 2.0, V()), basisM(px, dir, pz, at(3.4)).multiply(Mx(V(s * 1.1, 0, 0)))));
  // крестовина 17
  parts.push(sph(0.95, at(4.2), 12));
  // вилка 16 (развёрнута на 90°, смещена по pz)
  for (const s of [-1, 1]) parts.push(soupXform(box(0.7, 2.6, 2.0, V()), basisM(pz, dir, px, at(5.0)).multiply(Mx(V(s * 1.1, 0, 0)))));
  // стержень 22/24
  parts.push(cyl(1.0, 1.0, 58, at(35), q, 18));
  // муфта 20 + кольцевые проточки 25 (тонкие кольца)
  parts.push(cyl(1.8, 1.8, 2.8, at(7.5), q, 16));
  [20, 42, 56].forEach(d => { parts.push(cyl(1.6, 1.6, 1.6, at(d), q, 16)); parts.push(cyl(0.8, 0.8, 0.6, at(d), q, 12)); });
  // шестигранные участки 26/27/28
  [30, 48].forEach(d => parts.push(cyl(1.7, 1.7, 3.0, at(d), q, 6)));
  parts.push(cyl(1.9, 1.9, 4.2, at(64), q, 6));           // хвостовик-шестигранник 28
  return concat(parts);
}

export function buildKDA(R) {
  const Wr = 4.0, Tr = 1.7, pThick = 1.25;
  const chord = Math.min(34, R * 0.82);
  const theta = 2 * Math.asin(Math.min(0.96, chord / (2 * R)));
  const at = (p) => V(R * Math.sin(p), 0, R * (1 - Math.cos(p)));
  const tang = (p) => V(Math.cos(p), 0, Math.sin(p));
  const inpl = (p) => V(-Math.sin(p), 0, Math.cos(p));
  const parts = {};

  const tab = box(7.5, Tr + 0.8, Wr + 1.2, V(-3.4, 0, 0));
  parts.rail = concat([toothedRail(R, theta, Wr, Tr), tab]);
  parts.plateFixed = clover(V(-6.2, 0, 0), V(-1, 0, 0), V(0, 0, 1), pThick, RAIL_HOLES, RAIL_BARS);

  const phiS = theta * 0.78;
  const cS = at(phiS), tS = tang(phiS), mS = inpl(phiS);
  parts.slider = sliderBody(cS, tS, mS, Wr);
  // червяк над ползуном, ось вдоль касательной
  parts.worm = soupXform(wormBody(1.35, 2.0, 6.2, 5, 0.7), basisM(V(0, 1, 0), tS.clone().normalize(), V().crossVectors(V(0, 1, 0), tS).normalize(), cS.clone().add(V(0, 3.6, 0))));
  parts.plateMobile = clover(cS.clone(), mS.clone().normalize(), tS.clone().normalize(), pThick, SLD_HOLES, SLD_BARS);
  parts.drive = drive(cS, tS);

  const soup = concat([parts.rail, parts.plateFixed, parts.slider, parts.worm, parts.plateMobile, parts.drive]);
  return { soup, parts, R, theta, chord };
}

export function transformSoup(soup, mat) { return soupXform(soup, mat); }
