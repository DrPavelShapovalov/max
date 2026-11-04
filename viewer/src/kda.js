import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
//  ВЫСОКОДЕТАЛЬНАЯ параметрическая модель внутриротового криволинейного КДА
//  по патенту RU2772023C1 (ООО «КОНМЕТ») — в СОБРАННОМ виде (как на фиг. 28).
//
//  Компоновка «в сборе» (фиг. 4, 5, 24, 25, 28):
//   • РЕЙКА 1 — криволинейная (радиус R) зубчатая дуга-«рычаг» уходит в одну
//     сторону (слева на фиг. 28), трапециевидные ЗУБЬЯ 6 по всей длине;
//   • ПЛАСТИНЫ 2 (неподвижн.) и 4 (подвижн.) — «клеверные/бабочка»: две
//     трилистниковые лопасти по 3 ЗЕНКОВАННЫХ отверстия (фиг. 25), собраны
//     ПЛОТНО вокруг центрального узла (одна веером вверх, другая вниз);
//   • ПОЛЗУН 3 (корпус 9) с ЧЕРВЯКОМ 10 — центральный узел, червяк в зацеплении
//     с зубьями рейки; выступы 36, пружинящие элементы 15;
//   • ПРИВОД 30 — ГИБКИЙ витой вал, S-образно уходит в другую сторону (справа
//     на фиг. 28) через КАРДАН (вилки 16/35, крестовина 17) к шестигранному
//     хвостовику 28.
//
//  Локальный базис (совпадает с планнером OSSA: X→dir ветви, Y→наружу/толщина
//  пластин/выход привода, Z→выпуклость дуги). Центральный узел ≈ в начале,
//  зубчатая рейка уходит по +X, гибкий привод — по −X с подъёмом +Y.
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
const sph = (r, pos, seg = 16) => geoSoup(new THREE.SphereGeometry(r, seg, seg), Mx(pos));

function tris(verts, faces) {
  const A = []; for (const [a, b, c] of faces) { A.push(verts[a].x, verts[a].y, verts[a].z, verts[b].x, verts[b].y, verts[b].z, verts[c].x, verts[c].y, verts[c].z); }
  return new Float32Array(A);
}

// ── Зенкованное отверстие пластины (седло 29 сверху), плоскость XZ, толщина по Y ──
function washer(Ro, Ri, thick, pos, seg = 20) {
  const A = []; const yT = thick / 2, yB = -thick / 2, Rcs = Ri * 1.6, cs = thick * 0.55;
  const P = (a, b, c) => A.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const oc = (a, r, y) => V(pos.x + Math.cos(a) * r, pos.y + y, pos.z + Math.sin(a) * r);
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * 2 * Math.PI, a1 = (i + 1) / seg * 2 * Math.PI;
    const To = (a) => oc(a, Ro, yT), Tcs = (a) => oc(a, Rcs, yT), Tin = (a) => oc(a, Ri, yT - cs), Bin = (a) => oc(a, Ri, yB), Bo = (a) => oc(a, Ro, yB);
    P(To(a0), Tcs(a0), Tcs(a1)); P(To(a0), Tcs(a1), To(a1));     // верхняя кайма
    P(Tcs(a0), Tin(a0), Tin(a1)); P(Tcs(a0), Tin(a1), Tcs(a1));   // конус зенковки 29
    P(Tin(a0), Bin(a0), Bin(a1)); P(Tin(a0), Bin(a1), Tin(a1));   // цилиндр отверстия
    P(Bo(a0), Bo(a1), oc(a1, Ri, yB)); P(Bo(a0), oc(a1, Ri, yB), oc(a0, Ri, yB)); // низ
    P(To(a0), To(a1), Bo(a1)); P(To(a0), Bo(a1), Bo(a0));         // наружная стенка
  }
  return new Float32Array(A);
}
// перемычка между двумя точками (в плоскости пластины, толщина по Y)
function barBetween(A, B, width, thick) {
  const d = B.clone().sub(A); const len = d.length(); if (len < 1e-4) return new Float32Array(0);
  return box(len, thick, width, A.clone().add(B).multiplyScalar(0.5), qFromTo(V(1, 0, 0), d));
}

