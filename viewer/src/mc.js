import { surfaceNets } from 'isosurface';

// Извлечение изоповерхности кости из объёма.
// Для скорости объём при необходимости прореживается до ~targetMax по наибольшей оси.
export function extractSurface(volume, isolevel, targetMax = 160) {
  const [nx, ny, nz] = volume.dims;
  const src = volume.data;
  const step = Math.max(1, Math.ceil(Math.max(nx, ny, nz) / targetMax));

  const dx = Math.floor((nx - 1) / step) + 1;
  const dy = Math.floor((ny - 1) / step) + 1;
  const dz = Math.floor((nz - 1) / step) + 1;

  // прореженный объём в Float32
  const ds = new Float32Array(dx * dy * dz);
  for (let z = 0; z < dz; z++) {
    const sz = Math.min(z * step, nz - 1);
    for (let y = 0; y < dy; y++) {
      const sy = Math.min(y * step, ny - 1);
      const rowBase = sz * nx * ny + sy * nx;
      const dstBase = z * dx * dy + y * dx;
      for (let x = 0; x < dx; x++) {
        const sx = Math.min(x * step, nx - 1);
        ds[dstBase + x] = src[rowBase + sx];
      }
    }
  }

  const dims = [dx, dy, dz];
  const potential = (x, y, z) => ds[z * dx * dy + y * dx + x] - isolevel;
  const mesh = surfaceNets(dims, potential);

  // масштаб в мм: шаг сетки * прореживание * spacing
  const sp = volume.spacing;
  const sxmm = sp[0] * step, symm = sp[1] * step, szmm = sp[2] * step;

  const positions = new Float32Array(mesh.positions.length * 3);
  // центрирование для удобного вращения
  const cx = (dx * sxmm) / 2, cy = (dy * symm) / 2, cz = (dz * szmm) / 2;
  for (let i = 0; i < mesh.positions.length; i++) {
    const p = mesh.positions[i];
    positions[i * 3]     = p[0] * sxmm - cx;
    positions[i * 3 + 1] = p[1] * symm - cy;
    positions[i * 3 + 2] = p[2] * szmm - cz;
  }
  // cells → треугольники (surfaceNets отдаёт квады)
  const tris = [];
  for (const c of mesh.cells) {
    if (c.length === 4) {
      tris.push(c[0], c[1], c[2], c[0], c[2], c[3]);
    } else if (c.length === 3) {
      tris.push(c[0], c[1], c[2]);
    }
  }
  return { positions, indices: new Uint32Array(tris), vertexCount: mesh.positions.length, triCount: tris.length / 3, step };
}
