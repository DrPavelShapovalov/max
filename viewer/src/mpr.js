// MPR — мультипланарные срезы из КТ-объёма (аксиал / коронар / сагиттал).
// Объём: { data, dims:[nx,ny,nz], spacing:[sx,sy,sz] }, индекс = z*nx*ny + y*nx + x.
// Рисуем в оттенках серого с окном WC/WW, учитываем анизотропию (spacing) и
// показываем перекрестие текущих срезов.

export class MPR {
  constructor(vol) {
    this.vol = vol;
    const [nx, ny, nz] = vol.dims;
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.ix = nx >> 1; this.iy = ny >> 1; this.iz = nz >> 1;  // текущие срезы
    this.wc = 300; this.ww = 1500;
    this._off = document.createElement('canvas');
    this.view = { axial: null, coronal: null, sagittal: null };  // трансформы последнего рендера
    this.zoom = { axial: 1, coronal: 1, sagittal: 1 };
    this.pan = { axial: { x: 0, y: 0 }, coronal: { x: 0, y: 0 }, sagittal: { x: 0, y: 0 } };
  }
  resetView(key) { this.zoom[key] = 1; this.pan[key] = { x: 0, y: 0 }; }
  _lut(v) { const lo = this.wc - this.ww / 2; let p = ((v - lo) / this.ww) * 255; return p < 0 ? 0 : p > 255 ? 255 : p | 0; }

  // Параметры плоскости: оси вокселей (U,V), фиксированная ось, физический шаг.
  planeInfo(key) {
    const sp = this.vol.spacing;
    if (key === 'axial') return { W: this.nx, H: this.ny, su: sp[0], sv: sp[1], fixed: 'z', idx: this.iz };
    if (key === 'coronal') return { W: this.nx, H: this.nz, su: sp[0], sv: sp[2], fixed: 'y', idx: this.iy };
    return { W: this.ny, H: this.nz, su: sp[1], sv: sp[2], fixed: 'x', idx: this.ix };
  }
  // воксель (i,j) плоскости → пиксели канваса (по трансформе последнего рендера)
  voxelToCanvas(key, i, j) { const v = this.view[key]; if (!v) return null; return { x: v.dx + (i / v.W) * v.dw, y: v.dy + (j / v.H) * v.dh }; }
  canvasToVoxel(key, cx, cy) { const v = this.view[key]; if (!v) return null; return { i: (cx - v.dx) / v.dw * v.W, j: (cy - v.dy) / v.dh * v.H }; }

  // Универсальный рендер плоскости в canvas с «вписыванием» и перекрестием.
  _render(cv, W, H, aspectX, aspectY, sample, crossU, crossV, key) {
    const off = this._off; off.width = W; off.height = H;
    const octx = off.getContext('2d');
    const img = octx.createImageData(W, H);
    const d = img.data;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const g = this._lut(sample(i, j));
      const o = (j * W + i) * 4; d[o] = d[o + 1] = d[o + 2] = g; d[o + 3] = 255;
    }
    octx.putImageData(img, 0, 0);

    const cw = cv.width = cv.clientWidth || 300, ch = cv.height = cv.clientHeight || 200;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#05080b'; ctx.fillRect(0, 0, cw, ch);
    // вписываем с учётом физического соотношения сторон
    const pw = W * aspectX, ph = H * aspectY;
    const base = Math.min(cw / pw, ch / ph) * 0.96;
    const z = (key && this.zoom[key]) || 1;
    const pan = (key && this.pan[key]) || { x: 0, y: 0 };
    const dw = pw * base * z, dh = ph * base * z;
    const dx = (cw - dw) / 2 + pan.x, dy = (ch - dh) / 2 + pan.y;
    if (key) this.view[key] = { dx, dy, dw, dh, W, H };   // сохраняем трансформу для оверлеев/кликов
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, W, H, dx, dy, dw, dh);
    // перекрестие
    ctx.strokeStyle = 'rgba(51,236,221,.55)'; ctx.lineWidth = 1;
    const cx = dx + (crossU / W) * dw, cy = dy + (crossV / H) * dh;
    ctx.beginPath(); ctx.moveTo(cx, dy); ctx.lineTo(cx, dy + dh); ctx.moveTo(dx, cy); ctx.lineTo(dx + dw, cy); ctx.stroke();
    // рамка
    ctx.strokeStyle = 'rgba(47,228,214,.25)'; ctx.strokeRect(dx, dy, dw, dh);
  }

  drawAxial(cv) {   // z = iz; оси (x,y)
    const { data } = this.vol, nx = this.nx, ny = this.ny, base = this.iz * nx * ny;
    this._render(cv, nx, ny, this.vol.spacing[0], this.vol.spacing[1],
      (i, j) => data[base + j * nx + i], this.ix, this.iy, 'axial');
  }
  drawCoronal(cv) { // y = iy; оси (x,z)
    const { data } = this.vol, nx = this.nx, ny = this.ny, nz = this.nz;
    this._render(cv, nx, nz, this.vol.spacing[0], this.vol.spacing[2],
      (i, j) => data[j * nx * ny + this.iy * nx + i], this.ix, this.iz, 'coronal');
  }
  drawSagittal(cv) { // x = ix; оси (y,z)
    const { data } = this.vol, nx = this.nx, ny = this.ny, nz = this.nz;
    this._render(cv, ny, nz, this.vol.spacing[1], this.vol.spacing[2],
      (i, j) => data[j * nx * ny + i * nx + this.ix], this.iy, this.iz, 'sagittal');
  }
  drawAll(cvA, cvC, cvS) { if (cvA) this.drawAxial(cvA); if (cvC) this.drawCoronal(cvC); if (cvS) this.drawSagittal(cvS); }
}
