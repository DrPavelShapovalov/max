import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { jsPDF } from 'jspdf';
import { splitByPlane } from './cut.js';
import { DEVICES, selectDevice, autoDevice, arcRadius } from './distractors.js';
import { buildDemo, buildDemoVolume } from './demo.js';
import { MPR } from './mpr.js';
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
const measurements = [];     // [{ a:[x,y,z], b:[x,y,z], mm }]
// ── MPR (срезы КТ) ─────────────────────────────────────────────────────────────
let volume = null, mpr = null, mprOn = false;
let dicomGroups = null, dicomSeries = null, curSeries = 0;
let mprMode = null;                 // null | 'len' | 'ang' | 'plane' | 'vec' — режим клика по срезу
let mprPending = null;              // { plane, type, pts:[{i,j}] } — для измерений
let vecPending = [];               // мировые точки для вектора «со среза»
const mprMeas = [];                 // [{ plane, slice, type, pts:[{i,j}], value }]

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
  for (const key of ['axial', 'coronal', 'sagittal']) {
    const el = document.getElementById(MPR_CANVAS[key]); if (el) el.addEventListener('pointerdown', (e) => onMPRClick(key, e));
  }
  wireMPRMouse();
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
    toggleMPR: (on) => toggleMPR(on),
    autoPick(ang) { if (plan) { $('corrAngle').value = ang; autoPickDevice(); } return plan ? plan.deg : null; },
    exportPDF: () => exportPDF(),
    mprInfo: () => mpr ? { on: mprOn, dims: volume.dims, ix: mpr.ix, iy: mpr.iy, iz: mpr.iz } : null,
    series: () => dicomSeries,
    selectSeries: (i) => buildFromSeries(i),
    // имитировать измерение на срезе: клики по воксельным точкам
    mprMeasure(plane, type, voxPts) {
      if (!mpr) return null; const info = mpr.planeInfo(plane);
      const pts = voxPts.map(p => ({ i: p.i, j: p.j }));
      const val = type === 'len' ? sliceLen(info, pts) : sliceAng(info, pts);
      mprMeas.push({ plane, slice: info.idx, type, pts, value: val }); if (mprOn) renderMPR(); return val;
    },
    overlays: () => ({ hasPlaneTrace: !!cutPlane, hasVector: !!plan, mprMeas: mprMeas.length }),
    sliceToWorld: (plane, i, j) => volume ? sliceVoxToWorld(plane, i, j).toArray() : null,
    placeFromSlice(plane, i, j) { placeCutPlaneAt(sliceVoxToWorld(plane, i, j), null, getFrag(selId) || frags[0]); return cutPlane ? cutPlane.group.position.toArray() : null; },
    vecFromSlice(plane, a, b) { if (!plan) return null; const w1 = sliceVoxToWorld(plane, a.i, a.j), w2 = sliceVoxToWorld(plane, b.i, b.j); plan.dir = w2.clone().sub(w1).normalize(); applyDistraction(); return plan.dir.toArray(); },
    voxelVal(vx, vy, vz) { if (!volume) return null; const [nx, ny] = volume.dims; return volume.data[vz * nx * ny + vy * nx + vx]; },
    scrollSlice(plane, d) { if (!mpr) return; const p = plane === 'axial' ? 'iz' : plane === 'coronal' ? 'iy' : 'ix'; mpr[p] += d; renderMPR(); return mpr[p]; },
    state: () => ({ nFrags: frags.length, names: frags.map(f => f.name), tri: frags.map(f => triCount(f.soup)), hasVolume: !!volume, mprOn, plan: plan ? { mobile: getFrag(plan.mobileId)?.name, dir: plan.dir.toArray(), length: plan.length, deg: plan.deg } : null }),
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
  volume = buildDemoVolume(); initMPR();
  frameAll(); selectFragment(f.id);
  status('Демо загружено. Шаг 1: «Разорвать контакт» — кликай по зубным контактам, затем «Отделить НЧ». Срезы — кнопка «▦ Срезы».');
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
    const { loadDicom } = await import('./dicom.js');
    clearAll();
    const { groups, series } = await loadDicom(Array.from(fileList), (p, msg) => status(msg));
    dicomGroups = groups; dicomSeries = series;
    populateSeriesUI(series);
    let def = series.findIndex(s => s.isBone); if (def < 0) def = 0;   // по умолчанию — костная серия
    await buildFromSeries(def);
  } catch (e) { console.error(e); alert('DICOM: ' + e.message); status('Ошибка DICOM.'); }
}
async function buildFromSeries(idx) {
  if (!dicomGroups) return;
  curSeries = idx;
  status(`Сборка серии: ${dicomSeries[idx]?.label || idx}…`);
  const { assembleSeries } = await import('./dicom.js');
  const { extractSurface } = await import('./mc.js');
  const vol = await assembleSeries(dicomGroups, idx, (p, msg) => status(msg));
  const thr = +($('thr')?.value || 300);
  const surf = extractSurface(vol, thr, 220);
  const soup = new Float32Array(surf.triCount * 9);
  const { positions, indices } = surf; let o = 0;
  for (let t = 0; t < indices.length; t += 3)
    for (let k = 0; k < 3; k++) { const vi = indices[t + k] * 3; soup[o++] = positions[vi]; soup[o++] = positions[vi + 1]; soup[o++] = positions[vi + 2]; }
  // убираем прежние фрагменты/план, но сохраняем список серий
  [...frags].forEach(f => removeFragment(f.id));
  clearCutPlane(); plan = null; clearMeasure(); mprMeas.length = 0; mprPending = null;
  const f = addFragment(soup, 'Кость (КТ)', 'bone', 0xe6eef6);
  volume = vol; initMPR();
  frameAll(); selectFragment(f.id); updatePlanPanel();
  const sel = $('seriesSel'); if (sel) sel.value = String(idx);
  status(`Серия «${dicomSeries[idx]?.desc || idx}» · порог ${thr} HU. Шаг 1: разорвать контакты и «Отделить НЧ». Срезы — «▦ Срезы».`);
}
function populateSeriesUI(series) {
  const wrap = $('seriesWrap'), sel = $('seriesSel');
  if (!wrap || !sel) return;
  if (series.length > 1) {
    sel.innerHTML = series.map(s => `<option value="${s.index}">${s.isBone ? '🦴 ' : ''}${s.label}${s.isBone ? '' : ''}</option>`).join('');
    wrap.style.display = 'flex';
  } else wrap.style.display = 'none';
}
function clearAll() {
  [...frags].forEach(f => removeFragment(f.id));
  clearCutPlane(); plan = null; clearMeasure(); updatePlanPanel();
  volume = null; mpr = null; measurements.length = 0;
  dicomGroups = null; dicomSeries = null; mprMeas.length = 0; mprPending = null;
  const sw = $('seriesWrap'); if (sw) sw.style.display = 'none';
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
      measurements.push({ a: measurePts[0].toArray(), b: measurePts[1].toArray(), mm: d });
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
function clearCutPlane() { if (cutPlane) { scene.remove(cutPlane.group); cutPlane = null; if (mprOn) renderMPR(); } }
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
  if (mprOn) renderMPR();
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
  if (mprOn) renderMPR();
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
  if (mprOn) renderMPR();
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
function clearMeasure() {
  measurePts = []; measurements.length = 0; [...measureGroup.children].forEach(c => measureGroup.remove(c));
  mprMeas.length = 0; mprPending = null; if (mprOn) renderMPR();
  const mv = $('measVal'); if (mv) mv.style.display = 'none';
}

// ── gizmo / направленное движение ────────────────────────────────────────────────
function onGizmoChange() {
  // двигаем плоскость остеотомии — обновляем её след на срезах
  if (cutPlane && gizmo.object === cutPlane.group) { if (mprOn) renderMPR(); }
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
  mprMode = null; document.querySelectorAll('.mprarm').forEach(b => b.classList.remove('armed'));
  setMode(on ? m : null);
}
function armMPR(btn, m) {
  const on = btn.classList.toggle('armed');
  document.querySelectorAll('.mprarm').forEach(b => { if (b !== btn) b.classList.remove('armed'); });
  setMode(null); document.querySelectorAll('.step .armed, #measBtn').forEach(b => b.classList.remove('armed'));
  mprMode = on ? m : null; mprPending = null; vecPending = [];
  if (mprMode && !mprOn) toggleMPR(true);
  const txt = { len: 'Срезы: 2 точки — длина.', ang: 'Срезы: 3 точки — угол.', plane: 'Клик по срезу поставит плоскость остеотомии.', vec: 'Срезы: 2 клика (от → куда) зададут вектор дистракции.' };
  status(mprMode ? txt[m] : '');
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

  // MPR-срезы
  $('mprToggle').onclick = () => toggleMPR();
  ['slA', 'slC', 'slS'].forEach((id, k) => { $(id).oninput = () => { if (!mpr) return; const prop = k === 0 ? 'iz' : k === 1 ? 'iy' : 'ix'; mpr[prop] = +$(id).value; renderMPR(); }; });
  $('mprLenBtn').onclick = () => armMPR($('mprLenBtn'), 'len');
  $('mprAngBtn').onclick = () => armMPR($('mprAngBtn'), 'ang');
  $('osteoSliceBtn').onclick = () => armMPR($('osteoSliceBtn'), 'plane');
  $('vecSliceBtn').onclick = () => armMPR($('vecSliceBtn'), 'vec');
  // серии DICOM + порог
  $('seriesSel').onchange = () => buildFromSeries(+$('seriesSel').value);
  $('thr').onchange = () => { if (dicomGroups) buildFromSeries(curSeries); };
  $('wc').oninput = () => { $('wcv').textContent = $('wc').value; if (mpr) { mpr.wc = +$('wc').value; renderMPR(); } };
  $('ww').oninput = () => { $('wwv').textContent = $('ww').value; if (mpr) { mpr.ww = +$('ww').value; renderMPR(); } };
  document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { const [wc, ww] = b.dataset.preset.split(',').map(Number); $('wc').value = wc; $('ww').value = ww; $('wcv').textContent = wc; $('wwv').textContent = ww; if (mpr) { mpr.wc = wc; mpr.ww = ww; renderMPR(); } });

  // авто-КДА
  $('corrAngle').oninput = () => { $('corrAngleV').textContent = $('corrAngle').value + '°'; };
  $('autoPickBtn').onclick = autoPickDevice;

  // измерения/экспорт
  $('measBtn').onclick = () => arm($('measBtn'), 'measure');
  $('measClr').onclick = clearMeasure;
  $('pdfBtn').onclick = exportPDF;
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
// ── MPR: срезы КТ ───────────────────────────────────────────────────────────────
function initMPR() {
  if (!volume) { mpr = null; return; }
  mpr = new MPR(volume);
  mpr.wc = +($('wc')?.value || 300); mpr.ww = +($('ww')?.value || 1500);
  const [nx, ny, nz] = volume.dims;
  setSlider('slA', nz, mpr.iz); setSlider('slC', ny, mpr.iy); setSlider('slS', nx, mpr.ix);
  const wrap = $('mprTools'); if (wrap) wrap.style.display = 'flex';
  renderMPR();
}
function setSlider(id, n, val) { const s = $(id); if (!s) return; s.min = 0; s.max = n - 1; s.value = val; }
const MPR_CANVAS = { axial: 'mprA', coronal: 'mprC', sagittal: 'mprS' };
function renderMPR() {
  if (!mpr || !mprOn) return;
  mpr.drawAll($('mprA'), $('mprC'), $('mprS'));
  const L = (id, v, n) => { const e = $(id); if (e) e.textContent = `${v + 1}/${n}`; };
  const [nx, ny, nz] = volume.dims;
  L('mprAn', mpr.iz, nz); L('mprCn', mpr.iy, ny); L('mprSn', mpr.ix, nx);
  drawMPROverlays();
}

// мир → воксель (полноразмерная сетка; 3D-кость центрирована в середине объёма)
function worldToVoxel(wx, wy, wz) {
  const [nx, ny, nz] = volume.dims, sp = volume.spacing;
  return { x: wx / sp[0] + nx / 2, y: wy / sp[1] + ny / 2, z: wz / sp[2] + nz / 2 };
}
// клип прямой a·i+b·j=c к прямоугольнику [0,W]×[0,H] → два конца или null
function lineClipRect(a, b, c, W, H) {
  const pts = [];
  const add = (i, j) => { if (i >= -0.5 && i <= W + 0.5 && j >= -0.5 && j <= H + 0.5) pts.push([i, j]); };
  if (Math.abs(b) > 1e-9) { add(0, (c - a * 0) / b); add(W, (c - a * W) / b); }
  if (Math.abs(a) > 1e-9) { add((c - b * 0) / a, 0); add((c - b * H) / a, H); }
  if (pts.length < 2) return null;
  return [pts[0], pts[1]];
}
function drawMPROverlays() {
  for (const key of ['axial', 'coronal', 'sagittal']) {
    const cv = $(MPR_CANVAS[key]); if (!cv) continue;
    const ctx = cv.getContext('2d');
    if (cutPlane) drawPlaneTrace(ctx, key);     // след плоскости остеотомии
    if (plan) drawVectorTrace(ctx, key);        // проекция вектора дистракции
    drawSliceMeasures(ctx, key);
  }
}
function drawPlaneTrace(ctx, key) {
  if (!cutPlane) return;
  const N = planeNormalWorld(); const P = cutPlane.group.position;
  const [NX, NY, NZ] = volume.dims, sp = volume.spacing;
  const D = N.x * P.x + N.y * P.y + N.z * P.z;
  let a, b, c, W, H;
  const info = mpr.planeInfo(key);
  if (key === 'axial') { const Z = (mpr.iz - NZ / 2) * sp[2]; a = N.x * sp[0]; b = N.y * sp[1]; c = (D - N.z * Z) + a * NX / 2 + b * NY / 2; W = NX; H = NY; }
  else if (key === 'coronal') { const Y = (mpr.iy - NY / 2) * sp[1]; a = N.x * sp[0]; b = N.z * sp[2]; c = (D - N.y * Y) + a * NX / 2 + b * NZ / 2; W = NX; H = NZ; }
  else { const X = (mpr.ix - NX / 2) * sp[0]; a = N.y * sp[1]; b = N.z * sp[2]; c = (D - N.x * X) + a * NY / 2 + b * NZ / 2; W = NY; H = NZ; }
  const seg = lineClipRect(a, b, c, W, H); if (!seg) return;
  const p0 = mpr.voxelToCanvas(key, seg[0][0], seg[0][1]), p1 = mpr.voxelToCanvas(key, seg[1][0], seg[1][1]);
  if (!p0 || !p1) return;
  ctx.strokeStyle = 'rgba(255,194,77,.9)'; ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
  ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); ctx.setLineDash([]);
}
function drawVectorTrace(ctx, key) {
  const len = Math.max(+$('distAmt').value, plan.length, 8);
  const O = worldToVoxel(plan.origin.x, plan.origin.y, plan.origin.z);
  const T = worldToVoxel(plan.origin.x + plan.dir.x * len, plan.origin.y + plan.dir.y * len, plan.origin.z + plan.dir.z * len);
  const pick = (v) => key === 'axial' ? [v.x, v.y] : key === 'coronal' ? [v.x, v.z] : [v.y, v.z];
  const [oi, oj] = pick(O), [ti, tj] = pick(T);
  const a = mpr.voxelToCanvas(key, oi, oj), b = mpr.voxelToCanvas(key, ti, tj);
  if (!a || !b) return;
  ctx.strokeStyle = 'rgba(57,224,143,.95)'; ctx.fillStyle = 'rgba(57,224,143,.95)'; ctx.lineWidth = 2; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  const ang = Math.atan2(b.y - a.y, b.x - a.x), s = 7;      // наконечник
  ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - s * Math.cos(ang - 0.4), b.y - s * Math.sin(ang - 0.4));
  ctx.lineTo(b.x - s * Math.cos(ang + 0.4), b.y - s * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fill();
}
function drawSliceMeasures(ctx, key) {
  const info = mpr.planeInfo(key);
  const items = mprMeas.filter(m => m.plane === key && m.slice === info.idx);
  const drawPts = (pts, color, label, mid) => {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.6; ctx.setLineDash([]);
    const cs = pts.map(p => mpr.voxelToCanvas(key, p.i, p.j));
    ctx.beginPath(); cs.forEach((c, k) => k ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)); ctx.stroke();
    cs.forEach(c => { ctx.beginPath(); ctx.arc(c.x, c.y, 3, 0, 7); ctx.fill(); });
    if (label && mid != null) { ctx.font = '12px ui-monospace,monospace'; ctx.fillStyle = '#eafcfd'; ctx.fillText(label, cs[mid].x + 6, cs[mid].y - 6); }
  };
  for (const m of items) drawPts(m.pts, m.type === 'len' ? 'rgba(255,194,77,.95)' : 'rgba(138,162,255,.95)', m.type === 'len' ? m.value.toFixed(1) + ' мм' : m.value.toFixed(0) + '°', m.type === 'len' ? 1 : 1);
  if (mprPending && mprPending.plane === key && mprPending.slice === info.idx) drawPts(mprPending.pts, 'rgba(255,255,255,.8)');
}

