import * as THREE from 'three';
import { mergeSoups } from './geometry.js';

// Демонстрационная модель: условный «череп + нижняя челюсть», сваренные в ОДНУ
// связную сетку только через два зубных контакта (слева и справа). Ровно та
// ситуация, которую мы решаем: пока контакты целы — челюсть «приклеена» к черепу;
// разорви их — и «Отделить НЧ» отщёлкивает челюсть по связности.

function geoToSoup(geo, matrix) {
  const g = geo.toNonIndexed();
  const pos = g.attributes.position;
  if (matrix) { for (let i = 0; i < pos.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(matrix); pos.setXYZ(i, v.x, v.y, v.z); } }
  return new Float32Array(pos.array);
}

function nearestVertex(soup, p) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < soup.length; i += 3) {
    const dx = soup[i] - p.x, dy = soup[i + 1] - p.y, dz = soup[i + 2] - p.z;
    const d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; bi = i; }
  }
  return new THREE.Vector3(soup[bi], soup[bi + 1], soup[bi + 2]);
}

// Мостик (2 треугольника) между двумя точками на черепе и двумя на челюсти.
// Концы берутся как ближайшие СУЩЕСТВУЮЩИЕ вершины — тогда union-find их сваривает.
function bridge(skull, mand, near) {
  const s = nearestVertex(skull, near);
  const m = nearestVertex(mand, near);
  const s2 = s.clone().add(new THREE.Vector3(2, 0, 0));
  const m2 = m.clone().add(new THREE.Vector3(2, 0, 0));
  return new Float32Array([
    s.x, s.y, s.z, s2.x, s2.y, s2.z, m.x, m.y, m.z,
    s2.x, s2.y, s2.z, m2.x, m2.y, m2.z, m.x, m.y, m.z,
  ]);
}

export function buildDemo() {
  // ── череп + верхняя челюсть: вытянутый овоид ──
  const skullGeo = new THREE.SphereGeometry(34, 28, 20);
  const skullM = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 12, -4),
    new THREE.Quaternion(),
    new THREE.Vector3(1.0, 1.05, 1.18));
  const skull = geoToSoup(skullGeo, skullM);

  // ── нижняя челюсть: «подкова» (тор, дуга) лёжа в плоскости XZ ──
  const mandGeo = new THREE.TorusGeometry(26, 6.5, 16, 48, Math.PI * 1.15);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, -Math.PI / 2 - Math.PI * 0.075));
  const mandM = new THREE.Matrix4().compose(new THREE.Vector3(0, -16, 16), q, new THREE.Vector3(1, 1, 1));
  let mand = geoToSoup(mandGeo, mandM);

  // два зубных контакта (спереди слева/справа) — единственные мостики
  const bL = bridge(skull, mand, new THREE.Vector3(-14, -2, 30));
  const bR = bridge(skull, mand, new THREE.Vector3(14, -2, 30));

  const soup = mergeSoups([skull, mand, bL, bR]);
  return { soup, name: 'Череп + НЧ (демо)', bridges: [{ x: -14, y: -2, z: 30 }, { x: 14, y: -2, z: 30 }] };
}

// Синтетический КТ-объём для демонстрации MPR-срезов (без реальных данных).
// Череп — шаровой свод, нижняя челюсть — дуга-подкова у основания.
export function buildDemoVolume() {
  const nx = 100, ny = 100, nz = 100, sp = 1.8;
  const data = new Float32Array(nx * ny * nz);
  const cx = 50, cy = 60, cz = 50;        // центр черепа в вокселях
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    let v = -1000;                         // воздух
    const dx = x - cx, dy = y - cy, dz = z - cz;
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r <= 30) v = r >= 24 ? 900 : 120;  // кортикальная оболочка / внутри мягче
    // нижняя челюсть: кольцо в плоскости XZ у основания (низкий Y)
    const ring = Math.abs(Math.sqrt(dx * dx + (dz + 4) * (dz + 4)) - 23);
    if (y >= 20 && y <= 34 && ring <= 5 && (dz + 4) < 20) v = Math.max(v, 950);
    data[z * nx * ny + y * nx + x] = v;
  }
  return { data, dims: [nx, ny, nz], spacing: [sp, sp, sp], min: -1000, max: 1200, modality: 'CT' };
}
