import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { loadDicom, assembleSeries } from './dicom.js';
import { extractSurface } from './mc.js';
import { segmentMandible } from './seg.js';
import { traceMandibularCanal } from './nerve.js';
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
let dicomGroups = null, curSeries = 0;
async function loadFiles(fileList) {
  const files = Array.from(fileList).filter(f => !f.name.startsWith('.'));
  if (!files.length) return;
  status('Загрузка…', 0);
  try {
    const { groups, series } = await loadDicom(files, (p, m) => status(m, p));
    dicomGroups = groups;
    buildSeriesTabs(series);
    // серия по умолчанию: костная (для 3D) если есть, иначе самая большая
    const def = series.findIndex(s=>s.isBone);
    await loadSeries(def>=0 ? def : 0);
  } catch (e) {
    if (e.code === 'COMPRESSED') {
      status('');
      alert('Эта серия сжата (JPEG/JPEG2000). Экспортируй серию как «uncompressed» из ВИДАР/RadiAnt и загрузи снова.');
    } else {
      status('');
      alert('Ошибка загрузки: ' + e.message);
      console.error(e);
    }
  }
}
async function loadSeries(i){
  if(!dicomGroups) return;
  curSeries = i;
  status('Сборка серии…', 0.5);
  const vol = await assembleSeries(dicomGroups, i, (p,m)=>status(m,p));
  volume = vol;
  win = { ...vol.window };
  threshold = 300;
  idx = [vol.dims[0]>>1, vol.dims[1]>>1, vol.dims[2]>>1];
  $('wc').value = win.center; $('ww').value = win.width; $('wcval').textContent=win.center; $('wwval').textContent=win.width;
  $('thr').value = threshold; $('thrval').textContent = threshold + ' HU';
  $('meta').textContent = `${vol.modality||'CT'} · ${vol.dims.join('×')} · ${vol.spacing.map(s=>s.toFixed(2)).join('/')} мм · HU ${vol.min}…${vol.max}`;
  document.querySelectorAll('#seriesTabs .tab').forEach((t,k)=>t.classList.toggle('active',k===i));
  mprMeas={axial:[],coronal:[],sagittal:[]};
  resetCut(true);
  setupSliders(); $('dropHint').style.display='none';
  await sliceFlip();
  status('Реконструкция 3D…', 0.9);
  renderAllMPR();
  await rebuild3D();
  ensurePlaneViz();
  status('', null);
}
function buildSeriesTabs(series){
  const bar = $('seriesTabs'); bar.innerHTML='';
  let tabs;
  if (series.length>1){
    tabs = series.map(s=>({ label:(s.isBone?'🦴 ':'◍ ')+s.label, onClick:()=>loadSeries(s.index) }));
  } else {
    // одна серия → два режима-вкладки (как в ВИДАР): костный / мягкотканный
    tabs = [
      { label:'🦴 Костный режим', onClick:()=>{ applyWin(300,1500); markTab(0); } },
      { label:'◍ Мягкие ткани',  onClick:()=>{ applyWin(40,400);  markTab(1); } },
    ];
  }
  tabs.forEach((t,k)=>{ const el=document.createElement('div'); el.className='tab'+(k===0?' active':'');
    el.textContent=t.label; el.onclick=()=>{ t.onClick(); }; bar.appendChild(el); });
  bar.style.display = 'flex';
}
function markTab(k){ document.querySelectorAll('#seriesTabs .tab').forEach((t,i)=>t.classList.toggle('active',i===k)); }
function applyWin(c,w){ win={center:c,width:w}; $('wc').value=c; $('ww').value=w; $('wcval').textContent=c; $('wwval').textContent=w; if(volume) renderAllMPR(); }

// быстрая прокрутка аксиальных срезов во время загрузки (визуализация)
async function sliceFlip(){
  const m = sliceMeta('axial'); const N = m.count; if (N<2) return;
  const steps = Math.min(48, N);
  for (let i=0;i<steps;i++){
    idx[2] = Math.min(N-1, Math.floor(i/(steps-1)*(N-1)));
    $('sl-axial').value = idx[2]; renderMPR('axial');
    status(`Чтение срезов… ${Math.round(i/(steps-1)*100)}%`, i/(steps-1));
    await new Promise(r=>setTimeout(r, 22));
  }
  idx = [m2center(0), m2center(1), m2center(2)];
}
function m2center(ax){ const d=volume.dims; return d[ax]>>1; }

