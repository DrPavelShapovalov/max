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
    if (devPtMode) {
      ray.setFromCamera(m, camera);
      const tgts = [fragFixed, fragMobileMesh, boneMesh].filter(o=>o && o.visible);
      const hit = ray.intersectObjects(tgts, false)[0];
      if (hit) addDevPt(hit.point);
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
let planeMesh = null, roiBox = null, fragFixed = null, fragMobileGroup = null, fragMobileMesh = null;
let arcMesh = null;
let isCut = false, cutN = null, cutP = null, cutSign = -1;
let mobileMode = 'sliders';        // 'sliders' | 'arc' | 'manual'
let curDevice = null, arcFrameCur = null, arcRadCur = 0, arcDegCur = 0;

// плоскость: источник истины — planeMesh (двигается слайдерами или гизмо)
function getPlaneN() { const n = new THREE.Vector3(0,0,1); if (planeMesh) n.applyQuaternion(planeMesh.quaternion); return n.normalize(); }
function getPlaneP() { return planeMesh ? planeMesh.position.clone() : new THREE.Vector3(); }

function ensurePlaneViz(fromSliders) {
  if (!planeMesh) {
    const m = new THREE.MeshBasicMaterial({ color: 0x2fe4d6, transparent: true, opacity: 0.20, side: THREE.DoubleSide, depthWrite: false });
    planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    planeMesh.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x2fe4d6, wireframe: true, transparent: true, opacity: 0.5 })));
    planeMesh.name = 'plane'; scene.add(planeMesh);
  }
  const s = modelRadius * 2.2; planeMesh.scale.set(s, s, 1);
  if (fromSliders) {
    const or = $('cutOrient').value;
    const tx = (+$('cutTiltX').value) * Math.PI/180, ty = (+$('cutTiltY').value) * Math.PI/180;
    let base = or === 'axial' ? new THREE.Vector3(0,0,1) : or === 'coronal' ? new THREE.Vector3(0,1,0) : new THREE.Vector3(1,0,0);
    const n = base.applyEuler(new THREE.Euler(tx, ty, 0)).normalize();
    planeMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), n);
    planeMesh.position.copy(n.multiplyScalar(+$('cutOff').value));
  }
  planeMesh.visible = !isCut;
}

function ensureRoiViz() {
  if (!roiBox) {
    roiBox = new THREE.Mesh(new THREE.BoxGeometry(1,1,1),
      new THREE.MeshBasicMaterial({ color: 0xffc24d, transparent: true, opacity: 0.10, depthWrite: false }));
    roiBox.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1)),
      new THREE.LineBasicMaterial({ color: 0xffc24d })));
    roiBox.name = 'roi'; scene.add(roiBox);
    roiBox.position.set(0,0,0);
  }
  const sx=+$('roiSX').value, sy=+$('roiSY').value, sz=+$('roiSZ').value;
  roiBox.scale.set(sx, sy, sz);
  roiBox.visible = $('roiOn').checked && !isCut;
}

