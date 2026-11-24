/* История ДО — 3D. Всё зависит только от времени t: window.setT(t) рисует кадр (рендер кадр за кадром в render.cjs). */
(() => {
const W = 1080, H = 1920, T_END = 36.4;
const $ = (id) => document.getElementById(id);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ss = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * k * (k * (k * 6 - 15) + 10); };   // smootherstep
const lerp = (a, b, k) => a + (b - a) * k;
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

/* ---------- общая настройка ---------- */
function makeRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1); r.setSize(W, H, false);
  r.outputEncoding = THREE.sRGBEncoding; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.82;
  r.localClippingEnabled = true; r.setClearColor(0x000000, 0);
  return r;
}
// окружение для отражений: тёмная студия с тремя софтбоксами
function studioEnv(renderer) {
  const s = new THREE.Scene(); s.background = new THREE.Color(0x0b1311);
  const box = (w, h, x, y, z, c, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); if (ry) m.rotation.z = ry; s.add(m); };
  box(6, 3, 4, 5, 6, 0xfff1d6); box(3, 8, -7, 1, -2, 0x9fe0c8); box(8, 2, 0, -6, 4, 0x3a2a14); box(4, 4, 0, 8, -6, 0xffffff);
  const pm = new THREE.PMREMGenerator(renderer); const env = pm.fromScene(s, 0.04).texture; pm.dispose(); return env;
}
function lights(scene) {
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x1a1610, 0.6));
  const key = new THREE.DirectionalLight(0xffe6c2, 2.0); key.position.set(160, 220, 260); scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfe6d6, 0.8); rim.position.set(-260, 120, -220); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xd6b266, 0.45); fill.position.set(-120, -160, 200); scene.add(fill);
}
const boneMat = (env) => new THREE.MeshPhysicalMaterial({ color: 0xb99c72, roughness: 0.68, metalness: 0, clearcoat: 0.18, clearcoatRoughness: 0.7,
  envMap: env, envMapIntensity: 0.35, side: THREE.DoubleSide });
const steelMat = (env) => new THREE.MeshStandardMaterial({ color: 0xc9d1d4, roughness: 0.26, metalness: 0.95, envMap: env, envMapIntensity: 1.25 });
const regenMat = () => new THREE.MeshStandardMaterial({ color: 0x4fc39b, roughness: 0.45, metalness: 0, emissive: 0x1d6b50, emissiveIntensity: 0.7 });
// тонкие цилиндры-«колонны» регенерата (InstancedMesh, ось по Y)
function columns(n, r, mat) { const m = new THREE.InstancedMesh(new THREE.CylinderGeometry(r, r, 1, 6, 1), mat, n); m.frustumCulled = false; return m; }
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const qZ = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));

/* ---------- сцена A: нижняя челюсть (BodyParts3D, мм) ---------- */
const rA = makeRenderer($('cvA')), envA = studioEnv(rA);
const sceneA = new THREE.Scene(); lights(sceneA);
const camA = new THREE.PerspectiveCamera(30, W / H, 1, 3000);
const jaw = new THREE.Group(); sceneA.add(jaw);
const Z0 = 11;                      // плоскость распила: только тело челюсти (ветвь заканчивается около Z = 4–7)
const clip = new THREE.Plane(v3(0, -1, 0), 100);
let post, ant, fibersA, cutPts, fiberSrc = [], devPost, devAnt, barIn;