// ---------- MPR ----------
const planes = ['axial', 'coronal', 'sagittal'];
function sliceMeta(plane) {
  const [nx, ny, nz] = volume.dims;
  const [sx, sy, sz] = volume.spacing;
  if (plane === 'axial')    return { w: nx, h: ny, pw: nx * sx, ph: ny * sy, count: nz, axis: 2 };
  if (plane === 'coronal')  return { w: nx, h: nz, pw: nx * sx, ph: nz * sz, count: ny, axis: 1 };
  return { w: ny, h: nz, pw: ny * sy, ph: nz * sz, count: nx, axis: 0 }; // sagittal
}
// один воксель среза (для сэмплинга/плотности)
function voxel(plane, a, b, k){
  const [nx, ny, nz] = volume.dims; const d = volume.data;
  if (plane === 'axial')   return d[k*nx*ny + b*nx + a];
  if (plane === 'coronal') return d[b*nx*ny + k*nx + a];
  return d[b*nx*ny + k + a*nx]; // sagittal
}
function sampleSlice(plane, k, w, h) {
  const m = sliceMeta(plane); const half = (slabN>1)? (slabN>>1) : 0;
  const out = new Int16Array(w * h);
  for (let b=0;b<h;b++) for (let a=0;a<w;a++){
    if (!half){ out[b*w+a] = voxel(plane,a,b,k); continue; }
    // толстый срез: усреднение соседних срезов (наложение + размытие, видно ориентиры)
    let sum=0,n=0;
    for (let s=-half;s<=half;s++){ const kk=k+s; if(kk<0||kk>=m.count) continue; sum+=voxel(plane,a,b,kk); n++; }
    out[b*w+a] = n? (sum/n)|0 : voxel(plane,a,b,k);
  }
  return out;
}
// ---------- Косой (полуаксиальный / панорамный) реформат ----------
let oblique = { on:false, angle:0 };
// Крест-указатель как в Vidar: на каждой плоскости свой угол наклона (превращение
// в «икс» = косой реформат в плоскости) — тянется мышью за поворотную рукоятку.
let xhair = { axial:{angle:0}, coronal:{angle:0}, sagittal:{angle:0} };
function planeBasis(plane){
  const [nx,ny,nz]=volume.dims, [sx,sy,sz]=volume.spacing;
  if(plane==='axial')   return { e1:[1,0,0], e2:[0,1,0], e3:[0,0,1], Wmm:nx*sx, Hmm:ny*sy, ax:2, flipY:false };
  if(plane==='coronal') return { e1:[1,0,0], e2:[0,0,1], e3:[0,1,0], Wmm:nx*sx, Hmm:nz*sz, ax:1, flipY:true };
  return { e1:[0,1,0], e2:[0,0,1], e3:[1,0,0], Wmm:ny*sy, Hmm:nz*sz, ax:0, flipY:true }; // sagittal
}
// косой реформат В ПЛОСКОСТИ на угол xhair[plane].angle (наклон креста → «икс»)
function renderReslice(plane){
  const cv=$('cv-'+plane), ctx=cv.getContext('2d');
  const [nx,ny,nz]=volume.dims, [sx,sy,sz]=volume.spacing;
  const B=planeBasis(plane);
  const cxmm=idx[0]*sx, cymm=idx[1]*sy, czmm=idx[2]*sz;
  const th=(xhair[plane].angle||0)*Math.PI/180, cs=Math.cos(th), sn=Math.sin(th);
  // повёрнутые оси в плоскости
  const e1=[B.e1[0]*cs+B.e2[0]*sn, B.e1[1]*cs+B.e2[1]*sn, B.e1[2]*cs+B.e2[2]*sn];
  const e2=[-B.e1[0]*sn+B.e2[0]*cs, -B.e1[1]*sn+B.e2[1]*cs, -B.e1[2]*sn+B.e2[2]*cs];
  const nrm=B.e3;
  const Wmm=B.Wmm, Hmm=B.Hmm, step=Math.min(sx,sy,sz);
  const outW=Math.min(700,Math.round(Wmm/step)), outH=Math.min(700,Math.round(Hmm/step));
  const du=Wmm/outW, dv=Hmm/outH;
  const slabHalf=(slabN>1)?(slabN*Math.min(sx,sy,sz))/2:0;
  const nsteps=slabHalf>0?Math.max(1,Math.round(slabHalf/step)):0;
  const lo=win.center-win.width/2, span=win.width||1;
  const imgc=document.createElement('canvas'); imgc.width=outW; imgc.height=outH;
  const img=new ImageData(outW,outH); const dta=img.data;
  for(let v=0;v<outH;v++){ const ev=(v-outH/2)*dv;
    for(let u=0;u<outW;u++){ const eu=(u-outW/2)*du;
      const bx=cxmm+eu*e1[0]+ev*e2[0], by=cymm+eu*e1[1]+ev*e2[1], bz=czmm+eu*e1[2]+ev*e2[2];
      let val;
      if(nsteps===0) val=sampleVoxelMM(bx,by,bz);
      else { let s=0,c=0; for(let t=-nsteps;t<=nsteps;t++){ const o=t*step; s+=sampleVoxelMM(bx+o*nrm[0],by+o*nrm[1],bz+o*nrm[2]); c++; } val=s/c; }
      let g=(val-lo)/span; g=g<0?0:g>1?1:g; g=(g*255)|0;
      const oo=(v*outW+u)*4; dta[oo]=dta[oo+1]=dta[oo+2]=g; dta[oo+3]=255;
    } }
  imgc.getContext('2d').putImageData(img,0,0);
  const CW=cv.width, CH=cv.height; ctx.fillStyle='#000'; ctx.fillRect(0,0,CW,CH);
  const ar=Wmm/Hmm; let dw=CW,dh=CW/ar; if(dh>CH){dh=CH;dw=CH*ar;} const ox=(CW-dw)/2,oy=(CH-dh)/2;
  ctx.imageSmoothingEnabled=true;
  if(B.flipY){ ctx.save(); ctx.translate(ox,oy+dh); ctx.scale(1,-1); ctx.drawImage(imgc,0,0,outW,outH,0,0,dw,dh); ctx.restore(); }
  else ctx.drawImage(imgc,0,0,outW,outH,ox,oy,dw,dh);
  mprLayout[plane]={ ox,oy,dw,dh, flipY:B.flipY, m:{pw:Wmm,ph:Hmm}, k:idx[B.ax] };
  drawCrosshair(plane, ctx, ox,oy,dw,dh);
  drawMprMeas(plane, ctx);
  ctx.fillStyle='rgba(47,228,214,.9)'; ctx.font='11px ui-monospace,monospace';
  ctx.fillText(`${plane.toUpperCase()} косой ${xhair[plane].angle}°${slabN>1?'  ⊟'+slabN+' срез':''}`, 8, 16);
}
// рисуем крест с рукоятками: центр (перенос), толщина (band+handle), поворот (◆)
function drawCrosshair(plane, ctx, ox,oy,dw,dh){
  const dims=volume.dims;
  let u,v;
  if(plane==='axial'){ u=idx[0]/dims[0]; v=idx[1]/dims[1]; }
  else if(plane==='coronal'){ u=idx[0]/dims[0]; v=idx[2]/dims[2]; }
  else { u=idx[1]/dims[1]; v=idx[2]/dims[2]; }
  const flipY = plane!=='axial';
  const cx=ox+u*dw, cy=oy+(flipY?(1-v):v)*dh;
  const th=(xhair[plane].angle||0)*Math.PI/180, cs=Math.cos(th), sn=Math.sin(th);
  const sy = flipY?-1:1;                          // экран: у флипнутых плоскостей ось v идёт вверх
  // единичные направления линий креста (на экране; y вниз)
  const d1={x:cs, y:sy*sn}, d2={x:-sn, y:sy*cs};
  const L=Math.max(dw,dh);
  ctx.save();
  ctx.strokeStyle='rgba(47,228,214,.55)'; ctx.lineWidth=1;
  ctx.beginPath();
  ctx.moveTo(cx-d1.x*L, cy-d1.y*L); ctx.lineTo(cx+d1.x*L, cy+d1.y*L);
  ctx.moveTo(cx-d2.x*L, cy-d2.y*L); ctx.lineTo(cx+d2.x*L, cy+d2.y*L);
  ctx.stroke();
  // полоса толщины (slab) вдоль d1, ширина = slab мм в пикселях
  const L2=mprLayout[plane]; const pxPerMM = L2 ? (L2.dw/L2.m.pw) : 1;
  const slabMM = slabN>1 ? slabN*Math.min(...volume.spacing) : 0;
  if(slabMM>0){ const hw=slabMM*pxPerMM/2;
    ctx.strokeStyle='rgba(255,194,77,.5)'; ctx.setLineDash([4,3]);
    ctx.beginPath();
    ctx.moveTo(cx-d2.x*hw-d1.x*L, cy-d2.y*hw-d1.y*L); ctx.lineTo(cx-d2.x*hw+d1.x*L, cy-d2.y*hw+d1.y*L);
    ctx.moveTo(cx+d2.x*hw-d1.x*L, cy+d2.y*hw-d1.y*L); ctx.lineTo(cx+d2.x*hw+d1.x*L, cy+d2.y*hw+d1.y*L);
    ctx.stroke(); ctx.setLineDash([]);
  }
  // рукоятки
  const HD=42;                                   // расстояние рукояток от центра, px
  // толщина: квадрат на оси d2 (тяни в бок → утолщение)
  const tH={ x:cx+d2.x*HD, y:cy+d2.y*HD };
  ctx.fillStyle='rgba(255,194,77,.95)'; ctx.fillRect(tH.x-4,tH.y-4,8,8);
  // поворот: ромб на оси d1 (тяни → «икс»/косой)
  const rH={ x:cx+d1.x*HD, y:cy+d1.y*HD };
  ctx.fillStyle='rgba(47,228,214,.95)'; ctx.save(); ctx.translate(rH.x,rH.y); ctx.rotate(Math.PI/4); ctx.fillRect(-4,-4,8,8); ctx.restore();
  // центр
  ctx.fillStyle='rgba(47,228,214,.95)'; ctx.beginPath(); ctx.arc(cx,cy,3.2,0,7); ctx.fill();
  ctx.restore();
  xhairScreen[plane]={ cx, cy, d1, d2, HD, tH, rH };
}
let xhairScreen={};
function sampleVoxelMM(wx, wy, wz){          // мм → ближайший воксель
  const [nx,ny,nz]=volume.dims, [sx,sy,sz]=volume.spacing, d=volume.data;
  const a=Math.round(wx/sx), b=Math.round(wy/sy), c=Math.round(wz/sz);
  if(a<0||a>=nx||b<0||b>=ny||c<0||c>=nz) return -1000;
  return d[c*nx*ny + b*nx + a];
}
function renderOblique(){
  const cv=$('cv-coronal'), ctx=cv.getContext('2d');
  const [nx,ny,nz]=volume.dims, [sx,sy,sz]=volume.spacing;
  // центр — по прицелу; наклон α вокруг оси L-R (полуаксиальный ↔ полукоронарный)
  const cxmm=idx[0]*sx, cymm=idx[1]*sy, czmm=idx[2]*sz;
  const a=oblique.angle*Math.PI/180;
  const e1=[1,0,0];                          // L-R
  const e2=[0, Math.cos(a), Math.sin(a)];    // наклон между A-P и S-I
  const nrm=[0, -Math.sin(a), Math.cos(a)];  // нормаль (для толстого слоя)
  const Wmm=nx*sx, Hmm=Math.max(ny*sy, nz*sz);
  const step=Math.min(sx,sy,sz);
  const outW=Math.min(700, Math.round(Wmm/step)), outH=Math.min(700, Math.round(Hmm/step));
  const du=Wmm/outW, dv=Hmm/outH;
  const slabHalf=(slabN>1)?(slabN*Math.min(sx,sy,sz))/2:0;
  const nsteps=slabHalf>0?Math.max(1,Math.round(slabHalf/step)):0;
  const lo=win.center-win.width/2, span=win.width||1;
  const imgc=document.createElement('canvas'); imgc.width=outW; imgc.height=outH;
  const img=new ImageData(outW,outH); const dta=img.data;
  for(let v=0;v<outH;v++){ const ev=(v-outH/2)*dv;
    for(let u=0;u<outW;u++){ const eu=(u-outW/2)*du;
      const bx=cxmm+eu*e1[0]+ev*e2[0], by=cymm+eu*e1[1]+ev*e2[1], bz=czmm+eu*e1[2]+ev*e2[2];
      let val;
      if(nsteps===0){ val=sampleVoxelMM(bx,by,bz); }
      else { let s=0,cnt=0; for(let t=-nsteps;t<=nsteps;t++){ const o=t*step;
        s+=sampleVoxelMM(bx+o*nrm[0], by+o*nrm[1], bz+o*nrm[2]); cnt++; } val=s/cnt; }
      let g=(val-lo)/span; g=g<0?0:g>1?1:g; g=(g*255)|0;
      const oo=(v*outW+u)*4; dta[oo]=dta[oo+1]=dta[oo+2]=g; dta[oo+3]=255;
    } }
  imgc.getContext('2d').putImageData(img,0,0);
  const CW=cv.width, CH=cv.height; ctx.fillStyle='#000'; ctx.fillRect(0,0,CW,CH);
  const ar=Wmm/Hmm; let dw=CW,dh=CW/ar; if(dh>CH){dh=CH;dw=CH*ar;} const ox=(CW-dw)/2,oy=(CH-dh)/2;
  ctx.imageSmoothingEnabled=true;
  ctx.save(); ctx.translate(ox,oy+dh); ctx.scale(1,-1); ctx.drawImage(imgc,0,0,outW,outH,0,0,dw,dh); ctx.restore();
  mprLayout['coronal']={ ox,oy,dw,dh, flipY:true, m:{pw:Wmm,ph:Hmm}, k:idx[1] };
  drawMprMeas('coronal', ctx);
  ctx.fillStyle='rgba(47,228,214,.9)'; ctx.font='11px ui-monospace,monospace';
  ctx.fillText(`OBLIQUE ${oblique.angle}°${slabN>1?'  ⊟'+slabN:''}`, 8, 16);
}
function renderMPR(plane) {
  if (plane==='coronal' && oblique.on && volume){ renderOblique(); return; }
  if (volume && xhair[plane] && xhair[plane].angle){ renderReslice(plane); return; }  // косой в плоскости (крест-«икс»)
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
  // сохранить раскладку для перевода клик↔мм
  mprLayout[plane] = { ox, oy, dw, dh, flipY, m, k };
  // прицел-указатель Vidar (центр/толщина/поворот)
  drawCrosshair(plane, ctx, ox, oy, dw, dh);
  drawMprMeas(plane, ctx);
  // подпись
  ctx.fillStyle = 'rgba(47,228,214,.9)'; ctx.font = '11px ui-monospace,monospace';
  ctx.fillText(`${plane.toUpperCase()}  ${k + 1}/${m.count}${slabN>1?'  ⊟'+slabN:''}`, 8, 16);
}
// ---------- измерения на MPR ----------
let slabN = 1;
let mprLayout = {};
let mprMode = null;                 // null|'dist'|'angle'|'dens'
let mprMeas = { axial:[], coronal:[], sagittal:[] };
let mprDraft = null;                // текущее незавершённое измерение
function frac2px(plane, f){ const L=mprLayout[plane]; return { x:L.ox+f.fx*L.dw, y:L.oy+(L.flipY?(1-f.fy):f.fy)*L.dh }; }
function px2frac(plane, x, y){ const L=mprLayout[plane]; let fx=(x-L.ox)/L.dw, fy=(y-L.oy)/L.dh; if(L.flipY) fy=1-fy; return {fx,fy}; }
function fracDistMM(plane, a, b){ const L=mprLayout[plane]; const dx=(a.fx-b.fx)*L.m.pw, dy=(a.fy-b.fy)*L.m.ph; return Math.hypot(dx,dy); }
function drawMprMeas(plane, ctx){
  const L=mprLayout[plane]; if(!L) return;
  const list = mprMeas[plane].filter(o=>o.k===L.k).concat(mprDraft && mprDraft.plane===plane ? [mprDraft] : []);
  ctx.lineWidth=1.5; ctx.font='11px ui-monospace,monospace';
  for(const o of list){
    const P=o.pts.map(f=>frac2px(plane,f));
    if(o.type==='dist' && P.length>=1){ ctx.strokeStyle='#ffc24d'; ctx.fillStyle='#ffc24d';
      if(P.length>=2){ ctx.beginPath(); ctx.moveTo(P[0].x,P[0].y); ctx.lineTo(P[1].x,P[1].y); ctx.stroke();
        const mm=fracDistMM(plane,o.pts[0],o.pts[1]); ctx.fillText(mm.toFixed(1)+' мм',(P[0].x+P[1].x)/2+4,(P[0].y+P[1].y)/2-4); }
      P.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,2.5,0,7);ctx.fill();}); }
    else if(o.type==='angle' && P.length>=1){ ctx.strokeStyle='#38a8ff'; ctx.fillStyle='#38a8ff';
      if(P.length>=2){ctx.beginPath();ctx.moveTo(P[0].x,P[0].y);ctx.lineTo(P[1].x,P[1].y);if(P[2])ctx.lineTo(P[2].x,P[2].y);ctx.stroke();}
      if(P.length>=3){ const a=o.pts[0],c=o.pts[1],b=o.pts[2]; const L2=mprLayout[plane];
        const v1={x:(a.fx-c.fx)*L2.m.pw,y:(a.fy-c.fy)*L2.m.ph}, v2={x:(b.fx-c.fx)*L2.m.pw,y:(b.fy-c.fy)*L2.m.ph};
        const ang=Math.acos((v1.x*v2.x+v1.y*v2.y)/(Math.hypot(v1.x,v1.y)*Math.hypot(v2.x,v2.y)||1))*180/Math.PI;
        ctx.fillText(ang.toFixed(1)+'°',P[1].x+5,P[1].y-5); }
      P.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,2.5,0,7);ctx.fill();}); }
    else if(o.type==='dens' && P.length>=1){ ctx.strokeStyle='#39d98a'; ctx.fillStyle='#39d98a';
      const c=P[0]; const rpx = P.length>=2? Math.hypot(P[1].x-c.x,P[1].y-c.y) : 10;
      ctx.beginPath(); ctx.arc(c.x,c.y,rpx,0,7); ctx.stroke();
      if(o.hu!=null) ctx.fillText(`${o.hu|0} HU · ${o.area.toFixed(0)} мм²`, c.x+rpx+4, c.y); }
  }
}
function setMprMode(mode){
  mprMode = (mprMode===mode)? null : mode; mprDraft=null;
  ['mDist','mAngle','mDens'].forEach(id=>$(id).classList.remove('armed'));
  if(mprMode){ setMeasMode(null); const b=$({dist:'mDist',angle:'mAngle',dens:'mDens'}[mprMode]); b&&b.classList.add('armed'); }
}
function clearMpr(){ mprMeas={axial:[],coronal:[],sagittal:[]}; mprDraft=null; if(volume) renderAllMPR(); }
function computeDensity(o){
  const plane=o.plane, m=sliceMeta(plane), k=o.k, c=o.pts[0], e=o.pts[1];
  const cx=c.fx*m.w, cy=c.fy*m.h; const rpx=Math.hypot((e.fx-c.fx)*m.w,(e.fy-c.fy)*m.h);
  const r2=rpx*rpx; let sum=0,n=0;
  for(let b=Math.max(0,Math.floor(cy-rpx));b<Math.min(m.h,Math.ceil(cy+rpx));b++)
    for(let a=Math.max(0,Math.floor(cx-rpx));a<Math.min(m.w,Math.ceil(cx+rpx));a++)
      if((a-cx)**2+(b-cy)**2<=r2){ sum+=voxel(plane,a,b,k); n++; }
  o.hu = n? sum/n : 0;
  const rmm=(Math.abs(e.fx-c.fx)*m.pw + Math.abs(e.fy-c.fy)*m.ph)/2;
  o.area=Math.PI*rmm*rmm;
}
function onMprClick(plane, f, k){
  if(!mprDraft || mprDraft.plane!==plane || mprDraft.k!==k || mprDraft.type!==mprMode) mprDraft={type:mprMode,plane,k,pts:[]};
  mprDraft.pts.push(f);
  const need = mprMode==='angle'?3:2;
  if(mprMode==='dens' && mprDraft.pts.length===2) computeDensity(mprDraft);
  if(mprDraft.pts.length>=need){
    if(mprMode==='dist') mprDraft.mm=fracDistMM(plane,mprDraft.pts[0],mprDraft.pts[1]);
    let msg;
    if(mprMode==='dist') msg=`MPR длина: ${mprDraft.mm.toFixed(1)} мм`;
    else if(mprMode==='angle'){ const P=mprDraft.pts, L=mprLayout[plane];
      const v1={x:(P[0].fx-P[1].fx)*L.m.pw,y:(P[0].fy-P[1].fy)*L.m.ph}, v2={x:(P[2].fx-P[1].fx)*L.m.pw,y:(P[2].fy-P[1].fy)*L.m.ph};
      msg=`MPR угол: ${(Math.acos((v1.x*v2.x+v1.y*v2.y)/(Math.hypot(v1.x,v1.y)*Math.hypot(v2.x,v2.y)||1))*180/Math.PI).toFixed(1)}°`; }
    else msg=`MPR плотность: ${mprDraft.hu|0} HU · ${mprDraft.area.toFixed(0)} мм²`;
    mprMeas[plane].push(mprDraft); mprDraft=null;
    $('measVal').textContent=msg; $('measVal').style.display='';
  }
  renderMPR(plane);
}
function setCrosshair(plane, f){        // перетаскиваемый указатель: задаёт срезы др. плоскостей
  const [nx,ny,nz]=volume.dims;
  const cl=(v,n)=>Math.max(0,Math.min(n-1,Math.round(v*(n-1))));
  if(plane==='axial'){ idx[0]=cl(f.fx,nx); idx[1]=cl(f.fy,ny); }
  else if(plane==='coronal'){ idx[0]=cl(f.fx,nx); idx[2]=cl(f.fy,nz); }
  else { idx[1]=cl(f.fx,ny); idx[2]=cl(f.fy,nz); }
  planes.forEach(p=>{ $('sl-'+p).value=idx[sliceMeta(p).axis]; });
  renderAllMPR();
}
function bindMprMeas(){
  planes.forEach(plane=>{ const cv=$('cv-'+plane); let drag=null;   // null|'move'|'rot'|'thick'
    const toPx=(ev)=>{ const r=cv.getBoundingClientRect(); return { x:(ev.clientX-r.left)*cv.width/r.width, y:(ev.clientY-r.top)*cv.height/r.height }; };
    const toFrac=(ev)=>{ const p=toPx(ev); return px2frac(plane,p.x,p.y); };
    const slabMax=()=> +($('slab')?.max||31);
    cv.addEventListener('mousedown',(ev)=>{ if(!volume) return;
      if(mprMode){ ev.preventDefault(); ev.stopPropagation(); onMprClick(plane, toFrac(ev), idx[sliceMeta(plane).axis]); return; }
      if(plane==='coronal'&&oblique.on) return;      // косой коронар строится отдельным наклоном
      const p=toPx(ev); const S=xhairScreen[plane];
      ev.preventDefault();
      if(S){ const near=(h)=>Math.hypot(p.x-h.x,p.y-h.y)<12;
        if(near(S.rH)){ drag='rot'; return; }        // ромб → поворот (косой «икс»)
        if(near(S.tH)){ drag='thick'; return; }      // квадрат → толщина среза
      }
      drag='move'; setCrosshair(plane, toFrac(ev)); }, true);
    cv.addEventListener('mousemove',(ev)=>{ if(!drag||mprMode) return; const p=toPx(ev); const S=xhairScreen[plane];
      if(drag==='move'){ setCrosshair(plane, toFrac(ev)); return; }
      if(!S) return;
      if(drag==='rot'){ const sy=(plane!=='axial')?-1:1;
        let deg=Math.atan2((p.y-S.cy)*sy, p.x-S.cx)*180/Math.PI;
        // ограничим до ±80°, округлим до 1°
        deg=Math.max(-80,Math.min(80,Math.round(deg)));
        xhair[plane].angle=deg; renderMPR(plane); return; }
      if(drag==='thick'){ const proj=(p.x-S.cx)*S.d2.x+(p.y-S.cy)*S.d2.y;   // px вдоль d2
        const L=mprLayout[plane]; const pxPerMM=L?(L.dw/L.m.pw):1;
        const mm=Math.abs(proj)/pxPerMM; const minsp=Math.min(...volume.spacing);
        let n=Math.max(1,Math.min(slabMax(), Math.round(mm/minsp)));
        slabN=n; if($('slab')){ $('slab').value=n; $('slabv').textContent=n; }
        renderAllMPR(); return; }
    });
    window.addEventListener('mouseup',()=>{ drag=null; });
    cv.addEventListener('dblclick',(ev)=>{ if(!volume||mprMode) return; ev.preventDefault();
      xhair[plane].angle=0; slabN=1; if($('slab')){ $('slab').value=1; $('slabv').textContent=1; } renderAllMPR(); });
  });
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
let renderer, scene, camera, controls, trackball, orbit, boneMesh;
function setRotMode(mode){
  const tgt = controls && controls.target ? controls.target.clone() : new THREE.Vector3();
  const MB = THREE.MOUSE;
  if (mode==='turn' || mode==='pan'){
    controls=orbit; trackball.enabled=false; orbit.enabled=true;
    orbit.mouseButtons = { LEFT: mode==='pan'?MB.PAN:MB.ROTATE, MIDDLE:MB.DOLLY, RIGHT:MB.PAN };
    if (orbit.target) orbit.target.copy(tgt);
  } else {
    controls=trackball; orbit.enabled=false; trackball.enabled=true;
    trackball.target.copy(tgt);
    if (trackball.handleResize) trackball.handleResize();
  }
  ['rotFree','rotTurn','rotPan'].forEach(id=>$(id)?.classList.remove('armed'));
  $({free:'rotFree',turn:'rotTurn',pan:'rotPan'}[mode])?.classList.add('armed');
}
function zoomStep(f){                 // приблизить/отдалить камеру к цели
  const tgt = controls.target || new THREE.Vector3();
  const dir = camera.position.clone().sub(tgt);
  camera.position.copy(tgt).add(dir.multiplyScalar(f));
}
function init3D() {
  const cv = $('cv-3d');
  renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a1418);
  camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
  camera.position.set(0, -350, 120);
  trackball = new TrackballControls(camera, cv);
  trackball.rotateSpeed = 3.2; trackball.zoomSpeed = 1.3; trackball.panSpeed = 0.8;
  trackball.dynamicDampingFactor = 0.12; trackball.staticMoving = false; trackball.keys = [];
  orbit = new OrbitControls(camera, cv);      // «по кругу» (турель)
  orbit.enableDamping = true; orbit.dampingFactor = 0.1; orbit.rotateSpeed = 0.9;
  orbit.enabled = false;
  controls = trackball;                        // активные
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
    if (devPtMode || symTgtMode || midMode || measMode || nerveMode) {
      ray.setFromCamera(m, camera);
      const tgts = [boneMesh, baseMesh, ...frags.map(f=>f.mesh)].filter(o=>o && o.visible);
      const hit = ray.intersectObjects(tgts, false)[0];
      if (hit) {
        if (measMode) addMeasPt(hit.point);
        else if (midMode) addMidPt(hit.point);
        else if (symTgtMode) setSymTarget(hit.point);
        else if (nerveMode) addNervePt(hit.point);
        else addDevPt(hit.point);
      }
      return;
    }
    if (!isCut || !frags.length) return;      // клик по фрагменту — выбрать/тащить
    ray.setFromCamera(m, camera);
    const hit = ray.intersectObjects(frags.map(f=>f.mesh), false)[0];
    if (hit){ const rec = hit.object.userData.frag; const i = frags.indexOf(rec);
      if (i>=0){ mobileMode='manual'; selectFrag(i); if(gizmo){ gizmo.setMode('translate'); gizmo.attach(rec.group);} } }
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
  if ($('autoSeg') && $('autoSeg').checked) autoSegment(true);
}
// связные детали кости (по индексному мешу) — сортированы по размеру
function segmentComponents(surf){
  const P=surf.positions, I=surf.indices; const nv=P.length/3;
  const parent=new Int32Array(nv); for(let i=0;i<nv;i++)parent[i]=i;
  const find=x=>{ while(parent[x]!==x){ parent[x]=parent[parent[x]]; x=parent[x]; } return x; };
  const uni=(a,b)=>{ a=find(a); b=find(b); if(a!==b)parent[a]=b; };
  const nt=I.length/3;
  for(let t=0;t<nt;t++){ const a=I[t*3],b=I[t*3+1],c=I[t*3+2]; uni(a,b); uni(b,c); }
  const map=new Map();
  for(let t=0;t<nt;t++){ const r=find(I[t*3]); let e=map.get(r); if(!e){ e=[]; map.set(r,e); } e.push(t); }
  const comps=[...map.values()].map(tris=>{
    const soup=new Float32Array(tris.length*9); let o=0;
    for(const t of tris){ for(let k=0;k<3;k++){ const vi=I[t*3+k]; soup[o++]=P[vi*3]; soup[o++]=P[vi*3+1]; soup[o++]=P[vi*3+2]; } }
    return { soup, n:tris.length };
  });
  comps.sort((a,b)=>b.n-a.n);
  return comps;
}
// авто-сегментация: череп = самая большая деталь (опора), остальные крупные —
// подвижные (нижняя челюсть отделяется сама, если не сращена на пороге)
function autoSegment(silent){
  if(!boneSurf) return false;
  // 1) воксельная сегментация нижней челюсти (рвёт тонкие сращения)
  if (volume){
    const seg = segmentMandible(volume, threshold);
    if (seg){
      const [nx,ny,nz]=volume.dims, [spx,spy,spz]=volume.spacing;
      const P=boneSurf.positions, I=boneSurf.indices, nt=I.length/3;
      const mand=[], skull=[];
      for(let t=0;t<nt;t++){
        let cx=0,cy=0,cz=0; const vi=[I[t*3],I[t*3+1],I[t*3+2]];
        for(const j of vi){ cx+=P[j*3]; cy+=P[j*3+1]; cz+=P[j*3+2]; } cx/=3;cy/=3;cz/=3;
        const vx=(cx + nx*spx/2)/spx, vy=(cy + ny*spy/2)/spy, vz=(cz + nz*spz/2)/spz;
        const dst = seg.get(vx,vy,vz)?mand:skull;
        for(const j of vi){ dst.push(P[j*3],P[j*3+1],P[j*3+2]); }
      }
      if(mand.length>=90 && skull.length>=90){
        removeFrags();
        baseSoup=new Float32Array(skull); rebuildBaseMesh();
        const rec=addFrag(new Float32Array(mand), 0x66d9e8, new THREE.Vector3(0,0,1), soupCentroid(new Float32Array(mand)), 'Нижняя челюсть');
        isCut=true; clearArc(); clearRegen(); clearDevPts();
        selectFrag(frags.indexOf(rec)); refreshObjPanel();
        $('cutInfo').textContent='Сегментация: «Нижняя челюсть» отделена. Кликни её и режь/двигай — череп не тронется.';
        return true;
      }
    }
  }
  // 2) запасной путь — по связным деталям меша
  const comps = segmentComponents(boneSurf);
  const total = comps.reduce((s,c)=>s+c.n,0);
  const keep = comps.slice(1).filter(c=>c.n >= total*0.03).slice(0,4);   // до 4 крупных подвижных
  if(!keep.length){
    if(!silent) alert('Кость — единая деталь (челюсть сращена с черепом на текущем пороге). Подними «3D порог» или используй распил.');
    $('cutInfo').textContent = 'Единая деталь: подними 3D порог для отделения челюсти или распили.';
    return false;
  }
  removeFrags();
  const baseParts=[ comps[0].soup ];
  comps.slice(1).forEach(c=>{ if(!keep.includes(c)) baseParts.push(c.soup); });
  let bl=0; baseParts.forEach(s=>bl+=s.length); baseSoup=new Float32Array(bl);
  let bo=0; baseParts.forEach(s=>{ baseSoup.set(s,bo); bo+=s.length; });
  rebuildBaseMesh();
  keep.forEach((c,i)=> addFrag(c.soup, i===0?0x66d9e8:0xffc24d, new THREE.Vector3(0,0,1), soupCentroid(c.soup), 'Деталь '+(i+1)));
  isCut=true; clearArc(); clearRegen(); clearDevPts();
  let mi=-1, lowZ=Infinity; frags.forEach((f,i)=>{ if(f.centroid.z<lowZ){ lowZ=f.centroid.z; mi=i; } });
  if(mi>=0){ frags[mi].name='Нижняя челюсть'; selectFrag(mi); }
  refreshObjPanel();
  $('cutInfo').textContent = `Сегментация: ${frags.length} подвижн. деталь(ей) + череп. Кликни нижнюю челюсть → тащи/планируй. Сращено — подними порог или распили.`;
  return true;
}

