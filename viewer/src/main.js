import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { buildVolume } from './dicom.js';
import { extractSurface } from './mc.js';
import { splitByPlane } from './cut.js';
import { DEVICES, arcRadius, selectDevice, arcFrame, arcPoints } from './distractors.js';

let gizmo = null, pickMode = false;

const $ = id => document.getElementById(id);
let volume = null;
let idx = [0, 0, 0];          // текущие срезы [x,y,z]
let win = { center: 300, width: 1500 };
let threshold = 300;

// ---------- Статус ----------
function status(msg, pct) {
  $('status').textContent = msg || '';
  const bar = $('progbar');
  if (pct == null) { bar.style.width = '0%'; bar.parentElement.style.opacity = 0; }
  else { bar.parentElement.style.opacity = 1; bar.style.width = Math.round(pct * 100) + '%'; }
}

// ---------- Загрузка ----------
async function loadFiles(fileList) {
  const files = Array.from(fileList).filter(f => !f.name.startsWith('.'));
  if (!files.length) return;
  status('Загрузка…', 0);
  try {
    const vol = await buildVolume(files, (p, m) => status(m, p));
    volume = vol;
    win = { ...vol.window };
    threshold = 300;
    idx = [vol.dims[0] >> 1, vol.dims[1] >> 1, vol.dims[2] >> 1];
    $('wc').value = win.center; $('ww').value = win.width;
    $('thr').value = threshold; $('thrval').textContent = threshold + ' HU';
    $('meta').textContent = `${vol.modality || 'CT'} · ${vol.dims.join('×')} · ${vol.spacing.map(s => s.toFixed(2)).join('/')} мм · HU ${vol.min}…${vol.max}`;
    status('Реконструкция 3D…', 0.9);
    setupSliders();
    renderAllMPR();
    await rebuild3D();
    ensurePlaneViz();
    status('', null);
    $('dropHint').style.display = 'none';
  } catch (e) {
    if (e.code === 'COMPRESSED') {
      status('');
      alert('Эта серия сжата (JPEG/JPEG2000). Поддержка сжатых DICOM появится в следующем обновлении — пока экспортируйте серию как «uncompressed» из ВИДАР/RadiAnt.');
    } else {
      status('');
      alert('Ошибка загрузки: ' + e.message);
      console.error(e);
    }
  }
}

// ---------- MPR ----------
const planes = ['axial', 'coronal', 'sagittal'];
function sliceMeta(plane) {
  const [nx, ny, nz] = volume.dims;
  const [sx, sy, sz] = volume.spacing;
  if (plane === 'axial')    return { w: nx, h: ny, pw: nx * sx, ph: ny * sy, count: nz, axis: 2 };
  if (plane === 'coronal')  return { w: nx, h: nz, pw: nx * sx, ph: nz * sz, count: ny, axis: 1 };
  return { w: ny, h: nz, pw: ny * sy, ph: nz * sz, count: nx, axis: 0 }; // sagittal
}
function sampleSlice(plane, k, w, h) {
  const [nx, ny, nz] = volume.dims;
  const d = volume.data;
  const out = new Int16Array(w * h);
  if (plane === 'axial') {
    const base = k * nx * ny;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = d[base + y * nx + x];
  } else if (plane === 'coronal') {
    for (let z = 0; z < h; z++) { const base = z * nx * ny + k * nx; for (let x = 0; x < w; x++) out[z * w + x] = d[base + x]; }
  } else {
    for (let z = 0; z < h; z++) { const base = z * nx * ny + k; for (let y = 0; y < w; y++) out[z * w + y] = d[base + y * nx]; }
  }
  return out;
}
function renderMPR(plane) {
  const m = sliceMeta(plane);
  const k = idx[m.axis];
  const px = sampleSlice(plane, k, m.w, m.h);
  const lo = win.center - win.width / 2, span = win.width || 1;
  const img = new ImageData(m.w, m.h);
  const dta = img.data;
  for (let i = 0; i < px.length; i++) {
    let g = (px[i] - lo) / span; g = g < 0 ? 0 : g > 1 ? 1 : g; g = (g * 255) | 0;
    const o = i * 4; dta[o] = dta[o + 1] = dta[o + 2] = g; dta[o + 3] = 255;
  }
  const off = document.createElement('canvas'); off.width = m.w; off.height = m.h;
  off.getContext('2d').putImageData(img, 0, 0);

  const cv = $('cv-' + plane); const ctx = cv.getContext('2d');
  const CW = cv.width, CH = cv.height;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);
  // вписать по физическому соотношению сторон
  const ar = m.pw / m.ph;
  let dw = CW, dh = CW / ar; if (dh > CH) { dh = CH; dw = CH * ar; }
  const ox = (CW - dw) / 2, oy = (CH - dh) / 2;
  ctx.imageSmoothingEnabled = true;
  const flipY = plane !== 'axial'; // superior наверх для коронар/сагиттал
  if (flipY) {
    ctx.save(); ctx.translate(ox, oy + dh); ctx.scale(1, -1);
    ctx.drawImage(off, 0, 0, m.w, m.h, 0, 0, dw, dh); ctx.restore();
  } else {
    ctx.drawImage(off, 0, 0, m.w, m.h, ox, oy, dw, dh);
  }
  // прицел (позиции других осей)
  ctx.strokeStyle = 'rgba(47,228,214,.55)'; ctx.lineWidth = 1;
  let u, v;
  if (plane === 'axial')   { u = idx[0] / volume.dims[0]; v = idx[1] / volume.dims[1]; }
  else if (plane === 'coronal') { u = idx[0] / volume.dims[0]; v = idx[2] / volume.dims[2]; }
  else { u = idx[1] / volume.dims[1]; v = idx[2] / volume.dims[2]; }
  const lx = ox + u * dw, ly = oy + (flipY ? (1 - v) : v) * dh;
  ctx.beginPath(); ctx.moveTo(lx, oy); ctx.lineTo(lx, oy + dh); ctx.moveTo(ox, ly); ctx.lineTo(ox + dw, ly); ctx.stroke();
  // подпись
  ctx.fillStyle = 'rgba(47,228,214,.9)'; ctx.font = '11px ui-monospace,monospace';
  ctx.fillText(`${plane.toUpperCase()}  ${k + 1}/${m.count}`, 8, 16);
}
function resizeMPRCanvases() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  planes.forEach(p => {
    const cv = $('cv-' + p);
    const w = cv.clientWidth || 600, h = cv.clientHeight || 450;
    cv.width = Math.max(2, Math.round(w * dpr));
    cv.height = Math.max(2, Math.round(h * dpr));
  });
}
function renderAllMPR() { if (volume) { resizeMPRCanvases(); planes.forEach(renderMPR); } }

