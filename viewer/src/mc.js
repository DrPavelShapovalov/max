import { surfaceNets } from 'isosurface';

// Извлечение изоповерхности кости.
// Даунсемплинг РАВНОМЕРНЫЙ по каждой оси (каждая ось приводится под targetMax)
// с max-pooling — так тонкая кортикальная кость не «выпадает» в дыры.
export function extractSurface(volume, isolevel, targetMax = 200) {
  const [nx, ny, nz] = volume.dims;
  const src = volume.data;
  const sxStep = Math.max(1, Math.ceil(nx / targetMax));
  const syStep = Math.max(1, Math.ceil(ny / targetMax));
  const szStep = Math.max(1, Math.ceil(nz / targetMax));

  const dx = Math.ceil(nx / sxStep);
  const dy = Math.ceil(ny / syStep);
  const dz = Math.ceil(nz / szStep);

  const ds = new Float32Array(dx * dy * dz);
  ds.fill(-32768);
  // max-pool исходника в прореженную сетку
  for (let z = 0; z < nz; z++) {
    const oz = (z / szStep) | 0;
    for (let y = 0; y < ny; y++) {
      const oy = (y / syStep) | 0;
      const srcRow = z * nx * ny + y * nx;
      const dstRow = oz * dx * dy + oy * dx;
      for (let x = 0; x < nx; x++) {
        const ox = (x / sxStep) | 0;
        const v = src[srcRow + x];
        const di = dstRow + ox;
        if (v > ds[di]) ds[di] = v;
      }
    }
  }

  const dims = [dx, dy, dz];
  const potential = (x, y, z) => ds[z * dx * dy + y * dx + x] - isolevel;
  const mesh = surfaceNets(dims, potential);

  const sp = volume.spacing;
  const sxmm = sp[0] * sxStep, symm = sp[1] * syStep, szmm = sp[2] * szStep;
  const cx = (dx * sxmm) / 2, cy = (dy * symm) / 2, cz = (dz * szmm) / 2;

  const positions = new Float32Array(mesh.positions.length * 3);
  for (let i = 0; i < mesh.positions.length; i++) {
    const p = mesh.positions[i];
    positions[i * 3]     = p[0] * sxmm - cx;
    positions[i * 3 + 1] = p[1] * symm - cy;
    positions[i * 3 + 2] = p[2] * szmm - cz;
  }
  const tris = [];
  for (const c of mesh.cells) {
    if (c.length === 4) tris.push(c[0], c[1], c[2], c[0], c[2], c[3]);
    else if (c.length === 3) tris.push(c[0], c[1], c[2]);
  }
  return {
    positions, indices: new Uint32Array(tris),
    vertexCount: mesh.positions.length, triCount: tris.length / 3,
    step: `${sxStep}/${syStep}/${szStep}`,
  };
}
