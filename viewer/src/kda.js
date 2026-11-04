import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
//  Параметрическая модель внутриротового криволинейного КДА по патенту
//  RU2772023C1 (ООО «КОНМЕТ»): криволинейная зубчатая РЕЙКА радиуса R + костная
//  ПЛАСТИНА (неподвижный фрагмент), ПОЛЗУН с ЧЕРВЯКОМ + костная пластина
//  (подвижный фрагмент) и ГИБКИЙ ПРИВОД наружу. R = радиус дуги рейки (мм):
//  R40 / R50 / R70 / R100 / R180. Возвращает «суп» треугольников (Float32Array×9)
//  в локальной системе: начало рейки в (0,0,0), дуга в плоскости XZ (выпуклость +Z),
//  толщина пластин по Y, привод выходит по +Y.
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

// Шайба с отверстием (винтовое отверстие пластины), ось — Y.
function washer(Ro, Ri, thick, pos, seg = 20) {
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
    P(Oi0, Bi0, Bi1); P(Oi0, Bi1, Oi1);          // стенка отверстия (конусная «воронка» 29 упрощена)
  }
  return new Float32Array(A);
}

// Костная пластина в плоскости XZ (толщина по Y): центральный «хребет» + 6 отверстий
// двумя рядами (как клеверные реконструктивные пластины, фиг. 10/14).
function bonePlate(x0, dir, L, thick) {
  const parts = []; const spineW = 3.0, rowGap = 4.2, Ro = 2.6, Ri = 1.3;
  const cx = x0 + dir * L / 2;
  parts.push(box(L, thick, spineW, V(cx, 0, 0)));                       // хребет
  for (let r = -1; r <= 1; r += 2) {
    parts.push(box(L * 0.74, thick, 1.4, V(x0 + dir * L * 0.5, 0, r * rowGap * 0.62)));  // боковой мостик
    for (let i = 0; i < 3; i++) {
      const xx = x0 + dir * (0.18 + i * 0.3) * L, zz = r * rowGap;
      parts.push(washer(Ro, Ri, thick, V(xx, 0, zz)));
      parts.push(box(2.0, thick, rowGap * 0.9, V(xx, 0, r * rowGap * 0.5)));             // перемычка к хребту
    }
  }
  return concat(parts);
}

// Криволинейная зубчатая рейка радиуса R, дуга 0..theta в плоскости XZ.
function railArc(R, theta, Wr, Tr) {
  const C = V(0, 0, R);                                     // центр дуги (над началом)
  const at = (phi) => V(R * Math.sin(phi), 0, R * (1 - Math.cos(phi)));   // точка центра сечения
  const tang = (phi) => V(Math.cos(phi), 0, Math.sin(phi));               // касательная
  const inpl = (phi) => V(-Math.sin(phi), 0, Math.cos(phi));              // нормаль в плоскости (ширина)
  const Y = V(0, 1, 0);
  const steps = Math.max(24, Math.round(theta / (Math.PI / 90)));
  const A = []; const P = (a, b, c) => A.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const quad = (a, b, c, d) => { P(a, b, c); P(a, c, d); };
  const sect = (phi) => { const c = at(phi), m = inpl(phi).multiplyScalar(Wr / 2), y = Y.clone().multiplyScalar(Tr / 2);
    return { tl: c.clone().add(m).add(y), tr: c.clone().sub(m).add(y), bl: c.clone().add(m).sub(y), br: c.clone().sub(m).sub(y) }; };
  let prev = sect(0);
  for (let i = 1; i <= steps; i++) {
    const s = sect(theta * i / steps);
    quad(prev.tl, prev.tr, s.tr, s.tl);   // верх (+Y)
    quad(prev.br, prev.bl, s.bl, s.br);   // низ
    quad(prev.tr, prev.br, s.br, s.tr);   // внутр. бок
    quad(prev.bl, prev.tl, s.tl, s.bl);   // внешн. бок
    prev = s;
  }
  // торцы
  const s0 = sect(0), s1 = sect(theta);
  P(s0.tl, s0.bl, s0.br); P(s0.tl, s0.br, s0.tr);
  P(s1.tr, s1.br, s1.bl); P(s1.tr, s1.bl, s1.tl);
  const rail = new Float32Array(A);
  // зубья 6 — поперечные гребешки на верхней грани, под небольшим углом к радиусу
  const teeth = []; const n = Math.max(10, Math.round(R * theta / 1.5));
  for (let i = 1; i < n; i++) {
    const phi = theta * i / n; const c = at(phi).add(V(0, Tr / 2, 0));
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), inpl(phi)).multiply(qAxis(V(0, 1, 0), 0.18));
    teeth.push(box(Wr * 0.92, 0.5, 0.7, c.clone().add(V(0, 0.2, 0)), q));
  }
  return concat([rail, concat(teeth)]);
}

