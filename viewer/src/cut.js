// Разрезание меша плоскостью на два фрагмента.
// Плоскость: точка p и нормаль n. Сторона dist>=0 → фрагмент A, dist<0 → B.
// Треугольники, пересекающие плоскость, аккуратно рассекаются.

export function splitByPlane(positions, indices, n, p) {
  const A = [];               // triangle soup (x,y,z по 9 на треугольник)
  const B = [];
  const nx = n.x, ny = n.y, nz = n.z;
  const dist = (v) => (v[0] - p.x) * nx + (v[1] - p.y) * ny + (v[2] - p.z) * nz;

  const triCount = indices ? indices.length : positions.length / 3;
  const get = (i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];

  const push = (arr, a, b, c) => { arr.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); };
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  for (let t = 0; t < triCount; t += 3) {
    const i0 = indices ? indices[t] : t;
    const i1 = indices ? indices[t + 1] : t + 1;
    const i2 = indices ? indices[t + 2] : t + 2;
    const v = [get(i0), get(i1), get(i2)];
    const d = [dist(v[0]), dist(v[1]), dist(v[2])];
    const pos = d.map(x => x >= 0);
    const cnt = pos[0] + pos[1] + pos[2];

    if (cnt === 3) { push(A, v[0], v[1], v[2]); continue; }
    if (cnt === 0) { push(B, v[0], v[1], v[2]); continue; }

    // порядок вершин: выделяем «одиночную» сторону
    // индексы так, чтобы s = одиночная вершина, m1,m2 — две другие
    let single, m1, m2, singlePos;
    if (cnt === 1) { // одна pos, две neg
      singlePos = true;
      const si = pos[0] ? 0 : pos[1] ? 1 : 2;
      single = si; m1 = (si + 1) % 3; m2 = (si + 2) % 3;
    } else { // две pos, одна neg
      singlePos = false;
      const si = !pos[0] ? 0 : !pos[1] ? 1 : 2;
      single = si; m1 = (si + 1) % 3; m2 = (si + 2) % 3;
    }
    const vs = v[single], v1 = v[m1], v2 = v[m2];
    const ds = d[single], d1 = d[m1], d2 = d[m2];
    const t1 = ds / (ds - d1);   // точка на ребре s-m1
    const t2 = ds / (ds - d2);   // точка на ребре s-m2
    const p1 = lerp(vs, v1, t1);
    const p2 = lerp(vs, v2, t2);

    // сторона одиночной вершины получает один треугольник (s,p1,p2)
    // другая сторона — четырёхугольник (p1,v1,v2,p2) → два треугольника
    const singleArr = singlePos ? A : B;
    const otherArr = singlePos ? B : A;
    push(singleArr, vs, p1, p2);
    push(otherArr, p1, v1, v2);
    push(otherArr, p1, v2, p2);
  }
  return { posA: new Float32Array(A), posB: new Float32Array(B) };
}