// разделение triangle-soup боксом ROI (по центроиду, ROI без поворота)
function filterByBox(pos, box) {
  const inA=[], outA=[]; const c=box.position, s=box.scale;
  const hx=s.x/2, hy=s.y/2, hz=s.z/2;
  for (let t=0;t<pos.length;t+=9){
    const cx=(pos[t]+pos[t+3]+pos[t+6])/3, cy=(pos[t+1]+pos[t+4]+pos[t+7])/3, cz=(pos[t+2]+pos[t+5]+pos[t+8])/3;
    const inside = Math.abs(cx-c.x)<=hx && Math.abs(cy-c.y)<=hy && Math.abs(cz-c.z)<=hz;
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
  const n = getPlaneN(), p = getPlaneP();
  cutN = n.clone(); cutP = p.clone();
  const mobileSide = $('cutMobile').value; // 'A'(+) или 'B'(−)
  cutSign = mobileSide === 'A' ? 1 : -1;
  const { posA, posB } = splitByPlane(boneSurf.positions, boneSurf.indices, n, p);
  let fixedPos = mobileSide === 'B' ? posA : posB;
  let mobilePos = mobileSide === 'B' ? posB : posA;

  if ($('roiOn').checked) {           // локальный распил: подвижное = сторона ∩ ROI
    const f = filterByBox(mobilePos, roiBox);
    mobilePos = f.inside;
    // остальное присоединяем к фиксированному
    const merged = new Float32Array(fixedPos.length + f.outside.length);
    merged.set(fixedPos, 0); merged.set(f.outside, fixedPos.length); fixedPos = merged;
  }
  removeFrags();
  boneMesh.visible = false; planeMesh.visible = false; if (roiBox) roiBox.visible = false;

  fragFixed = makeMesh(fixedPos, 0xe6ddc9); fragFixed.name='fixed'; scene.add(fragFixed);
  fragMobileMesh = makeMesh(mobilePos, 0x66d9e8); fragMobileMesh.name='mobile';
  fragMobileGroup = new THREE.Group(); fragMobileGroup.add(fragMobileMesh); fragMobileGroup.name='mobile';
  scene.add(fragMobileGroup);

  isCut = true; mobileMode = 'sliders';
  ['mvDist','mvX','mvY','mvRot'].forEach(id => $(id).value = 0);
  applyMobileTransform();
  clearArc();
  const triM = mobilePos.length/9|0;
  $('cutInfo').textContent = `Распил · подвижный фрагмент ${triM.toLocaleString('ru')} треуг.` + ($('roiOn').checked?' (локально)':'');
}

// ---- Карандаш: распил по нарисованному от руки ----
let penOn = false, penPts = [], penDrawing = false;
let lineComps = null, penCandIdx = 0;   // кэш связных компонент для «Поменять фрагмент»
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

// союз-поиск
function makeDSU(n){ const p=new Int32Array(n); for(let i=0;i<n;i++)p[i]=i;
  const find=(x)=>{ while(p[x]!==x){ p[x]=p[p[x]]; x=p[x]; } return x; };
  const uni=(a,b)=>{ a=find(a); b=find(b); if(a!==b)p[a]=b; };
  return { find, uni }; }

// Локальный распил по линии: рвём связность меша вдоль нарисованной линии,
// выделяем связные компоненты, подвижным делаем компоненту у линии.
function doLineCut(){
  const dc = penCanvas(); const rw = dc.getBoundingClientRect();
  const poly = penPts.map(p=>({x:p.x,y:p.y}));
  const P = boneSurf.positions, I = boneSurf.indices;
  if (!I) { doLoopCut(); return; }               // без индексов связность не построить
  const nv = P.length/3, v=new THREE.Vector3();
  const side = new Int8Array(nv), sx=new Float32Array(nv), sy=new Float32Array(nv);
  for (let i=0;i<nv;i++){ const s=projVert(P,i,rw,v); sx[i]=s.x; sy[i]=s.y; side[i]=sideOfLine(s.x,s.y,poly); }
  const dsu = makeDSU(nv);
  const tri = I.length/3;
  const edge=(a,b)=>{ if(side[a]===side[b]) dsu.uni(a,b); };  // не соединяем через линию
  for (let t=0;t<tri;t++){ const a=I[t*3],b=I[t*3+1],c=I[t*3+2]; edge(a,b); edge(b,c); edge(c,a); }
  // группируем треугольники по компонентам (по стороне-большинству вершин)
  const comps = new Map();
  for (let t=0;t<tri;t++){
    const a=I[t*3],b=I[t*3+1],c=I[t*3+2];
    const sSum=side[a]+side[b]+side[c]; const maj = sSum>=0?1:-1;
    const rep = side[a]===maj?a : side[b]===maj?b : c;
    const root = dsu.find(rep);
    let e = comps.get(root); if(!e){ e={tris:[], n:0, cx:0, cy:0}; comps.set(root,e); }
    e.tris.push(t); e.n++;
    e.cx += (sx[a]+sx[b]+sx[c])/3; e.cy += (sy[a]+sy[b]+sy[c])/3;
  }
  // кандидаты: сортируем по близости центроида к середине линии
  const mid = poly[Math.floor(poly.length/2)];
  const arr = [...comps.values()].filter(e=>e.n>=8).map(e=>{ e.cx/=e.n; e.cy/=e.n;
    e.d=(e.cx-mid.x)**2+(e.cy-mid.y)**2; return e; }).sort((a,b)=>a.d-b.d);
  if (!arr.length) { alert('Линия не пересекла кость. Проведите её прямо по кости.'); return; }
  lineComps = { arr, P, I }; penCandIdx = 0;
  buildFragFromComp();
}
function buildFragFromComp(){
  const { arr, P, I } = lineComps;
  const mob = arr[penCandIdx % arr.length];
  const mobSet = new Set(mob.tris);
  const inA=[], outA=[];
  const tri = I.length/3;
  for (let t=0;t<tri;t++){ const a=I[t*3],b=I[t*3+1],c=I[t*3+2];
    const dst = mobSet.has(t)?inA:outA;
    dst.push(P[a*3],P[a*3+1],P[a*3+2], P[b*3],P[b*3+1],P[b*3+2], P[c*3],P[c*3+1],P[c*3+2]); }
  finalizeFrag(new Float32Array(inA), new Float32Array(outA), `Линия · фрагмент ${(mob.n).toLocaleString('ru')} треуг.`);
  $('penInfo').textContent = `Готово. Если отделился не тот кусок — «Поменять фрагмент». Всего компонент: ${arr.length}.`;
}
function swapFragment(){ if(!lineComps){ return; } penCandIdx++; buildFragFromComp(); }

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
// общая сборка фрагментов + оси дистракции (вдоль взгляда камеры)
function finalizeFrag(mobilePos, fixedPos, info){
  removeFrags(); clearDevPts();
  boneMesh.visible=false; if(planeMesh) planeMesh.visible=false; if(roiBox) roiBox.visible=false;
  fragFixed = makeMesh(fixedPos, 0xe6ddc9); fragFixed.name='fixed'; scene.add(fragFixed);
  fragMobileMesh = makeMesh(mobilePos, 0x66d9e8); fragMobileMesh.name='mobile';
  fragMobileGroup = new THREE.Group(); fragMobileGroup.add(fragMobileMesh); fragMobileGroup.name='mobile';
  scene.add(fragMobileGroup);
  const box=new THREE.Box3().setFromObject(fragMobileMesh); const ctr=box.getCenter(new THREE.Vector3());
  cutN=new THREE.Vector3(); camera.getWorldDirection(cutN); cutN.multiplyScalar(-1).normalize();
  cutP=ctr; cutSign=1;
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
  const req = +$('reqLen').value;          // планируемая длина дистракции, мм (длина дуги)
  const need = +$('reqDeg').value;         // требуемый угол коррекции, градусы
  curDevice = selectDevice(need);          // аппарат по угловой кривизне (30..180)
  const useDeg = Math.min(need, curDevice.deg); // фактический разворот ≤ градуса аппарата
  arcDegCur = useDeg;
  const R = arcRadius(req, useDeg);        // радиус дуги выводим из длины и угла
  const { d, a } = arcAxis();
  // точка приложения дуги: середина зоны аппарата, если заданы точки
  const P0 = devPts.length===2 ? devPts[0].clone().add(devPts[1]).multiplyScalar(0.5) : cutP.clone();
  arcFrameCur = arcFrame(P0, d, a, R);
  arcRadCur = R;
  drawArc();
  mobileMode = 'arc';
  $('arcDist').max = req.toFixed(1); $('arcDist').value = req;
  moveAlongArc();
  const zone = devPts.length===2 ? ' · зона по точкам' : '';
  $('kdoInfo').innerHTML = `<b style="color:var(--accent)">${curDevice.name}</b> · кривизна дуги ${curDevice.deg}° · коррекция ${useDeg.toFixed(0)}° · дистракция ${req.toFixed(1)} мм · радиус ≈ ${R.toFixed(0)} мм${zone}`;
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
  removeFrags(); clearArc(); clearDevPts(); lineComps=null; isCut=false; mobileMode='sliders'; arcFrameCur=null;
  if (boneMesh) boneMesh.visible = true;
  if (planeMesh) planeMesh.visible = false; if (roiBox) roiBox.visible = false;
  if (gizmo) gizmo.detach();
  if (!silent && $('cutInfo')) $('cutInfo').textContent = 'Задайте плоскость и нажмите «Распилить»';
}

// ---- Гизмо: привязка к плоскости / области / фрагментам ----
function attachGizmo(obj, mode){ if(!gizmo||!obj) return; gizmo.setMode(mode||'translate'); gizmo.attach(obj); }
function setPickMode(on){ pickMode = on; $('pickBtn').classList.toggle('cp-act', on); $('pickBtn').classList.toggle('cp-ghost', !on); }

function bindOsteotomy() {
  const upd = () => {
    $('cutTiltXv').textContent = $('cutTiltX').value+'°'; $('cutTiltYv').textContent = $('cutTiltY').value+'°';
    $('cutOffv').textContent = $('cutOff').value+' мм';
    if (!isCut){ ensurePlaneViz(true); }
  };
  ['cutOrient','cutTiltX','cutTiltY','cutOff'].forEach(id => $(id).addEventListener('input', upd));
  ['roiSX','roiSY','roiSZ'].forEach(id => $(id).addEventListener('input', ()=>{ $(id+'v').textContent=$(id).value; ensureRoiViz(); }));
  $('roiOn').addEventListener('change', ()=>{ ensureRoiViz(); });
  $('movePlane').onclick = ()=>{ if(planeMesh){ gizmo.setMode('translate'); gizmo.attach(planeMesh); } };
  $('rotPlane').onclick = ()=>{ if(planeMesh){ gizmo.setMode('rotate'); gizmo.attach(planeMesh); } };
  $('moveRoi').onclick  = ()=>{ ensureRoiViz(); if(roiBox){ gizmo.setMode('translate'); gizmo.attach(roiBox); } };
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
  $('cpHead').onclick = ()=> $('cutpanel').classList.toggle('collapsed');
  // карандаш
  bindPen();
  $('penBtn').onclick = ()=> setPenMode(!penOn);
  $('penClear').onclick = clearPen;
  $('penCut').onclick = penCutDispatch;
  $('penSwap').onclick = swapFragment;
  $('penMode').addEventListener('change', clearPen);
  $('devPtBtn').onclick = ()=> setDevPtMode(!devPtMode);
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
