import dicomParser from 'dicom-parser';

// Загрузка DICOM с ГРУППИРОВКОЙ ПО СЕРИЯМ.
// Несколько серий в папке (мягкотканная / костная / разведка) больше не
// смешиваются в один объём. Возвращаем список серий + собранный объём.
// Поддержка: несжатые Little Endian (implicit/explicit), 8/16-бит.

const UNCOMPRESSED = new Set([
  '1.2.840.10008.1.2',    // Implicit VR LE
  '1.2.840.10008.1.2.1',  // Explicit VR LE
  '1.2.840.10008.1.2.1.99', // Deflated Explicit VR LE (обычно тоже читается)
]);

function readSlice(buffer) {
  const byteArray = new Uint8Array(buffer);
  const ds = dicomParser.parseDicom(byteArray);
  const tsuid = ds.string('x00020010') || '1.2.840.10008.1.2';
  const rows = ds.uint16('x00280010');
  const cols = ds.uint16('x00280011');
  if (!rows || !cols) return null;
  const pdEl = ds.elements.x7fe00010;
  if (!pdEl) return null;
  const ps = (ds.string('x00280030') || '1\\1').split('\\').map(Number);   // [row,col] мм
  const thickness = parseFloat(ds.string('x00180050') || '0') || 0;
  const ipp = (ds.string('x00200032') || '0\\0\\0').split('\\').map(Number);
  const iop = (ds.string('x00200037') || '1\\0\\0\\0\\1\\0').split('\\').map(Number);
  const slope = parseFloat(ds.string('x00281053') || '1') || 1;
  const intercept = parseFloat(ds.string('x00281052') || '0') || 0;
  const bits = ds.uint16('x00280100') || 16;
  const pixelRep = ds.uint16('x00280103') || 0;
  const samples = ds.uint16('x00280002') || 1;                             // 1=grayscale, 3=RGB (скаут)
  const instance = parseInt(ds.string('x00200013') || '0', 10) || 0;
  const seriesUID = ds.string('x0020000e') || 'S';
  const seriesNum = ds.string('x00200011') || '';
  const desc = (ds.string('x0008103e') || '').trim();                      // SeriesDescription
  const kernel = (ds.string('x00181210') || '').trim();                    // ConvolutionKernel
  const modality = ds.string('x00080060') || '';
  const wc = parseFloat((ds.string('x00281050') || '').split('\\')[0]);
  const ww = parseFloat((ds.string('x00281051') || '').split('\\')[0]);
  return {
    rows, cols, ps, thickness, ipp, iop, slope, intercept, bits, pixelRep, samples,
    instance, seriesUID, seriesNum, desc, kernel, modality,
    compressed: !UNCOMPRESSED.has(tsuid), tsuid,
    wc: isNaN(wc) ? null : wc, ww: isNaN(ww) ? null : ww,
    _byteArray: byteArray, _pdEl: pdEl,
  };
}

function extractPixels(s) {
  const { _byteArray: ba, _pdEl: el, bits, pixelRep, rows, cols, samples } = s;
  const n = rows * cols;
  const off = el.dataOffset;
  const out = new Int16Array(n);
  if (samples === 3) {                       // RGB скаут — берём яркость (обычно отбрасываем как серию)
    for (let i = 0; i < n; i++) out[i] = ba[off + i * 3];
  } else if (bits <= 8) {
    for (let i = 0; i < n; i++) out[i] = ba[off + i];
  } else if (pixelRep === 1) {
    const dv = new DataView(ba.buffer, off, n * 2);
    for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true);
  } else {
    const dv = new DataView(ba.buffer, off, n * 2);
    for (let i = 0; i < n; i++) out[i] = dv.getUint16(i * 2, true) | 0;
  }
  return out;
}

function normalOf(iop){
  const [r0,r1,r2,c0,c1,c2]=iop;
  return [r1*c2-r2*c1, r2*c0-r0*c2, r0*c1-r1*c0];
}
function isBoneKernel(g){
  const s=(g.desc+' '+g.kernel).toLowerCase();
  return /bone|кост|sharp|hard|h\d|b[3-9]|yd|yc|edge/.test(s);
}
function seriesLabel(g, i){
  const base = g.desc || g.kernel || (`Серия ${g.seriesNum||i+1}`);
  return `${base} · ${g.slices.length}`;
}