// ── Трилистник (клеверный лист): 3 зенкованных отверстия под 120° вокруг tc ──
//   baseAng — ориентация: одна доля смотрит наружу (от центра аппарата)
function trilobe(tc, baseAng, thick, r = 2.8, Ro = 2.6, Ri = 1.2) {
  const parts = [];
  const h = [0, 1, 2].map(k => { const a = baseAng + k * 2 * Math.PI / 3; return V(tc.x + Math.cos(a) * r, tc.y, tc.z + Math.sin(a) * r); });
  for (let k = 0; k < 3; k++) parts.push(barBetween(h[k], h[(k + 1) % 3], 2.5, thick)); // перепонки
  parts.push(box(2.6, thick, 2.6, tc));                                                  // центр лепестка
  for (const p of h) parts.push(washer(Ro, Ri, thick, p));
  return concat(parts);
}

// ── Клеверная пластина-«бабочка»: две трилистниковые лопасти (фиг. 25, 28) ──
//   hub — центр (под крепление к узлу), side=+1 лопасти веером +Z, −1 веером −Z.
//   Два лепестка разнесены в разные стороны по X → с другой пластиной образуют
//   4 трилистника в 4 «квадрантах» (как на фото фиг. 28).
function butterflyPlate(hub, side, thick) {
  const parts = [];
  const span = 6.2, reach = 8.8;   // разнос лопастей по X и вынос по Z
  const tcL = V(hub.x - span, hub.y, hub.z + reach * side);
  const tcR = V(hub.x + span, hub.y, hub.z + reach * side);
  const neck = V(hub.x, hub.y, hub.z + 2.0 * side);
  // короткая площадка-хребет 32 у центрального узла
  parts.push(box(4.4, thick, 2.8, V(hub.x, hub.y, hub.z + 1.3 * side)));
  // шейки к лопастям (без широкой верхней перемычки — лепестки отдельные)
  parts.push(barBetween(neck, tcL, 3.3, thick));
  parts.push(barBetween(neck, tcR, 3.3, thick));
  // лепестки-трилистники: одной долей наружу от центра
  parts.push(trilobe(tcL, Math.atan2(tcL.z - hub.z, tcL.x - hub.x), thick));
  parts.push(trilobe(tcR, Math.atan2(tcR.z - hub.z, tcR.x - hub.x), thick));
  return concat(parts);
}

// ── Трапециевидный зуб рейки (локально: X — шаг, Y — высота, Z — ширина) ──
function trapTooth(bl, tl, W, h) {
  const xb = bl / 2, xt = tl / 2, z = W / 2;
  const v = [V(-xb, 0, -z), V(xb, 0, -z), V(xb, 0, z), V(-xb, 0, z), V(-xt, h, -z), V(xt, h, -z), V(xt, h, z), V(-xt, h, z)];
  return tris(v, [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]);
}
// ── Криволинейная зубчатая рейка-рычаг (дуга p∈[p0,p1], зубья по верхней грани) ──
function toothedRail(R, p0, p1, Wr, Tr) {
  const at = (p) => V(R * Math.sin(p), 0, R * (1 - Math.cos(p)));
  const inpl = (p) => V(-Math.sin(p), 0, Math.cos(p));
  const Y = V(0, 1, 0);
  const steps = Math.max(36, Math.round(R * (p1 - p0) / 0.7));
  const A = []; const P = (a, b, c) => A.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const quad = (a, b, c, d) => { P(a, b, c); P(a, c, d); };
  const sect = (p) => { const c = at(p), m = inpl(p).multiplyScalar(Wr / 2), y = Y.clone().multiplyScalar(Tr / 2);
    return { tl: c.clone().add(m).add(y), tr: c.clone().sub(m).add(y), bl: c.clone().add(m).sub(y), br: c.clone().sub(m).sub(y) }; };
  let prev = sect(p0);
  for (let i = 1; i <= steps; i++) { const s = sect(p0 + (p1 - p0) * i / steps);
    quad(prev.tl, prev.tr, s.tr, s.tl); quad(prev.br, prev.bl, s.bl, s.br); quad(prev.tr, prev.br, s.br, s.tr); quad(prev.bl, prev.tl, s.tl, s.bl); prev = s; }
  const s0 = sect(p0), s1 = sect(p1);
  P(s0.tl, s0.bl, s0.br); P(s0.tl, s0.br, s0.tr); P(s1.tr, s1.br, s1.bl); P(s1.tr, s1.bl, s1.tl);
  // зубья: трапеции по верхней грани с шагом ~1.15 мм, наклон 0.18 рад к радиусу
  const teeth = []; const pitch = 1.15; const n = Math.max(10, Math.round(R * (p1 - p0) / pitch));
  for (let i = 1; i < n; i++) {
    const p = p0 + (p1 - p0) * i / n; const c = at(p).add(V(0, Tr / 2, 0));
    const X = V(Math.cos(p), 0, Math.sin(p)), Z = inpl(p);
    const m = basisM(X, Y, Z, c).multiply(Mx(V(), qAxis(V(0, 1, 0), 0.18)));
    teeth.push(soupXform(trapTooth(0.95, 0.32, Wr * 0.92, 0.85), m));
  }
  return concat([new Float32Array(A), concat(teeth)]);
}

