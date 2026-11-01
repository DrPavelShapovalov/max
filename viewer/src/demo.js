import * as THREE from 'three';
import { mergeSoups } from './geometry.js';

// Демо-модель: условный «череп + нижняя челюсть», сваренные в ОДНУ связную сетку
// только через два зубных контакта. Меш и синтетический КТ-объём строятся из
// ОДНИХ аналитических форм в мировых координатах → оверлеи (плоскость, вектор)
// и срезы совпадают с 3D так же, как на реальном DICOM.

// ── общие формы в мировых координатах ──
const SKULL = { c: new THREE.Vector3(0, 12, -4), r: new THREE.Vector3(34, 34 * 1.05, 34 * 1.18) };
const MAND = { c: new THREE.Vector3(0, -16, 16), euler: [Math.PI / 2, 0, -Math.PI / 2 - Math.PI * 0.075], R: 26, tube: 6.5, arc: Math.PI * 1.15 };
const BRIDGES = [{ x: -14, y: -2, z: 30 }, { x: 14, y: -2, z: 30 }];

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
function bridge(skull, mand, near) {
  const s = nearestVertex(skull, near), m = nearestVertex(mand, near);
  const s2 = s.clone().add(new THREE.Vector3(2, 0, 0)), m2 = m.clone().add(new THREE.Vector3(2, 0, 0));
  return new Float32Array([s.x, s.y, s.z, s2.x, s2.y, s2.z, m.x, m.y, m.z, s2.x, s2.y, s2.z, m2.x, m2.y, m2.z, m.x, m.y, m.z]);
}

export function buildDemo() {
  const skullGeo = new THREE.SphereGeometry(34, 28, 20);
  const skullM = new THREE.Matrix4().compose(SKULL.c, new THREE.Quaternion(), new THREE.Vector3(1.0, 1.05, 1.18));
  const skull = geoToSoup(skullGeo, skullM);

  const mandGeo = new THREE.TorusGeometry(MAND.R, MAND.tube, 16, 48, MAND.arc);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...MAND.euler));
  const mandM = new THREE.Matrix4().compose(MAND.c, q, new THREE.Vector3(1, 1, 1));
  const mand = geoToSoup(mandGeo, mandM);

  const bL = bridge(skull, mand, new THREE.Vector3(BRIDGES[0].x, BRIDGES[0].y, BRIDGES[0].z));
  const bR = bridge(skull, mand, new THREE.Vector3(BRIDGES[1].x, BRIDGES[1].y, BRIDGES[1].z));
  return { soup: mergeSoups([skull, mand, bL, bR]), name: 'Череп + НЧ (демо)', bridges: BRIDGES };
}

// Синтетический КТ-объём из ТЕХ ЖЕ форм → совпадает с демо-мешем в мире.
// Отображение воксель↔мир такое же, как worldToVoxel в app: X=(vx-nx/2)*spacing.
export function buildDemoVolume() {
  const nx = 100, ny = 100, nz = 100, sp = 1.8;
  const data = new Float32Array(nx * ny * nz);
  const qInv = new THREE.Quaternion().setFromEuler(new THREE.Euler(...MAND.euler)).invert();
  const loc = new THREE.Vector3();
  const R = MAND.R, tube2 = MAND.tube * MAND.tube;
  for (let z = 0; z < nz; z++) {
    const Z = (z - nz / 2) * sp;
    for (let y = 0; y < ny; y++) {
      const Y = (y - ny / 2) * sp;
      for (let x = 0; x < nx; x++) {
        const X = (x - nx / 2) * sp;
        let v = -1000;
        // череп — эллипсоид (оболочка 900, внутри 150)
        const nX = (X - SKULL.c.x) / SKULL.r.x, nY = (Y - SKULL.c.y) / SKULL.r.y, nZ = (Z - SKULL.c.z) / SKULL.r.z;
        const d = nX * nX + nY * nY + nZ * nZ;
        if (d <= 1) v = d >= 0.8 ? 900 : 150;
        // нижняя челюсть — тор в локальной системе
        loc.set(X - MAND.c.x, Y - MAND.c.y, Z - MAND.c.z).applyQuaternion(qInv);
        const qd = Math.sqrt(loc.x * loc.x + loc.y * loc.y) - R;
        if (qd * qd + loc.z * loc.z <= tube2) v = Math.max(v, 950);
        data[z * nx * ny + y * nx + x] = v;
      }
    }
  }
  return { data, dims: [nx, ny, nz], spacing: [sp, sp, sp], min: -1000, max: 1200, modality: 'CT' };
}