// ---------- Остеотомия / дистракторы (мультифрагментная модель) ----------
let boneSurf = null, modelRadius = 150;
let planeMesh = null;
let baseSoup = null;            // triangle-soup нераспиленной кости (мировые коорд.)
let baseMesh = null;            // неподвижная опорная кость (череп + нераспил.)
let frags = [];                 // [{group, mesh, soup, color, dist}] — подвижные фрагменты
let activeFrag = -1;
let arcMesh = null, regenMesh = null;
let isCut = false, cutN = null, cutP = null, cutSign = -1;
let mobileMode = 'sliders';        // 'sliders' | 'arc' | 'manual'
let curDevice = null, arcFrameCur = null, arcRadCur = 0, arcDegCur = 0;

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
function concatF32(a, b){ const r=new Float32Array(a.length+b.length); r.set(a,0); r.set(b,a.length); return r; }
function splitInside(pos, test){
  const inA=[], outA=[];
  for (let t=0;t<pos.length;t+=9){
    const cx=(pos[t]+pos[t+3]+pos[t+6])/3, cy=(pos[t+1]+pos[t+4]+pos[t+7])/3, cz=(pos[t+2]+pos[t+5]+pos[t+8])/3;
    const dst = test(cx,cy,cz)?inA:outA; for(let k=0;k<9;k++) dst.push(pos[t+k]);
  }
  return { inside:new Float32Array(inA), outside:new Float32Array(outA) };
}
function ensureBase(){ if(!baseSoup) baseSoup = expandIndexed(boneSurf); }
function rebuildBaseMesh(){
  if (baseMesh){ scene.remove(baseMesh); baseMesh.geometry.dispose(); }
  baseMesh = makeMesh(baseSoup, 0xe6ddc9); baseMesh.name='base'; scene.add(baseMesh);
  if (boneMesh) boneMesh.visible=false;
}
function addFrag(soup, color, n, p, name){
  const mesh = makeMesh(soup, color); mesh.name='frag';
  const group = new THREE.Group(); group.add(mesh); scene.add(group);
  const rec = { group, mesh, soup, color, n:n.clone(), p:p.clone(),
    centroid: soupCentroid(soup), dist:0, name: name || ('Фрагмент '+(frags.length+1)) };
  mesh.userData.frag = rec;
  frags.push(rec); refreshObjPanel(); return rec;
}
function removeOneFrag(rec){
  const i=frags.indexOf(rec); if(i<0) return;
  scene.remove(rec.group); rec.mesh.geometry.dispose();
  frags.splice(i,1); if(activeFrag>=frags.length) activeFrag=frags.length-1;
  refreshObjPanel();
}
// какой объект под экранной точкой: фрагмент, 'base' или null
function pickObjectAt(px, py, rw){
  const ray=new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((px/rw.width)*2-1, -(py/rw.height)*2+1), camera);
  const meshes=[...frags.map(f=>f.mesh)]; if(baseMesh&&baseMesh.visible) meshes.push(baseMesh); if(boneMesh&&boneMesh.visible) meshes.push(boneMesh);
  const h=ray.intersectObjects(meshes.filter(Boolean), false)[0];
  if(!h) return null;
  return h.object.userData.frag ? h.object.userData.frag : 'base';
}
// распилить ОДИН объект плоскостью → 2 объекта; остальные не трогаем
function splitFragByPlane(rec, n, p, label){
  rec.mesh.updateMatrixWorld(true); const M=rec.mesh.matrixWorld;
  const P=rec.soup; const A=[],B=[]; const v=new THREE.Vector3();
  for(let t=0;t<P.length;t+=9){
    const w=[]; let cx=0,cy=0,cz=0;
    for(let k=0;k<3;k++){ v.set(P[t+k*3],P[t+k*3+1],P[t+k*3+2]).applyMatrix4(M); w.push(v.x,v.y,v.z); cx+=v.x;cy+=v.y;cz+=v.z; }
    const d=(cx/3-p.x)*n.x+(cy/3-p.y)*n.y+(cz/3-p.z)*n.z;
    (d>=0?A:B).push(w[0],w[1],w[2],w[3],w[4],w[5],w[6],w[7],w[8]);
  }
  if(A.length<9 || B.length<9){ alert('Плоскость не пересекла объект насквозь — наклони/сдвинь линию.'); return; }
  const nm=rec.name||'Объект';
  removeOneFrag(rec);
  const a=addFrag(new Float32Array(A), rec.color||0x66d9e8, n, p, nm+' ①');
  const b=addFrag(new Float32Array(B), 0xffc24d, n.clone().multiplyScalar(-1), p, nm+' ②');
  isCut=true; cutN=n.clone(); cutP=p.clone(); clearArc(); clearRegen();
  selectFrag(frags.indexOf(b));
  $('cutInfo').textContent = `Распил «${nm}» → 2 объекта. Другие объекты сохранены — режь их тоже. Двигай/планируй.`;
}
function soupCentroid(pos){ const c=new THREE.Vector3(); const nt=pos.length/3;
  for(let i=0;i<pos.length;i+=3){ c.x+=pos[i]; c.y+=pos[i+1]; c.z+=pos[i+2]; } return c.multiplyScalar(1/nt); }