// ---------- 3D ----------
let renderer, scene, camera, controls, boneMesh;
function init3D() {
  const cv = $('cv-3d');
  renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a1418);
  camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
  camera.position.set(0, -350, 120);
  controls = new TrackballControls(camera, cv);
  controls.rotateSpeed = 3.2;      // плавное вращение по любым осям
  controls.zoomSpeed = 1.3;
  controls.panSpeed = 0.8;
  controls.dynamicDampingFactor = 0.12; // инерция/плавность
  controls.staticMoving = false;
  controls.keys = [];
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const d1 = new THREE.DirectionalLight(0xffffff, 0.9); d1.position.set(1, -1, 1); scene.add(d1);
  const d2 = new THREE.DirectionalLight(0x88bbff, 0.4); d2.position.set(-1, 1, -0.5); scene.add(d2);

  // гизмо для ручного перемещения (плоскость / область / фрагменты)
  gizmo = new TransformControls(camera, cv);
  gizmo.addEventListener('dragging-changed', (e) => { controls.enabled = !e.value; });
  gizmo.setSize(0.8);
  scene.add(gizmo);

  // выбор фрагмента кликом (в режиме «Тащить»)
  const ray = new THREE.Raycaster(), m = new THREE.Vector2();
  cv.addEventListener('click', (ev) => {
    const r = cv.getBoundingClientRect();
    m.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    m.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    if (devPtMode || symTgtMode || midMode || measMode) {
      ray.setFromCamera(m, camera);
      const tgts = [fragFixed, fragMobileMesh, boneMesh].filter(o=>o && o.visible);
      const hit = ray.intersectObjects(tgts, false)[0];
      if (hit) {
        if (measMode) addMeasPt(hit.point);
        else if (midMode) addMidPt(hit.point);
        else if (symTgtMode) setSymTarget(hit.point);
        else addDevPt(hit.point);
      }
      return;
    }
    if (!pickMode || !isCut) return;
    ray.setFromCamera(m, camera);
    const targets = [fragFixed, fragMobileMesh].filter(Boolean);
    const hit = ray.intersectObjects(targets, false)[0];
    if (hit) {
      let o = hit.object; if (o === fragMobileMesh) o = fragMobileGroup;
      if (o === fragMobileGroup) mobileMode = 'manual';
      gizmo.attach(o);
    }
  });

  resize3D();
  (function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();
}
function resize3D() {
  const cv = $('cv-3d'); const r = cv.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
  if (controls && controls.handleResize) controls.handleResize();
  syncPenCanvas(); if (penPts.length) drawPen();
}
async function rebuild3D() {
  if (!volume) return;
  await new Promise(r => setTimeout(r, 10));
  const t0 = performance.now();
  const surf = extractSurface(volume, threshold, 200);
  if (boneMesh) { scene.remove(boneMesh); boneMesh.geometry.dispose(); boneMesh.material.dispose(); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(surf.positions, 3));
  geo.setIndex(new THREE.BufferAttribute(surf.indices, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xe6ddc9, roughness: 0.62, metalness: 0.05, flatShading: false, side: THREE.DoubleSide });
  boneMesh = new THREE.Mesh(geo, mat); scene.add(boneMesh);
  boneSurf = surf;                 // сохраняем для распила
  resetCut(true);                  // сброс остеотомии при пересборке модели
  // подогнать камеру
  geo.computeBoundingSphere();
  const rr = geo.boundingSphere.radius || 150;
  modelRadius = rr;
  camera.position.set(0, -rr * 2.4, rr * 0.7); controls.target.set(0, 0, 0);
  $('info3d').textContent = `${surf.triCount.toLocaleString('ru')} треуг. · ${(performance.now() - t0 | 0)} мс · шаг ×${surf.step}`;
}

// ---------- Остеотомия / дистракторы ----------
let boneSurf = null, modelRadius = 150;
let planeMesh = null, fragFixed = null, fragMobileGroup = null, fragMobileMesh = null;
let arcMesh = null;
let isCut = false, cutN = null, cutP = null, cutSign = -1;
let mobileMode = 'sliders';        // 'sliders' | 'arc' | 'manual'
let curDevice = null, arcFrameCur = null, arcRadCur = 0, arcDegCur = 0;
let mobileCentroid = null;

// плоскость: источник истины — planeMesh (двигается слайдерами или гизмо)
function getPlaneN() { const n = new THREE.Vector3(0,0,1); if (planeMesh) n.applyQuaternion(planeMesh.quaternion); return n.normalize(); }
function getPlaneP() { return planeMesh ? planeMesh.position.clone() : new THREE.Vector3(); }

let planeBox = null;
function ensurePlaneViz(fromSliders) {
  if (!planeMesh) {
    const m = new THREE.MeshBasicMaterial({ color: 0x2fe4d6, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
    planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    planeMesh.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x2fe4d6, wireframe: true, transparent: true, opacity: 0.55 })));
    planeMesh.name = 'plane'; scene.add(planeMesh);
    // объёмная рамка (глубина) — показывает захватываемый объём
    planeBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1)),
      new THREE.LineBasicMaterial({ color: 0xffc24d, transparent:true, opacity:0.7 }));
    planeMesh.add(planeBox);
  }
  const full = modelRadius * 2.4;
  const W = planeFull('cutW') ? full : (+$('cutW').value);
  const L = planeFull('cutL') ? full : (+$('cutL').value);
  const D = planeFull('cutD') ? full : (+$('cutD').value);
  planeMesh.scale.set(W, L, 1);            // сам квадрат-плоскость
  planeBox.scale.set(W, L, D);             // объёмная рамка (в локальных ед. плоскости)
  planeBox.visible = !(planeFull('cutW') && planeFull('cutL') && planeFull('cutD'));
  if (fromSliders) {
    const or = $('cutOrient').value;
    const tx = (+$('cutTiltX').value) * Math.PI/180, ty = (+$('cutTiltY').value) * Math.PI/180;
    let base = or === 'axial' ? new THREE.Vector3(0,0,1) : or === 'coronal' ? new THREE.Vector3(0,1,0) : new THREE.Vector3(1,0,0);
    const n = base.applyEuler(new THREE.Euler(tx, ty, 0)).normalize();
    planeMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), n);
    planeMesh.position.copy(n.multiplyScalar(+$('cutOff').value));
  }
  planeMesh.visible = $('planeOn').checked && !isCut && !penOn;
}
// слайдер на максимуме = «вся» (без ограничения)
function planeFull(id){ const el=$(id); return +el.value >= +el.max; }

// разделение triangle-soup ОРИЕНТИРОВАННЫМ боксом плоскости (ширина×высота×толщина, мм).
// Внутри бокса → inside; вне → outside (кость остаётся целой). Толщина ограничивает
// захват вдоль нормали — не «прошивает» череп насквозь.
function filterByPlaneBox(pos) {
  const inA=[], outA=[]; const v=new THREE.Vector3();
  const full = modelRadius * 2.4;
  const hx=(planeFull('cutW')?full:+$('cutW').value)/2;
  const hy=(planeFull('cutL')?full:+$('cutL').value)/2;
  const hz=(planeFull('cutD')?full:+$('cutD').value)/2;
  planeMesh.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().compose(planeMesh.position, planeMesh.quaternion, new THREE.Vector3(1,1,1)).invert();
  for (let t=0;t<pos.length;t+=9){
    const cx=(pos[t]+pos[t+3]+pos[t+6])/3, cy=(pos[t+1]+pos[t+4]+pos[t+7])/3, cz=(pos[t+2]+pos[t+5]+pos[t+8])/3;
    v.set(cx,cy,cz).applyMatrix4(inv);
    const inside = Math.abs(v.x)<=hx && Math.abs(v.y)<=hy && Math.abs(v.z)<=hz;
    const dst = inside?inA:outA;
    for (let k=0;k<9;k++) dst.push(pos[t+k]);
  }
  return { inside:new Float32Array(inA), outside:new Float32Array(outA) };
}

function makeMesh(pos, color) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide }));
}

