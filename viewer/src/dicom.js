import dicomParser from 'dicom-parser';

// Строим 3D-объём из набора DICOM-файлов одной серии.
// Поддержка: несжатые Little Endian (implicit/explicit), 16-бит CT.
// Сжатые синтаксисы (JPEG/JPEG2000) распознаются и сообщаются отдельно.

const UNCOMPRESSED = new Set([
  '1.2.840.10008.1.2',    // Implicit VR LE
  '1.2.840.10008.1.2.1',  // Explicit VR LE
]);

function readSlice(buffer) {
  const byteArray = new Uint8Array(buffer);
  const ds = dicomParser.parseDicom(byteArray);
  const tsuid = ds.string('x00020010') || '1.2.840.10008.1.2';
  const modality = ds.string('x00080060') || '';
  const rows = ds.uint16('x00280010');
  const cols = ds.uint16('x00280011');
  if (!rows || !cols) return null; // не изображение
  const compressed = !UNCOMPRESSED.has(tsuid);

  const ps = (ds.string('x00280030') || '1\\1').split('\\').map(Number); // [row,col] мм
  const thickness = parseFloat(ds.string('x00180050') || '1');
  const ipp = (ds.string('x00200032') || '0\\0\\0').split('\\').map(Number);
  const iop = (ds.string('x00200037') || '1\\0\\0\\0\\1\\0').split('\\').map(Number);
  const slope = parseFloat(ds.string('x00281053') || '1');
  const intercept = parseFloat(ds.string('x00281052') || '0');
  const bits = ds.uint16('x00280100') || 16;
  const pixelRep = ds.uint16('x00280103') || 0; // 0 unsigned, 1 signed
  const instance = parseInt(ds.string('x00200013') || '0', 10);
  const wc = parseFloat((ds.string('x00281050') || '').split('\\')[0]);
  const ww = parseFloat((ds.string('x00281051') || '').split('\\')[0]);

  const pdEl = ds.elements.x7fe00010;
  return {
    rows, cols, ps, thickness, ipp, iop, slope, intercept, bits, pixelRep,
    instance, modality, compressed, tsuid,
    wc: isNaN(wc) ? null : wc, ww: isNaN(ww) ? null : ww,
    _byteArray: byteArray, _pdEl: pdEl,
  };
}

function extractPixels(s) {
  const { _byteArray: ba, _pdEl: el, bits, pixelRep, rows, cols } = s;
  const n = rows * cols;
  if (!el) return null;
  const off = el.dataOffset;
  const out = new Int16Array(n);
  if (bits <= 8) {
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

export async function buildVolume(files, onProgress) {
  // files: массив File. Читаем, парсим, отбираем самую большую серию.
  const slices = [];
  let compressedSeen = false;
  for (let i = 0; i < files.length; i++) {
    const buf = await files[i].arrayBuffer();
    let s;
    try { s = readSlice(buf); } catch (e) { s = null; }
    if (s) { if (s.compressed) compressedSeen = true; slices.push(s); }
    if (onProgress) onProgress((i + 1) / files.length * 0.5, `Чтение срезов ${i + 1}/${files.length}`);
  }
  const valid = slices.filter(s => s.rows && s.cols && !s.compressed);
  if (valid.length === 0) {
    if (compressedSeen) {
      const err = new Error('COMPRESSED');
      err.code = 'COMPRESSED';
      throw err;
    }
    throw new Error('Не найдено ни одного пригодного DICOM-среза (нужна КТ-серия, несжатая).');
  }

  // нормаль среза = iop[0..2] x iop[3..5]
  const [r0, r1, r2, c0, c1, c2] = valid[0].iop;
  const nx = [r1 * c2 - r2 * c1, r2 * c0 - r0 * c2, r0 * c1 - r1 * c0];
  const proj = s => s.ipp[0] * nx[0] + s.ipp[1] * nx[1] + s.ipp[2] * nx[2];
  valid.sort((a, b) => {
    const pa = proj(a), pb = proj(b);
    if (Math.abs(pa - pb) > 1e-6) return pa - pb;
    return a.instance - b.instance;
  });

  const cols = valid[0].cols, rows = valid[0].rows, nz = valid.length;
  // z-spacing из позиций (или из толщины)
  let zsp = valid[0].thickness || 1;
  if (nz > 1) {
    const d = Math.abs(proj(valid[nz - 1]) - proj(valid[0])) / (nz - 1);
    if (d > 1e-3) zsp = d;
  }
  const spacing = [valid[0].ps[1] || 1, valid[0].ps[0] || 1, zsp]; // [x,y,z] мм

  const data = new Int16Array(cols * rows * nz);
  let min = 32767, max = -32768;
  for (let z = 0; z < nz; z++) {
    const s = valid[z];
    const px = extractPixels(s);
    const base = z * cols * rows;
    for (let i = 0; i < cols * rows; i++) {
      let v = px[i] * s.slope + s.intercept; // HU
      v = v | 0;
      data[base + i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (onProgress) onProgress(0.5 + (z + 1) / nz * 0.5, `Сборка объёма ${z + 1}/${nz}`);
  }

  const wc = valid[0].wc, ww = valid[0].ww;
  return {
    data, dims: [cols, rows, nz], spacing, min, max,
    modality: valid[0].modality,
    window: { center: wc ?? 300, width: ww ?? 1500 },
  };
}
