import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { splitByPlane } from './cut.js';
import { DEVICES, selectDevice, arcRadius } from './distractors.js';
import { buildDemo } from './demo.js';
import {
  centroid, bbox, triCount, breakContact, splitComponents,
  parseSTL, writeSTLBinary,
} from './geometry.js';

// ════════════════════════════════════════════════════════════════════════════
//  OSSA 4 — планнер остеотомии и дистракции нижней челюсти.
//  Логика: НЕ автосегментация. Хирург ведёт поток 1-2-3:
//   1) разорвать зубной/суставной контакт → связность отделяет НЧ;
//   2) остеотомия плоскостью в углу → проксимальный + дистальный фрагменты;
//   3) дистрактор заданного вектора двигает медиальный фрагмент (прямой / дуга).
// ════════════════════════════════════════════════════════════════════════════

const $ = (id) => document.getElementById(id);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const PALETTE = [0xdfe9f2, 0x7fd4c8, 0xffb86b, 0x8ea2ff, 0xff8fae, 0x9be36b, 0xd3a6ff, 0x6bd0ff];

// ── сцена ────────────────────────────────────────────────────────────────────
let scene, camera, renderer, orbit, gizmo, raycaster, canvas;
let modelRadius = 100;
const frags = [];            // { id,name,color,soup,geom,mesh,group,visible,kind }
let selId = null;
let nextId = 1;
let mode = null;             // null | 'break' | 'osteo' | 'measure' | 'distDir'
const undoStack = [];

// ── плоскость остеотомии ──────────────────────────────────────────────────────
let cutPlane = null;         // { group, mesh, normalLocal }
// ── дистракция ────────────────────────────────────────────────────────────────
let plan = null;             // { mobileId, fixedId, origin:V3, dir:V3(unit), deg, length }
// ── измерения ────────────────────────────────────────────────────────────────
let measurePts = [], measureGroup;

function init() {
  canvas = $('cv');
  scene = new THREE.Scene();
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  camera = new THREE.PerspectiveCamera(42, 1, 0.5, 6000);
  camera.position.set(0, 40, 260);

  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x1a222a, 1.05));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(120, 180, 220); scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fc4ff, 0.6); fill.position.set(-160, 40, -120); scene.add(fill);
  const rim = new THREE.DirectionalLight(0x66f0e0, 0.5); rim.position.set(0, -160, -40); scene.add(rim);

  const grid = new THREE.GridHelper(1200, 48, 0x1f4a52, 0x12343b);
  grid.position.y = -140; grid.material.transparent = true; grid.material.opacity = 0.5; scene.add(grid);

  orbit = new OrbitControls(camera, canvas);
  orbit.enableDamping = true; orbit.dampingFactor = 0.08;

  gizmo = new TransformControls(camera, canvas);
  gizmo.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });
  gizmo.addEventListener('objectChange', onGizmoChange);
  const gz = gizmo.getHelper ? gizmo.getHelper() : gizmo;   // three r160+: getHelper()
  scene.add(gz);

  raycaster = new THREE.Raycaster();
  measureGroup = new THREE.Group(); scene.add(measureGroup);

  window.addEventListener('resize', resize);
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('keydown', onKey);
  resize();
  animate();
  wireUI();
  // стартовая подсказка
  status('Загрузите STL / DICOM или нажмите «Демо-модель».');
  // доступ для автотестов
  window.OSSA = {
    frags, loadDemo, separateMandible, doOsteotomy, exportSTL,
    breakAt(p, r = 4) { const f = getFrag(selId) || frags[0]; if (!f) return 0; pushUndo(); const res = breakContact(f.soup, new THREE.Vector3(p.x, p.y, p.z), r); rebuildFrag(f, res.soup); return res.removed; },
    placePlane(p, nrm) { placeCutPlaneAt(new THREE.Vector3(p.x, p.y, p.z), null, getFrag(selId) || frags[0]); if (nrm) cutPlane.group.lookAt(cutPlane.group.position.clone().add(new THREE.Vector3(nrm.x, nrm.y, nrm.z))); },
    distract(mm) { if (!plan) return; plan.length = Math.max(plan.length, mm, 1); $('distAmt').value = mm; $('distAmtV').textContent = mm.toFixed(1) + ' мм'; applyDistraction(); },
    mobilePos() { const f = plan && getFrag(plan.mobileId); return f ? f.group.position.toArray() : null; },
    state: () => ({ nFrags: frags.length, names: frags.map(f => f.name), tri: frags.map(f => triCount(f.soup)), plan: plan ? { mobile: getFrag(plan.mobileId)?.name, dir: plan.dir.toArray(), length: plan.length } : null }),
  };
}