// воксель среза (i,j) → мировая точка (та же привязка, что worldToVoxel)
function sliceVoxToWorld(key, i, j) {
  const [nx, ny, nz] = volume.dims, sp = volume.spacing;
  if (key === 'axial') return new THREE.Vector3((i - nx / 2) * sp[0], (j - ny / 2) * sp[1], (mpr.iz - nz / 2) * sp[2]);
  if (key === 'coronal') return new THREE.Vector3((i - nx / 2) * sp[0], (mpr.iy - ny / 2) * sp[1], (j - nz / 2) * sp[2]);
  return new THREE.Vector3((mpr.ix - nx / 2) * sp[0], (i - ny / 2) * sp[1], (j - nz / 2) * sp[2]);
}
// клик по срезу — измерение или планирование (плоскость/вектор)
function onMPRClick(key, ev) {
  if (ev.button !== 0 || !mpr || !mprMode) return;
  const cv = $(MPR_CANVAS[key]); const r = cv.getBoundingClientRect();
  const vx = mpr.canvasToVoxel(key, ev.clientX - r.left, ev.clientY - r.top); if (!vx) return;
  const info = mpr.planeInfo(key);

  if (mprMode === 'plane') {                     // поставить плоскость остеотомии со среза
    const w = sliceVoxToWorld(key, vx.i, vx.j);
    placeCutPlaneAt(w, null, getFrag(selId) || frags[0]);
    mprMode = null; document.querySelectorAll('.mprarm').forEach(b => b.classList.remove('armed'));
    status('Плоскость поставлена со среза — доверни в 3D и «Распилить».');
    return;
  }
  if (mprMode === 'vec') {                        // задать вектор дистракции 2 кликами
    vecPending.push(sliceVoxToWorld(key, vx.i, vx.j));
    if (vecPending.length >= 2) {
      const dir = vecPending[1].clone().sub(vecPending[0]);
      if (dir.length() > 1e-3 && plan) { plan.dir = dir.normalize(); applyDistraction(); updatePlanPanel(); status('Вектор дистракции задан со среза.'); }
      else status('Нет остеотомии — сначала Шаг 2.');
      vecPending = []; mprMode = null; document.querySelectorAll('.mprarm').forEach(b => b.classList.remove('armed'));
    } else status('Вектор: кликни вторую точку (куда).');
    return;
  }

  // измерения (длина/угол)
  if (!mprPending || mprPending.plane !== key || mprPending.slice !== info.idx || mprPending.type !== mprMode)
    mprPending = { plane: key, slice: info.idx, type: mprMode, pts: [] };
  mprPending.pts.push({ i: vx.i, j: vx.j });
  const need = mprMode === 'len' ? 2 : 3;
  if (mprPending.pts.length >= need) {
    const val = mprMode === 'len' ? sliceLen(info, mprPending.pts) : sliceAng(info, mprPending.pts);
    mprMeas.push({ plane: key, slice: info.idx, type: mprMode, pts: mprPending.pts, value: val });
    status(`Срез (${key}): ${mprMode === 'len' ? val.toFixed(1) + ' мм' : val.toFixed(0) + '°'}.`);
    mprPending = null;
  }
  renderMPR();
}
// колесо/перетаскивание над срезом: прокрутка срезов, зум (ctrl/shift), панорама (ПКМ)
function wireMPRMouse() {
  for (const key of ['axial', 'coronal', 'sagittal']) {
    const el = $(MPR_CANVAS[key]); if (!el) continue;
    el.addEventListener('wheel', (e) => {
      if (!mpr || !mprOn) return; e.preventDefault();
      if (e.ctrlKey || e.shiftKey) { const f = e.deltaY < 0 ? 1.12 : 1 / 1.12; mpr.zoom[key] = Math.max(0.5, Math.min(8, mpr.zoom[key] * f)); }
      else { const d = e.deltaY < 0 ? 1 : -1; const prop = key === 'axial' ? 'iz' : key === 'coronal' ? 'iy' : 'ix'; const max = (key === 'axial' ? mpr.nz : key === 'coronal' ? mpr.ny : mpr.nx) - 1; mpr[prop] = Math.max(0, Math.min(max, mpr[prop] + d)); syncSliceSlider(key); }
      renderMPR();
    }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    let panning = false, lx = 0, ly = 0;
    el.addEventListener('pointerdown', (e) => { if (e.button === 2) { panning = true; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId); } });
    el.addEventListener('pointermove', (e) => { if (panning && mpr) { mpr.pan[key].x += e.clientX - lx; mpr.pan[key].y += e.clientY - ly; lx = e.clientX; ly = e.clientY; renderMPR(); } });
    el.addEventListener('pointerup', (e) => { if (e.button === 2) panning = false; });
    el.addEventListener('dblclick', () => { if (mpr) { mpr.resetView(key); renderMPR(); } });
  }
}
function syncSliceSlider(key) {
  const id = key === 'axial' ? 'slA' : key === 'coronal' ? 'slC' : 'slS';
  const val = key === 'axial' ? mpr.iz : key === 'coronal' ? mpr.iy : mpr.ix;
  const s = $(id); if (s) s.value = val;
}
function sliceLen(info, pts) {
  const du = (pts[0].i - pts[1].i) * info.su, dv = (pts[0].j - pts[1].j) * info.sv;
  return Math.hypot(du, dv);
}
function sliceAng(info, pts) {
  const [a, b, c] = pts;                       // вершина — средняя точка b
  const v1x = (a.i - b.i) * info.su, v1y = (a.j - b.j) * info.sv;
  const v2x = (c.i - b.i) * info.su, v2y = (c.j - b.j) * info.sv;
  const d = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1);
  return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
}
function toggleMPR(on) {
  mprOn = on !== undefined ? on : !mprOn;
  $('stage').classList.toggle('mpr-on', mprOn && !!mpr);
  $('mprToggle').classList.toggle('armed', mprOn);
  requestAnimationFrame(() => { resize(); if (mprOn) renderMPR(); });
  if (mprOn && !mpr) status('Срезы доступны после загрузки DICOM или демо-модели.');
}