function selectFrag(i){
  activeFrag = i;
  frags.forEach((f,k)=>{ f.mesh.material.emissive.setHex(k===i?0x134e4a:0x000000);
    f.mesh.material.emissiveIntensity = k===i?0.9:0; });
  if (i>=0 && gizmo){ gizmo.attach(frags[i].group); }
  updateSelInfo(); refreshObjPanel();
}
// ---- Панель объектов (как дерево в BonaByte) ----
function refreshObjPanel(){
  const box=$('objList'); if(!box) return;
  let html='';
  if (baseMesh) html+=`<div class="obj-row" data-base="1"><span class="eye" data-eye="base">${baseMesh.visible?'👁':'—'}</span><span class="dot" style="background:#e6ddc9"></span><span class="nm">Череп (опора)</span></div>`;
  frags.forEach((f,i)=>{ const col='#'+(f.color>>>0).toString(16).padStart(6,'0').slice(-6);
    html+=`<div class="obj-row${i===activeFrag?' sel':''}" data-i="${i}"><span class="eye" data-eyei="${i}">${f.group.visible?'👁':'—'}</span><span class="dot" style="background:${col}"></span><span class="nm" data-sel="${i}">${f.name}</span><span class="del" data-del="${i}">✕</span></div>`; });
  if(!frags.length && !baseMesh) html='<div class="info">Нет объектов — загрузите КТ.</div>';
  box.innerHTML=html;
  box.querySelectorAll('[data-sel]').forEach(el=>el.onclick=()=>{ const i=+el.dataset.sel; selectFrag(i); if(gizmo){gizmo.setMode('translate');gizmo.attach(frags[i].group);} });
  box.querySelectorAll('[data-eyei]').forEach(el=>el.onclick=()=>{ const i=+el.dataset.eyei; frags[i].group.visible=!frags[i].group.visible; refreshObjPanel(); });
  box.querySelectorAll('[data-eye="base"]').forEach(el=>el.onclick=()=>{ if(baseMesh){ baseMesh.visible=!baseMesh.visible; refreshObjPanel(); } });
  box.querySelectorAll('[data-del]').forEach(el=>el.onclick=()=>{ const i=+el.dataset.del; removeOneFrag(frags[i]); });
}
function updateSelInfo(){
  if (activeFrag<0){ $('cutInfo').textContent = `Фрагментов: ${frags.length}. Кликни фрагмент, чтобы выбрать.`; return; }
  const f=frags[activeFrag];
  $('cutInfo').textContent = `Активен фрагмент №${activeFrag+1}/${frags.length} · ${(f.soup.length/9|0).toLocaleString('ru')} треуг. Тащи гизмо или планируй КДО.`;
}
// союз-поиск
function makeDSU(n){ const p=new Int32Array(n); for(let i=0;i<n;i++)p[i]=i;
  const find=(x)=>{ while(p[x]!==x){ p[x]=p[p[x]]; x=p[x]; } return x; };
  const uni=(a,b)=>{ a=find(a); b=find(b); if(a!==b)p[a]=b; };
  return { find, uni }; }