function resize() {
  const w = canvas.clientWidth || canvas.parentElement.clientWidth, h = canvas.clientHeight || canvas.parentElement.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
function animate() { requestAnimationFrame(animate); orbit.update(); renderer.render(scene, camera); }
function status(t) { const s = $('status'); if (s) s.textContent = t || ''; }

// ── фрагменты ─────────────────────────────────────────────────────────────────
function makeGeom(soup) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(soup, 3));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}
function addFragment(soup, name, kind = 'bone', color) {
  const id = nextId++;
  const col = color != null ? color : PALETTE[(frags.length) % PALETTE.length];
  const geom = makeGeom(soup);
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide, flatShading: false });
  const mesh = new THREE.Mesh(geom, mat); mesh.renderOrder = 1;
  const group = new THREE.Group(); group.add(mesh);
  scene.add(group);
  const frag = { id, name, color: col, soup, geom, mesh, group, visible: true, kind };
  mesh.userData.fragId = id;
  frags.push(frag);
  refreshList();
  return frag;
}
function getFrag(id) { return frags.find(f => f.id === id); }
function removeFragment(id) {
  const i = frags.findIndex(f => f.id === id); if (i < 0) return;
  const f = frags[i]; if (gizmo.object === f.group) gizmo.detach();
  scene.remove(f.group); f.geom.dispose(); f.mesh.material.dispose();
  frags.splice(i, 1); if (selId === id) selId = null; refreshList();
}
function rebuildFrag(frag, soup) {
  frag.soup = soup; frag.geom.dispose();
  frag.geom = makeGeom(soup); frag.mesh.geometry = frag.geom;
}
function selectFragment(id, attach = true) {
  selId = id; refreshList();
  const f = getFrag(id);
  if (f && attach) { gizmo.attach(f.group); }
  else gizmo.detach();
  const sel = getFrag(id);
  if (sel) status(`Выбран: ${sel.name} · ${triCount(sel.soup).toLocaleString('ru')} треуг.`);
}

// запекание трансформы группы в координаты (для экспорта / последующих операций)
function bakedSoup(frag) {
  frag.group.updateMatrixWorld(true);
  const m = frag.group.matrixWorld, s = frag.soup, out = new Float32Array(s.length);
  const v = new THREE.Vector3();
  for (let i = 0; i < s.length; i += 3) { v.set(s[i], s[i + 1], s[i + 2]).applyMatrix4(m); out[i] = v.x; out[i + 1] = v.y; out[i + 2] = v.z; }
  return out;
}

// ── загрузка ──────────────────────────────────────────────────────────────────
function loadDemo() {
  clearAll();
  const { soup } = buildDemo();
  const f = addFragment(soup, 'Череп + НЧ (демо)', 'bone', 0xe6eef6);
  frameAll(); selectFragment(f.id);
  status('Демо загружено. Шаг 1: «Разорвать контакт» — кликай по зубным контактам, затем «Отделить НЧ».');
}
async function loadSTLFiles(fileList) {
  const files = Array.from(fileList); if (!files.length) return;
  for (const file of files) {
    try {
      const soup = parseSTL(await file.arrayBuffer());
      if (soup.length < 9) { alert('Не удалось прочитать STL: ' + file.name); continue; }
      const f = addFragment(soup, file.name.replace(/\.stl$/i, ''), 'bone');
      selectFragment(f.id);
    } catch (e) { alert('Ошибка STL: ' + e.message); }
  }
  frameAll();
}
async function loadDICOM(fileList) {
  status('Чтение DICOM…');
  try {
    const { buildVolume } = await import('./dicom.js');
    const { extractSurface } = await import('./mc.js');
    const vol = await buildVolume(Array.from(fileList), () => { });
    const thr = +($('thr')?.value || 300);
    const surf = extractSurface(vol, thr, 220);
    // индексированный меш → «суп»
    const soup = new Float32Array(surf.triCount * 9);
    const { positions, indices } = surf; let o = 0;
    for (let t = 0; t < indices.length; t += 3)
      for (let k = 0; k < 3; k++) { const vi = indices[t + k] * 3; soup[o++] = positions[vi]; soup[o++] = positions[vi + 1]; soup[o++] = positions[vi + 2]; }
    clearAll();
    const f = addFragment(soup, 'Кость (КТ)', 'bone', 0xe6eef6);
    frameAll(); selectFragment(f.id);
    status(`Кость построена (порог ${thr} HU). Шаг 1: разорвать контакты и «Отделить НЧ».`);
  } catch (e) { console.error(e); alert('DICOM: ' + e.message); status('Ошибка DICOM.'); }
}
function clearAll() {
  [...frags].forEach(f => removeFragment(f.id));
  clearCutPlane(); plan = null; clearMeasure(); updatePlanPanel();
}

