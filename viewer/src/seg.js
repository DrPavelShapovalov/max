// Сегментация нижней челюсти по вокселям (устойчиво к тонким сращениям:
// зубные контакты, сустав). Работает на прореженной маске: эрозия рвёт тонкие
// перемычки → связные компоненты → нижняя челюсть = крупная нижняя компонента →
// дилатация метки обратно. Возвращает функцию get(vx,vy,vz) → 1 (челюсть) / 0.
export function segmentMandible(volume, threshold){
  const [nx,ny,nz]=volume.dims, d=volume.data;
  // прореживание до ~128 по наибольшей оси
  const target=128;
  const sx=Math.max(1,Math.ceil(nx/target)), sy=Math.max(1,Math.ceil(ny/target)), sz=Math.max(1,Math.ceil(nz/target));
  const lx=Math.ceil(nx/sx), ly=Math.ceil(ny/sy), lz=Math.ceil(nz/sz);
  const N=lx*ly*lz;
  const mask=new Uint8Array(N);
  // max-pool в блок
  for(let z=0;z<nz;z++){ const lz0=(z/sz)|0; for(let y=0;y<ny;y++){ const ly0=(y/sy)|0; const base=z*nx*ny+y*nx;
    for(let x=0;x<nx;x++){ if(d[base+x]>=threshold){ mask[(lz0*ly+ly0)*lx+((x/sx)|0)]=1; } } } }
  const at=(x,y,z)=> (x<0||y<0||z<0||x>=lx||y>=ly||z>=lz)?0:mask[(z*ly+y)*lx+x];
  // эрозия (6-связность) — рвём тонкие мостики
  const er=new Uint8Array(N);
  for(let z=0;z<lz;z++)for(let y=0;y<ly;y++)for(let x=0;x<lx;x++){
    if(mask[(z*ly+y)*lx+x] && at(x-1,y,z)&&at(x+1,y,z)&&at(x,y-1,z)&&at(x,y+1,z)&&at(x,y,z-1)&&at(x,y,z+1)) er[(z*ly+y)*lx+x]=1; }
  // связные компоненты эрозированной маски (BFS, 6-связность)
  const comp=new Int32Array(N).fill(-1); let nc=0; const sizes=[], sumz=[];
  const stack=new Int32Array(N);
  for(let s=0;s<N;s++){ if(!er[s]||comp[s]>=0) continue;
    let sp=0; stack[sp++]=s; comp[s]=nc; let cnt=0, zsum=0;
    while(sp){ const c=stack[--sp]; cnt++; const z=(c/(lx*ly))|0, y=((c/lx)|0)%ly, x=c%lx; zsum+=z;
      const nb=[[x-1,y,z],[x+1,y,z],[x,y-1,z],[x,y+1,z],[x,y,z-1],[x,y,z+1]];
      for(const [a,b,cc] of nb){ if(a<0||b<0||cc<0||a>=lx||b>=ly||cc>=lz)continue; const j=(cc*ly+b)*lx+a;
        if(er[j]&&comp[j]<0){ comp[j]=nc; stack[sp++]=j; } } }
    sizes[nc]=cnt; sumz[nc]=zsum/cnt; nc++; }
  if(nc<2) return null;                         // не удалось разделить
  // нижняя челюсть — крупная компонента с наименьшим средним Z (нижняя)
  const big=[...sizes.keys()].filter(i=>sizes[i]>=N*0.004).sort((a,b)=>sizes[b]-sizes[a]);
  if(big.length<2) return null;
  let mand=big[0], bestZ=Infinity;
  for(const i of big){ if(sumz[i]<bestZ){ bestZ=sumz[i]; mand=i; } }
  // метка челюсти на LO-сетке + дилатация на 2 вокселя в пределах маски
  let lab=new Uint8Array(N);
  for(let i=0;i<N;i++) if(comp[i]===mand) lab[i]=1;
  for(let it=0;it<2;it++){ const nl=lab.slice();
    for(let z=0;z<lz;z++)for(let y=0;y<ly;y++)for(let x=0;x<lx;x++){ const i=(z*ly+y)*lx+x; if(lab[i]||!mask[i])continue;
      if(at2(lab,x-1,y,z)||at2(lab,x+1,y,z)||at2(lab,x,y-1,z)||at2(lab,x,y+1,z)||at2(lab,x,y,z-1)||at2(lab,x,y,z+1)) nl[i]=1; }
    lab=nl; }
  function at2(arr,x,y,z){ return (x<0||y<0||z<0||x>=lx||y>=ly||z>=lz)?0:arr[(z*ly+y)*lx+x]; }
  return {
    get(vx,vy,vz){ const x=(vx/sx)|0, y=(vy/sy)|0, z=(vz/sz)|0; return at2(lab,x,y,z); }
  };
}