// связные компоненты triangle-soup (сварка вершин по позиции): comp[t] = корень
function components(soup){
  const ntri = soup.length/9; const nvraw = soup.length/3;
  const map=new Map(); const vid=new Int32Array(nvraw); let nv=0;
  for(let i=0;i<soup.length;i+=3){
    const k=(Math.round(soup[i]*4))+'_'+(Math.round(soup[i+1]*4))+'_'+(Math.round(soup[i+2]*4));
    let id=map.get(k); if(id===undefined){ id=nv++; map.set(k,id); } vid[i/3]=id;
  }
  const dsu=makeDSU(nv);
  for(let t=0;t<ntri;t++){ const a=vid[t*3],b=vid[t*3+1],c=vid[t*3+2]; dsu.uni(a,b); dsu.uni(b,c); }
  const comp=new Int32Array(ntri); for(let t=0;t<ntri;t++) comp[t]=dsu.find(vid[t*3]);
  return { comp, ntri };
}
const triC=(s,t,ax)=>(s[t*9+ax]+s[t*9+3+ax]+s[t*9+6+ax])/3;
// ЛОКАЛЬНАЯ остеотомия: внутри зоны (рамка/бокс у линии) кость делится плоскостью
// на 2 фрагмента; всё вне зоны — целая опора. Так режется одна сторона; для
// двусторонней остеотомии повторяем на другой ветви. cutP = центр реза (шарнир).
function cutRegion(n, p, test, label){
  ensureBase();
  const up=[], lo=[], base=[]; const nx=n.x,ny=n.y,nz=n.z;
  const ntri=baseSoup.length/9;
  let cInX=0,cInY=0,cInZ=0,ninside=0;
  for(let t=0;t<ntri;t++){ const o=t*9;
    const cx=triC(baseSoup,t,0), cy=triC(baseSoup,t,1), cz=triC(baseSoup,t,2);
    if(!test(cx,cy,cz)){ for(let k=0;k<9;k++) base.push(baseSoup[o+k]); continue; }
    const d=(cx-p.x)*nx+(cy-p.y)*ny+(cz-p.z)*nz;
    const dst = d>=0?up:lo; for(let k=0;k<9;k++) dst.push(baseSoup[o+k]);
    cInX+=cx; cInY+=cy; cInZ+=cz; ninside++;
  }
  const fUp=new Float32Array(up), fLo=new Float32Array(lo);
  if (fUp.length<9 || fLo.length<9){ alert('Плоскость не разделила кость в зоне на 2 части — сдвинь/наклони линию или увеличь зону.'); return; }
  baseSoup=new Float32Array(base); rebuildBaseMesh();
  const centerCut = ninside? new THREE.Vector3(cInX/ninside,cInY/ninside,cInZ/ninside) : p.clone();
  const made=[ addFrag(fUp, 0x66d9e8, n, centerCut), addFrag(fLo, 0xffc24d, n.clone().multiplyScalar(-1), centerCut) ];
  isCut = true; cutN=n.clone(); cutP=centerCut.clone();
  clearArc(); clearRegen();
  selectFrag(frags.indexOf(made[1]));            // по умолчанию активен нижний (дистальный)
  $('cutInfo').textContent = `Остеотомия (${label}): 2 фрагмента. Поставь 2 точки аппарата и «Спланировать КДО».`;
}

// ---- РОБАСТНЫЙ РАСПИЛ («пила»): удаляем тонкий пропил ВНУТРИ зоны, затем
// пересчитываем связные компоненты. КРУПНЕЙШАЯ компонента ВСЕГДА остаётся
// неподвижной опорой (череп) — распил физически не может «развалить весь череп».
// Отделяются только те куски, что реально отсоединились пропилом.
function currentBoneSoup(){
  ensureBase();
  const parts=[baseSoup]; frags.forEach(f=>parts.push(f.soup));
  let len=0; parts.forEach(s=>len+=s.length); const out=new Float32Array(len);
  let o=0; parts.forEach(s=>{ out.set(s,o); o+=s.length; }); return out;
}
function sawCut(n, p, test, label){
  const soup=currentBoneSoup();
  const kerf=Math.max(1.2, modelRadius*0.012);          // толщина пропила вдоль нормали (тонкая)
  const kept=[];
  for(let t=0;t<soup.length;t+=9){
    const cx=(soup[t]+soup[t+3]+soup[t+6])/3, cy=(soup[t+1]+soup[t+4]+soup[t+7])/3, cz=(soup[t+2]+soup[t+5]+soup[t+8])/3;
    const d=(cx-p.x)*n.x+(cy-p.y)*n.y+(cz-p.z)*n.z;
    if(test(cx,cy,cz) && Math.abs(d)<=kerf) continue;   // удалили полосу пропила = разрез
    for(let k=0;k<9;k++) kept.push(soup[t+k]);
  }
  const keptF=new Float32Array(kept);
  const { comp, ntri } = components(keptF);
  const map=new Map();
  for(let t=0;t<ntri;t++){ let e=map.get(comp[t]); if(!e){ e=[]; map.set(comp[t],e); } e.push(t); }
  let groups=[...map.values()].map(tris=>{ const s=new Float32Array(tris.length*9); let o=0;
    for(const t of tris){ for(let k=0;k<9;k++) s[o++]=keptF[t*9+k]; } return s; });
  groups.sort((a,b)=>b.length-a.length);
  if(groups.length<2){
    alert('Пропил не отделил фрагмент — кусок остался соединён в другом месте.\n\n'+
      '• ОДНОСТОРОННИЙ случай (одна ветвь спаяна с основанием черепа): сначала нажми '+
      '«Отделить нижнюю челюсть» (или галка «Сегментация НЧ») — челюсть станет отдельным '+
      'объектом; затем распили ТОЛЬКО поражённую ветвь: этого достаточно, фрагмент повернётся '+
      'вокруг здоровой стороны.\n'+
      '• Иначе проведи рез через всю толщу кости (расширь рамку) или распили вторую сторону.');
    return false;
  }
  // крупнейшая компонента — опора (череп), НИКОГДА не рассыпается; мелкие крошки → в опору
  removeFrags();
  const baseParts=[groups[0]]; const movable=[];
  for(let i=1;i<groups.length;i++){ if(groups[i].length/9 >= Math.max(40, ntri*0.008)) movable.push(groups[i]); else baseParts.push(groups[i]); }
  let bl=0; baseParts.forEach(s=>bl+=s.length); baseSoup=new Float32Array(bl);
  let bo=0; baseParts.forEach(s=>{ baseSoup.set(s,bo); bo+=s.length; });
  rebuildBaseMesh();
  const baseC=soupCentroid(baseSoup);
  movable.forEach((s,i)=>{ const c=soupCentroid(s); const nn=c.clone().sub(baseC).normalize();
    addFrag(s, i===0?0x66d9e8:0xffc24d, nn, c, movable.length>1?('Фрагмент '+(i+1)):'Нижняя челюсть (фрагмент)'); });
  isCut=true; cutN=n.clone(); cutP=p.clone(); clearArc(); clearRegen(); clearDevPts();
  let mi=-1, lowZ=Infinity; frags.forEach((f,i)=>{ if(f.centroid.z<lowZ){ lowZ=f.centroid.z; mi=i; } });
  if(mi>=0) selectFrag(mi);
  refreshObjPanel();
  $('cutInfo').textContent=`Распил (${label}): отделено фрагментов — ${movable.length}. Череп остаётся целой опорой. Поставь 2 точки аппарата → «Рассчитать КДО».`;
  return true;
}

function doCut() {
  if (!boneSurf || !planeMesh) return;
  planeMesh.updateMatrixWorld(true);
  const n = getPlaneN(), p = getPlaneP();
  const bounded = !(planeFull('cutW') && planeFull('cutL') && planeFull('cutD'));
  let test;
  if (bounded){
    const full=modelRadius*2.4;
    const hx=(planeFull('cutW')?full:+$('cutW').value)/2, hy=(planeFull('cutL')?full:+$('cutL').value)/2, hz=(planeFull('cutD')?full:+$('cutD').value)/2;
    const inv=new THREE.Matrix4().compose(planeMesh.position, planeMesh.quaternion, new THREE.Vector3(1,1,1)).invert();
    const v=new THREE.Vector3();
    test=(cx,cy,cz)=>{ v.set(cx,cy,cz).applyMatrix4(inv); return Math.abs(v.x)<=hx&&Math.abs(v.y)<=hy&&Math.abs(v.z)<=hz; };
  } else test=()=>true;
  // если выбран отдельный объект — режем только его (плоскостью)
  if (activeFrag>=0 && frags[activeFrag]){ splitFragByPlane(frags[activeFrag], n, p, 'плоскостью'); return; }
  sawCut(n, p, test, bounded?'рамкой':'плоскостью');
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
  const tgts = [boneMesh, baseMesh, ...frags.map(f=>f.mesh)].filter(o=>o && o.visible);
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
  const strokeLen = A.distanceTo(B);
  // объект под серединой штриха — режем ТОЛЬКО его
  const midScreen = penPts[Math.floor(penPts.length/2)];
  const target = pickObjectAt(midScreen.x, midScreen.y, rw);
  lineCut = { center, n:n.clone(), u:u.clone(), viewDir:viewDir.clone().normalize(), strokeLen, target };
  buildLineFrag();
}
function buildLineFrag(){
  const { center, n, u, viewDir, strokeLen, target } = lineCut;
  if (target && target!=='base'){          // распил отдельного объекта (напр. нижней челюсти)
    splitFragByPlane(target, n, center, 'линия');
    setPenMode(false); penPts=[]; drawPen();
    $('penInfo').textContent = 'Распил объекта готов. Другие объекты не тронуты. Режь дальше или планируй КДО.';
    return;
  }
  // распил опоры (черепа) — локально, боксом вокруг штриха
  const halfU = strokeLen/2 + modelRadius*0.06;
  const halfDepth = modelRadius*0.55, halfHeight = modelRadius*0.6;
  const w = new THREE.Vector3().crossVectors(u, viewDir).normalize();
  const test=(cx,cy,cz)=>{ const dx=cx-center.x,dy=cy-center.y,dz=cz-center.z;
    return Math.abs(dx*u.x+dy*u.y+dz*u.z)<=halfU && Math.abs(dx*viewDir.x+dy*viewDir.y+dz*viewDir.z)<=halfDepth && Math.abs(dx*w.x+dy*w.y+dz*w.z)<=halfHeight; };
  sawCut(n, center, test, 'линия');
  setPenMode(false); penPts=[]; drawPen();
  $('penInfo').textContent = 'Локальная остеотомия опоры. Поставь 2 точки аппарата и «Спланировать КДО».';
}
function swapFragment(){ if(!frags.length){ return; } selectFrag((activeFrag+1)%frags.length); }