async function loadJaw() {
  const buf = await (await fetch('/assets/mandible.stl')).arrayBuffer(), dv = new DataView(buf);
  const n = dv.getUint32(80, true), raw = new Float32Array(n * 9);
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) { const v = dv.getFloat32(84 + i * 50 + 12 + k * 4, true); raw[i * 9 + k] = v; const a = k % 3; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
  const c = [0, 1, 2].map((a) => (mn[a] + mx[a]) / 2);
  // оси BodyParts3D → three: X = x, Y = z (вверх), Z = −y (вперёд, к камере)
  const key = new Map(), pos = [], idx = new Uint32Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    const x = raw[i * 3] - c[0], y = raw[i * 3 + 2] - c[2], z = -(raw[i * 3 + 1] - c[1]);
    const kk = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let id = key.get(kk); if (id === undefined) { id = pos.length / 3; key.set(kk, id); pos.push(x, y, z); } idx[i] = id;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals(); const nrm = g.getAttribute('normal').array;
  const A = { p: [], n: [] }, P = { p: [], n: [] };
  for (let t = 0; t < n; t++) {
    const ids = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]]; const cz = (pos[ids[0] * 3 + 2] + pos[ids[1] * 3 + 2] + pos[ids[2] * 3 + 2]) / 3;
    const cy = (pos[ids[0] * 3 + 1] + pos[ids[1] * 3 + 1] + pos[ids[2] * 3 + 1]) / 3;
    const dst = cz > Z0 && cy < 0 ? A : P; for (const id of ids) { dst.p.push(pos[id * 3], pos[id * 3 + 1], pos[id * 3 + 2]); dst.n.push(nrm[id * 3], nrm[id * 3 + 1], nrm[id * 3 + 2]); }
  }
  const mk = (o) => { const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(o.p, 3)); gg.setAttribute('normal', new THREE.Float32BufferAttribute(o.n, 3)); return gg; };
  const mat = boneMat(envA); mat.clippingPlanes = [clip];
  post = new THREE.Mesh(mk(P), mat); ant = new THREE.Group(); ant.add(new THREE.Mesh(mk(A), mat)); jaw.add(post, ant);
  // точки у линии распила (задний фрагмент) — основания колонн регенерата
  for (let i = 0; i < pos.length; i += 3) if (pos[i + 2] > Z0 - 1.6 && pos[i + 2] <= Z0 && pos[i + 1] < -5) fiberSrc.push([pos[i], pos[i + 1], pos[i + 2]]);
  const step = Math.max(1, Math.floor(fiberSrc.length / 320)); fiberSrc = fiberSrc.filter((_, i) => i % step === 0);
  fibersA = columns(fiberSrc.length, 0.45, regenMat()); jaw.add(fibersA);
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(fiberSrc.flat(), 3));
  cutPts = new THREE.Points(cg, new THREE.PointsMaterial({ color: 0xf0d48e, size: 2.2, sizeAttenuation: true, transparent: true, opacity: 0 })); jaw.add(cutPts);
  // наружный аппарат (как у McCarthy, 1992): спицы через кожу к стержню снаружи; левая сторона
  const st = steelMat(envA), pin = (from, to, grp) => { const d = to.clone().sub(from), m = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, d.length(), 12), st);
    m.position.copy(from).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(v3(0, 1, 0), d.normalize()); grp.add(m);
    const cl = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 6), st); cl.position.copy(to); grp.add(cl); };
  devPost = new THREE.Group(); devAnt = new THREE.Group(); jaw.add(devPost); ant.add(devAnt);
  const latX = (z, y) => { let m = 0; for (let i = 0; i < pos.length; i += 3) if (pos[i] < 0 && Math.abs(pos[i + 2] - z) < 1.5 && Math.abs(pos[i + 1] - y) < 2.5 && pos[i] < m) m = pos[i]; return m; };
  const P1 = [3, -19], P2 = [8, -21], A1 = [16, -24], A2 = [21, -26];
  const BX = Math.min(...[P1, P2, A1, A2].map(([z, y]) => latX(z, y))) - 30, BY = -22;
  for (const [[z, y], g] of [[P1, devPost], [P2, devPost], [A1, devAnt], [A2, devAnt]]) pin(v3(latX(z, y) + 5, y, z), v3(BX, BY, z), g);
  window.__BX = BX;
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 22, 16), st); tube.quaternion.copy(qZ); tube.position.set(BX, BY, 5); devPost.add(tube);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 5, 18), st); knob.quaternion.copy(qZ); knob.position.set(BX, BY, -8.5); devPost.add(knob);
  barIn = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 1, 12), st); barIn.quaternion.copy(qZ); devPost.add(barIn);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 12, 12), st); rod.quaternion.copy(qZ); rod.position.set(BX, BY, 20); devAnt.add(rod);
}
function setFibers(inst, src, d, axis) {          // колонны от основания до сдвинутого фрагмента
  for (let i = 0; i < src.length; i++) {
    const [x, y, z] = src[i];
    if (d < 0.05) { _m.makeScale(0, 0, 0); inst.setMatrixAt(i, _m); continue; }
    if (axis === 'z') { _p.set(x, y, z + d / 2); _q.copy(qZ); } else { _p.set(x, y - d / 2, z); _q.identity(); }
    _s.set(1, d, 1); _m.compose(_p, _q, _s); inst.setMatrixAt(i, _m);
  }
  inst.instanceMatrix.needsUpdate = true;
}