function frameAll() {
  if (!frags.length) return;
  const box = new THREE.Box3();
  frags.forEach(f => { f.geom.computeBoundingBox(); box.union(f.geom.boundingBox.clone().applyMatrix4(f.group.matrixWorld)); });
  const c = box.getCenter(V3()), size = box.getSize(V3());
  modelRadius = Math.max(size.x, size.y, size.z) * 0.5 || 100;
  orbit.target.copy(c);
  camera.position.copy(c).add(V3(0, size.y * 0.25, modelRadius * 3.1));
  camera.near = modelRadius / 100; camera.far = modelRadius * 60; camera.updateProjectionMatrix();
}

// ── список объектов ────────────────────────────────────────────────────────────
function refreshList() {
  const box = $('objList'); if (!box) return;
  if (!frags.length) { box.innerHTML = '<div class="hint">Нет объектов. Загрузите модель.</div>'; return; }
  box.innerHTML = '';
  for (const f of frags) {
    const row = document.createElement('div');
    row.className = 'obj' + (f.id === selId ? ' sel' : '');
    row.innerHTML =
      `<span class="eye">${f.visible ? '👁' : '◻'}</span>` +
      `<span class="dot" style="background:#${f.color.toString(16).padStart(6, '0')}"></span>` +
      `<span class="nm">${f.name}</span>` +
      `<span class="del">✕</span>`;
    row.querySelector('.eye').onclick = (e) => { e.stopPropagation(); f.visible = !f.visible; f.group.visible = f.visible; refreshList(); };
    row.querySelector('.nm').onclick = () => selectFragment(f.id);
    row.querySelector('.nm').ondblclick = () => { const n = prompt('Имя объекта:', f.name); if (n) { f.name = n; refreshList(); } };
    row.querySelector('.del').onclick = (e) => { e.stopPropagation(); if (confirm('Удалить «' + f.name + '»?')) { pushUndo(); removeFragment(f.id); } };
    box.appendChild(row);
  }
}

// ── пикинг ──────────────────────────────────────────────────────────────────────
function pickAt(ev) {
  const r = canvas.getBoundingClientRect();
  const m = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(m, camera);
  const meshes = frags.filter(f => f.visible).map(f => f.mesh);
  const hits = raycaster.intersectObjects(meshes, false);
  return hits.length ? hits[0] : null;
}
function onPointerDown(ev) {
  if (ev.button !== 0 || !mode) return;
  if (gizmo.dragging) return;
  const hit = pickAt(ev);
  if (mode === 'break') {
    if (!hit) return;
    const frag = getFrag(hit.object.userData.fragId); if (!frag) return;
    pushUndo();
    const local = frag.group.worldToLocal(hit.point.clone());
    const r = +($('breakR').value);
    const res = breakContact(frag.soup, local, r);
    rebuildFrag(frag, res.soup);
    status(`Контакт разорван: удалено ${res.removed} треуг. (⌀ ${r} мм). Разорви остальные контакты, затем «Отделить НЧ».`);
  } else if (mode === 'measure') {
    if (!hit) return;
    measurePts.push(hit.point.clone());
    addMeasureDot(hit.point);
    if (measurePts.length === 2) {
      const d = measurePts[0].distanceTo(measurePts[1]);
      addMeasureLine(measurePts[0], measurePts[1]);
      $('measVal').textContent = d.toFixed(1) + ' мм'; $('measVal').style.display = 'inline-block';
      status('Длина: ' + d.toFixed(1) + ' мм. Кликни ещё 2 точки для нового замера.');
      measurePts = [];
    }
  } else if (mode === 'osteo') {
    if (!hit) return;
    placeCutPlaneAt(hit.point, hit.face, getFrag(hit.object.userData.fragId));
    setMode(null); $('osteoPlaceBtn').classList.remove('armed');
  } else if (mode === 'distDir') {
    if (!hit || !plan) return;
    plan.dir = hit.point.clone().sub(plan.origin).normalize();
    setMode(null); $('distPickBtn').classList.remove('armed');
    updatePlanPanel(); applyDistraction();
    status('Вектор дистракции задан по точке.');
  }
}