// Контурный (loop) распил — область вдоль луча взгляда становится подвижным фрагментом.
function doLoopCut(){
  ensureBase();
  const dc = penCanvas(); const rw = dc.getBoundingClientRect();
  const poly = penPts.map(p=>({x:p.x, y:p.y}));
  const v=new THREE.Vector3();
  const test=(cx,cy,cz)=>{ v.set(cx,cy,cz).project(camera);
    return pointInPoly((v.x+1)/2*rw.width, (1-(v.y+1)/2)*rw.height, poly); };
  const s = splitInside(baseSoup, test);
  if (s.inside.length<9){ alert('В контур не попала кость. Обведите зону точнее.'); return; }
  baseSoup = s.outside; rebuildBaseMesh();
  const viewN=new THREE.Vector3(); camera.getWorldDirection(viewN); viewN.multiplyScalar(-1).normalize();
  const rec = addFrag(s.inside, 0x66d9e8, viewN, soupCentroid(s.inside));
  isCut=true; cutN=viewN.clone(); cutP=rec.centroid.clone();
  clearDevPts(); clearArc(); clearRegen();
  selectFrag(frags.length-1);
  setPenMode(false); penPts=[]; drawPen();
  $('cutInfo').textContent = `Контур: фрагмент ${(s.inside.length/9|0).toLocaleString('ru')} треуг.`;
}
function penCutDispatch(){
  if (!boneSurf) { alert('Сначала постройте 3D-модель.'); return; }
  if (penPts.length < 3) { alert('Сначала нарисуйте карандашом.'); return; }
  const mode=penMode();
  if (mode==='line') doLineCut(); else if (mode==='loop') doLoopCut(); else doKnife();
}
// ---- Нож: обрезать нарисованную область (base + фрагменты); «Вернуть» откатывает ----
let knifeStack = [];
function doKnife(){
  ensureBase();
  const rw=penCanvas().getBoundingClientRect(); const poly=penPts.map(p=>({x:p.x,y:p.y}));
  const v=new THREE.Vector3();
  const inLoop=(cx,cy,cz,mat)=>{ v.set(cx,cy,cz); if(mat) v.applyMatrix4(mat); v.project(camera);
    return pointInPoly((v.x+1)/2*rw.width,(1-(v.y+1)/2)*rw.height, poly); };
  const trim=(soup,mat)=>{ const out=[]; let rem=0;
    for(let t=0;t<soup.length;t+=9){ const cx=(soup[t]+soup[t+3]+soup[t+6])/3,cy=(soup[t+1]+soup[t+4]+soup[t+7])/3,cz=(soup[t+2]+soup[t+5]+soup[t+8])/3;
      if(inLoop(cx,cy,cz,mat)){ rem++; continue; } for(let k=0;k<9;k++) out.push(soup[t+k]); }
    return { kept:new Float32Array(out), rem }; };
  knifeStack.push({ base: baseSoup, frags: frags.map(f=>f.soup) });   // снимок для отката
  let removed=0;
  const tb=trim(baseSoup,null); removed+=tb.rem; baseSoup=tb.kept; rebuildBaseMesh();
  frags.forEach(f=>{ f.mesh.updateMatrixWorld(true); const tf=trim(f.soup, f.mesh.matrixWorld); removed+=tf.rem;
    f.soup=tf.kept; f.mesh.geometry.dispose();
    const g=new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(f.soup,3)); g.computeVertexNormals();
    f.mesh.geometry=g; });
  setPenMode(false); penPts=[]; drawPen();
  $('penInfo').textContent = `Обрезано ${(removed).toLocaleString('ru')} треуг. «↩ Вернуть» — откат.`;
}
function knifeUndo(){
  const s=knifeStack.pop(); if(!s){ $('penInfo').textContent='Нечего возвращать.'; return; }
  baseSoup=s.base; rebuildBaseMesh();
  frags.forEach((f,i)=>{ if(s.frags[i]){ f.soup=s.frags[i]; f.mesh.geometry.dispose();
    const g=new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(f.soup,3)); g.computeVertexNormals(); f.mesh.geometry=g; } });
  $('penInfo').textContent='Обрезанный участок возвращён.';
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
function setSymTgtMode(on){ symTgtMode=on; const b=$('symTgtBtn'); if(b) b.classList.toggle('armed', on); }
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
// авто-дистракция активного фрагмента до симметрии (к зеркалу здорового ориентира)
function planSymmetry(){
  if (!isCut || activeFrag<0){ alert('Распили и кликни подвижный фрагмент.'); return; }
  if (!symHealthy){ alert('Сначала отметь здоровый ориентир кнопкой «Ориентир».'); return; }
  const rec = activeRec();
  const target = mirrorAcross(symHealthy);
  const land = rec.centroid.clone();
  const disp = target.clone().sub(land); const L = disp.length();
  if (L < 1e-3){ alert('Фрагмент уже у цели.'); return; }
  const dir = disp.clone().normalize();
  // требуемая угловая коррекция = отклонение вектора от нормали распила; аппарат: 180=прямой
  const ang = rec.n.angleTo(dir)*180/Math.PI;
  let best=DEVICES[0]; for(const d of DEVICES) if(Math.abs(d.deg-(180-ang))<Math.abs(best.deg-(180-ang))) best=d;
  curDevice = best;
  let up=new THREE.Vector3(0,0,1); if(Math.abs(dir.dot(up))>0.9) up=new THREE.Vector3(0,1,0);
  const perp=new THREE.Vector3().crossVectors(dir,up).normalize();
  distr = { P0: land.clone(), dir, perp, deg: curDevice.deg, L };
  mobileMode='arc'; drawArc();
  $('reqLen').value=Math.min(40,L).toFixed(1); $('reqLenv').textContent=L.toFixed(1)+' мм';
  $('arcDist').max=L.toFixed(1); $('arcDist').value=L.toFixed(1);
  moveAlongArc();
  const resid = railPoint(L).distanceTo(target);
  $('kdoInfo').innerHTML = `<b style="color:var(--accent)">${curDevice.name}</b> · ${curDevice.deg===180?'прямой':'дуга '+(180-curDevice.deg)+'°'} · дистракция ${L.toFixed(1)} мм`;
  $('symInfo').innerHTML = `Для симметрии: <b>${curDevice.name}</b>, вытянуть <b>${L.toFixed(1)} мм</b>. Остаточная асимметрия ≈ ${resid.toFixed(1)} мм.`;
  lastPlan = { mode:'symmetry', device:curDevice.name, deg:curDevice.deg, mm:L, resid };
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
  let vol, label; const rec=activeRec();
  if (rec){ rec.mesh.updateMatrixWorld(true);
    vol=triVolume(meshWorldTris(rec.mesh, rec.mesh.matrixWorld)); label=`фрагмента №${activeFrag+1}`; }
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
  if (isCut){ if(baseSoup) parts.push(baseSoup);
    frags.forEach(f=>{ f.mesh.updateMatrixWorld(true); parts.push(meshWorldTris(f.mesh, f.mesh.matrixWorld)); }); }
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
  downloadBlob(new Blob([buf],{type:'application/sla'}), `OSSA-plan-${Date.now()}.stl`);
  status(`STL сохранён · ${nt.toLocaleString('ru')} треуг.`); setTimeout(()=>status('',null),2500);
}
// ---- STL: экспорт объекта / импорт, примитивы, винты, нерв ----
function soupToSTL(P){
  const nt=P.length/9|0; const buf=new ArrayBuffer(84+nt*50); const dv=new DataView(buf);
  dv.setUint32(80,nt,true); let off=84; const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),nrm=new THREE.Vector3();
  for(let t=0;t<P.length;t+=9){ a.set(P[t],P[t+1],P[t+2]);b.set(P[t+3],P[t+4],P[t+5]);c.set(P[t+6],P[t+7],P[t+8]);
    nrm.crossVectors(b.clone().sub(a),c.clone().sub(a)).normalize();
    dv.setFloat32(off,nrm.x,true);dv.setFloat32(off+4,nrm.y,true);dv.setFloat32(off+8,nrm.z,true);off+=12;
    for(const p of[a,b,c]){dv.setFloat32(off,p.x,true);dv.setFloat32(off+4,p.y,true);dv.setFloat32(off+8,p.z,true);off+=12;} dv.setUint16(off,0,true);off+=2; }
  return buf;
}
function objWorldTris(rec){ rec.mesh.updateMatrixWorld(true); return meshWorldTris(rec.mesh, rec.mesh.matrixWorld); }
function exportActiveSTL(){ const r=activeRec(); if(!r){ alert('Выбери объект в списке «Объекты».'); return; }
  downloadBlob(new Blob([soupToSTL(objWorldTris(r))],{type:'application/sla'}), (r.name||'object').replace(/\s+/g,'_')+'.stl');
  status('STL объекта сохранён'); setTimeout(()=>status('',null),2000); }