function doCut() {
  if (!boneSurf || !planeMesh) return;
  planeMesh.updateMatrixWorld(true);
  const n = getPlaneN(), p = getPlaneP();
  cutN = n.clone(); cutP = p.clone();
  const mobileSide = $('cutMobile').value; // 'A'(+) или 'B'(−)
  cutSign = mobileSide === 'A' ? 1 : -1;
  const { posA, posB } = splitByPlane(boneSurf.positions, boneSurf.indices, n, p);
  let fixedPos = mobileSide === 'B' ? posA : posB;
  let mobilePos = mobileSide === 'B' ? posB : posA;

  const bounded = !(planeFull('cutW') && planeFull('cutL') && planeFull('cutD'));
  if (bounded) {                     // окно-бокс: подвижное = сторона ∩ бокс
    const f = filterByPlaneBox(mobilePos);
    mobilePos = f.inside;
    const merged = new Float32Array(fixedPos.length + f.outside.length);
    merged.set(fixedPos, 0); merged.set(f.outside, fixedPos.length); fixedPos = merged;
  }
  if (mobilePos.length < 9) { alert('В рамку не попала кость. Увеличь размеры рамки или наведи её точнее.'); return; }
  finalizeFrag(mobilePos, fixedPos, `подвижный фрагмент ${(mobilePos.length/9|0).toLocaleString('ru')} треуг.`
    + (bounded?' (в рамке)':''), n, p);
}