// ── ШАГ 1: отделение НЧ ───────────────────────────────────────────────────────
function separateMandible() {
  const f = getFrag(selId) || frags[0];
  if (!f) { alert('Нет объекта для разделения.'); return; }
  pushUndo();
  const comps = splitComponents(f.soup, 0.02);
  if (comps.length < 2) {
    status('Пока одна связная деталь — сначала «Разорвать контакт» на зубах/суставе, потом «Отделить НЧ».');
    alert('Модель всё ещё единая. Сначала разорвите контакты (зубы, при необходимости — сустав), затем повторите «Отделить НЧ».');
    return;
  }
  const baseName = f.name; const col0 = f.color;
  removeFragment(f.id);
  // крупнейшие две: нижняя по Y — челюсть
  const infos = comps.map(s => ({ s, c: centroid(s), b: bbox(s), n: triCount(s) }));
  infos.sort((a, b) => b.n - a.n);
  const created = [];
  if (infos.length === 2) {
    const lower = infos[0].c.y < infos[1].c.y ? 0 : 1;
    const mand = addFragment(infos[lower].s, 'Нижняя челюсть', 'mandible', 0xffb86b);
    const skull = addFragment(infos[1 - lower].s, 'Череп (неподвижно)', 'skull', 0xdfe9f2);
    created.push(mand, skull);
    selectFragment(mand.id);
  } else {
    infos.forEach((it, i) => created.push(addFragment(it.s, `${baseName} — фрагмент ${i + 1}`, 'bone')));
    selectFragment(created[0].id);
  }
  status(`Отделено компонентов: ${created.length}. Нижняя челюсть — оранжевая, подвижна. Шаг 2: остеотомия.`);
}