function parseSTL(buf){
  const dv=new DataView(buf);
  // бинарный?
  if(buf.byteLength>84){ const nt=dv.getUint32(80,true); if(84+nt*50===buf.byteLength){
    const out=new Float32Array(nt*9); let o=0,off=84;
    for(let t=0;t<nt;t++){ off+=12; for(let k=0;k<3;k++){ out[o++]=dv.getFloat32(off,true); out[o++]=dv.getFloat32(off+4,true); out[o++]=dv.getFloat32(off+8,true); off+=12; } off+=2; }
    return out; } }
  // ASCII
  const txt=new TextDecoder().decode(new Uint8Array(buf)); const nums=[]; const re=/vertex\s+([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)/g; let m;
  while((m=re.exec(txt))){ nums.push(+m[1],+m[2],+m[3]); }
  return new Float32Array(nums);
}
function importSTLFiles(fileList){
  const files=Array.from(fileList); if(!files.length) return;
  files.forEach(async f=>{ try{ const soup=parseSTL(await f.arrayBuffer());
    if(soup.length<9){ alert('Не удалось прочитать STL: '+f.name); return; }
    const rec=addFrag(soup, 0x9b8cff, new THREE.Vector3(0,0,1), soupCentroid(soup), f.name.replace(/\.stl$/i,''));
    isCut=true; selectFrag(frags.indexOf(rec)); if(gizmo){gizmo.setMode('translate');gizmo.attach(rec.group);}
    status('Импортирован '+f.name); setTimeout(()=>status('',null),2000);
  }catch(e){ alert('Ошибка импорта STL: '+e.message); } });
}
function geoToSoup(geo){ const g=geo.toNonIndexed(); return new Float32Array(g.attributes.position.array); }
function placeAtView(rec){ // поставить объект в центр сцены перед камерой
  const t=(controls&&controls.target)?controls.target.clone():new THREE.Vector3();
  rec.group.position.copy(t); rec.centroid=t.clone();
}
function addPrimitive(kind){
  const s=Math.max(6, modelRadius*0.14);
  let geo, name;
  if(kind==='cyl'){ geo=new THREE.CylinderGeometry(s*0.5,s*0.5,s*2.4,28); name='Цилиндр'; }
  else if(kind==='box'){ geo=new THREE.BoxGeometry(s*1.6,s*0.9,s*0.9); name='Блок'; }
  else { geo=new THREE.SphereGeometry(s,28,18); name='Сфера'; }
  const rec=addFrag(geoToSoup(geo), 0x39a0ff, new THREE.Vector3(0,0,1), new THREE.Vector3(), name);
  placeAtView(rec); isCut=true; selectFrag(frags.indexOf(rec)); if(gizmo){gizmo.setMode('translate');gizmo.attach(rec.group);}
  $('cutInfo').textContent=`Примитив «${name}» добавлен. Двигай/вращай гизмо, экспортируй в STL.`;
}
function addScrew(){
  const d=+($('screwD')?.value||2.0), L=+($('screwL')?.value||10);
  const geo=new THREE.CylinderGeometry(d/2,d/2,L,20);
  // маленький конус-острие
  const rec=addFrag(geoToSoup(geo), 0xcfd6dd, new THREE.Vector3(0,0,1), new THREE.Vector3(), `Винт Ø${d}×${L}`);
  placeAtView(rec); isCut=true; selectFrag(frags.indexOf(rec)); if(gizmo){gizmo.setMode('translate');gizmo.attach(rec.group);}
}
// ---- Нерв: трасса нижнечелюстного канала по точкам ----
let nerveMode=false, nervePts=[], nerveMarks=[];
function setNerveMode(on){ nerveMode=on; $('nerveBtn')?.classList.toggle('armed',on);
  if(on){ setPenMode(false); setDevPtMode(false); setMidMode(false); setMeasMode&&setMeasMode(null); setPickMode(false);
    nervePts=[]; nerveMarks.forEach(m=>scene.remove(m)); nerveMarks=[];
    $('cutInfo').textContent='Нерв: кликай точки вдоль канала (по кости/срезам). «Готово» — построить трассу.'; } }
function addNervePt(pt){ nervePts.push(pt.clone()); const m=markerMesh(0xff5d6c); m.position.copy(pt); scene.add(m); nerveMarks.push(m); }
function buildNerve(){
  if(nervePts.length<2){ alert('Нужно ≥2 точек канала.'); return; }
  nerveMarks.forEach(m=>scene.remove(m)); nerveMarks=[];
  const curve=new THREE.CatmullRomCurve3(nervePts.slice());
  const geo=new THREE.TubeGeometry(curve, Math.max(8,nervePts.length*6), Math.max(0.8,modelRadius*0.012), 10, false);
  const rec=addFrag(geoToSoup(geo), 0xff5d6c, new THREE.Vector3(0,0,1), soupCentroid(geoToSoup(geo)), 'Нижнечелюстной нерв');
  isCut=true; nerveMode=false; $('nerveBtn')?.classList.remove('armed'); nervePts=[];
  $('cutInfo').textContent='Трасса нерва построена (объект «Нижнечелюстной нерв»).';
}
// АВТО-трассировка канала нижнечелюстного нерва прямо по КТ
function buildNerveTube(pts, name, color){
  const vecs = pts.map(p=>new THREE.Vector3(p.x,p.y,p.z));
  const curve=new THREE.CatmullRomCurve3(vecs, false, 'catmullrom', 0.5);
  const geo=new THREE.TubeGeometry(curve, Math.max(24, pts.length*4), Math.max(0.9, modelRadius*0.014), 12, false);
  const soup=geoToSoup(geo);
  addFrag(soup, color, new THREE.Vector3(0,0,1), soupCentroid(soup), name);
}
function autoNerve(){
  if(!volume){ alert('Сначала загрузите КТ.'); return; }
  $('cutInfo').textContent='Трассирую канал нерва по КТ…';
  setTimeout(()=>{
    let seg=null; try{ seg=segmentMandible(volume, threshold); }catch(e){ seg=null; }
    let res=null; try{ res=traceMandibularCanal(volume, threshold, seg); }catch(e){ console.error(e); }
    if(!res || (!res.left && !res.right)){
      alert('Не удалось автоматически найти канал: на этом пороге/качестве КТ полость канала не выделяется как замкнутая. Понизь «3D порог» (чтобы кортикал вокруг канала стал сплошным) и повтори, либо обведи канал вручную кнопкой «Нерв: вручную».');
      $('cutInfo').textContent='Авто-трасса канала не найдена — понизь 3D порог или обведи вручную.';
      return;
    }
    // убрать прежние авто-каналы
    for(let i=frags.length-1;i>=0;i--) if(/канал нерва/i.test(frags[i].name||'')) removeOneFrag(frags[i]);
    let made=0;
    if(res.right && res.right.length>=3){ buildNerveTube(res.right, 'Канал нерва (правый)', 0xff5d6c); made++; }
    if(res.left  && res.left.length>=3){ buildNerveTube(res.left,  'Канал нерва (левый)',  0xff9f43); made++; }
    isCut=true; refreshObjPanel();
    $('cutInfo').textContent = made? `Канал нерва найден автоматически (сторон: ${made}). Проверь ход по MPR; при необходимости обведи вручную.` : 'Канал не найден.';
  }, 30);
}
function exportProtocol(){
  const now=new Date().toLocaleString('ru-RU');
  const meas = $('measVal').style.display!=='none' ? $('measVal').textContent : '—';
  const planned = frags.filter(f=>f.planMM);
  let plan;
  if (planned.length){
    plan = '<b>Результат планирования:</b><br>' + planned.map((f,i)=>{
      const typ = f.planDev.deg===180?'Прямой':f.planDev.name;
      return `${planned.length>1?(i===0?'Справа':'Слева')+' — ':''}<b>${typ} — ${f.planMM.toFixed(0)} мм</b>`;
    }).join('<br>');
  } else plan = lastPlan ? `Аппарат <b>${lastPlan.device}</b> — <b>${lastPlan.mm.toFixed(0)} мм</b>.` : 'Планирование КДО не выполнено.';
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

function activeRec(){ return activeFrag>=0 ? frags[activeFrag] : null; }
function activeGroup(){ const r=activeRec(); return r?r.group:null; }

function applyMobileTransform() {
  const g = activeGroup(); if (!isCut || !g || mobileMode==='arc') return;
  const dist=+$('mvDist').value, mx=+$('mvX').value, my=+$('mvY').value, rot=(+$('mvRot').value)*Math.PI/180;
  const rec = activeRec(); const out = rec.n.clone();
  const quat = new THREE.Quaternion().setFromAxisAngle(out, rot);
  const extra = out.clone().multiplyScalar(dist).add(new THREE.Vector3(mx,my,0));
  setGroupRigid(g, quat, rec.centroid, extra);
  $('mvDistv').textContent = dist.toFixed(1)+' мм'; $('mvXv').textContent = mx.toFixed(0);
  $('mvYv').textContent = my.toFixed(0); $('mvRotv').textContent = (+$('mvRot').value).toFixed(0)+'°';
}

// ---- Планирование КДА по «рельсу» из точек аппарата. 180° = прямой (трансляция),
//      меньше — дуга (полный поворот Φ = 180−градус за всю длину). ----
let distr = null;
function railInfo(){
  const f = activeRec();
  let P0, dir;
  if (devPts.length===2){ P0=devPts[0].clone(); dir=devPts[1].clone().sub(devPts[0]); }
  else if (f){ P0=f.centroid.clone(); dir=f.n.clone(); }
  else { P0=cutP.clone(); dir=cutN.clone(); }
  if (dir.lengthSq()<1e-6) dir.set(0,-1,0);
  return { P0, dir:dir.normalize() };
}
// цель для односторонней симметрии: ближайшая точка зеркала здоровой стороны к опоре
function nearestMirrorTarget(P1){
  if(!baseSoup) return null;
  const {point,normal}=midNormalPoint(); const nx=normal.x,ny=normal.y,nz=normal.z;
  let best=Infinity, T=new THREE.Vector3();
  for(let i=0;i<baseSoup.length;i+=3){ const x=baseSoup[i],y=baseSoup[i+1],z=baseSoup[i+2];
    const d=(x-point.x)*nx+(y-point.y)*ny+(z-point.z)*nz;
    const rx=x-2*d*nx, ry=y-2*d*ny, rz=z-2*d*nz;
    const dd=(rx-P1.x)**2+(ry-P1.y)**2+(rz-P1.z)**2;
    if(dd<best){ best=dd; T.set(rx,ry,rz); } }
  return T;
}
// АВТО-расчёт КДО: врач отметил остеотомию и 2 опоры — программа сама считает мм/угол/аппарат
function planKDO() {
  if (!isCut || activeFrag<0) { alert('Сначала распили и кликни подвижный (дистальный) фрагмент.'); return; }
  if (devPts.length<2) { alert('Поставь 2 точки аппарата: 1-я — дистальная опора, 2-я — медиальная.'); return; }
  const mode = $('kdoMode').value;
  const P1 = devPts[0].clone(), P2 = devPts[1].clone();          // 1-я дистальная опора, 2-я медиальная
  // НАПРАВЛЕНИЕ дистракции — строго вдоль тела (рельс от медиальной к дистальной опоре),
  // фрагмент едет прямо, не «криво».
  let dir = P1.clone().sub(P2); if(dir.lengthSq()<1e-6) dir.copy(activeRec().n); dir.normalize();
  // --- ФИЗИОЛОГИЧНОЕ НАПРАВЛЕНИЕ: строго в анатомической плоскости ---
  // Медиолатеральная ось = нормаль срединной (сагиттальной) плоскости.
  const ml = midNormalPoint().normal.clone().normalize();       // лево-право
  const vert = new THREE.Vector3(0,0,1);                          // верх-низ (ось срезов)
  // AP-ось (вперёд-назад) в сагиттальной плоскости
  let apAxis = new THREE.Vector3().crossVectors(ml, vert); if(apAxis.lengthSq()<1e-6) apAxis.set(0,1,0); apAxis.normalize();
  const kdoPlane = ($('kdoPlane')&&$('kdoPlane').value) || 'sag';
  // убираем медиолатеральную составляющую — фрагмент НИКОГДА не идёт «внутрь»/через среднюю линию
  dir = dir.sub(ml.clone().multiplyScalar(dir.dot(ml)));
  if(kdoPlane==='vert') dir = vert.clone();                      // только вертикально (удлинение ветви)
  if(dir.lengthSq()<1e-6) dir = apAxis.clone();
  dir.normalize();
  // фрагмент едет НАРУЖУ (от опоры), не внутрь
  if (baseSoup){ const outward=activeRec().centroid.clone().sub(soupCentroid(baseSoup));
    if(dir.dot(outward)<0) dir.negate(); }
  let mm, curveDeg=0;
  if (mode==='uni'){
    const target = nearestMirrorTarget(P1);                      // зеркало здоровой стороны
    if (target){
      const disp = target.clone().sub(P1);
      mm = disp.dot(dir);                                        // проекция дефицита на ось тела
      curveDeg = disp.clone().sub(dir.clone().multiplyScalar(mm)).length(); // поперечная составляющая (мм)
      if (mm < 1) mm = Math.max(2, disp.length());               // если проекция мала — берём модуль
    } else mm = 12;
  } else {
    const {point,normal}=midNormalPoint();
    const toMid = point.clone().sub(P1).dot(dir);                // сколько пройти вдоль тела до средней
    mm = Math.abs(toMid) > 1 ? Math.abs(toMid) : 12;
  }
  mm = Math.min(mm, 40);
  // тип аппарата: прямой (180°) для линейного хода; криволинейный при сочетанной
  // плоскости или заметной поперечной (вертикальной) коррекции.
  let deg = 180;
  const wantCurve = kdoPlane==='combo' || curveDeg > 3;
  if (wantCurve){ const need = Math.min(150, 10 + Math.max(curveDeg,6)*4);
    let best=DEVICES[0]; for(const d of DEVICES) if(Math.abs(d.deg-(180-need))<Math.abs(best.deg-(180-need))) best=d; deg=best.deg; }
  curDevice = DEVICES.find(d=>d.deg===deg) || DEVICES[DEVICES.length-1];
  // ось изгиба дуги — В САГИТТАЛЬНОЙ ПЛОСКОСТИ (⟂ медиолатеральной оси, ⟂ dir),
  // направлена вниз-вперёд: криволинейный аппарат ведёт фрагмент сочетанно
  // сагиттально+вертикально, но НЕ поперёк (не внутрь черепа).
  let perp=new THREE.Vector3().crossVectors(ml, dir); if(perp.lengthSq()<1e-6) perp.copy(apAxis); perp.normalize();
  if(perp.dot(vert) > 0) perp.negate();                          // изгиб книзу (физиологично вперёд-вниз)
  distr = { P0:P1, dir, perp, deg:curDevice.deg, L:mm, ml:ml.clone() };
  mobileMode='arc'; drawArc();
  $('arcDist').max=mm.toFixed(1); $('arcDist').value=mm.toFixed(1); moveAlongArc();
  const rec=activeRec(); rec.planDev=curDevice; rec.planMM=mm;
  const typ = curDevice.deg===180?'Прямой (180°)':curDevice.name;
  const plLbl = kdoPlane==='vert'?'вертикально (удлинение ветви)':kdoPlane==='combo'?'сочетанно сагиттально+вертикально':'в сагиттальной плоскости (вперёд-вниз)';
  $('kdoInfo').innerHTML = `<b style="color:var(--accent)">${typ}</b> — <b>${mm.toFixed(0)} мм</b> · ${plLbl}`;
  $('symInfo').textContent = mode==='uni'?'Цель: симметрия со здоровой стороной. Ползунок «Дистракция» — анимация.':'Цель: смыкание по средней линии. Ползунок «Дистракция» — анимация.';
  lastPlan = { mode, device:typ, mm, deg:curDevice.deg };
}
// путь дистального ориентира при длине s
function railPoint(s){
  const { P0, dir, perp, deg, L } = distr;
  const Phi = (180-deg)*Math.PI/180;
  if (Phi < 1e-4) return P0.clone().add(dir.clone().multiplyScalar(s));
  const R = L / Phi; const C = P0.clone().add(perp.clone().multiplyScalar(R));
  const axis = new THREE.Vector3().crossVectors(dir, perp).normalize();
  return C.clone().add(P0.clone().sub(C).applyAxisAngle(axis, Math.min(s/R, Phi)));
}
function drawArc() {
  clearArc(); if(!distr) return;
  const pts=[]; const seg=48; for(let i=0;i<=seg;i++) pts.push(railPoint(distr.L*i/seg));
  const curve=new THREE.CatmullRomCurve3(pts);
  const geo=new THREE.TubeGeometry(curve, seg, Math.max(0.5, modelRadius*0.01), 8, false);
  arcMesh=new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color:0x2fe4d6 })); scene.add(arcMesh);
}
function clearArc(){ if (arcMesh){ scene.remove(arcMesh); arcMesh.geometry.dispose(); arcMesh=null; } }
function clearRegen(){ if(regenMesh){ scene.remove(regenMesh); regenMesh.geometry.dispose(); regenMesh=null; } }
function drawRegen(s){                 // «регенерат» — растущая перемычка вдоль пройденного пути
  clearRegen(); if(!distr || s<0.5) return;
  const seg=Math.max(2, Math.round(s/1.5)); const pts=[];
  for(let i=0;i<=seg;i++) pts.push(railPoint(s*i/seg));
  const curve=new THREE.CatmullRomCurve3(pts);
  const geo=new THREE.TubeGeometry(curve, seg, Math.max(1.2, modelRadius*0.06), 10, false);
  regenMesh=new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color:0xffc24d, transparent:true, opacity:0.5, roughness:0.8 }));
  scene.add(regenMesh);
}
function moveAlongArc() {
  const g = activeGroup(); if (mobileMode!=='arc' || !distr || !g) return;
  const s = +$('arcDist').value;
  const { P0, dir, perp, deg, L } = distr;
  const Phi=(180-deg)*Math.PI/180;
  if (Phi<1e-4){ g.quaternion.identity(); g.position.copy(dir.clone().multiplyScalar(s)); }
  else { const R=L/Phi; const C=P0.clone().add(perp.clone().multiplyScalar(R));
    const axis=new THREE.Vector3().crossVectors(dir,perp).normalize();
    const quat=new THREE.Quaternion().setFromAxisAngle(axis, Math.min(s/R,Phi));
    setGroupRigid(g, quat, C, null); }
  drawRegen(s);
  $('arcDistv').textContent = `${s.toFixed(1)} мм`;
}