// ── Червяк 10: конический сердечник + спиральная резьба 34 (ось локально Y) ──
function wormBody(rCore, rTip, Lw, turns, threadW) {
  const parts = [];
  parts.push(cyl(rCore * 0.9, rCore, Lw, V(0, 0, 0), null, 20));
  const A = []; const P = (a, b, c) => A.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const N = Math.max(40, Math.round(turns * 44));
  const st = (i) => { const u = i / N, ang = 2 * Math.PI * turns * u, y = -Lw / 2 + Lw * u;
    const rc = rCore * (0.9 + 0.1 * u), rt = rTip * (0.88 + 0.12 * u); const dx = Math.cos(ang), dz = Math.sin(ang);
    return { back: V(dx * rc, y - threadW / 2, dz * rc), front: V(dx * rc, y + threadW / 2, dz * rc), tip: V(dx * rt, y, dz * rt) }; };
  let s = st(0);
  for (let i = 1; i <= N; i++) { const t = st(i);
    P(s.back, t.back, t.tip); P(s.back, t.tip, s.tip);
    P(s.tip, t.tip, t.front); P(s.tip, t.front, s.front);
    s = t; }
  parts.push(new Float32Array(A));
  return concat(parts);
}

// ── Компактный корпус ползуна 3/9 (паз под рейку + гнездо червяка + выступы 36) ──
function sliderBlock(c, tang, Wr) {
  const Z = new THREE.Vector3().crossVectors(V(0, 1, 0), tang).normalize();
  const q = basisM(tang.clone().normalize(), V(0, 1, 0), Z, c);
  const L = (s) => soupXform(s, q);
  const parts = [];
  const half = Wr / 2 + 1.2;
  // боковые стенки паза 12
  parts.push(L(box(6.6, 4.4, 1.5, V(0, 1.0, half))));
  parts.push(L(box(6.6, 4.4, 1.5, V(0, 1.0, -half))));
  // крыша-арка 44/45 над червяком
  parts.push(L(box(6.6, 1.8, Wr + 4.8, V(0, 3.0, 0))));
  parts.push(L(geoSoup(new THREE.CylinderGeometry(half + 0.3, half + 0.3, 6.6, 18, 1, false, 0, Math.PI), Mx(V(0, 3.0, 0), qAxis(V(1, 0, 0), -Math.PI / 2).multiply(qAxis(V(0, 0, 1), Math.PI / 2))))));
  // корпус-бочка червяка (горизонтальный цилиндр по касательной, как на фиг. 28)
  parts.push(L(cyl(half + 0.35, half + 0.35, 4.6, V(0, 3.0, 0), qAxis(V(0, 0, 1), Math.PI / 2), 18)));
  // выступы 36 по углам
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(L(box(1.6, 2.8, 1.6, V(sx * 3.1, -0.5, sz * half))));
  // пружинящие элементы 15 — тонкие дужки по бокам
  for (const sz of [-1, 1]) {
    parts.push(L(cyl(0.42, 0.42, 4.8, V(3.6, 0.6, sz * (half + 0.35)), qAxis(V(1, 0, 0), 0), 8)));
    parts.push(L(cyl(0.42, 0.42, 1.6, V(1.5, 0.6, sz * (half + 0.35)), qAxis(V(0, 0, 1), Math.PI / 2), 8)));
  }
  return concat(parts);
}