// ── ШАГ 2: остеотомия плоскостью ──────────────────────────────────────────────
function clearCutPlane() { if (cutPlane) { scene.remove(cutPlane.group); cutPlane = null; } }
function placeCutPlaneAt(point, face, frag) {
  clearCutPlane();
  const size = modelRadius * 1.4;
  const geo = new THREE.PlaneGeometry(size, size);
  const mat = new THREE.MeshBasicMaterial({ color: 0x33ecdd, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x33ecdd }));
  mesh.add(edge);
  const group = new THREE.Group(); group.add(mesh);
  group.position.copy(point);
  // ориентируем плоскость вертикально-косо (типичный угловой распил): нормаль ~ горизонтальная
  group.lookAt(point.clone().add(V3(1, 0, 0.3)));
  scene.add(group);
  cutPlane = { group, mesh, frag };
  gizmo.attach(group); gizmo.setMode('rotate');
  $('cutMoveBtn').classList.remove('armed'); $('cutRotBtn').classList.add('armed');
  status('Плоскость поставлена. Двигай/вращай её по углу НЧ, затем «Распилить».');
  updateOsteoInfo();
}
function planeNormalWorld() {
  if (!cutPlane) return null;
  return V3(0, 0, 1).applyQuaternion(cutPlane.group.quaternion).normalize();
}
function doOsteotomy() {
  if (!cutPlane) { alert('Сначала поставь плоскость распила (кнопка «Поставить плоскость», затем клик по кости).'); return; }
  const frag = cutPlane.frag && getFrag(cutPlane.frag.id) ? cutPlane.frag : (getFrag(selId) || frags[0]);
  if (!frag) return;
  pushUndo();
  const n = planeNormalWorld();
  const p = cutPlane.group.position.clone();
  // переводим плоскость в локальные координаты фрагмента
  frag.group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(frag.group.matrixWorld).invert();
  const pLoc = p.clone().applyMatrix4(inv);
  const nLoc = n.clone().transformDirection(inv).normalize();
  const { posA, posB } = splitByPlane(frag.soup, frag.indices || null, nLoc, pLoc);
  if (posA.length < 9 || posB.length < 9) { alert('Плоскость не пересекает кость — подвинь её на угол НЧ.'); return; }
  const name = frag.name;
  const baseQuat = frag.group.quaternion.clone(), basePos = frag.group.position.clone();
  removeFragment(frag.id);
  const cA = centroid(posA), cB = centroid(posB);
  // дистальный (тело/подбородок) — передний (больший Z) и/или нижний; проксимальный — с мыщелком (выше)
  const aIsProximal = cA.y > cB.y;
  const prox = addFragment(aIsProximal ? posA : posB, name + ' — проксимальный (ветвь)', 'bone', 0xbfe3ff);
  const dist = addFragment(aIsProximal ? posB : posA, name + ' — дистальный (тело)', 'mandible', 0xffb86b);
  [prox, dist].forEach(fr => { fr.group.position.copy(basePos); fr.group.quaternion.copy(baseQuat); });
  clearCutPlane(); gizmo.detach();
  // план дистракции: ось = нормаль, origin = середина распила, направление от проксимального к дистальному
  const origin = new THREE.Vector3((cA.x + cB.x) / 2, (cA.y + cB.y) / 2, (cA.z + cB.z) / 2).applyMatrix4(frag.group.matrixWorld);
  let dir = n.clone(); const toDist = centroid(dist.soup); const pc = centroid(prox.soup);
  if (dir.dot(V3(toDist.x - pc.x, toDist.y - pc.y, toDist.z - pc.z)) < 0) dir.negate();
  plan = { mobileId: dist.id, fixedId: prox.id, origin, dir: dir.normalize(), deg: 180, length: 0 };
  selectFragment(dist.id, false);
  updatePlanPanel();
  status('Остеотомия выполнена. Шаг 3: задай вектор и длину дистракции, двигай ползунок.');
}