// ---- Карандаш: распил по нарисованному от руки ----
let penOn = false, penPts = [], penDrawing = false;
let lineCut = null, penCandIdx = 0;   // кэш распила по линии для «Поменять фрагмент»
function penMode(){ return $('penMode') ? $('penMode').value : 'line'; }
function penCanvas(){ return $('cv-draw'); }
function syncPenCanvas(){
  const dc = penCanvas(), cv = $('cv-3d'); if (!dc || !cv) return;
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio, 2);
  if (dc.width !== Math.round(r.width*dpr) || dc.height !== Math.round(r.height*dpr)) {
    dc.width = Math.round(r.width*dpr); dc.height = Math.round(r.height*dpr);
  }
}
function drawPen(){
  const dc = penCanvas(); const ctx = dc.getContext('2d');
  const dpr = Math.min(devicePixelRatio, 2);
  ctx.clearRect(0,0,dc.width,dc.height);
  if (penPts.length < 1) return;
  ctx.lineWidth = 2.5*dpr; ctx.strokeStyle = '#2fe4d6'; ctx.lineJoin='round'; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(penPts[0].x*dpr, penPts[0].y*dpr);
  for (let i=1;i<penPts.length;i++) ctx.lineTo(penPts[i].x*dpr, penPts[i].y*dpr);
  if (!penDrawing && penMode()==='loop' && penPts.length>2) { ctx.closePath(); ctx.setLineDash([6*dpr,5*dpr]); }
  ctx.stroke(); ctx.setLineDash([]);
}
function setPenMode(on){
  penOn = on; const dc = penCanvas();
  dc.classList.toggle('on', on); $('penBtn').classList.toggle('armed', on);
  if (on) { setPickMode(false); syncPenCanvas(); }
  else { penDrawing = false; }
  if (!isCut && planeMesh) ensurePlaneViz(false);   // прячем/показываем плоскость при рисовании
}
function pointInPoly(x, y, poly){
  let inside = false;
  for (let i=0, j=poly.length-1; i<poly.length; j=i++){
    const xi=poly[i].x, yi=poly[i].y, xj=poly[j].x, yj=poly[j].y;
    if (((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}
function bindPen(){
  const dc = penCanvas();
  const getP = (ev)=>{ const r=dc.getBoundingClientRect(); return { x:ev.clientX-r.left, y:ev.clientY-r.top }; };
  const onMove = (ev)=>{ if(!penOn||!penDrawing) return; penPts.push(getP(ev)); drawPen(); };
  const onUp = ()=>{ if(!penOn||!penDrawing) return; penDrawing=false; drawPen();
    const ok = penPts.length>2;
    $('penInfo').textContent = ok ? (penMode()==='line'
        ? `Линия готова (${penPts.length} тчк). Нажмите «Распилить по нарисованному».`
        : `Контур готов (${penPts.length} тчк). Нажмите «Распилить по нарисованному».`)
      : 'Слишком коротко — проведите линию ещё раз.'; };
  dc.addEventListener('pointerdown', (ev)=>{ if(!penOn) return; penDrawing=true; penPts=[getP(ev)]; drawPen();
    ev.preventDefault(); });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
function clearPen(){ penPts=[]; penDrawing=false; drawPen();
  $('penInfo').textContent='Проведите линию распила прямо по кости — отделится только связанный фрагмент.'; }

// проекция вершины в экранные px (относительно cv-draw)
function projVert(P, ix, rw, v){ v.set(P[ix*3],P[ix*3+1],P[ix*3+2]).project(camera);
  return { x:(v.x+1)/2*rw.width, y:(1-(v.y+1)/2)*rw.height }; }

// сторона точки относительно открытой ломаной (по ближайшему сегменту)
function sideOfLine(px, py, poly){
  let best=Infinity, sign=1;
  for (let i=0;i<poly.length-1;i++){
    const a=poly[i], b=poly[i+1];
    const dx=b.x-a.x, dy=b.y-a.y, L2=dx*dx+dy*dy || 1e-6;
    let t=((px-a.x)*dx+(py-a.y)*dy)/L2; t=Math.max(0,Math.min(1,t));
    const cx=a.x+t*dx, cy=a.y+t*dy; const d=(px-cx)**2+(py-cy)**2;
    if (d<best){ best=d; sign = ((b.x-a.x)*(py-a.y)-(b.y-a.y)*(px-a.x))>=0 ? 1 : -1; }
  }
  return sign;
}

// Луч из экранной точки в 3D по кости (или по видимым фрагментам)
function pickBone(px, py, rw){
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2((px/rw.width)*2-1, -(py/rw.height)*2+1);
  ray.setFromCamera(ndc, camera);
  const tgts = [boneMesh, fragFixed, fragMobileMesh].filter(o=>o && o.visible);
  const h = ray.intersectObjects(tgts, false)[0];
  return h ? h.point.clone() : null;
}

// Распил по нарисованной линии = локальная РЕЖУЩАЯ ПЛОСКОСТЬ (сфера-ограничение).
// Линия задаёт плоскость (вдоль луча взгляда) и локальную зону вокруг штриха;
// внутри зоны кость делится на «выше линии» и «ниже линии», снаружи — целая.
function doLineCut(){
  const dc = penCanvas(); const rw = dc.getBoundingClientRect();
  // 3D-точки под штрихом
  const hits=[];
  for (let i=0;i<penPts.length;i++){ const p=pickBone(penPts[i].x, penPts[i].y, rw); if(p) hits.push(p); }
  if (hits.length < 2){ alert('Линия прошла мимо кости. Проведи карандашом прямо по кости.'); return; }
  const A=hits[0], B=hits[hits.length-1];
  const center=new THREE.Vector3(); hits.forEach(h=>center.add(h)); center.multiplyScalar(1/hits.length);
  let R=0; hits.forEach(h=>{ R=Math.max(R, h.distanceTo(center)); });
  R = R*1.25 + modelRadius*0.05;                        // локальная зона вокруг линии
  const u = B.clone().sub(A); if(u.lengthSq()<1e-6) u.set(1,0,0); u.normalize();
  const viewDir = new THREE.Vector3(); camera.getWorldDirection(viewDir);
  let n = new THREE.Vector3().crossVectors(u, viewDir); // нормаль плоскости «выше/ниже линии»
  if (n.lengthSq()<1e-6) n.copy(viewDir); n.normalize();
  lineCut = { center, R, n: n.clone(), p: center.clone() };
  penCandIdx = 0;
  buildLineFrag();
}
function buildLineFrag(){
  const { center, R, n, p } = lineCut;
  const { posA, posB } = splitByPlane(boneSurf.positions, boneSurf.indices, n, p);
  const R2 = R*R;
  const inSphere=(pos)=>{ const inA=[], outA=[];
    for (let t=0;t<pos.length;t+=9){ const cx=(pos[t]+pos[t+3]+pos[t+6])/3, cy=(pos[t+1]+pos[t+4]+pos[t+7])/3, cz=(pos[t+2]+pos[t+5]+pos[t+8])/3;
      const d=(cx-center.x)**2+(cy-center.y)**2+(cz-center.z)**2; const dst=d<=R2?inA:outA;
      for(let k=0;k<9;k++) dst.push(pos[t+k]); }
    return { inside:new Float32Array(inA), outside:new Float32Array(outA) }; };
  const sideMob = penCandIdx%2===0 ? posA : posB;       // подвижная сторона (свапается)
  const sideFix = penCandIdx%2===0 ? posB : posA;
  const fm = inSphere(sideMob), ff = inSphere(sideFix);
  const mobilePos = fm.inside;
  // фикс = другая сторона в зоне + вся кость вне зоны
  const fixedPos = new Float32Array(fm.outside.length + ff.inside.length + ff.outside.length);
  fixedPos.set(fm.outside,0); fixedPos.set(ff.inside, fm.outside.length); fixedPos.set(ff.outside, fm.outside.length+ff.inside.length);
  if (mobilePos.length < 9){ penCandIdx++;                     // пустая сторона — берём другую
    if (penCandIdx<2){ buildLineFrag(); return; }
    alert('В зоне линии нет кости с этой стороны.'); return; }
  const cutSignSave = penCandIdx%2===0 ? 1 : -1;
  finalizeFrag(mobilePos, fixedPos, `линия · подвижный фрагмент ${(mobilePos.length/9|0).toLocaleString('ru')} треуг.`, n, p, cutSignSave);
  $('penInfo').textContent = `Готово. Подвижна ${penCandIdx%2===0?'верхняя':'нижняя'} часть от линии. Не та — «Поменять фрагмент».`;
}
function swapFragment(){ if(!lineCut){ return; } penCandIdx++; buildLineFrag(); }

// Контурный (loop) распил — вырубка по замкнутому контуру вдоль взгляда.
function doLoopCut(){
  const dc = penCanvas(); const rw = dc.getBoundingClientRect();
  const poly = penPts.map(p=>({x:p.x, y:p.y}));
  const P = boneSurf.positions, I = boneSurf.indices;
  const triCount = I ? I.length/3 : P.length/9;
  const inA=[], outA=[]; const v=new THREE.Vector3();
  for (let t=0;t<triCount;t++){
    const a=I?I[t*3]:t*3, b=I?I[t*3+1]:t*3+1, c=I?I[t*3+2]:t*3+2;
    const pa=projVert(P,a,rw,v), pb=projVert(P,b,rw,v), pc=projVert(P,c,rw,v);
    const cx=(pa.x+pb.x+pc.x)/3, cy=(pa.y+pb.y+pc.y)/3;
    const dst = pointInPoly(cx, cy, poly)?inA:outA;
    for (const idx of [a,b,c]) dst.push(P[idx*3],P[idx*3+1],P[idx*3+2]);
  }
  const mobilePos=new Float32Array(inA), fixedPos=new Float32Array(outA);
  if (mobilePos.length<9){ alert('В контур не попала кость. Обведите зону точнее.'); return; }
  finalizeFrag(mobilePos, fixedPos, `Контур · фрагмент ${(mobilePos.length/9|0).toLocaleString('ru')} треуг.`);
}
function penCutDispatch(){
  if (!boneSurf) { alert('Сначала постройте 3D-модель.'); return; }
  if (penPts.length < 3) { alert('Сначала нарисуйте линию/контур карандашом.'); return; }
  if (penMode()==='line') doLineCut(); else doLoopCut();
}
// общая сборка фрагментов. n,p — плоскость распила (если задана); иначе ось вдоль взгляда.
function finalizeFrag(mobilePos, fixedPos, info, n, p, sign){
  removeFrags(); clearDevPts();
  boneMesh.visible=false; if(planeMesh) planeMesh.visible=false;
  fragFixed = makeMesh(fixedPos, 0xe6ddc9); fragFixed.name='fixed'; scene.add(fragFixed);
  fragMobileMesh = makeMesh(mobilePos, 0x66d9e8); fragMobileMesh.name='mobile';
  fragMobileGroup = new THREE.Group(); fragMobileGroup.add(fragMobileMesh); fragMobileGroup.name='mobile';
  scene.add(fragMobileGroup);
  const box=new THREE.Box3().setFromObject(fragMobileMesh); const ctr=box.getCenter(new THREE.Vector3());
  mobileCentroid = ctr.clone();
  if (n && p) { cutN=n.clone(); cutP=p.clone(); if(sign!=null) cutSign=sign; } // шарнир дистракции — на плоскости распила
  else { cutN=new THREE.Vector3(); camera.getWorldDirection(cutN); cutN.multiplyScalar(-1).normalize(); cutP=ctr; cutSign=1; }
  isCut=true; mobileMode='sliders';
  ['mvDist','mvX','mvY','mvRot'].forEach(id => $(id).value = 0);
  applyMobileTransform(); clearArc();
  setPenMode(false); penPts=[]; drawPen();
  $('cutInfo').textContent = 'Распил · ' + info;
}

// ---- Точки под аппарат (клик по фрагменту) ----
let devPtMode = false, devPts = [], devMarkers = [];
function setDevPtMode(on){ devPtMode=on; $('devPtBtn').classList.toggle('armed', on);
  if(on){ setPenMode(false); setPickMode(false);
    $('penInfo').textContent='Кликните 2 точки по кости — начало и конец аппарата вдоль линии распила.'; } }
function clearDevPts(){ devMarkers.forEach(m=>scene.remove(m)); devMarkers=[]; devPts=[]; }
function addDevPt(pt){
  if (devPts.length>=2) clearDevPts();
  devPts.push(pt.clone());
  const s=new THREE.Mesh(new THREE.SphereGeometry(Math.max(1.2,modelRadius*0.02),12,12),
    new THREE.MeshBasicMaterial({color:0xffc24d}));
  s.position.copy(pt); scene.add(s); devMarkers.push(s);
  $('penInfo').textContent = devPts.length<2 ? 'Поставьте вторую точку аппарата.' : 'Зона аппарата задана. Нажмите «Спланировать КДО».';
}

// ---- Симметрия: средняя плоскость по 3 точкам + зеркало + авто-дистракция ----
let mirrorMesh = null, symHealthy = null, symTgtMarker = null, symTgtMode = false;
let midMode = false, midPts = [], midMarkers = [], midPlane = null; // midPlane={point,normal}
function markerMesh(color){ const m=new THREE.Mesh(new THREE.SphereGeometry(Math.max(1.6,modelRadius*0.02),16,16),
    new THREE.MeshBasicMaterial({ color, depthTest:false })); m.renderOrder=999; return m; }
// средняя плоскость: по 3 точкам (устойчиво к наклону головы), иначе X=0 + сдвиг
function midNormalPoint(){
  if (midPlane){ const off=(+$('midAdj').value)||0;
    return { point: midPlane.point.clone().add(midPlane.normal.clone().multiplyScalar(off)), normal: midPlane.normal.clone() }; }
  return { point: new THREE.Vector3((+$('midAdj').value)||0,0,0), normal: new THREE.Vector3(1,0,0) };
}
function mirrorAcross(p){                     // отражение точки относительно средней плоскости
  const {point,normal}=midNormalPoint();
  const d = p.clone().sub(point).dot(normal);
  return p.clone().sub(normal.clone().multiplyScalar(2*d));
}
function setMidMode(on){ midMode=on; $('midSetBtn').classList.toggle('armed', on);
  if(on){ setPenMode(false); setDevPtMode(false); setSymTgtMode(false); setPickMode(false); midPts=[];
    midMarkers.forEach(m=>scene.remove(m)); midMarkers=[];
    $('symInfo').textContent='Кликни 3 точки ПО СЕРЕДИНЕ черепа (напр. надпереносье, между резцами, затылок).'; } }
function addMidPt(pt){
  midPts.push(pt.clone()); const m=markerMesh(0x38a8ff); m.position.copy(pt); scene.add(m); midMarkers.push(m);
  if (midPts.length>=3){
    const [a,b,c]=midPts; const n=new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    const point=a.clone().add(b).add(c).multiplyScalar(1/3);
    midPlane={ point, normal:n }; setMidMode(false);
    $('symInfo').textContent='Средняя линия задана. Теперь «Зеркало» / «Ориентир» на здоровой стороне.';
    if (mirrorMesh){ rebuildMirror(); }
  } else $('symInfo').textContent=`Средняя линия: точка ${midPts.length}/3.`;
}
function rebuildMirror(){
  if(mirrorMesh){ scene.remove(mirrorMesh); mirrorMesh.geometry.dispose(); mirrorMesh=null; }
  if(!boneSurf) return;
  const P=boneSurf.positions, I=boneSurf.indices; const {point,normal}=midNormalPoint();
  const mp=new Float32Array(P.length); const v=new THREE.Vector3();
  for(let i=0;i<P.length;i+=3){ v.set(P[i],P[i+1],P[i+2]);
    const d=v.clone().sub(point).dot(normal); const r=v.sub(normal.clone().multiplyScalar(2*d));
    mp[i]=r.x; mp[i+1]=r.y; mp[i+2]=r.z; }
  const g=new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(mp,3));
  if(I) g.setIndex(new THREE.BufferAttribute(I,1)); g.computeVertexNormals();
  mirrorMesh=new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color:0x39d98a, transparent:true, opacity:0.3, side:THREE.DoubleSide, depthWrite:false }));
  scene.add(mirrorMesh);
}
function toggleMirror(){
  if (mirrorMesh){ scene.remove(mirrorMesh); mirrorMesh.geometry.dispose(); mirrorMesh=null; $('symInfo').textContent='Зеркало убрано.'; return; }
  if (!boneSurf){ alert('Сначала постройте 3D-модель.'); return; }
  if (!midPlane){ $('symInfo').textContent='Совет: сначала задай среднюю линию 3 точками — иначе зеркало по оси X.'; }
  rebuildMirror();
  $('symInfo').textContent='Зелёное — зеркало здоровой стороны (цель). Совмести через среднюю линию / «Сдвиг ср.».';
}
function setSymTgtMode(on){ symTgtMode=on; $('symTgtBtn').classList.toggle('armed', on);
  if(on){ setPenMode(false); setDevPtMode(false); setMidMode(false); setPickMode(false);
    $('symInfo').textContent='Кликни ориентир на ЗДОРОВОЙ стороне — его зеркало станет целью.'; } }
function setSymTarget(pt){
  symHealthy = pt.clone();
  const tgt = mirrorAcross(pt);
  if (symTgtMarker) scene.remove(symTgtMarker);
  symTgtMarker = markerMesh(0x39d98a); symTgtMarker.position.copy(tgt); scene.add(symTgtMarker);
  $('symInfo').textContent='Цель отмечена (зелёная). Нажми «Дистракция до симметрии».';
}
function clearSym(){
  if(mirrorMesh){ scene.remove(mirrorMesh); mirrorMesh.geometry.dispose(); mirrorMesh=null; }
  if(symTgtMarker){ scene.remove(symTgtMarker); symTgtMarker=null; }
  midMarkers.forEach(m=>scene.remove(m)); midMarkers=[]; midPts=[];
  symHealthy=null; symTgtMode=false; midMode=false;
  if($('symTgtBtn')) $('symTgtBtn').classList.remove('armed');
  if($('midSetBtn')) $('midSetBtn').classList.remove('armed');
}
// авто-подбор аппарата и величины дистракции для достижения симметрии
function planSymmetry(){
  if (!isCut){ alert('Сначала распилите модель (лучше карандашом по линии).'); return; }
  if (!symHealthy){ alert('Сначала отметь здоровый ориентир кнопкой «Здоровый ориентир».'); return; }
  const target = mirrorAcross(symHealthy);                  // куда должен попасть фрагмент
  // шарнир (у остеотомии) и дистальный ориентир фрагмента
  const app  = devPts.length>=1 ? devPts[0].clone() : cutP.clone();
  const land = devPts.length>=2 ? devPts[1].clone()
             : (fragMobileMesh ? new THREE.Box3().setFromObject(fragMobileMesh).getCenter(new THREE.Vector3()) : cutP.clone());
  const u = land.clone().sub(app);                          // текущий радиус-вектор
  const w = target.clone().sub(app);                        // желаемое направление
  const R = u.length();
  if (R < 1e-3 || w.length() < 1e-3){ alert('Ориентиры слишком близко. Поставь точки аппарата пошире.'); return; }
  let axis = new THREE.Vector3().crossVectors(u, w);
  if (axis.lengthSq() < 1e-8) axis.copy(cutN);              // почти коллинеарны — ось вдоль нормали распила
  axis.normalize();
  const theta = u.angleTo(w);                               // угол коррекции (рад)
  const angleDeg = theta * 180/Math.PI;
  const arcLen = R * theta;                                 // длина дистракции по дуге (мм)
  curDevice = selectDevice(angleDeg);
  arcDegCur = Math.min(angleDeg, curDevice.deg);
  arcRadCur = R;
  const C = app.clone(), r0 = u.clone();
  arcFrameCur = { C, a: axis, w: null, r0, pointAt:(t)=>C.clone().add(r0.clone().applyAxisAngle(axis, t)) };
  drawArc();
  mobileMode = 'arc';
  $('reqLen').value = Math.min(40, arcLen).toFixed(1); $('reqLenv').textContent = arcLen.toFixed(1)+' мм';
  $('reqDeg').value = Math.min(180, Math.round(angleDeg)); $('reqDegv').textContent = Math.round(angleDeg)+'°';
  $('arcDist').max = arcLen.toFixed(1); $('arcDist').value = arcLen.toFixed(1);
  moveAlongArc();
  // остаточная асимметрия: куда реально попал ориентир
  const landFinal = C.clone().add(r0.clone().applyAxisAngle(axis, arcDegCur*Math.PI/180));
  const resid = landFinal.distanceTo(target);
  $('kdoInfo').innerHTML = `<b style="color:var(--accent)">${curDevice.name}</b> · кривизна ${curDevice.deg}° · коррекция ${angleDeg.toFixed(0)}° · дистракция ${arcLen.toFixed(1)} мм`;
  $('symInfo').innerHTML = `Для симметрии: <b>${curDevice.name}</b>, раскрутить <b>${arcLen.toFixed(1)} мм</b> (≈${angleDeg.toFixed(0)}°). Остаточная асимметрия ≈ ${resid.toFixed(1)} мм.`;
  lastPlan = { mode:'symmetry', device:curDevice.name, deg:angleDeg, mm:arcLen, resid };
}

// ---- Измерения (линейка / угол / объём) ----
let measMode = null, measPts = [], measObjs = []; let lastPlan = null;
function clearMeas(){ measObjs.forEach(o=>scene.remove(o)); measObjs=[]; measPts=[];
  $('measVal').style.display='none'; }
function setMeasMode(mode){
  clearMeas();
  measMode = (measMode===mode)? null : mode;
  ['measDist','measAngle','measVol'].forEach(id=>$(id).classList.remove('armed'));
  if (measMode){ setPenMode(false); setDevPtMode(false); setSymTgtMode(false); setMidMode(false); setPickMode(false);
    $({dist:'measDist',angle:'measAngle',vol:'measVol'}[measMode]).classList.add('armed'); }
  if (measMode==='vol'){ measVolume(); measMode=null; $('measVol').classList.remove('armed'); return; }
  $('measInfo').textContent = measMode==='dist' ? 'Кликни 2 точки на кости — длина.' :
    measMode==='angle' ? 'Кликни 3 точки — угол во второй точке.' : 'Длина — 2 точки, угол — 3, прямо на кости.';
}
function addMeasPt(pt){
  measPts.push(pt.clone());
  const m=markerMesh(0xffc24d); m.position.copy(pt); scene.add(m); measObjs.push(m);
  const need = measMode==='angle'?3:2;
  if (measPts.length>=2){
    const g=new THREE.BufferGeometry().setFromPoints(measPts);
    const ln=new THREE.Line(g, new THREE.LineBasicMaterial({color:0xffc24d, depthTest:false})); ln.renderOrder=998;
    measObjs.push(ln); scene.add(ln);
  }
  if (measPts.length>=need){
    let txt;
    if (measMode==='dist'){ const d=measPts[0].distanceTo(measPts[1]); txt=`Длина: ${d.toFixed(1)} мм`; }
    else { const a=measPts[0].clone().sub(measPts[1]), b=measPts[2].clone().sub(measPts[1]);
      txt=`Угол: ${(a.angleTo(b)*180/Math.PI).toFixed(1)}°`; }
    $('measVal').textContent=txt; $('measVal').style.display='';
    measMode=null; ['measDist','measAngle'].forEach(id=>$(id).classList.remove('armed'));
    $('measInfo').textContent='Готово. «Очистить» — убрать метки.';
  }
}
function triVolume(pos){ // объём triangle-soup, см³ (дивергенция)
  let v6=0; for(let t=0;t<pos.length;t+=9){
    const ax=pos[t],ay=pos[t+1],az=pos[t+2], bx=pos[t+3],by=pos[t+4],bz=pos[t+5], cx=pos[t+6],cy=pos[t+7],cz=pos[t+8];
    v6 += ax*(by*cz-bz*cy) - ay*(bx*cz-bz*cx) + az*(bx*cy-by*cx); }
  return Math.abs(v6)/6/1000;
}
function meshWorldTris(mesh, mat){ const src=mesh.geometry.attributes.position.array; const out=new Float32Array(src.length);
  const v=new THREE.Vector3(); for(let i=0;i<src.length;i+=3){ v.set(src[i],src[i+1],src[i+2]); if(mat) v.applyMatrix4(mat);
    out[i]=v.x; out[i+1]=v.y; out[i+2]=v.z; } return out; }
function measVolume(){
  let vol, label;
  if (isCut && fragMobileMesh){ fragMobileGroup.updateMatrixWorld(true);
    vol=triVolume(meshWorldTris(fragMobileMesh, fragMobileMesh.matrixWorld)); label='подвижного фрагмента'; }
  else if (boneMesh){ vol=triVolume(expandIndexed(boneSurf)); label='всей кости'; }
  else { alert('Нет модели.'); return; }
  $('measVal').textContent=`Объём ${label}: ${vol.toFixed(1)} см³`; $('measVal').style.display='';
  $('measInfo').textContent='Объём считается по 3D-модели (приближённо).';
}
function expandIndexed(surf){ const P=surf.positions,I=surf.indices; if(!I) return P;
  const out=new Float32Array(I.length*3); for(let t=0;t<I.length;t++){ const a=I[t];
    out[t*3]=P[a*3]; out[t*3+1]=P[a*3+1]; out[t*3+2]=P[a*3+2]; } return out; }

// ---- Экспорт STL (для 3D-печати) и протокола ----
function downloadBlob(blob, name){ const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
function collectPlannedTris(){
  const parts=[];
  if (isCut){ if(fragFixed) parts.push(meshWorldTris(fragFixed,null));
    if(fragMobileMesh){ fragMobileGroup.updateMatrixWorld(true); parts.push(meshWorldTris(fragMobileMesh, fragMobileMesh.matrixWorld)); } }
  else if (boneSurf) parts.push(expandIndexed(boneSurf));
  let n=0; parts.forEach(p=>n+=p.length); const all=new Float32Array(n); let o=0;
  parts.forEach(p=>{ all.set(p,o); o+=p.length; }); return all;
}
function exportSTL(){
  if(!boneSurf){ alert('Сначала постройте 3D-модель.'); return; }
  const P=collectPlannedTris(); const nt=P.length/9|0;
  const buf=new ArrayBuffer(84+nt*50); const dv=new DataView(buf);
  dv.setUint32(80, nt, true); let off=84; const nrm=new THREE.Vector3(), a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  for(let t=0;t<P.length;t+=9){
    a.set(P[t],P[t+1],P[t+2]); b.set(P[t+3],P[t+4],P[t+5]); c.set(P[t+6],P[t+7],P[t+8]);
    nrm.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    dv.setFloat32(off,nrm.x,true); dv.setFloat32(off+4,nrm.y,true); dv.setFloat32(off+8,nrm.z,true); off+=12;
    for(const p of [a,b,c]){ dv.setFloat32(off,p.x,true); dv.setFloat32(off+4,p.y,true); dv.setFloat32(off+8,p.z,true); off+=12; }
    dv.setUint16(off,0,true); off+=2;
  }
  downloadBlob(new Blob([buf],{type:'application/sla'}), `KDO-plan-${Date.now()}.stl`);
  status(`STL сохранён · ${nt.toLocaleString('ru')} треуг.`); setTimeout(()=>status('',null),2500);
}
function exportProtocol(){
  const now=new Date().toLocaleString('ru-RU');
  const meas = $('measVal').style.display!=='none' ? $('measVal').textContent : '—';
  const plan = lastPlan ? (lastPlan.mode==='symmetry'
      ? `Аппарат <b>${lastPlan.device}</b>, дистракция <b>${lastPlan.mm.toFixed(1)} мм</b> (коррекция ${lastPlan.deg.toFixed(0)}°), остаточная асимметрия ${lastPlan.resid.toFixed(1)} мм.`
      : `Аппарат <b>${lastPlan.device}</b>, коррекция до ${lastPlan.deg.toFixed(0)}°.`)
    : 'Планирование КДО не выполнено.';
  const html=`<!doctype html><meta charset="utf-8"><title>Протокол планирования КДО</title>
<style>body{font-family:system-ui,Segoe UI,sans-serif;max-width:720px;margin:32px auto;color:#132;line-height:1.5;padding:0 18px}
h1{font-size:20px;border-bottom:2px solid #22c9bd;padding-bottom:8px}h2{font-size:14px;color:#0a8;margin-top:22px}
.k{color:#567;font-size:13px}.v{font-weight:600}table{border-collapse:collapse;width:100%;font-size:13px;margin-top:6px}
td{border:1px solid #dce;padding:6px 9px}</style>
<h1>Протокол виртуального планирования дистракционного остеогенеза</h1>
<p class="k">Сформировано: ${now} · КДО-Планировщик 3D (прототип, не медизделие)</p>
<h2>Исходные данные</h2>
<table><tr><td class="k">Серия</td><td>${($('meta').textContent||'—')}</td></tr>
<tr><td class="k">Порог кости (3D)</td><td>${threshold} HU</td></tr></table>
<h2>Остеотомия</h2><table><tr><td class="k">Статус</td><td>${isCut?'выполнена':'не выполнена'}</td></tr>
<tr><td class="k">Комментарий</td><td>${($('cutInfo').textContent||'').replace(/</g,'')}</td></tr></table>
<h2>Дистракция</h2><p>${plan}</p>
<h2>Измерения</h2><p>${meas}</p>
<h2>Заключение</h2><p>План носит предварительный характер и требует верификации врачом. Аппарат КДА подобран по угловой кривизне дуги (линейка 30/50/70/100/180°).</p>`;
  downloadBlob(new Blob([html],{type:'text/html'}), `KDO-protocol-${Date.now()}.html`);
  status('Протокол сохранён'); setTimeout(()=>status('',null),2500);
}

function setGroupRigid(group, quat, center, extraT) {
  const rc = center.clone().applyQuaternion(quat);
  group.quaternion.copy(quat);
  group.position.copy(center).sub(rc).add(extraT || new THREE.Vector3());
}

function applyMobileTransform() {
  if (!isCut || !fragMobileGroup || mobileMode === 'manual') return;
  if (mobileMode === 'arc' && arcFrameCur) { return; } // дугой управляет свой слайдер
  const dist=+$('mvDist').value, mx=+$('mvX').value, my=+$('mvY').value, rot=(+$('mvRot').value)*Math.PI/180;
  const quat = new THREE.Quaternion().setFromAxisAngle(cutN, rot);
  const extra = cutN.clone().multiplyScalar(dist*cutSign).add(new THREE.Vector3(mx,my,0));
  setGroupRigid(fragMobileGroup, quat, cutP, extra);
  $('mvDistv').textContent = dist.toFixed(1)+' мм'; $('mvXv').textContent = mx.toFixed(0);
  $('mvYv').textContent = my.toFixed(0); $('mvRotv').textContent = (+$('mvRot').value).toFixed(0)+'°';
}

// ---- Планирование КДА (криволинейная дистракция) ----
function arcAxis() {
  const d = cutN.clone().multiplyScalar(cutSign);       // направление выдвижения наружу
  // если поставлены 2 точки аппарата — ось дуги идёт вдоль линии аппарата
  if (devPts.length === 2) {
    let a = devPts[1].clone().sub(devPts[0]);
    a.sub(d.clone().multiplyScalar(a.dot(d)));           // перпендикуляр к направлению выдвижения
    if (a.lengthSq() > 1e-6) return { d, a: a.normalize() };
  }
  let up = new THREE.Vector3(0,0,1); if (Math.abs(d.dot(up))>0.9) up = new THREE.Vector3(0,1,0);
  let a = new THREE.Vector3().crossVectors(d, up).normalize();
  a.applyAxisAngle(d, (+$('arcRot').value)*Math.PI/180);  // «плоскость дуги»
  return { d, a };
}
function planKDO() {
  if (!isCut) { alert('Сначала распилите модель.'); return; }
  const req = +$('reqLen').value;          // планируемая длина дистракции, мм
  const need = +$('reqDeg').value;         // требуемый угол коррекции, градусы
  curDevice = selectDevice(need);
  const useDeg = Math.min(need, curDevice.deg);
  // ШАРНИР у зоны остеотомии (не «улетает»): вращаем фрагмент вокруг точки распила
  const app = devPts.length===2 ? devPts[0].clone().add(devPts[1]).multiplyScalar(0.5) : cutP.clone();
  let land = mobileCentroid ? mobileCentroid.clone() : app.clone().add(new THREE.Vector3(0,-modelRadius*0.4,0));
  let u = land.sub(app);
  if (u.length() < 5) u = cutN.clone().multiplyScalar(cutSign).multiplyScalar(modelRadius*0.4); // запас
  const R = u.length();
  const { a } = arcAxis();                  // ось поворота в плоскости распила
  arcRadCur = R; arcDegCur = useDeg;
  arcFrameCur = { C: app.clone(), a, r0: u.clone(), pointAt:(t)=>app.clone().add(u.clone().applyAxisAngle(a, t)) };
  drawArc();
  mobileMode = 'arc';
  const maxLen = R * useDeg * Math.PI/180;  // ход при полном градусе аппарата
  $('arcDist').max = maxLen.toFixed(1); $('arcDist').value = Math.min(req, maxLen).toFixed(1);
  moveAlongArc();
  const zone = devPts.length===2 ? ' · зона по точкам' : '';
  $('kdoInfo').innerHTML = `<b style="color:var(--accent)">${curDevice.name}</b> · кривизна ${curDevice.deg}° · коррекция ${useDeg.toFixed(0)}° · шарнир у распила${zone}`;
  lastPlan = { mode:'kdo', device:curDevice.name, deg:useDeg, mm:+$('arcDist').value };
}
function drawArc() {
  clearArc();
  const pts = arcPoints(arcFrameCur, arcDegCur*Math.PI/180, 60);
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, 60, Math.max(0.6, modelRadius*0.012), 8, false);
  arcMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x2fe4d6 }));
  scene.add(arcMesh);
}
function clearArc(){ if (arcMesh){ scene.remove(arcMesh); arcMesh.geometry.dispose(); arcMesh=null; } }
function moveAlongArc() {
  if (mobileMode!=='arc' || !arcFrameCur) return;
  const s = +$('arcDist').value;                 // длина вдоль дуги, мм
  const theta = Math.min(s / arcRadCur, arcDegCur*Math.PI/180);
  const quat = new THREE.Quaternion().setFromAxisAngle(arcFrameCur.a, theta);
  setGroupRigid(fragMobileGroup, quat, arcFrameCur.C, null);
  $('arcDistv').textContent = `${s.toFixed(1)} мм · ${(theta*180/Math.PI).toFixed(0)}°`;
}

