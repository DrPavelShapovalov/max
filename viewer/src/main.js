import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildVolume } from './dicom.js';
import { extractSurface } from './mc.js';

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
  ctx.drawImage(off, 0, 0, m.w, m.h, ox, oy, dw, dh);
  // прицел (позиции других осей)
  ctx.strokeStyle = 'rgba(47,228,214,.55)'; ctx.lineWidth = 1;
  let u, v;
  if (plane === 'axial')   { u = idx[0] / volume.dims[0]; v = idx[1] / volume.dims[1]; }
  else if (plane === 'coronal') { u = idx[0] / volume.dims[0]; v = idx[2] / volume.dims[2]; }
  else { u = idx[1] / volume.dims[1]; v = idx[2] / volume.dims[2]; }
  const lx = ox + u * dw, ly = oy + v * dh;
  ctx.beginPath(); ctx.moveTo(lx, oy); ctx.lineTo(lx, oy + dh); ctx.moveTo(ox, ly); ctx.lineTo(ox + dw, ly); ctx.stroke();
  // подпись
  ctx.fillStyle = 'rgba(47,228,214,.9)'; ctx.font = '11px ui-monospace,monospace';
  ctx.fillText(`${plane.toUpperCase()}  ${k + 1}/${m.count}`, 8, 16);
}
function renderAllMPR() { if (volume) planes.forEach(renderMPR); }

// ---------- 3D ----------
let renderer, scene, camera, controls, boneMesh;
function init3D() {
  const cv = $('cv-3d');
  renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a1418);
  camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
  camera.position.set(0, -350, 120);
  controls = new OrbitControls(camera, cv); controls.enableDamping = true;
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const d1 = new THREE.DirectionalLight(0xffffff, 0.9); d1.position.set(1, -1, 1); scene.add(d1);
  const d2 = new THREE.DirectionalLight(0x88bbff, 0.4); d2.position.set(-1, 1, -0.5); scene.add(d2);
  resize3D();
  (function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();
}
function resize3D() {
  const cv = $('cv-3d'); const r = cv.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
}
async function rebuild3D() {
  if (!volume) return;
  await new Promise(r => setTimeout(r, 10));
  const t0 = performance.now();
  const surf = extractSurface(volume, threshold, 160);
  if (boneMesh) { scene.remove(boneMesh); boneMesh.geometry.dispose(); boneMesh.material.dispose(); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(surf.positions, 3));
  geo.setIndex(new THREE.BufferAttribute(surf.indices, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xe6ddc9, roughness: 0.62, metalness: 0.05, flatShading: false, side: THREE.DoubleSide });
  boneMesh = new THREE.Mesh(geo, mat); scene.add(boneMesh);
  // подогнать камеру
  geo.computeBoundingSphere();
  const rr = geo.boundingSphere.radius || 150;
  camera.position.set(0, -rr * 2.4, rr * 0.7); controls.target.set(0, 0, 0);
  $('info3d').textContent = `${surf.triCount.toLocaleString('ru')} треуг. · ${(performance.now() - t0 | 0)} мс · шаг ×${surf.step}`;
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
  window.addEventListener('resize', () => { resize3D(); });
}

init3D(); bindControls(); bindWheel();
status('', null);
window.__loadFiles = loadFiles; // хук для авто-тестов