/* ---------- сцена B: аппарат Илизарова на длинной кости ---------- */
const rB = makeRenderer($('cvB')), envB = studioEnv(rB);
const sceneB = new THREE.Scene(); lights(sceneB);
const camB = new THREE.PerspectiveCamera(30, W / H, 1, 3000);
const rig = new THREE.Group(); sceneB.add(rig); rig.rotation.z = 0.1;
const topG = new THREE.Group(), botG = new THREE.Group(); rig.add(topG, botG);
let midRods = [], fibersB, fiberSrcB = [];
(function buildRing() {
  const prof = (sgn) => { const pts = []; for (let i = 0; i <= 40; i++) { const y = i / 40 * 160, k = Math.pow(y / 160, 5);
    pts.push(new THREE.Vector2(10.5 + 12 * k + 1.2 * Math.sin(y / 23), sgn * y)); } if (sgn < 0) pts.reverse(); return pts; };
  const bm = boneMat(envB), st = steelMat(envB);
  const top = new THREE.Mesh(new THREE.LatheGeometry(prof(1), 48), bm), bot = new THREE.Mesh(new THREE.LatheGeometry(prof(-1), 48), bm);
  topG.add(top); botG.add(bot);
  const ring = (y, g) => { const r = new THREE.Mesh(new THREE.TorusGeometry(66, 3.4, 18, 96), st); r.rotation.x = Math.PI / 2; r.position.y = y; g.add(r);
    for (const a of [0.42, -0.42]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 136, 8), st); w.rotation.z = Math.PI / 2; w.rotation.y = a;
      w.position.y = y + (a > 0 ? 1.2 : -1.2); g.add(w); } };
  ring(100, topG); ring(46, topG); ring(-46, botG); ring(-100, botG);
  for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2, x = Math.cos(a) * 66, z = Math.sin(a) * 66;
    const seg = (y0, y1, g) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, Math.abs(y1 - y0), 12), st); m.position.set(x, (y0 + y1) / 2, z); g.add(m); };
    seg(100, 46, topG); seg(-46, -100, botG);
    for (const [y, g] of [[100, topG], [46, topG], [-46, botG], [-100, botG]]) for (const s of [4.6, -4.6]) {
      const nut = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 3.6, 6), st); nut.position.set(x, y + s, z); g.add(nut); }
    const mr = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 1, 12), st); mr.userData = { x, z }; rig.add(mr); midRods.push(mr); }
  for (let i = 0; i < 140; i++) { const a = i * 2.399963, r = 9.6 * Math.sqrt((i + 0.5) / 140); fiberSrcB.push([Math.cos(a) * r, 0, Math.sin(a) * r]); }
  fibersB = columns(fiberSrcB.length, 0.42, regenMat()); rig.add(fibersB);
})();

/* ---------- субтитры: слова с таймингом, ошибки распознавания исправлены ---------- */
let groups = [];
async function loadWords() {
  const fix = { 'хирургийского': 'хирургического', 'аномалии': 'аномалий', 'Геннадием': 'Гавриилом', 'применен': 'применён' };
  const raw = (await (await fetch('/assets/words.json')).json()).filter((w) => w.s < 34);
  const words = [];
  for (const w of raw) { let t = w.w; for (const [a, b] of Object.entries(fix)) t = t.replace(a, b);
    if (t.startsWith('-') && words.length) { const p = words[words.length - 1]; p.w += t; p.e = w.e; } else words.push({ w: t, s: w.s, e: w.e }); }
  let g = [];
  words.forEach((w, i) => { g.push(w); const nx = words[i + 1];
    if (/[.,!?]$/.test(w.w) || g.length >= 4 || (nx && nx.s - w.e > 0.35) || !nx) { groups.push(g); g = []; } });
}
function setCaption(t) {
  const el = $('cap'); const g = groups.find((x, i) => t >= x[0].s - 0.05 && t < (groups[i + 1] ? Math.min(groups[i + 1][0].s - 0.05, x[x.length - 1].e + 0.7) : x[x.length - 1].e + 0.7));
  if (!g) { el.innerHTML = ''; return; }
  el.innerHTML = g.map((w) => `<span class="${t >= w.e ? 'on' : t >= w.s ? 'cur' : ''}">${w.w.replace(/[,.]$/, '')}</span>`).join('');
}

/* ---------- слои поверх 3D ---------- */
function show(id, a, b, dy = 30) {                          // появление снизу, исчезновение
  const k = Math.min(ss(a, a + 0.45, T), 1 - ss(b - 0.35, b, T)); const el = $(id);
  el.style.opacity = k.toFixed(3); el.style.transform = `translateY(${((1 - ss(a, a + 0.45, T)) * dy).toFixed(1)}px)`;
}
let T = 0;
function camKeys(keys, t) {                                // плавный проезд камеры между ключами
  let i = 0; while (i < keys.length - 1 && t >= keys[i + 1][0]) i++;
  const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)], k = b === a ? 0 : ss(a[0], b[0], t);
  return { pos: a[1].clone().lerp(b[1], k), look: a[2].clone().lerp(b[2], k) };
}
const keysA = [
  [4.2, v3(40, 30, 400), v3(0, -4, 0)], [13.9, v3(-10, 40, 360), v3(0, -4, 0)],
  [15.2, v3(-250, 30, 190), v3(-26, -18, 12)], [18.6, v3(-225, 22, 170), v3(-28, -20, 13)],
  [25.4, v3(-360, 60, 150), v3(-30, -14, 10)], [33.0, v3(-330, 50, 130), v3(-32, -16, 12)],
  [36.4, v3(-190, 110, 360), v3(-6, -6, 10)]];

