// Автоматическая сегментация нижней челюсти по вокселям.
// Идея: нижняя челюсть «приклеена» к черепу только тонкими перемычками —
// контакты зубов и (иногда) сустав. Эрозия рвёт эти тонкие перемычки, не
// «съедая» массивную кость; дальше — связные компоненты. Череп — самая крупная
// костная компонента, нижняя челюсть — следующая по величине массивная кость,
// лежащая НИЖЕ черепа. Метку челюсти дилатируем обратно в пределах исходной маски.
// Возвращает { get(vx,vy,vz) -> 1 (челюсть) / 0 } либо null, если разделить не вышло.
export function segmentMandible(volume, threshold){
  const [nx,ny,nz]=volume.dims, d=volume.data;
  // ── прореживание до ~128 по наибольшей оси (max-pool, чтобы кортикал не выпал) ──
  const target=128;
  const sx=Math.max(1,Math.ceil(nx/target)), sy=Math.max(1,Math.ceil(ny/target)), sz=Math.max(1,Math.ceil(nz/target));
  const lx=Math.ceil(nx/sx), ly=Math.ceil(ny/sy), lz=Math.ceil(nz/sz);
  const N=lx*ly*lz;
  const mask=new Uint8Array(N);
  for(let z=0;z<nz;z++){ const lz0=(z/sz)|0; for(let y=0;y<ny;y++){ const ly0=(y/sy)|0; const base=z*nx*ny+y*nx;
    for(let x=0;x<nx;x++){ if(d[base+x]>=threshold){ mask[(lz0*ly+ly0)*lx+((x/sx)|0)]=1; } } } }
  const at=(a,x,y,z)=> (x<0||y<0||z<0||x>=lx||y>=ly||z>=lz)?0:a[(z*ly+y)*lx+x];

  // ── адаптивная эрозия: минимум проходов, достаточный для разделения ──
  // тонкие сращения (зубы) рвутся 1–2 проходами; толстые (сустав) — 3–4.
  for(let EROS=1; EROS<=4; EROS++){
    let cur=mask;
    for(let it=0;it<EROS;it++){ const er=new Uint8Array(N);
      for(let z=0;z<lz;z++)for(let y=0;y<ly;y++)for(let x=0;x<lx;x++){
        if(cur[(z*ly+y)*lx+x] && at(cur,x-1,y,z)&&at(cur,x+1,y,z)&&at(cur,x,y-1,z)&&at(cur,x,y+1,z)&&at(cur,x,y,z-1)&&at(cur,x,y,z+1)) er[(z*ly+y)*lx+x]=1; }
      cur=er; }
    const er=cur;

    // ── связные компоненты эрозированной маски (BFS, 6-связность) ──
    const comp=new Int32Array(N).fill(-1); let nc=0;
    const size=[], sumZ=[], minX=[], maxX=[];
    const stack=new Int32Array(N);
    for(let s=0;s<N;s++){ if(!er[s]||comp[s]>=0) continue;
      let sp=0; stack[sp++]=s; comp[s]=nc; let cnt=0, zsum=0, mnx=lx, mxx=-1;
      while(sp){ const cc=stack[--sp]; cnt++; const z=(cc/(lx*ly))|0, y=((cc/lx)|0)%ly, x=cc%lx; zsum+=z; if(x<mnx)mnx=x; if(x>mxx)mxx=x;
        const nb=[[x-1,y,z],[x+1,y,z],[x,y-1,z],[x,y+1,z],[x,y,z-1],[x,y,z+1]];
        for(const [a,b,c] of nb){ if(a<0||b<0||c<0||a>=lx||b>=ly||c>=lz)continue; const j=(c*ly+b)*lx+a;
          if(er[j]&&comp[j]<0){ comp[j]=nc; stack[sp++]=j; } } }
      size[nc]=cnt; sumZ[nc]=zsum/cnt; minX[nc]=mnx; maxX[nc]=mxx; nc++; }
    if(nc<2) continue;                                   // не разделилось — усилить эрозию

    // крупные компоненты (≥0.2% объёма маски), по убыванию размера
    const big=[...size.keys()].filter(i=>size[i]>=N*0.002).sort((a,b)=>size[b]-size[a]);
    if(big.length<2) continue;                           // нет второй массивной кости — усилить эрозию

    const skull=big[0];                                  // череп — самая крупная костная компонента
    // кандидаты в НЧ — прочие крупные; выбираем массивную кость НИЖЕ черепа и пошире (две ветви)
    const zRange=Math.max(1,lz);
    let mand=-1, best=-1e9;
    for(const i of big){ if(i===skull) continue;
      const sizeScore = size[i]/size[skull];                              // крупная
      const inferior  = (sumZ[skull]-sumZ[i])/zRange;                     // ниже черепа (+)
      const widthScore= (maxX[i]-minX[i])/lx;                             // широкая (две ветви)
      const score = 1.0*sizeScore + 1.1*inferior + 0.5*widthScore;
      if(score>best){ best=score; mand=i; }
    }
    if(mand<0 || size[mand] < N*0.003) continue;         // кандидат слишком мал — усилить эрозию

    // ── метка челюсти + дилатация обратно (EROS+1 вокселей) в пределах исходной маски ──
    let lab=new Uint8Array(N);
    for(let i=0;i<N;i++) if(comp[i]===mand) lab[i]=1;
    for(let it=0;it<EROS+1;it++){ const nl=lab.slice();
      for(let z=0;z<lz;z++)for(let y=0;y<ly;y++)for(let x=0;x<lx;x++){ const i=(z*ly+y)*lx+x; if(lab[i]||!mask[i])continue;
        if(at(lab,x-1,y,z)||at(lab,x+1,y,z)||at(lab,x,y-1,z)||at(lab,x,y+1,z)||at(lab,x,y,z-1)||at(lab,x,y,z+1)) nl[i]=1; }
      lab=nl; }
    return { get(vx,vy,vz){ const x=(vx/sx)|0, y=(vy/sy)|0, z=(vz/sz)|0; return at(lab,x,y,z); } };
  }
  return null;                                           // не удалось разделить ни на одном уровне
}