function removeFrags(){ [fragFixed, fragMobileGroup].forEach(o=>{ if(o) scene.remove(o); }); fragFixed=fragMobileGroup=fragMobileMesh=null; if(gizmo) gizmo.detach(); }
function resetCut(silent){
  removeFrags(); clearArc(); clearDevPts(); clearSym(); lineCut=null; isCut=false; mobileMode='sliders'; arcFrameCur=null;
  if (boneMesh) boneMesh.visible = true;
  if (gizmo) gizmo.detach();
  if (!silent && $('cutInfo')) $('cutInfo').textContent = 'Задайте плоскость и нажмите «Распилить»';
}

// ---- Гизмо: привязка к плоскости / области / фрагментам ----
function attachGizmo(obj, mode){ if(!gizmo||!obj) return; gizmo.setMode(mode||'translate'); gizmo.attach(obj); }
function setPickMode(on){ pickMode = on; $('pickBtn').classList.toggle('armed', on); }

function bindOsteotomy() {
  const upd = () => {
    $('cutTiltXv').textContent = $('cutTiltX').value+'°'; $('cutTiltYv').textContent = $('cutTiltY').value+'°';
    $('cutOffv').textContent = $('cutOff').value+' мм';
    if (!isCut){ ensurePlaneViz(true); }
  };
  ['cutOrient','cutTiltX','cutTiltY','cutOff'].forEach(id => $(id).addEventListener('input', upd));
  const dimLbl = (id)=> $(id+'v').textContent = planeFull(id) ? 'вся' : ($(id).value+' мм');
  ['cutW','cutL','cutD'].forEach(id => $(id).addEventListener('input', ()=>{ dimLbl(id); if(!isCut) ensurePlaneViz(false); }));
  $('planeOn').addEventListener('change', ()=>{ if(!isCut) ensurePlaneViz(false); });
  $('movePlane').onclick = ()=>{ if(planeMesh){ if(!$('planeOn').checked){$('planeOn').checked=true; ensurePlaneViz(false);} gizmo.setMode('translate'); gizmo.attach(planeMesh); } };
  $('rotPlane').onclick = ()=>{ if(planeMesh){ if(!$('planeOn').checked){$('planeOn').checked=true; ensurePlaneViz(false);} gizmo.setMode('rotate'); gizmo.attach(planeMesh); } };
  $('cutDo').onclick = ()=>{ if(volume) doCut(); };
  $('cutReset').onclick = ()=>{ resetCut(false); ensurePlaneViz(true); };
  $('cutMobile').addEventListener('change', ()=>{ if(isCut) doCut(); });
  ['mvDist','mvX','mvY','mvRot'].forEach(id => $(id).addEventListener('input', ()=>{ mobileMode='sliders'; clearArc(); applyMobileTransform(); }));
  // гизмо для фрагментов
  $('pickBtn').onclick = ()=> setPickMode(!pickMode);
  $('gizMove').onclick = ()=> gizmo && gizmo.setMode('translate');
  $('gizRot').onclick  = ()=> gizmo && gizmo.setMode('rotate');
  // КДА
  $('arcRot').addEventListener('input', ()=>{ $('arcRotv').textContent=$('arcRot').value+'°'; if(mobileMode==='arc') planKDO(); });
  $('reqLen').addEventListener('input', ()=>{ $('reqLenv').textContent=$('reqLen').value+' мм'; });
  $('reqDeg').addEventListener('input', ()=>{ $('reqDegv').textContent=$('reqDeg').value+'°'; });
  $('planKDO').onclick = planKDO;
  $('arcDist').addEventListener('input', moveAlongArc);
  // сворачивание блоков-панелей
  document.querySelectorAll('.p-head').forEach(h=>{
    h.addEventListener('click', ()=>{ const p=$(h.dataset.panel); p.classList.toggle('collapsed');
      h.querySelector('.tg').textContent = p.classList.contains('collapsed') ? '▸' : '▾'; });
  });
  document.querySelectorAll('.panel').forEach(p=> p.addEventListener('dblclick', e=>e.stopPropagation()));
  // карандаш
  bindPen();
  $('penBtn').onclick = ()=> setPenMode(!penOn);
  $('penClear').onclick = clearPen;
  $('penCut').onclick = penCutDispatch;
  $('penSwap').onclick = swapFragment;
  $('penMode').addEventListener('change', clearPen);
  $('devPtBtn').onclick = ()=> setDevPtMode(!devPtMode);
  // симметрия
  $('midSetBtn').onclick = ()=> setMidMode(!midMode);
  $('midAdj').addEventListener('input', ()=>{ $('midAdjv').textContent=$('midAdj').value+' мм';
    if(mirrorMesh) rebuildMirror(); if(symHealthy) setSymTarget(symHealthy); });
  $('mirrorBtn').onclick = toggleMirror;
  $('symTgtBtn').onclick = ()=> setSymTgtMode(!symTgtMode);
  $('symPlanBtn').onclick = planSymmetry;
  // измерения и экспорт
  $('measDist').onclick = ()=> setMeasMode('dist');
  $('measAngle').onclick = ()=> setMeasMode('angle');
  $('measVol').onclick = ()=> setMeasMode('vol');
  $('measClear').onclick = clearMeas;
  $('exportSTL').onclick = exportSTL;
  $('exportProto').onclick = exportProtocol;
}

