// Автоматическая трассировка канала нижнечелюстного нерва (canalis mandibulae).
// Канал = ТРУБЧАТАЯ полость низкой плотности, ЗАМКНУТАЯ внутри кости нижней челюсти
// (не сообщается с наружным воздухом). Алгоритм (offline, без сети):
//  1) маска кости НЧ (по порогу + метка сегментации нижней челюсти, слегка расширенная);
//  2) «наружный» воздух — заливка от границ объёма по не-кости;
//  3) замкнутые полости = не-кость, не достигнутые заливкой, внутри НЧ;
//  4) связные компоненты → по стороне (лево/право) выбираем самую вытянутую
//     (это и есть канал: идёт от нижнечелюстного отверстия к подбородочному);
//  5) центральная линия компоненты (проекция на главную ось, бины → центроиды).
// Возвращает { left:[Vec3-подобные {x,y,z}], right:[...] } в МИРОВЫХ координатах
// (согласовано с построением меша: c = vx*spacing - dims*spacing/2).
export function traceMandibularCanal(volume, threshold, seg){
  const [nx,ny,nz]=volume.dims, [spx,spy,spz]=volume.spacing, d=volume.data;
  const target=192;
  const sx=Math.max(1,Math.ceil(nx/target)), sy=Math.max(1,Math.ceil(ny/target)), sz=Math.max(1,Math.ceil(nz/target));
  const lx=Math.ceil(nx/sx), ly=Math.ceil(ny/sy), lz=Math.ceil(nz/sz);
  const N=lx*ly*lz;
  const idx=(x,y,z)=>(z*ly+y)*lx+x;
  const bone=new Uint8Array(N), mand=new Uint8Array(N);
  // выборка центра каждого блока
  for(let z=0;z<lz;z++){ const fz=Math.min(nz-1,z*sz+(sz>>1));
    for(let y=0;y<ly;y++){ const fy=Math.min(ny-1,y*sy+(sy>>1));
      for(let x=0;x<lx;x++){ const fx=Math.min(nx-1,x*sx+(sx>>1));
        const v=d[fz*nx*ny+fy*nx+fx];
        const i=idx(x,y,z);
        if(v>=threshold) bone[i]=1;
        if(seg && seg.get(fx,fy,fz)) mand[i]=1;
      } } }
  // если сегментации нет — считаем «НЧ» = нижняя треть кости в пределах bbox кости
  if(!seg){
    let zmin=lz,zmax=0; for(let i=0;i<N;i++) if(bone[i]){ const z=(i/(lx*ly))|0; if(z<zmin)zmin=z; if(z>zmax)zmax=z; }
    const zc=zmin+(zmax-zmin)*0.5;
    for(let i=0;i<N;i++){ const z=(i/(lx*ly))|0; if(bone[i] && z<=zc) mand[i]=1; }
  }
  // расширяем метку НЧ на 3 вокселя, чтобы захватить кортикал вокруг канала
  const at=(a,x,y,z)=>(x<0||y<0||z<0||x>=lx||y>=ly||z>=lz)?0:a[idx(x,y,z)];
  let md=mand;
  for(let it=0;it<3;it++){ const nl=md.slice();
    for(let z=0;z<lz;z++)for(let y=0;y<ly;y++)for(let x=0;x<lx;x++){ const i=idx(x,y,z); if(md[i])continue;
      if(at(md,x-1,y,z)||at(md,x+1,y,z)||at(md,x,y-1,z)||at(md,x,y+1,z)||at(md,x,y,z-1)||at(md,x,y,z+1)) nl[i]=1; }
    md=nl; }
  // «наружный» воздух: BFS от всех граничных не-кость вокселей
  const outside=new Uint8Array(N); const q=new Int32Array(N); let qh=0,qt=0;
  const pushIf=(x,y,z)=>{ if(x<0||y<0||z<0||x>=lx||y>=ly||z>=lz)return; const i=idx(x,y,z); if(!bone[i]&&!outside[i]){ outside[i]=1; q[qt++]=i; } };
  for(let x=0;x<lx;x++)for(let y=0;y<ly;y++){ pushIf(x,y,0); pushIf(x,y,lz-1); }
  for(let x=0;x<lx;x++)for(let z=0;z<lz;z++){ pushIf(x,0,z); pushIf(x,ly-1,z); }
  for(let y=0;y<ly;y++)for(let z=0;z<lz;z++){ pushIf(0,y,z); pushIf(lx-1,y,z); }
  while(qh<qt){ const c=q[qh++]; const z=(c/(lx*ly))|0, y=((c/lx)|0)%ly, x=c%lx;
    pushIf(x-1,y,z);pushIf(x+1,y,z);pushIf(x,y-1,z);pushIf(x,y+1,z);pushIf(x,y,z-1);pushIf(x,y,z+1); }
  // замкнутые полости внутри НЧ
  const enc=new Uint8Array(N);
  for(let i=0;i<N;i++) if(!bone[i] && !outside[i] && md[i]) enc[i]=1;
  // связные компоненты замкнутых полостей
  const comp=new Int32Array(N).fill(-1); let nc=0; const cells=[];
  const st=new Int32Array(N);
  for(let s=0;s<N;s++){ if(!enc[s]||comp[s]>=0)continue; let sp=0; st[sp++]=s; comp[s]=nc; const list=[];
    while(sp){ const c=st[--sp]; list.push(c); const z=(c/(lx*ly))|0, y=((c/lx)|0)%ly, x=c%lx;
      const nb=[[x-1,y,z],[x+1,y,z],[x,y-1,z],[x,y+1,z],[x,y,z-1],[x,y,z+1]];
      for(const [a,b,cc] of nb){ if(a<0||b<0||cc<0||a>=lx||b>=ly||cc>=lz)continue; const j=idx(a,b,cc); if(enc[j]&&comp[j]<0){ comp[j]=nc; st[sp++]=j; } } }
    cells.push(list); nc++; }
  // (нет замкнутых полостей → cells пуст → сработает запасной путь ниже)
  // центр НЧ по X — делим лево/право
  let mx=0,mn=0; for(let i=0;i<N;i++) if(mand[i]){ const x=i%lx; mx+=x; mn++; } const midX = mn? mx/mn : lx/2;
  // для каждой компоненты — размер, центроид, вытянутость (PCA)
  const toWorld=(x,y,z)=>({ x:(x*sx+sx/2)*spx - nx*spx/2, y:(y*sy+sy/2)*spy - ny*spy/2, z:(z*sz+sz/2)*spz - nz*spz/2 });
  function centerline(list){
    // PCA главная ось
    let cx=0,cy=0,cz=0; for(const c of list){ cx+=c%lx; cy+=((c/lx)|0)%ly; cz+=(c/(lx*ly))|0; }
    const n=list.length; cx/=n;cy/=n;cz/=n;
    let xx=0,xy=0,xz=0,yy=0,yz=0,zz=0;
    for(const c of list){ const x=c%lx-cx, y=((c/lx)|0)%ly-cy, z=((c/(lx*ly))|0)-cz; xx+=x*x;xy+=x*y;xz+=x*z;yy+=y*y;yz+=y*z;zz+=z*z; }
    // степенная итерация для главного собств. вектора матрицы ковариации
    let vx=1,vy=1,vz=1;
    for(let it=0;it<40;it++){ const ax=xx*vx+xy*vy+xz*vz, ay=xy*vx+yy*vy+yz*vz, az=xz*vx+yz*vy+zz*vz;
      const L=Math.hypot(ax,ay,az)||1; vx=ax/L; vy=ay/L; vz=az/L; }
    // проекция на ось, бины
    let tmin=Infinity,tmax=-Infinity; const proj=[];
    for(const c of list){ const x=c%lx-cx, y=((c/lx)|0)%ly-cy, z=((c/(lx*ly))|0)-cz; const t=x*vx+y*vy+z*vz; proj.push(t); if(t<tmin)tmin=t; if(t>tmax)tmax=t; }
    const span=tmax-tmin; const B=Math.max(6, Math.min(28, Math.round(span))); const acc=Array.from({length:B},()=>[0,0,0,0]);
    for(let k=0;k<list.length;k++){ const c=list[k]; const b=Math.min(B-1, Math.max(0, Math.floor((proj[k]-tmin)/(span||1)*(B-1))));
      acc[b][0]+=c%lx; acc[b][1]+=((c/lx)|0)%ly; acc[b][2]+=(c/(lx*ly))|0; acc[b][3]++; }
    const pts=[]; for(const a of acc){ if(a[3]>0) pts.push(toWorld(a[0]/a[3], a[1]/a[3], a[2]/a[3])); }
    return { pts, span, size:n };
  }
  const scored=cells.map((list,ci)=>{ const cl=centerline(list); let cx=0; for(const c of list) cx+=c%lx; cx/=list.length;
    return { ...cl, side: cx<midX?'left':'right', ci, cx }; })
    .filter(o=> o.size>=8 && o.pts.length>=3 && o.span>= 6);   // отсекаем мелкие марровые лакуны
  const pick=(side)=>{ const cand=scored.filter(o=>o.side===side); if(!cand.length) return null;
    cand.sort((a,b)=> (b.span*Math.sqrt(b.size)) - (a.span*Math.sqrt(a.size)) ); return cand[0].pts; };
  let left=pick('left'), right=pick('right');
  if(left || right) return { left, right, approx:false };
  // ---- ЗАПАСНОЙ путь: приблизительная трасса по геометрии НЧ ----
  // (если замкнутая полость канала не выделилась на этом пороге/качестве КТ)
  const approxSide=(sideSel)=>{
    // собрать воксели НЧ выбранной стороны
    const bins=new Map();                                   // ключ по y-бину → {sx,sz,zmin,zmax,n}
    let ymin=ly,ymax=0; const cells2=[];
    for(let i=0;i<N;i++){ if(!mand[i])continue; const x=i%lx; if(sideSel(x)) { const y=((i/lx)|0)%ly; if(y<ymin)ymin=y; if(y>ymax)ymax=y; cells2.push(i); } }
    if(cells2.length<30) return null;
    const NB=16, span=Math.max(1,ymax-ymin);
    for(const i of cells2){ const x=i%lx, y=((i/lx)|0)%ly, z=(i/(lx*ly))|0;
      const b=Math.min(NB-1,Math.floor((y-ymin)/span*(NB-1)));
      let e=bins.get(b); if(!e){ e={sx:0,sz2:0,n:0,zmin:1e9,zmax:-1e9,y}; bins.set(b,e); }
      e.sx+=x; e.n++; if(z<e.zmin)e.zmin=z; if(z>e.zmax)e.zmax=z; e.by=y; }
    const pts=[]; for(let b=0;b<NB;b++){ const e=bins.get(b); if(!e||e.n<3)continue;
      const x=e.sx/e.n, z=e.zmin+0.42*(e.zmax-e.zmin);       // канал ~ на 40% высоты от нижнего края
      pts.push(toWorld(x, e.by, z)); }
    return pts.length>=3? pts : null;
  };
  left = approxSide(x=>x<midX); right = approxSide(x=>x>=midX);
  if(!left && !right) return null;
  return { left, right, approx:true };
}
