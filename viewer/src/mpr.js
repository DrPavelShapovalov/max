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
  }
  _lut(v) { const lo = this.wc - this.ww / 2; let p = ((v - lo) / this.ww) * 255; return p < 0 ? 0 : p > 255 ? 255 : p | 0; }

  // Универсальный рендер плоскости в canvas с «вписыванием» и перекрестием.
  _render(cv, W, H, aspectX, aspectY, sample, crossU, crossV) {
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
    const s = Math.min(cw / pw, ch / ph) * 0.96;
    const dw = pw * s, dh = ph * s, dx = (cw - dw) / 2, dy = (ch - dh) / 2;
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
      (i, j) => data[base + j * nx + i], this.ix, this.iy);
  }
  drawCoronal(cv) { // y = iy; оси (x,z)
    const { data } = this.vol, nx = this.nx, ny = this.ny, nz = this.nz;
    this._render(cv, nx, nz, this.vol.spacing[0], this.vol.spacing[2],
      (i, j) => data[j * nx * ny + this.iy * nx + i], this.ix, this.iz);
  }
  drawSagittal(cv) { // x = ix; оси (y,z)
    const { data } = this.vol, nx = this.nx, ny = this.ny, nz = this.nz;
    this._render(cv, ny, nz, this.vol.spacing[1], this.vol.spacing[2],
      (i, j) => data[j * nx * ny + i * nx + this.ix], this.iy, this.iz);
  }
  drawAll(cvA, cvC, cvS) { if (cvA) this.drawAxial(cvA); if (cvC) this.drawCoronal(cvC); if (cvS) this.drawSagittal(cvS); }
}