// ── Карданный узел: вилка 35 + крестовина 17 + вилка 16 ──
function cardan(pos, dir) {
  const parts = [];
  const d = dir.clone().normalize();
  const q = qFromTo(V(0, 1, 0), d);
  const refU = Math.abs(d.dot(V(0, 1, 0))) > 0.9 ? V(1, 0, 0) : V(0, 1, 0);
  const px = new THREE.Vector3().crossVectors(d, refU).normalize();
  const pz = new THREE.Vector3().crossVectors(d, px).normalize();
  const at = (t) => pos.clone().add(d.clone().multiplyScalar(t));
  // хвостовик червяка 13 с пазами 14
  parts.push(cyl(1.45, 1.45, 2.4, at(1.1), q, 14));
  // вилка 35 (две щёки по px)
  for (const s of [-1, 1]) parts.push(soupXform(box(0.65, 2.4, 1.9, V()), basisM(px, d, pz, at(3.1)).multiply(Mx(V(s * 1.0, 0, 0)))));
  // крестовина 17
  parts.push(sph(0.9, at(3.9), 12));
  // вилка 16 (развёрнута 90°, по pz)
  for (const s of [-1, 1]) parts.push(soupXform(box(0.65, 2.4, 1.9, V()), basisM(pz, d, px, at(4.7)).multiply(Mx(V(s * 1.0, 0, 0)))));
  // муфта 20
  parts.push(cyl(1.6, 1.6, 2.2, at(6.0), q, 14));
  return { soup: concat(parts), end: at(7.0), dir: d };
}