window.setT = (t) => {
  T = t;
  // фото и имя
  const ph = 1 - ss(3.6, 4.5, t);
  $('doc').style.opacity = ph.toFixed(3);
  $('doc').style.transform = `translateY(${(lerp(40, 0, ss(0, 4, t)) - ss(3.6, 4.5, t) * 120).toFixed(1)}px) scale(${(1.0 + 0.05 * t / 4).toFixed(4)})`;
  show('name', 0.15, 3.85, 40);
  show('c1', 3.95, 5.75); show('c2', 5.8, 11.15); show('c3', 11.25, 13.85);
  show('t1', 13.95, 18.1); show('t2', 19.8, 25.4); show('t3', 27.4, 33.6); show('end', 33.8, 36.6, 40); show('credit', 33.8, 36.6, 0);
  // мм на распиле
  const dA = t < 25.4 ? 10 * ss(15.8, 18.2, t) : 4 + 10 * ss(27.0, 33.4, t);
  const mmOn = Math.max(Math.min(ss(15.6, 16.0, t), 1 - ss(17.9, 18.3, t)), Math.min(ss(26.8, 27.2, t), 1 - ss(33.2, 33.6, t)));
  $('mm').style.opacity = mmOn.toFixed(3); $('mm').querySelector('.v').textContent = dA.toFixed(1).replace('.', ',');
  setCaption(t);
  // сцена A
  const aOn = Math.max(Math.min(ss(4.1, 4.7, t), 1 - ss(17.9, 18.5, t)), ss(25.3, 25.9, t));
  $('cvA').style.opacity = aOn.toFixed(3);
  // проявление «сканом» снизу вверх
  const sc = ss(4.2, 6.4, t), clipY = lerp(-46, 46, sc); clip.constant = t < 25 ? clipY : 100;
  $('scan').style.opacity = (Math.min(ss(4.2, 4.5, t), 1 - ss(6.1, 6.5, t))).toFixed(3);
  if (post) {
    jaw.rotation.y = t < 14 ? lerp(-0.55, 0.65, ss(4.2, 13.9, t)) : t < 25 ? lerp(0.65, 0, ss(13.9, 15.2, t)) : 0;
    jaw.position.y = 0;
    ant.position.z = dA; setFibers(fibersA, fiberSrc, dA, 'z');
    cutPts.material.opacity = t < 25 ? Math.min(ss(14.9, 15.3, t), 1 - ss(16.2, 16.8, t)) * (0.7 + 0.3 * Math.sin(t * 14)) : 0;
    const dev = ss(25.9, 27.0, t); devPost.visible = devAnt.visible = t > 25.4;
    devPost.position.x = devAnt.position.x = lerp(-60, 0, dev);
    barIn.scale.y = Math.max(0.01, dA); barIn.position.set(window.__BX, -22, 16 - 2 + dA / 2 + 0);
    const c = camKeys(keysA, t); camA.position.copy(c.pos); camA.lookAt(c.look); camA.setViewOffset(W, H, 0, -150, W, H);
    // сканирующая линия на экране следует за плоскостью отсечения
    _p.set(0, clipY, 0).applyMatrix4(jaw.matrixWorld).project(camA); $('scan').style.transform = `translateY(${((1 - _p.y) / 2 * H - 2).toFixed(1)}px)`;
    if (aOn > 0.001) rA.render(sceneA, camA);
  }
  // сцена B
  const bOn = Math.min(ss(17.9, 18.6, t), 1 - ss(25.3, 25.9, t));
  $('cvB').style.opacity = bOn.toFixed(3);
  if (bOn > 0.001) {
    const dB = 18 * ss(18.8, 25.2, t);
    botG.position.y = -dB; setFibers(fibersB, fiberSrcB, dB, 'y');
    for (const m of midRods) { const len = 92 + dB; m.scale.y = len; m.position.set(m.userData.x, (46 + (-46 - dB)) / 2, m.userData.z); }
    const a = 0.35 + (t - 17.9) * 0.2, R = lerp(820, 720, ss(17.9, 25.9, t));
    camB.position.set(Math.sin(a) * R, 60 - (t - 18) * 3, Math.cos(a) * R); camB.lookAt(0, -dB / 2 - 10, 0); camB.setViewOffset(W, H, 0, -230, W, H);
    rB.render(sceneB, camB);
  }
};
window.ready = Promise.all([loadJaw(), loadWords(), document.fonts.ready]).then(() => { window.setT(0); return true; });
})();
