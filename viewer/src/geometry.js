// OSSA 4 — геометрическое ядро. Работаем с «супом» треугольников:
// Float32Array, по 9 чисел на треугольник (3 вершины × xyz). Это удобно для
// разрыва контактов (удаление треугольников) и совпадает с выходом splitByPlane.

// ── базовая геометрия ──────────────────────────────────────────────────────
export function centroid(soup) {
  let x = 0, y = 0, z = 0;
  const n = soup.length / 3;
  for (let i = 0; i < soup.length; i += 3) { x += soup[i]; y += soup[i + 1]; z += soup[i + 2]; }
  return { x: x / n, y: y / n, z: z / n };
}

export function bbox(soup) {
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < soup.length; i += 3) {
    const x = soup[i], y = soup[i + 1], z = soup[i + 2];
    if (x < minx) minx = x; if (y < miny) miny = y; if (z < minz) minz = z;
    if (x > maxx) maxx = x; if (y > maxy) maxy = y; if (z > maxz) maxz = z;
  }
  return {
    min: { x: minx, y: miny, z: minz }, max: { x: maxx, y: maxy, z: maxz },
    size: { x: maxx - minx, y: maxy - miny, z: maxz - minz },
    center: { x: (minx + maxx) / 2, y: (miny + maxy) / 2, z: (minz + maxz) / 2 },
  };
}

export function triCount(soup) { return (soup.length / 9) | 0; }

export function mergeSoups(list) {
  let total = 0; for (const s of list) total += s.length;
  const out = new Float32Array(total); let o = 0;
  for (const s of list) { out.set(s, o); o += s.length; }
  return out;
}

// ── разрыв контакта (ластик) ────────────────────────────────────────────────
// Удаляет треугольники, у которых хотя бы одна вершина ближе radius к точке p.
// Этим рвём «зубной мостик» или сращение в суставе, не трогая остальную кость.
export function breakContact(soup, p, radius) {
  const r2 = radius * radius;
  const keep = [];
  let removed = 0;
  for (let t = 0; t < soup.length; t += 9) {
    let hit = false;
    for (let k = 0; k < 9; k += 3) {
      const dx = soup[t + k] - p.x, dy = soup[t + k + 1] - p.y, dz = soup[t + k + 2] - p.z;
      if (dx * dx + dy * dy + dz * dz <= r2) { hit = true; break; }
    }
    if (hit) { removed++; continue; }
    for (let k = 0; k < 9; k++) keep.push(soup[t + k]);
  }
  return { soup: new Float32Array(keep), removed };
}

// ── связные компоненты (union-find по сваренным вершинам) ────────────────────
// Сердце «отделения челюсти»: как только мостики разорваны, челюсть становится
// отдельной связной компонентой и отщёлкивается сама — без угадывания вокселями.
export function connectedComponents(soup, opts = {}) {
  const tol = opts.tol || 1e-3;               // шаг сетки сварки, мм
  const inv = 1 / tol;
  const nTri = soup.length / 9;
  const vid = new Map();                      // ключ вершины → id
  const triV = new Int32Array(nTri * 3);      // по 3 сваренных id на треугольник
  let nv = 0;
  const key = (x, y, z) => (Math.round(x * inv)) + ',' + (Math.round(y * inv)) + ',' + (Math.round(z * inv));
  for (let t = 0, ti = 0; t < soup.length; t += 9, ti += 3) {
    for (let k = 0; k < 3; k++) {
      const o = t + k * 3;
      const kk = key(soup[o], soup[o + 1], soup[o + 2]);
      let id = vid.get(kk);
      if (id === undefined) { id = nv++; vid.set(kk, id); }
      triV[ti + k] = id;
    }
  }
  // union-find
  const parent = new Int32Array(nv); for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let ti = 0; ti < triV.length; ti += 3) { union(triV[ti], triV[ti + 1]); union(triV[ti + 1], triV[ti + 2]); }
  // группируем треугольники по корню
  const buckets = new Map();
  for (let t = 0, ti = 0; t < soup.length; t += 9, ti += 3) {
    const root = find(triV[ti]);
    let arr = buckets.get(root);
    if (!arr) { arr = []; buckets.set(root, arr); }
    for (let k = 0; k < 9; k++) arr.push(soup[t + k]);
  }
  const comps = [...buckets.values()].map(a => new Float32Array(a));
  comps.sort((a, b) => b.length - a.length);
  return comps;
}

// Разделить на компоненты, мелкие осколки приклеить к ближайшей крупной.
// minFrac — минимальная доля треугольников, чтобы считаться самостоятельной деталью.
export function splitComponents(soup, minFrac = 0.01) {
  const comps = connectedComponents(soup);
  if (comps.length <= 1) return comps;
  const totalTri = triCount(soup);
  const big = [], small = [];
  for (const c of comps) (triCount(c) >= totalTri * minFrac ? big : small).push(c);
  if (!big.length) return [comps[0]];
  // приклеить осколки к ближайшей крупной компоненте
  const cents = big.map(centroid);
  const merged = big.map(c => [c]);
  for (const s of small) {
    const sc = centroid(s); let bi = 0, bd = Infinity;
    for (let i = 0; i < cents.length; i++) {
      const dx = sc.x - cents[i].x, dy = sc.y - cents[i].y, dz = sc.z - cents[i].z;
      const d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; bi = i; }
    }
    merged[bi].push(s);
  }
  return merged.map(list => list.length === 1 ? list[0] : mergeSoups(list));
}

// ── ввод-вывод STL ───────────────────────────────────────────────────────────
export function parseSTL(buf) {
  const dv = new DataView(buf);
  if (buf.byteLength > 84) {                               // бинарный
    const nt = dv.getUint32(80, true);
    if (84 + nt * 50 === buf.byteLength) {
      const out = new Float32Array(nt * 9); let o = 0, off = 84;
      for (let t = 0; t < nt; t++) {
        off += 12;                                          // пропускаем нормаль
        for (let k = 0; k < 3; k++) { out[o++] = dv.getFloat32(off, true); out[o++] = dv.getFloat32(off + 4, true); out[o++] = dv.getFloat32(off + 8, true); off += 12; }
        off += 2;                                           // attribute byte count
      }
      return out;
    }
  }
  const txt = new TextDecoder().decode(new Uint8Array(buf));  // ASCII
  const nums = []; const re = /vertex\s+([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)/g; let m;
  while ((m = re.exec(txt))) nums.push(+m[1], +m[2], +m[3]);
  return new Float32Array(nums);
}

// Запись бинарного STL. tris — массив вершин в МИРОВЫХ координатах (Float32Array ×9).
export function writeSTLBinary(soup) {
  const nt = soup.length / 9;
  const buf = new ArrayBuffer(84 + nt * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, nt, true);
  let off = 84;
  const nx = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l];
  };
  for (let t = 0; t < soup.length; t += 9) {
    const n = nx(soup[t], soup[t + 1], soup[t + 2], soup[t + 3], soup[t + 4], soup[t + 5], soup[t + 6], soup[t + 7], soup[t + 8]);
    dv.setFloat32(off, n[0], true); dv.setFloat32(off + 4, n[1], true); dv.setFloat32(off + 8, n[2], true); off += 12;
    for (let k = 0; k < 9; k++) { dv.setFloat32(off, soup[t + k], true); off += 4; }
    dv.setUint16(off, 0, true); off += 2;
  }
  return buf;
}