// ── ШАГ 3: дистрактор ──────────────────────────────────────────────────────────
function setDistraction(lengthMm) {
  if (!plan) return;
  plan.length = lengthMm;
  applyDistraction();
}
function applyDistraction() {
  if (!plan) return;
  const f = getFrag(plan.mobileId); if (!f) return;
  const slider = +($('distAmt').value);
  const s = slider;                             // текущая длина (мм) = значение ползунка
  const deg = plan.deg;
  const rotFull = (180 - deg) * Math.PI / 180;  // поворот регенерата при полной дистракции
  const Lmax = Math.max(plan.length, 0.0001);
  const dir = plan.dir.clone().normalize();
  if (rotFull < 1e-3 || Lmax < 1e-3) {
    f.group.position.copy(dir.multiplyScalar(s));
    f.group.quaternion.identity();
  } else {
    const theta = rotFull * (s / Lmax);
    const R = Lmax / rotFull;
    // ось дуги — медиолатеральная, перпендикулярна вектору и вертикали
    const axis = new THREE.Vector3().crossVectors(dir, V3(0, 1, 0)).normalize();
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    const w = new THREE.Vector3().crossVectors(axis, dir).normalize();
    const P0 = plan.origin.clone();
    const C = P0.clone().sub(w.multiplyScalar(R));
    const qr = new THREE.Quaternion().setFromAxisAngle(axis, theta);
    const t = C.clone().sub(C.clone().applyQuaternion(qr));
    f.group.position.copy(t); f.group.quaternion.copy(qr);
  }
  drawDistractorViz(s);
  updatePlanReadout(s);
}
function updatePlanReadout(s) {
  const el = $('distReadout'); if (!el || !plan) return;
  const deg = plan.deg; const rot = (180 - deg) * (s / Math.max(plan.length, 0.0001));
  el.innerHTML = `Длина регенерата: <b>${s.toFixed(1)} мм</b>` + (deg < 180 ? ` · поворот: <b>${rot.toFixed(0)}°</b> · ${DEVICES.find(d => d.deg === deg)?.name || ''}` : ' · прямой КДА-180');
}
let vizGroup;
function drawDistractorViz(s) {
  if (vizGroup) { scene.remove(vizGroup); vizGroup = null; }
  if (!plan || s <= 0.01) return;
  vizGroup = new THREE.Group();
  const f = getFrag(plan.mobileId); if (!f) return;
  const p0 = plan.origin.clone();
  f.group.updateMatrixWorld(true);
  const p1 = plan.origin.clone().applyMatrix4(new THREE.Matrix4().copy(f.group.matrixWorld)); // точка остеотомии, уехавшая с фрагментом
  // «штанга» дистрактора
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p0, p1]), new THREE.LineBasicMaterial({ color: 0x33ecdd }));
  // регенерат — полупрозрачный цилиндр между старым и новым положением остеотомии
  const dirv = p1.clone().sub(p0); const len = dirv.length();
  if (len > 0.1) {
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, len, 16),
      new THREE.MeshStandardMaterial({ color: 0x9be36b, transparent: true, opacity: 0.45, roughness: 0.8 }));
    cyl.position.copy(p0.clone().add(p1).multiplyScalar(0.5));
    cyl.quaternion.setFromUnitVectors(V3(0, 1, 0), dirv.clone().normalize());
    vizGroup.add(cyl);
  }
  vizGroup.add(line);
  scene.add(vizGroup);
}
function updatePlanPanel() {
  const box = $('mobileName');
  if (box) box.textContent = plan ? (getFrag(plan.mobileId)?.name || '—') : 'нет остеотомии';
  const dd = $('distDirTxt');
  if (dd) dd.textContent = plan ? `(${plan.dir.x.toFixed(2)}, ${plan.dir.y.toFixed(2)}, ${plan.dir.z.toFixed(2)})` : '—';
  updateOsteoInfo();
}
function updateOsteoInfo() {
  const el = $('osteoInfo'); if (!el) return;
  el.textContent = cutPlane ? 'Плоскость активна — вращай/двигай по углу НЧ, затем «Распилить».' : 'Нажми «Поставить плоскость» и кликни по углу нижней челюсти.';
}

// ── измерения ─────────────────────────────────────────────────────────────────
function addMeasureDot(p) { const m = new THREE.Mesh(new THREE.SphereGeometry(modelRadius * 0.012, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffc24d })); m.position.copy(p); measureGroup.add(m); }
function addMeasureLine(a, b) { measureGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xffc24d }))); }
function clearMeasure() { measurePts = []; [...measureGroup.children].forEach(c => measureGroup.remove(c)); const mv = $('measVal'); if (mv) mv.style.display = 'none'; }

// ── gizmo / направленное движение ────────────────────────────────────────────────
function onGizmoChange() {
  // если двигаем мобильный фрагмент вручную при активном плане — проекция на вектор (рельс)
  if ($('railChk')?.checked && plan && gizmo.object === getFrag(plan.mobileId)?.group) {
    const f = getFrag(plan.mobileId);
    const along = f.group.position.clone().dot(plan.dir);
    f.group.position.copy(plan.dir.clone().multiplyScalar(Math.max(0, along)));
    const s = Math.max(0, along);
    $('distAmt').value = Math.min(s, +$('distAmt').max); $('distAmtV').textContent = s.toFixed(1) + ' мм';
    drawDistractorViz(s); updatePlanReadout(s);
  }
}

