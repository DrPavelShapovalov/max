// Декодирование сжатых DICOM-кадров (offline, чистый JS / asm.js — без внешних загрузок).
// Поддержка: RLE Lossless, JPEG Lossless, JPEG-LS, JPEG2000, JPEG baseline.
import { Decoder as JpegLosslessDecoder } from 'jpeg-lossless-decoder-js';
import * as jpegBaseline from 'jpeg-js';
import OpenJPEGFactory from '@cornerstonejs/codec-openjpeg/decode';
import CharlsFactory from '@cornerstonejs/codec-charls/decode';

let _ojp = null, _charls = null;
async function ojp(){ if(!_ojp) _ojp = await OpenJPEGFactory(); return _ojp; }
async function charls(){ if(!_charls) _charls = await CharlsFactory(); return _charls; }

export function isCompressed(ts){ return !( ts==='1.2.840.10008.1.2' || ts==='1.2.840.10008.1.2.1' || ts==='1.2.840.10008.1.2.1.99'); }
export function codecName(ts){
  const map={
    '1.2.840.10008.1.2.5':'RLE Lossless',
    '1.2.840.10008.1.2.4.50':'JPEG Baseline','1.2.840.10008.1.2.4.51':'JPEG Extended',
    '1.2.840.10008.1.2.4.57':'JPEG Lossless','1.2.840.10008.1.2.4.70':'JPEG Lossless SV1',
    '1.2.840.10008.1.2.4.80':'JPEG-LS Lossless','1.2.840.10008.1.2.4.81':'JPEG-LS Near-lossless',
    '1.2.840.10008.1.2.4.90':'JPEG2000 Lossless','1.2.840.10008.1.2.4.91':'JPEG2000',
  };
  return map[ts] || ts;
}

// RLE (PackBits) — DICOM: заголовок из числа сегментов + смещений, затем сегменты.
function decodeRLE(bytes, rows, cols, bitsAllocated, samples){
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numSeg = dv.getInt32(0, true);
  const offsets = []; for(let i=0;i<numSeg;i++) offsets.push(dv.getInt32(4+i*4, true));
  const npix = rows*cols;
  const bytesPerSample = bitsAllocated>8?2:1;
  const out = new Uint8Array(npix * bytesPerSample * samples);
  // каждый сегмент = один байтовый план; для 16 бит: сегмент0 = старший байт, сегмент1 = младший
  for(let seg=0; seg<numSeg; seg++){
    const start=offsets[seg], end = seg+1<numSeg?offsets[seg+1]:bytes.length;
    const dst = new Uint8Array(npix);
    let p=start, o=0;
    while(p<end && o<npix){
      const n = dv.getInt8(p++);
      if(n>=0){ const cnt=n+1; for(let i=0;i<cnt&&o<npix;i++) dst[o++]=bytes[p++]; }
      else if(n!==-128){ const cnt=-n+1; const v=bytes[p++]; for(let i=0;i<cnt&&o<npix;i++) dst[o++]=v; }
    }
    // разложить сегмент в нужный байт итогового пикселя
    const sampleIdx = Math.floor(seg / bytesPerSample);
    const byteInSample = bytesPerSample===2 ? (bytesPerSample-1 - (seg % bytesPerSample)) : 0; // seg0->high
    for(let i=0;i<npix;i++) out[(i*samples+sampleIdx)*bytesPerSample + byteInSample] = dst[i];
  }
  return out;
}

// вернуть Int16Array/Uint8 массив ЗНАЧЕНИЙ пикселей (stored values, до rescale)
export async function decodeFrame(ts, encoded, info){
  const { rows, cols, bitsAllocated, pixelRep, samples=1 } = info;
  const npix = rows*cols;
  // --- RLE ---
  if (ts==='1.2.840.10008.1.2.5'){
    const raw = decodeRLE(encoded, rows, cols, bitsAllocated, samples);
    return toInt16(raw, bitsAllocated, pixelRep, npix, samples);
  }
  // --- JPEG Lossless (.57/.70) ---
  if (ts==='1.2.840.10008.1.2.4.57' || ts==='1.2.840.10008.1.2.4.70'){
    const d = new JpegLosslessDecoder();
    const ab = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset+encoded.byteLength);
    const decoded = d.decode(ab, 0, ab.byteLength);   // Uint8Array (little-endian bytes)
    return bytesToInt16(new Uint8Array(decoded.buffer||decoded), bitsAllocated, pixelRep, npix, samples);
  }
  // --- JPEG Baseline/Extended (.50/.51) ---
  if (ts==='1.2.840.10008.1.2.4.50' || ts==='1.2.840.10008.1.2.4.51'){
    const img = jpegBaseline.decode(encoded, { useTArray:true });
    const out = new Int16Array(npix);
    for(let i=0;i<npix;i++) out[i] = img.data[i*4]; // яркость (8-бит)
    return out;
  }
  // --- JPEG-LS (.80/.81) ---
  if (ts==='1.2.840.10008.1.2.4.80' || ts==='1.2.840.10008.1.2.4.81'){
    const m = await charls(); const dec = new m.JpegLSDecoder();
    const buf = dec.getEncodedBuffer(encoded.length); buf.set(encoded);
    dec.decode(); const fi=dec.getFrameInfo(); const out=dec.getDecodedBuffer();
    const res = bufToInt16(out, fi, npix, samples); dec.delete(); return res;
  }
  // --- JPEG2000 (.90/.91) ---
  if (ts==='1.2.840.10008.1.2.4.90' || ts==='1.2.840.10008.1.2.4.91'){
    const m = await ojp(); const dec = new m.J2KDecoder();
    const buf = dec.getEncodedBuffer(encoded.length); buf.set(encoded);
    dec.decode(); const fi=dec.getFrameInfo(); const out=dec.getDecodedBuffer();
    const res = bufToInt16(out, fi, npix, samples); dec.delete(); return res;
  }
  throw Object.assign(new Error('Неизвестный синтаксис сжатия: '+codecName(ts)), { code:'CODEC' });
}

// helpers ----
function bufToInt16(u8, fi, npix, samples){
  const bps = fi.bitsPerSample || 16; const signed = !!fi.isSigned;
  const comp = fi.componentCount || samples || 1;
  const out = new Int16Array(npix);
  if (bps<=8){ for(let i=0;i<npix;i++) out[i]=u8[i*comp]; return out; }
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  for(let i=0;i<npix;i++){ const o=i*comp*2; out[i]= signed?dv.getInt16(o,true):dv.getUint16(o,true); }
  return out;
}
function bytesToInt16(u8, bitsAllocated, pixelRep, npix, samples){
  const out=new Int16Array(npix);
  if (bitsAllocated<=8){ for(let i=0;i<npix;i++) out[i]=u8[i*samples]; return out; }
  const dv=new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  for(let i=0;i<npix;i++){ const o=i*samples*2; out[i]= pixelRep===1?dv.getInt16(o,true):dv.getUint16(o,true); }
  return out;
}
function toInt16(u8, bitsAllocated, pixelRep, npix, samples){ return bytesToInt16(u8, bitsAllocated, pixelRep, npix, samples); }