// ---------- UI ----------
function setupSliders() {
  planes.forEach(p => {
    const m = sliceMeta(p);
    const sl = $('sl-' + p); sl.max = m.count - 1; sl.value = idx[m.axis];
    sl.oninput = () => { idx[m.axis] = +sl.value; renderMPR(p); syncOthers(p); };
  });
}
function syncOthers(changed) { planes.filter(p => p !== changed).forEach(renderMPR); }

function bindWheel() {
  planes.forEach(p => {
    const cv = $('cv-' + p);
    cv.addEventListener('wheel', e => {
      if (!volume) return; e.preventDefault();
      const m = sliceMeta(p); const dir = e.deltaY > 0 ? 1 : -1;
      idx[m.axis] = Math.max(0, Math.min(m.count - 1, idx[m.axis] + dir));
      $('sl-' + p).value = idx[m.axis];
      renderMPR(p); syncOthers(p);
    }, { passive: false });
  });
}

let thrTimer;
function bindControls() {
  $('fileInput').addEventListener('change', e => loadFiles(e.target.files));
  $('loadBtn').onclick = () => $('fileInput').click();
  $('wc').oninput = e => { win.center = +e.target.value; $('wcval').textContent = win.center; renderAllMPR(); };
  $('ww').oninput = e => { win.width = +e.target.value; $('wwval').textContent = win.width; renderAllMPR(); };
  document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
    const [c, w] = b.dataset.preset.split(',').map(Number);
    win = { center: c, width: w }; $('wc').value = c; $('ww').value = w;
    $('wcval').textContent = c; $('wwval').textContent = w; renderAllMPR();
  });
  $('thr').oninput = e => {
    threshold = +e.target.value; $('thrval').textContent = threshold + ' HU';
    clearTimeout(thrTimer); thrTimer = setTimeout(rebuild3D, 200);
  };
  // drag&drop
  const dz = document.body;
  dz.addEventListener('dragover', e => { e.preventDefault(); });
  dz.addEventListener('drop', e => {
    e.preventDefault();
    if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
  });
  window.addEventListener('resize', () => { resize3D(); renderAllMPR(); });
}

// Двойной клик по окну → на весь экран, ещё раз → назад к 4 окнам.
let maximized = null;
function bindMaximize() {
  const grid = document.querySelector('.grid');
  document.querySelectorAll('.vp').forEach(vp => {
    vp.addEventListener('dblclick', () => {
      if (maximized === vp) {
        grid.classList.remove('maxed'); vp.classList.remove('active'); maximized = null;
      } else {
        document.querySelectorAll('.vp').forEach(v => v.classList.remove('active'));
        vp.classList.add('active'); grid.classList.add('maxed'); maximized = vp;
      }
      requestAnimationFrame(() => { resize3D(); renderAllMPR(); });
    });
  });
}

init3D(); bindControls(); bindWheel(); bindMaximize(); bindOsteotomy();
status('', null);
window.__loadFiles = loadFiles; // хук для авто-тестов