// ── экспорт / проект ─────────────────────────────────────────────────────────────
function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
function exportSTL(which = 'all') {
  if (!frags.length) { alert('Нет объектов.'); return; }
  const list = which === 'sel' && getFrag(selId) ? [getFrag(selId)] : frags.filter(f => f.visible);
  const merged = []; let total = 0;
  const parts = list.map(f => bakedSoup(f)); parts.forEach(p => total += p.length);
  const soup = new Float32Array(total); let o = 0; parts.forEach(p => { soup.set(p, o); o += p.length; });
  download((which === 'sel' ? (getFrag(selId)?.name || 'object') : 'ossa_plan') + '.stl', new Blob([writeSTLBinary(soup)], { type: 'model/stl' }));
  status('STL сохранён (' + list.length + ' объектов).');
}
function saveProject() {
  const data = {
    app: 'OSSA', version: 4, patient: $('patName')?.value || '',
    frags: frags.map(f => ({ name: f.name, color: f.color, kind: f.kind, visible: f.visible, pos: f.group.position.toArray(), quat: f.group.quaternion.toArray(), soup: Array.from(f.soup) })),
    plan: plan ? { mobileId: plan.mobileId, fixedId: plan.fixedId, origin: plan.origin.toArray(), dir: plan.dir.toArray(), deg: plan.deg, length: plan.length } : null,
  };
  download((data.patient || 'plan') + '.ossa', new Blob([JSON.stringify(data)], { type: 'application/json' }));
  status('Проект сохранён (.ossa).');
}
async function openProject(file) {
  try {
    const data = JSON.parse(await file.text());
    clearAll();
    const idmap = {};
    for (const fd of data.frags) {
      const f = addFragment(new Float32Array(fd.soup), fd.name, fd.kind, fd.color);
      f.group.position.fromArray(fd.pos); f.group.quaternion.fromArray(fd.quat);
      f.visible = fd.visible !== false; f.group.visible = f.visible;
      idmap[fd.name] = f.id;
    }
    if (data.plan) {
      // восстановление плана по порядку (mobile/fixed — новые id по индексу)
      plan = { mobileId: frags[0]?.id, fixedId: frags[1]?.id, origin: new THREE.Vector3().fromArray(data.plan.origin), dir: new THREE.Vector3().fromArray(data.plan.dir), deg: data.plan.deg, length: data.plan.length };
    }
    if (data.patient && $('patName')) $('patName').value = data.patient;
    frameAll(); refreshList(); updatePlanPanel();
    status('Проект загружен.');
  } catch (e) { alert('Не удалось открыть проект: ' + e.message); }
}

// ── undo ──────────────────────────────────────────────────────────────────────
function pushUndo() {
  const snap = frags.map(f => ({ name: f.name, color: f.color, kind: f.kind, visible: f.visible, pos: f.group.position.toArray(), quat: f.group.quaternion.toArray(), soup: f.soup.slice() }));
  undoStack.push(snap); if (undoStack.length > 12) undoStack.shift();
}
function undo() {
  const snap = undoStack.pop(); if (!snap) { status('Отменять нечего.'); return; }
  [...frags].forEach(f => removeFragment(f.id));
  plan = null; clearCutPlane(); gizmo.detach();
  snap.forEach(s => { const f = addFragment(s.soup, s.name, s.kind, s.color); f.group.position.fromArray(s.pos); f.group.quaternion.fromArray(s.quat); f.visible = s.visible; f.group.visible = s.visible; });
  updatePlanPanel(); status('Отменено.');
}

// ── режимы / горячие клавиши ──────────────────────────────────────────────────
function setMode(m) {
  mode = m;
  canvas.style.cursor = m ? 'crosshair' : '';
  orbit.enabled = true;
}
function onKey(e) {
  if (e.target.tagName === 'INPUT') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if (e.key === 'Delete' && selId != null) { pushUndo(); removeFragment(selId); }
  else if (e.key === 'Escape') { setMode(null); document.querySelectorAll('.armed').forEach(b => b.classList.remove('armed')); }
  else if (e.key === 'g') gizmo.setMode('translate');
  else if (e.key === 'r') gizmo.setMode('rotate');
}