// подготовка серии: сортировка по позиции, шаг, дедуп совпадающих позиций
function prepareGroup(g){
  const nrm = normalOf(g.slices[0].iop);
  const proj = s => s.ipp[0]*nrm[0] + s.ipp[1]*nrm[1] + s.ipp[2]*nrm[2];
  g.slices.forEach(s=> s._proj = proj(s));
  g.slices.sort((a,b)=> Math.abs(a._proj-b._proj)>1e-4 ? a._proj-b._proj : a.instance-b.instance);
  // убрать дубли по позиции (одинаковый _proj — напр. дозорный/повтор)
  const uniq=[]; let last=null;
  for(const s of g.slices){ if(last===null || Math.abs(s._proj-last)>1e-3){ uniq.push(s); last=s._proj; } }
  g.slices = uniq;
  g.normal = nrm; g.isBone = isBoneKernel(g);
}

function assemble(g, onProgress){
  const valid = g.slices;
  const rows=valid[0].rows, cols=valid[0].cols, nz=valid.length;
  let zsp = valid[0].thickness || 1;
  if (nz>1){ const d=Math.abs(valid[nz-1]._proj - valid[0]._proj)/(nz-1); if(d>1e-3) zsp=d; }
  const spacing=[valid[0].ps[1]||1, valid[0].ps[0]||1, zsp];
  const data=new Int16Array(cols*rows*nz);
  let min=32767,max=-32768;
  for(let z=0;z<nz;z++){
    const s=valid[z]; const px=extractPixels(s); const base=z*cols*rows;
    for(let i=0;i<cols*rows;i++){ let v=(px[i]*s.slope+s.intercept)|0; data[base+i]=v; if(v<min)min=v; if(v>max)max=v; }
    if(onProgress) onProgress(0.5+(z+1)/nz*0.5, `Сборка объёма ${z+1}/${nz}`);
  }
  return { data, dims:[cols,rows,nz], spacing, min, max, modality:valid[0].modality,
    window:{ center: valid[0].wc ?? 300, width: valid[0].ww ?? 1500 } };
}

// Разбор всех файлов → список серий. Возвращает {series, assembleIndex}.
export async function loadDicom(files, onProgress){
  const heads=[]; let compressedSeen=false;
  for(let i=0;i<files.length;i++){
    let s=null; try{ s=readSlice(await files[i].arrayBuffer()); }catch(e){ s=null; }
    if(s){ if(s.compressed) compressedSeen=true; else heads.push(s); }
    if(onProgress) onProgress((i+1)/files.length*0.5, `Чтение файлов ${i+1}/${files.length}`);
  }
  if(!heads.length){
    if(compressedSeen){ const e=new Error('COMPRESSED'); e.code='COMPRESSED'; throw e; }
    throw new Error('Не найдено пригодных DICOM-срезов (нужна несжатая КТ-серия).');
  }
  // группировка: серия + геометрия кадра (rows/cols) — чтобы разведка/иная матрица не смешивалась
  const map=new Map();
  for(const s of heads){ const key=`${s.seriesUID}#${s.rows}x${s.cols}#${s.samples}`;
    let g=map.get(key); if(!g){ g={ seriesUID:s.seriesUID, seriesNum:s.seriesNum, desc:s.desc, kernel:s.kernel, slices:[] }; map.set(key,g); }
    g.slices.push(s); }
  let groups=[...map.values()].filter(g=>g.slices.length>=3);   // серия из ≥3 срезов
  if(!groups.length) groups=[...map.values()];                  // иначе — что есть
  groups.forEach(prepareGroup);
  // многосерийные тома сначала: больше срезов = основная реконструкция
  groups.sort((a,b)=> b.slices.length - a.slices.length);
  const series = groups.map((g,i)=>({ index:i, label:seriesLabel(g,i), count:g.slices.length, isBone:g.isBone, desc:g.desc||g.kernel||'' }));
  return { groups, series };
}

// собрать объём выбранной серии
export function assembleSeries(groups, index, onProgress){
  return assemble(groups[index], onProgress);
}

// обратная совместимость: собрать основную серию за один вызов
export async function buildVolume(files, onProgress){
  const { groups } = await loadDicom(files, onProgress);
  return assemble(groups[0], onProgress);
}