// Ползун: «туннель» над рейкой (две стенки + перемычка) с выступами по углам.
function slider(c, tang, inpl, Wr) {
  const Y = V(0, 1, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), tang.clone().normalize());
  const parts = [];
  const put = (sx, sy, sz, off) => parts.push(box(sx, sy, sz, c.clone().add(off), q));
  const side = inpl.clone().normalize();
  put(6.2, 4.6, 1.8, side.clone().multiplyScalar(Wr / 2 + 1.2).add(V(0, 1.2, 0)));   // стенка 1
  put(6.2, 4.6, 1.8, side.clone().multiplyScalar(-(Wr / 2 + 1.2)).add(V(0, 1.2, 0))); // стенка 2
  put(6.2, 1.6, Wr + 4.4, V(0, 3.0, 0));                                             // перемычка-крыша
  // выступы 36 по углам (шипики)
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    put(1.6, 2.4, 1.6, V(0, 0, 0).add(tang.clone().multiplyScalar(sx * 3.1)).add(side.clone().multiplyScalar(sz * (Wr / 2 + 1.0))).add(V(0, -0.2, 0)));
  return concat(parts);
}

// Полный аппарат. R — радиус дуги рейки (мм). Возвращает { soup, parts }.
export function buildKDA(R) {
  const Wr = 4.0, Tr = 1.7;
  const chord = Math.min(34, R * 0.82);
  const theta = 2 * Math.asin(Math.min(0.96, chord / (2 * R)));
  const at = (phi) => V(R * Math.sin(phi), 0, R * (1 - Math.cos(phi)));
  const tang = (phi) => V(Math.cos(phi), 0, Math.sin(phi));
  const inpl = (phi) => V(-Math.sin(phi), 0, Math.cos(phi));

  const rail = railArc(R, theta, Wr, Tr);
  const plateFixed = bonePlate(-4, -1, 20, 1.2);                   // неподвижная пластина у начала рейки (−X)

  const phiS = theta * 0.8;                                        // позиция ползуна
  const cS = at(phiS).add(V(0, 0, 0));
  const tS = tang(phiS), mS = inpl(phiS);
  const sld = slider(cS, tS, mS, Wr);

  // червяк 10 — над ползуном, ось ≈ вдоль касательной
  const worm = cyl(1.5, 1.5, 6.0, cS.clone().add(V(0, 3.6, 0)),
    new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), tS.clone().normalize()), 16);

  // подвижная пластина — от ползуна вперёд (вдоль касательной, в плоскости XZ)
  const qPlate = new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), tS.clone().normalize());
  const plateMobile = transform(bonePlate(2, 1, 18, 1.2), Mx(cS.clone().add(mS.clone().multiplyScalar(0)), qPlate));

  // привод 5 — от червяка наружу (по +Y) и вдоль касательной: стержень + муфты + хвостовик
  const driveDir = V(0, 1, 0).add(tS.clone().multiplyScalar(0.5)).normalize();
  const qD = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), driveDir);
  const dStart = cS.clone().add(V(0, 4.2, 0));
  const drive = [];
  drive.push(cyl(1.1, 1.1, 64, dStart.clone().add(driveDir.clone().multiplyScalar(32)), qD, 14));     // стержень 22/24
  drive.push(cyl(1.9, 1.9, 3.2, dStart.clone().add(driveDir.clone().multiplyScalar(6)), qD, 12));      // шарнирная муфта 20
  [26, 45, 60].forEach(d => drive.push(cyl(1.7, 1.7, 2.4, dStart.clone().add(driveDir.clone().multiplyScalar(d)), qD, 12))); // кольца 25
  drive.push(cyl(1.9, 1.9, 4.0, dStart.clone().add(driveDir.clone().multiplyScalar(66)), qD, 6));      // шестигранный хвостовик 28

  const parts = { rail, plateFixed, slider: sld, worm, plateMobile, drive: concat(drive) };
  const soup = concat([rail, plateFixed, sld, worm, plateMobile, parts.drive]);
  return { soup, parts, R, theta, chord };
}

function transform(soup, mat) {
  const out = new Float32Array(soup.length); const v = new THREE.Vector3();
  for (let i = 0; i < soup.length; i += 3) { v.set(soup[i], soup[i + 1], soup[i + 2]).applyMatrix4(mat); out[i] = v.x; out[i + 1] = v.y; out[i + 2] = v.z; }
  return out;
}
export { transform as transformSoup };