// ── UI ──────────────────────────────────────────────────────────────────────────
function arm(btn, m) {
  const on = btn.classList.toggle('armed');
  document.querySelectorAll('.step .armed').forEach(b => { if (b !== btn) b.classList.remove('armed'); });
  setMode(on ? m : null);
}
function wireUI() {
  $('loadSTLbtn').onclick = () => $('stlInput').click();
  $('stlInput').onchange = (e) => loadSTLFiles(e.target.files);
  $('loadDicomBtn').onclick = () => $('dcmInput').click();
  $('dcmInput').onchange = (e) => loadDICOM(e.target.files);
  $('demoBtn').onclick = loadDemo;

  // шаг 1
  $('breakBtn').onclick = () => arm($('breakBtn'), 'break');
  $('breakR').oninput = () => { $('breakRv').textContent = $('breakR').value + ' мм'; };
  $('sepBtn').onclick = separateMandible;

  // шаг 2
  $('osteoPlaceBtn').onclick = () => arm($('osteoPlaceBtn'), 'osteo');
  $('cutMoveBtn').onclick = () => { if (cutPlane) { gizmo.setMode('translate'); gizmo.attach(cutPlane.group); $('cutMoveBtn').classList.add('armed'); $('cutRotBtn').classList.remove('armed'); } };
  $('cutRotBtn').onclick = () => { if (cutPlane) { gizmo.setMode('rotate'); gizmo.attach(cutPlane.group); $('cutRotBtn').classList.add('armed'); $('cutMoveBtn').classList.remove('armed'); } };
  $('cutDoBtn').onclick = doOsteotomy;

  // шаг 3
  $('distDirSel').onchange = () => applyDistractionDirPreset();
  $('distPickBtn').onclick = () => arm($('distPickBtn'), 'distDir');
  $('distDev').innerHTML = DEVICES.map(d => `<option value="${d.deg}">${d.name}${d.deg === 180 ? ' (прямой)' : ' (дуга ' + (180 - d.deg) + '°)'}</option>`).join('');
  $('distDev').value = 180;
  $('distDev').onchange = () => { if (plan) { plan.deg = +$('distDev').value; applyDistraction(); updatePlanReadout(+$('distAmt').value); } };
  $('distAmt').oninput = () => { $('distAmtV').textContent = (+$('distAmt').value).toFixed(1) + ' мм'; if (plan) { plan.length = Math.max(plan.length, +$('distAmt').value, 1); applyDistraction(); } };
  $('distPlay').onclick = playDistraction;
  $('railChk').onchange = () => { const f = plan && getFrag(plan.mobileId); if (f && $('railChk').checked) { gizmo.setMode('translate'); gizmo.attach(f.group); } };

  // гизмо/объекты
  $('gzMove').onclick = () => { gizmo.setMode('translate'); const f = getFrag(selId); if (f) gizmo.attach(f.group); };
  $('gzRot').onclick = () => { gizmo.setMode('rotate'); const f = getFrag(selId); if (f) gizmo.attach(f.group); };

  // измерения/экспорт
  $('measBtn').onclick = () => arm($('measBtn'), 'measure');
  $('measClr').onclick = clearMeasure;
  $('expSelBtn').onclick = () => exportSTL('sel');
  $('expAllBtn').onclick = () => exportSTL('all');
  $('saveBtn').onclick = saveProject;
  $('openBtn').onclick = () => $('projInput').click();
  $('projInput').onchange = (e) => e.target.files[0] && openProject(e.target.files[0]);
  $('undoBtn').onclick = undo;

  // шаги-аккордеон
  document.querySelectorAll('.step-head').forEach(h => h.onclick = () => h.parentElement.classList.toggle('open'));
  document.querySelector('.step')?.classList.add('open');

  // drag&drop
  canvas.addEventListener('dragover', e => e.preventDefault());
  canvas.addEventListener('drop', e => {
    e.preventDefault(); const fs = [...e.dataTransfer.files];
    if (fs.some(f => /\.stl$/i.test(f.name))) loadSTLFiles(fs.filter(f => /\.stl$/i.test(f.name)));
    else if (fs.length) loadDICOM(fs);
  });
}
function applyDistractionDirPreset() {
  if (!plan) return;
  const v = $('distDirSel').value;
  if (v === 'cut') { /* оставить как есть (нормаль распила) */ }
  else if (v === 'fwd') plan.dir = V3(0, -0.3, 1).normalize();   // вперёд-вниз (сагиттально)
  else if (v === 'down') plan.dir = V3(0, -1, 0);                // вертикально (удлинение ветви)
  else if (v === 'fwddown') plan.dir = V3(0, -0.7, 0.7).normalize();
  updatePlanPanel(); applyDistraction();
}
function playDistraction() {
  if (!plan || plan.length < 0.5) { status('Задай длину дистракции (ползунок).'); return; }
  const L = plan.length; const dur = 2600; const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur); const s = L * k;
    $('distAmt').value = s; $('distAmtV').textContent = s.toFixed(1) + ' мм';
    applyDistraction();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

init();