// ── Сплошная труба-свёртка вдоль ломаной (параллельный перенос репера) ──
function tubeAlong(pts, r, K = 9) {
  const A = []; const P = (a, b, c) => A.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const n = pts.length; const rings = [];
  for (let i = 0; i < n; i++) {
    const t = (i < n - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
    const up = Math.abs(t.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0);
    const nrm = up.clone().sub(t.clone().multiplyScalar(up.dot(t))).normalize();
    const bi = new THREE.Vector3().crossVectors(t, nrm).normalize();
    const ring = [];
    for (let k = 0; k < K; k++) { const a = k / K * 2 * Math.PI; ring.push(pts[i].clone().add(nrm.clone().multiplyScalar(Math.cos(a) * r)).add(bi.clone().multiplyScalar(Math.sin(a) * r))); }
    rings.push(ring);
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < K; k++) { const k2 = (k + 1) % K; P(rings[i][k], rings[i + 1][k], rings[i + 1][k2]); P(rings[i][k], rings[i + 1][k2], rings[i][k2]); }
  return new Float32Array(A);
}

// ── ГИБКИЙ привод 30: ПРЯМОЙ витой вал (гибкого типа) + хвостовик 28 ──
//   Привод гибкий, но моделируется прямым — на фото он лишь лежит изогнутым.
function flexDrive(start, startDir) {
  const parts = [];
  const d0 = startDir.clone().normalize();
  const Ldrv = 42;
  const n = 60;
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(start.clone().add(d0.clone().multiplyScalar(Ldrv * i / n)));
  // сплошной сердечник-тяга (без зазоров)
  parts.push(tubeAlong(pts, 0.82, 9));
  // тугая навивка: частые перекрывающиеся кольца чуть большего радиуса
  const coilEnd = Math.round(n * 0.82);  // до начала гладкого хвостовика
  for (let i = 0; i < coilEnd; i++) {
    const a = pts[i], b = pts[i + 1]; const seg = b.clone().sub(a); const len = seg.length(); if (len < 1e-4) continue;
    const mid = a.clone().add(b).multiplyScalar(0.5); const q = qFromTo(V(0, 1, 0), seg);
    parts.push(cyl(1.22, 1.22, len * 2.0, mid, q, 8));
  }
  // усилительные муфты-проточки 25 по длине
  [0.2, 0.45, 0.68].forEach(t => {
    const i = Math.min(n - 2, Math.round(t * n)); const a = pts[i], b = pts[i + 1];
    const q = qFromTo(V(0, 1, 0), b.clone().sub(a));
    parts.push(cyl(1.5, 1.5, 2.0, a.clone().add(b).multiplyScalar(0.5), q, 14));
  });
  // гладкий концевой участок + шестигранный хвостовик 28
  const e0 = pts[n], ePrev = pts[n - 1]; const ed = e0.clone().sub(ePrev).normalize(); const qe = qFromTo(V(0, 1, 0), ed);
  const cEnd = pts[coilEnd];
  parts.push(cyl(1.05, 1.05, cEnd.distanceTo(e0), cEnd.clone().add(e0).multiplyScalar(0.5), qFromTo(V(0, 1, 0), e0.clone().sub(cEnd)), 12)); // гладкий стержень
  parts.push(cyl(1.7, 1.7, 1.3, e0.clone().add(ed.clone().multiplyScalar(-0.2)), qe, 6));
  parts.push(cyl(1.85, 1.85, 3.4, e0.clone().add(ed.clone().multiplyScalar(1.6)), qe, 6)); // грань-шестигранник 28
  parts.push(cyl(1.0, 1.0, 2.0, e0.clone().add(ed.clone().multiplyScalar(4.3)), qe, 4));   // квадрат-носик
  return concat(parts);
}

export function buildKDA(R) {
  const Wr = 4.0, Tr = 1.7, pThick = 1.2;
  const chord = Math.min(34, R * 0.82);
  const theta = 2 * Math.asin(Math.min(0.96, chord / (2 * R)));
  const at = (p) => V(R * Math.sin(p), 0, R * (1 - Math.cos(p)));
  const tang = (p) => V(Math.cos(p), 0, Math.sin(p));
  const parts = {};

  // Центральный узел (ползун+червяк) у начала дуги p=0; рейка уходит по +X.
  const pS = 0.0;
  const cS = at(pS);             // центр узла ≈ (0,0,0)
  const tS = tang(pS);           // касательная = +X

  // Зубчатая рейка-рычаг: от узла по +X (ход ползуна + плечо фиксации)
  parts.rail = toothedRail(R, 0.02 * theta, theta, Wr, Tr);

  // Пластины «бабочка» ПЛОТНО у центра: неподвижная веером +Z, подвижная −Z
  const hubFix = V(cS.x + 4.2, -0.25, cS.z);   // неподвижная — чуть дистальнее на рейке
  const hubMob = V(cS.x - 0.4, -0.25, cS.z);   // подвижная — на ползуне
  parts.plateFixed = butterflyPlate(hubFix, +1, pThick);
  parts.plateMobile = butterflyPlate(hubMob, -1, pThick);
  // хвостовик рейки 33, связывающий неподвижную пластину с рейкой
  parts.railTab = box(5.6, Tr + 0.7, Wr + 1.0, V(cS.x + 4.2, 0, cS.z));

  // Ползун + червяк (ось червяка вдоль касательной, над рейкой)
  parts.slider = sliderBlock(cS, tS, Wr);
  const wormAxis = tS.clone().normalize();
  const wormZ = new THREE.Vector3().crossVectors(V(0, 1, 0), wormAxis).normalize();
  parts.worm = soupXform(wormBody(1.3, 1.95, 6.0, 5, 0.65), basisM(wormAxis, V(0, 1, 0), wormZ, cS.clone().add(V(0, 3.0, 0))));

  // Кардан + ГИБКИЙ привод уходят в противоположную от рейки сторону (−X) с подъёмом +Y
  const driveBase = cS.clone().add(V(-3.2, 3.0, 0));
  const card = cardan(driveBase, V(-1, 0.07, 0));
  parts.cardan = card.soup;
  parts.drive = flexDrive(card.end, card.dir.clone());   // прямой гибкий вал вдоль оси механизма

  const soup = concat([parts.rail, parts.railTab, parts.plateFixed, parts.plateMobile, parts.slider, parts.worm, parts.cardan, parts.drive]);
  return { soup, parts, R, theta, chord };
}

export function transformSoup(soup, mat) { return soupXform(soup, mat); }