function removeFrags(){
  frags.forEach(f=>{ scene.remove(f.group); f.mesh.geometry.dispose(); });
  frags=[]; activeFrag=-1;
  if (baseMesh){ scene.remove(baseMesh); baseMesh.geometry.dispose(); baseMesh=null; }
  baseSoup=null; if(gizmo) gizmo.detach(); refreshObjPanel();
}
function resetCut(silent){
  removeFrags(); clearArc(); clearRegen(); clearDevPts(); clearSym(); lineCut=null; distr=null;
  isCut=false; mobileMode='sliders';
  if (boneMesh) boneMesh.visible = true;
  if (gizmo) gizmo.detach();
  if (!silent && $('cutInfo')) $('cutInfo').textContent = 'Нарисуй линию карандашом или наведи рамку и распили.';
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
  $('segBtn').onclick = ()=>{ if(boneSurf) autoSegment(false); };
  // импланты / ориентиры
  $('primCyl').onclick = ()=> addPrimitive('cyl');
  $('primBox').onclick = ()=> addPrimitive('box');
  $('primSph').onclick = ()=> addPrimitive('sph');
  $('screwBtn').onclick = addScrew;
  $('nerveBtn').onclick = ()=> setNerveMode(!nerveMode);
  $('nerveDone').onclick = buildNerve;
  $('nerveAuto').onclick = autoNerve;
  $('expObjSTL').onclick = exportActiveSTL;
  $('impSTLbtn').onclick = ()=> $('impSTL').click();
  $('impSTL').addEventListener('change', e=> importSTLFiles(e.target.files));
  ['mvDist','mvX','mvY','mvRot'].forEach(id => $(id).addEventListener('input', ()=>{ mobileMode='sliders'; clearArc(); clearRegen(); applyMobileTransform(); }));
  // гизмо для фрагментов
  $('pickBtn').onclick = ()=> setPickMode(!pickMode);
  $('gizMove').onclick = ()=> gizmo && gizmo.setMode('translate');
  $('gizRot').onclick  = ()=> gizmo && gizmo.setMode('rotate');
  // КДА (авто)
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
  $('knifeUndo').onclick = knifeUndo;
  $('penMode').addEventListener('change', clearPen);
  $('rotFree').onclick = ()=> setRotMode('free');
  $('rotTurn').onclick = ()=> setRotMode('turn');
  $('rotPan').onclick = ()=> setRotMode('pan');
  $('zoomIn').onclick = ()=> zoomStep(0.82);
  $('zoomOut').onclick = ()=> zoomStep(1.22);
  $('kdoMode').addEventListener('change', ()=>{});
  $('devPtBtn').onclick = ()=> setDevPtMode(!devPtMode);
  // нож по клавише Delete
  window.addEventListener('keydown', (e)=>{ if((e.key==='Delete'||e.key==='Backspace') && penMode()==='knife' && penPts.length>2){ e.preventDefault(); doKnife(); } });
  // симметрия
  $('midSetBtn').onclick = ()=> setMidMode(!midMode);
  $('midAdj').addEventListener('input', ()=>{ $('midAdjv').textContent=$('midAdj').value+' мм';
    if(mirrorMesh) rebuildMirror(); if(symHealthy) setSymTarget(symHealthy); });
  $('mirrorBtn').onclick = toggleMirror;
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
  $('slab').addEventListener('input', e=>{ slabN=+e.target.value; $('slabv').textContent=slabN; if(volume) renderAllMPR(); });
  $('obl').onclick = ()=>{ oblique.on=!oblique.on; $('obl').classList.toggle('armed',oblique.on); if(volume) renderMPR('coronal'); };
  $('oblA').addEventListener('input', e=>{ oblique.angle=+e.target.value; $('oblAv').textContent=oblique.angle+'°'; if(volume&&oblique.on) renderMPR('coronal'); });
  $('mDist').onclick = ()=> setMprMode('dist');
  $('mAngle').onclick = ()=> setMprMode('angle');
  $('mDens').onclick = ()=> setMprMode('dens');
  $('mClear').onclick = clearMpr;
  bindMprMeas();
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
setRotMode('free');
status('', null);
// скрыть сплэш после инициализации
setTimeout(()=>{ const s=$('splash'); if(s) s.classList.add('hide'); setTimeout(()=>s&&s.remove(), 700); }, 1700);
window.__loadFiles = loadFiles; // хук для авто-тестов
