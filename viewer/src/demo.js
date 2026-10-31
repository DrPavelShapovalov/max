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