// ── авто-подбор КДА по углу коррекции ──────────────────────────────────────────
function autoPickDevice() {
  if (!plan) { status('Сначала выполните остеотомию (Шаг 2).'); return; }
  const ang = +$('corrAngle').value;
  const { device, achievedDeg } = autoDevice(ang);
  plan.deg = device.deg; $('distDev').value = device.deg;
  const r = $('distAmt').value > 0 ? arcRadius(+$('distAmt').value, achievedDeg) : null;
  $('corrRec').innerHTML = `Рекомендован: <b>${device.name}</b> · поворот ≈ <b>${achievedDeg}°</b>` + (r ? ` · радиус ${r.toFixed(0)} мм` : '');
  applyDistraction(); updatePlanReadout(+$('distAmt').value);
}

// ── протокол PDF ────────────────────────────────────────────────────────────────
function exportPDF() {
  const W = 1240, H = 1754;                    // A4 @ ~150 dpi
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
  // шапка
  c.fillStyle = '#0f766e'; c.fillRect(0, 0, W, 112);
  c.fillStyle = '#ffffff'; c.font = 'bold 40px Arial'; c.fillText('OSSA 4 — протокол планирования', 54, 56);
  c.font = '20px Arial'; c.fillStyle = '#d7f5f1'; c.fillText('Остеотомия и дистракция нижней челюсти', 54, 90);
  let y = 165; const L = 54, R = W - 54;
  c.fillStyle = '#111'; c.font = '22px Arial';
  const line = (label, val) => { c.fillStyle = '#555'; c.font = '19px Arial'; c.fillText(label, L, y); c.fillStyle = '#111'; c.font = 'bold 21px Arial'; c.fillText(val, L + 300, y); y += 38; };
  line('Пациент / № КТ:', $('patName')?.value || '—');
  line('Дата:', new Date().toLocaleDateString('ru-RU'));
  line('Объектов в сцене:', String(frags.length));
  // снимок 3D
  y += 10; c.fillStyle = '#0f766e'; c.font = 'bold 24px Arial'; c.fillText('3D-план', L, y); y += 16;
  try {
    renderer.render(scene, camera);
    const snap = renderer.domElement.toDataURL('image/png');
    const img = new Image(); img.src = snap;
    // синхронно: картинка из dataURL уже декодирована у большинства движков, но подстрахуемся
    return finishPDF(cv, c, y, img);
  } catch (e) { return finishPDF(cv, c, y, null); }
}
function finishPDF(cv, c, y, img) {
  const W = cv.width, L = 54;
  const draw = () => {
    if (img && img.complete && img.width) {
      const iw = W - 108, ih = iw * (img.height / img.width);
      c.drawImage(img, L, y, iw, Math.min(ih, 560)); y += Math.min(ih, 560) + 26;
    } else { y += 10; }
    // план дистракции
    c.fillStyle = '#0f766e'; c.font = 'bold 24px Arial'; c.fillText('Параметры дистракции', L, y); y += 34;
    c.font = '20px Arial'; c.fillStyle = '#111';
    const row = (t) => { c.fillStyle = '#222'; c.font = '20px Arial'; c.fillText('•  ' + t, L, y); y += 32; };
    if (plan) {
      const dev = DEVICES.find(d => d.deg === plan.deg);
      const s = +$('distAmt').value;
      row(`Подвижный фрагмент: ${getFrag(plan.mobileId)?.name || '—'}`);
      row(`Вектор дистракции: (${plan.dir.x.toFixed(2)}, ${plan.dir.y.toFixed(2)}, ${plan.dir.z.toFixed(2)})`);
      row(`Длина дистракции (регенерат): ${s.toFixed(1)} мм`);
      row(`Аппарат: ${dev?.name || '—'}` + (plan.deg < 180 ? `, поворот регенерата ≈ ${(180 - plan.deg)}°` : ' (прямой)'));
      if (plan.deg < 180 && s > 0) row(`Радиус дуги: ${arcRadius(s, 180 - plan.deg).toFixed(0)} мм`);
    } else row('Остеотомия не выполнена.');
    if (measurements.length || mprMeas.length) {
      y += 8; c.fillStyle = '#0f766e'; c.font = 'bold 24px Arial'; c.fillText('Измерения', L, y); y += 34;
      measurements.forEach((m, i) => row(`3D · замер ${i + 1}: ${m.mm.toFixed(1)} мм`));
      const PL = { axial: 'аксиал', coronal: 'коронар', sagittal: 'сагиттал' };
      mprMeas.forEach((m, i) => row(`Срез (${PL[m.plane]}) · ${m.type === 'len' ? m.value.toFixed(1) + ' мм' : m.value.toFixed(0) + '°'}`));
    }
    // футер
    const H = cv.height;
    c.fillStyle = '#777'; c.font = '15px Arial';
    c.fillText('ФГБУ НМИЦ «ЦНИИС и ЧЛХ» Минздрава России · OSSA 4', L, H - 70);
    c.fillText('Вспомогательный ориентир планирования. Клиническое решение принимает врач.', L, H - 46);
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
    pdf.save(($('patName')?.value || 'OSSA_план') + '.pdf');
    status('Протокол PDF сохранён.');
  };
  if (img && !img.complete) { img.onload = draw; img.onerror = draw; } else draw();
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
