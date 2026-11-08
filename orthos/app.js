'use strict';
const $=id=>document.getElementById(id);
const LM_DEF = window.ORTHOS_LM;
const LBL = Object.fromEntries(LM_DEF.map(l=>[l.id,l]));
const HARD = LM_DEF.filter(l=>l.kind==='hard').map(l=>l.id);
const ORDER = LM_DEF.map(l=>l.id);
const SOFTSET = new Set(LM_DEF.filter(l=>l.kind==='soft').map(l=>l.id));

const LINES=[['S','N','#5b6cff'],['Go','Me','#18c3b6'],['Po','Or','#8a63ff'],['N','A','#f0a63d'],['N','B','#f0556b'],['U1t','U1a','#5b6cff'],['L1t','L1a','#5b6cff'],['ANS','PNS','#9aa3c2']];
const PROFILE=['G','Prn','Sn','Ls','Li','Pog2','Me2'];

// ── состояние ──
let step='patient', patient={name:'',sex:'M',dob:''};
let vol=null, img=null, scale=0, photo=null;
let LM={}, pickId=null, view={ox:0,oy:0,zoom:1};
let plan={mxAdv:0,mxImp:0,mxPitch:0,mdAdv:0,mdRot:0,chAdv:0,chVert:0,autorot:false};
let overlay=0.5, building=false;

const cv=$('cv'), ctx=cv.getContext('2d');

// ── вектор-помощники ──
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y}),add=(a,b)=>({x:a.x+b.x,y:a.y+b.y}),mul=(a,s)=>({x:a.x*s,y:a.y*s});
const dot=(a,b)=>a.x*b.x+a.y*b.y,len=a=>Math.hypot(a.x,a.y),norm=a=>{const l=len(a)||1;return{x:a.x/l,y:a.y/l};};
const d2r=d=>d*Math.PI/180,r2d=r=>r*180/Math.PI;
function rot(p,pv,a){const c=Math.cos(a),s=Math.sin(a),dx=p.x-pv.x,dy=p.y-pv.y;return{x:pv.x+dx*c-dy*s,y:pv.y+dx*s+dy*c};}
function angAt(v,a,b){const v1=sub(a,v),v2=sub(b,v);return r2d(Math.acos(Math.max(-1,Math.min(1,dot(v1,v2)/((len(v1)*len(v2))||1)))));}
function lineAng(a,b,c,d){const v1=sub(b,a),v2=sub(d,c);return r2d(Math.acos(Math.min(1,Math.abs(dot(v1,v2))/((len(v1)*len(v2))||1))));}
function ptLineMM(p,a,b){if(!scale)return null;const d=sub(b,a),l=len(d)||1;return((p.x-a.x)*d.y-(p.y-a.y)*d.x)/l/scale;}
function axes(){let H;if(LM.Po&&LM.Or)H=norm(sub(LM.Or,LM.Po));else if(LM.A&&LM.PNS)H=norm(sub(LM.A,LM.PNS));else H={x:1,y:0};
  if(LM.A&&LM.S){const w=Math.sign(LM.A.x-LM.S.x);if(w&&Math.sign(H.x)!==w)H={x:-H.x,y:-H.y};}
  let V={x:-H.y,y:H.x};if(V.y<0)V={x:-V.x,y:-V.y};return{H,V};}

// ── цефалометрия ──
function analyse(G){
  const has=(...k)=>k.every(x=>G[x]);const rows=[];
  const a_=(key,val,lo,hi,norm,extra)=>{let st='—';if(val!=null&&!isNaN(val))st=val<lo?'ниже':(val>hi?'выше':'норма');rows.push({key,val,lo,hi,norm,st,extra});};
  a_('SNA, °',has('S','N','A')?angAt(G.N,G.S,G.A):null,80,84,'82±2');
  a_('SNB, °',has('S','N','B')?angAt(G.N,G.S,G.B):null,78,82,'80±2');
  let anb=null,cls='';if(has('S','N','A','B')){anb=angAt(G.N,G.S,G.A)-angAt(G.N,G.S,G.B);cls=anb>4?'II класс':(anb<0?'III класс':'I класс');}
  a_('ANB, °',anb,0,4,'2±2',cls);
  a_('Wits, мм',has('A','B','U1t','L1t')?(()=>{const ao=ptLineMM(G.A,G.U1t,G.L1t),bo=ptLineMM(G.B,G.U1t,G.L1t);return ao==null?null:(ao-bo);})():null,-1,3,'−1…3');
  a_('SN–MP, °',has('S','N','Go','Me')?lineAng(G.S,G.N,G.Go,G.Me):null,28,37,'32±5');
  a_('FMA, °',has('Po','Or','Go','Me')?lineAng(G.Po,G.Or,G.Go,G.Me):null,20,30,'25±5');
  a_('U1–NA, °',has('U1a','U1t','N','A')?lineAng(G.U1a,G.U1t,G.N,G.A):null,18,26,'22±2');
  a_('U1–NA, мм',has('U1t','N','A')?Math.abs(ptLineMM(G.U1t,G.N,G.A)):null,2,6,'4±2');
  a_('L1–NB, °',has('L1a','L1t','N','B')?lineAng(G.L1a,G.L1t,G.N,G.B):null,21,29,'25±2');
  a_('L1–NB, мм',has('L1t','N','B')?Math.abs(ptLineMM(G.L1t,G.N,G.B)):null,2,6,'4±2');
  if(has('U1a','U1t','L1a','L1t')){const v1=sub(G.U1t,G.U1a),v2=sub(G.L1t,G.L1a);a_('Межрезцовый, °',180-r2d(Math.acos(Math.max(-1,Math.min(1,dot(v1,v2)/((len(v1)*len(v2))||1))))),124,138,'131±7');}
  a_('Носогубный, °',has('Prn','Sn','Ls')?angAt(G.Sn,G.Prn,G.Ls):null,90,110,'100±10');
  return rows;
}
// Прогноз мягких тканей: средние коэффициенты «движение мягкой точки / движение
// опорной костной точки», раздельно по горизонтали (H) и вертикали (V). Значения —
// усреднённые по литературе ориентиры для ортогнатики (не копия источника):
//   [мягкая, костная_опора, kH, kV]
const ST_RATIO=[
  ['Prn','ANS',0.30,0.15],   // кончик носа: проекция от в/ч (адв. в/ч приподнимает/выдвигает нос)
  ['Sn','A',   0.55,0.45],   // субназале ← точка A
  ['Ls','U1t', 0.65,0.55],   // верхняя губа ← режущий край U1 (адв. в/ч + ретракция резца)
  ['Li','L1t', 0.70,0.55],   // нижняя губа ← режущий край L1
  ['Pog2','Pog',0.95,0.90],  // мягк. погонион ← костный погонион
  ['Me2','Me', 0.95,1.00],   // мягк. ментон ← костный ментон
];
function planned(){
  const {H,V}=axes();const s=scale||1;const P={};for(const k in LM)P[k]={x:LM[k].x,y:LM[k].y};
  const mxT=add(mul(H,plan.mxAdv*s),mul(V,-plan.mxImp*s)),mdT=mul(H,plan.mdAdv*s),chT=add(mul(H,plan.chAdv*s),mul(V,plan.chVert*s));
  const mdRot=plan.autorot?(plan.mxImp*1.1):plan.mdRot;const pivMx=LM.PNS||LM.ANS||LM.A,pivMd=LM.Ar||LM.Go;
  ['A','ANS','PNS','U1t','U1a'].forEach(k=>{if(!LM[k])return;let q=pivMx?rot(LM[k],pivMx,d2r(plan.mxPitch)):LM[k];P[k]=add(q,mxT);});
  ['B','L1t','L1a','Pog','Gn','Me'].forEach(k=>{if(!LM[k])return;let q=pivMd?rot(LM[k],pivMd,d2r(mdRot)):LM[k];P[k]=add(q,mdT);});
  ['Pog','Gn','Me'].forEach(k=>{if(P[k])P[k]=add(P[k],chT);});
  // мягкие ткани — по опорным костным точкам с раздельными H/V коэффициентами
  ST_RATIO.forEach(([sk,src,rh,rv])=>{if(!LM[sk]||!LM[src]||!P[src])return;const d=sub(P[src],LM[src]);
    P[sk]=add(LM[sk],add(mul(H,dot(d,H)*rh),mul(V,dot(d,V)*rv)));});
  // верхняя губа дополнительно укорачивается/выворачивается при импакции в/ч (верт. связь)
  if(LM.Ls&&P.Ls&&plan.mxImp){P.Ls=add(P.Ls,mul(V,-plan.mxImp*s*0.25));}
  return P;
}
const fmt=x=>(x>=0?'+':'')+(+x).toFixed(1);
const anyMove=()=>['mxAdv','mxImp','mxPitch','mdAdv','mdRot','chAdv','chVert'].some(k=>Math.abs(plan[k])>1e-6)||(plan.autorot&&Math.abs(plan.mxImp)>1e-6);

// ═══ Сегментация ТРГ: линии остеотомий по ориентирам ═══
function osteotomy(){
  if(!img)return[];const {H,V}=axes();const s=scale||1;const down=V,up=mul(V,-1);const out=[];
  // Le Fort I — параллельно нёбной плоскости (ANS–PNS), приподнята к апексам
  if(LM.ANS&&LM.PNS){const a=add(LM.ANS,mul(up,3*s)),b=add(LM.PNS,mul(up,3*s));out.push({a,b,col:'#5b6cff',label:'Le Fort I'});}
  // BSSO — косая линия в области ветви (Ar→Go)
  if(LM.Ar&&LM.Go){const a=add(LM.Ar,mul(H,2*s)),b=add(LM.Go,mul(H,7*s));out.push({a,b,col:'#18c3b6',label:'BSSO'});}
  // Гениопластика — ниже апексов нижних резцов, параллельно нижнему краю
  if(LM.Me&&(LM.B||LM.Pog)){const dir=LM.Go?norm(sub(LM.Me,LM.Go)):norm(sub(LM.Me,LM.Pog||LM.B));
    const base=LM.L1a?add(LM.L1a,mul(down,7*s)):mul(add(LM.B||LM.Me,LM.Me),0.5);
    const a=add(base,mul(dir,-15*s)),b=add(base,mul(dir,17*s));out.push({a,b,col:'#a05bff',label:'Гениопластика'});}
  return out;
}

// ═══ Триангуляция Делоне (Bowyer–Watson) ═══
function delaunay(P){
  const n=P.length;if(n<3)return[];
  let mnx=1/0,mny=1/0,mxx=-1/0,mxy=-1/0;for(const p of P){mnx=Math.min(mnx,p.x);mny=Math.min(mny,p.y);mxx=Math.max(mxx,p.x);mxy=Math.max(mxy,p.y);}
  const dmax=Math.max(mxx-mnx,mxy-mny)||1,cx=(mnx+mxx)/2,cy=(mny+mxy)/2;
  const pts=P.concat([{x:cx-20*dmax,y:cy-dmax},{x:cx,y:cy+20*dmax},{x:cx+20*dmax,y:cy-dmax}]);
  const inCirc=(a,b,c,p)=>{const d=2*(a.x*(b.y-c.y)+b.x*(c.y-a.y)+c.x*(a.y-b.y));if(Math.abs(d)<1e-9)return false;
    const a2=a.x*a.x+a.y*a.y,b2=b.x*b.x+b.y*b.y,c2=c.x*c.x+c.y*c.y;
    const ux=(a2*(b.y-c.y)+b2*(c.y-a.y)+c2*(a.y-b.y))/d,uy=(a2*(c.x-b.x)+b2*(a.x-c.x)+c2*(b.x-a.x))/d;
    return (p.x-ux)**2+(p.y-uy)**2<=(a.x-ux)**2+(a.y-uy)**2+1e-6;};
  let tris=[[n,n+1,n+2]];
  for(let i=0;i<n;i++){const p=pts[i],bad=[],edges=[];
    tris=tris.filter(t=>{if(inCirc(pts[t[0]],pts[t[1]],pts[t[2]],p)){bad.push(t);return false;}return true;});
    for(const t of bad){const es=[[t[0],t[1]],[t[1],t[2]],[t[2],t[0]]];
      for(const e of es){const d=edges.findIndex(f=>(f[0]===e[0]&&f[1]===e[1])||(f[0]===e[1]&&f[1]===e[0]));if(d>=0)edges.splice(d,1);else edges.push(e);}}
    for(const e of edges)tris.push([e[0],e[1],i]);}
  return tris.filter(t=>t[0]<n&&t[1]<n&&t[2]<n);
}
// аффинное отображение src-треугольника → dst-треугольник
function affTri(g,src,a0,a1,a2,b0,b1,b2){
  g.save();g.beginPath();g.moveTo(b0.x,b0.y);g.lineTo(b1.x,b1.y);g.lineTo(b2.x,b2.y);g.closePath();g.clip();
  const den=(a1.x-a0.x)*(a2.y-a0.y)-(a2.x-a0.x)*(a1.y-a0.y)||1e-6;
  const m11=((b1.x-b0.x)*(a2.y-a0.y)-(b2.x-b0.x)*(a1.y-a0.y))/den,
        m12=((b2.x-b0.x)*(a1.x-a0.x)-(b1.x-b0.x)*(a2.x-a0.x))/den,
        m21=((b1.y-b0.y)*(a2.y-a0.y)-(b2.y-b0.y)*(a1.y-a0.y))/den,
        m22=((b2.y-b0.y)*(a1.x-a0.x)-(b1.y-b0.y)*(a2.x-a0.x))/den;
  g.setTransform(m11,m21,m12,m22,b0.x-m11*a0.x-m12*a0.y,b0.y-m21*a0.x-m22*a0.y);
  g.drawImage(src,0,0);g.restore();
}
// Кусочно-аффинная деформация ТРГ: ориентиры (до)→(после), каркас по рамке закреплён
let warpCv=null,warpDirty=true;
const invalidateWarp=()=>{warpDirty=true;};
function buildWarp(){
  if(!img)return null;const W=img.width,H=img.height,P=planned();const B=[],A=[];
  for(const id in LM){if(!P[id])continue;B.push({x:LM[id].x,y:LM[id].y});A.push({x:P[id].x,y:P[id].y});}
  [[0,0],[W/2,0],[W,0],[W,H/2],[W,H],[W/2,H],[0,H],[0,H/2]].forEach(([x,y])=>{B.push({x,y});A.push({x,y});});
  if(B.length<3)return null;
  const tris=delaunay(B),out=document.createElement('canvas');out.width=W;out.height=H;
  const g=out.getContext('2d');g.drawImage(img,0,0);
  for(const[i,j,k]of tris)affTri(g,img,B[i],B[j],B[k],A[i],A[j],A[k]);
  return out;
}

// ═══ Хирургический шаблон (окклюзионный сплинт) — параметрическая 3D-модель ═══
let wafer={type:'final',archW:52,archD:40,height:11,band:11,teeth:12,ct:true,src:'param',ctDiag:null};
let waferMesh=null,waferYaw=0.6,waferPitch=0.5,waferRAF=null;
// Относительное положение зубных дуг, которое фиксирует шаблон (мм):
//  • ФИНАЛЬНЫЙ — обе челюсти в итоговом положении: AP = mdAdv−mxAdv, вертикаль ~0;
//  • ПРОМЕЖУТОЧНЫЙ — в/ч перемещена, н/ч ИСХОДНАЯ (BSSO ещё не выполнен):
//    AP = −mxAdv (только выдвижение в/ч), вертикаль = импакция в/ч (меняет зазор
//    против неподвижной н/ч — шаблон получается клиновидным/толще).
function waferStepAP(){ return wafer.type==='final' ? (plan.mdAdv-plan.mxAdv) : (-plan.mxAdv); }
function waferVert(){ return wafer.type==='inter' ? plan.mxImp : 0; } // + импакция → зазор больше
// сетка (N+1)×(M+1) верх/низ → замкнутый солид (верх, низ, стенки, торцы)
function gridToSolid(VT,VB){
  const N=VT.length-1,M=VT[0].length-1,T=[];
  const q=(p0,p1,p2,p3)=>{T.push([p0,p1,p2]);T.push([p0,p2,p3]);};
  for(let i=0;i<N;i++)for(let j=0;j<M;j++){
    q(VT[i][j],VT[i][j+1],VT[i+1][j+1],VT[i+1][j]);
    q(VB[i][j],VB[i+1][j],VB[i+1][j+1],VB[i][j+1]);}
  for(let i=0;i<N;i++){q(VT[i][0],VT[i+1][0],VB[i+1][0],VB[i][0]);q(VT[i][M],VB[i][M],VB[i+1][M],VT[i+1][M]);}
  for(let j=0;j<M;j++){q(VT[0][j],VB[0][j],VB[0][j+1],VT[0][j+1]);q(VT[N][j],VT[N][j+1],VB[N][j+1],VB[N][j]);}
  return T;
}
// функциональный сплинт: центральные ложа под зубы + буккальные/язычные
// ретенционные стенки (надевается на зубы и удерживается).
const WAFER={bandW:15, trough:0.30, wallH:4.5, sockT:2.8, sockB:2.8, sig:2.8, minTh:2.5};
const wallProfile=(o,W)=>{const Wc=W*WAFER.trough,t=Math.max(0,Math.min(1,(Math.abs(o)-Wc)/(W/2-Wc||1)));return WAFER.wallH*t*t*(3-2*t);};
// параметрический сплинт (обобщённая дуга — запасной режим / нет КТ-дентиции)
function buildWaferParam(){
  const aw=wafer.archW/2,ad=wafer.archD,half=wafer.height/2,W=WAFER.bandW,vert=waferVert();
  const N=84,M=14,nt=Math.max(6,wafer.teeth|0);
  const stepU=Math.max(-0.5,Math.min(0.5,waferStepAP()/(ad||1)));
  const sock=o=>Math.exp(-(o*o)/(2*WAFER.sig*WAFER.sig));           // форма центрального ложа
  const scal=u=>0.5+0.5*Math.cos(nt*Math.PI*u);                     // ложе на каждый зуб (1 — бугор)
  const C=u=>({x:aw*u,y:ad*u*u}),Nrm=u=>{const nx=2*ad*u,ny=-aw,l=Math.hypot(nx,ny)||1;let r={x:nx/l,y:ny/l};if(r.y<0)r={x:-r.x,y:-r.y};return r;};
  const VT=[],VB=[];
  for(let i=0;i<=N;i++){const u=-1+2*i/N,c=C(u),nr=Nrm(u);VT.push([]);VB.push([]);
    for(let j=0;j<=M;j++){const o=(j/M-0.5)*W,Fx=c.x+o*nr.x,Fy=c.y+o*nr.y,w=wallProfile(o,W);
      const occT=half-WAFER.sockT*sock(o)*scal(u)+vert, occB=-half+WAFER.sockB*sock(o)*scal(u-stepU);
      VT[i].push({x:Fx,y:Fy,z:occT+w});VB[i].push({x:Fx,y:Fy,z:occB-w});}}
  return gridToSolid(VT,VB);
}
// МНК-парабола Y=aX²+bX+c
function fitParabola(X,Y){const n=X.length;let S1=0,S2=0,S3=0,S4=0,T0=0,T1=0,T2=0;
  for(let i=0;i<n;i++){const x=X[i],y=Y[i],x2=x*x;S1+=x;S2+=x2;S3+=x2*x;S4+=x2*x2;T0+=y;T1+=x*y;T2+=x2*y;}
  const m=[[S4,S3,S2],[S3,S2,S1],[S2,S1,n]],v=[T2,T1,T0];
  const det=m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
  if(Math.abs(det)<1e-6)return null;
  const col=(M,k)=>M.map((r,i)=>r.map((e,j)=>j===k?v[i]:e));
  const d=M=>M[0][0]*(M[1][1]*M[2][2]-M[1][2]*M[2][1])-M[0][1]*(M[1][0]*M[2][2]-M[1][2]*M[2][0])+M[0][2]*(M[1][0]*M[2][1]-M[1][1]*M[2][0]);
  return{a:d(col(m,0))/det,b:d(col(m,1))/det,c:d(col(m,2))/det};
}
// заполнить пустые узлы heightmap соседями и сгладить
function fillSmooth(G,fb){const N=G.length-1,M=G[0].length-1;
  for(let i=0;i<=N;i++)for(let j=0;j<=M;j++)if(G[i][j].z==null){let s=0,c=0;
    for(let di=-2;di<=2;di++)for(let dj=-2;dj<=2;dj++){const a=i+di,b=j+dj;if(a>=0&&a<=N&&b>=0&&b<=M&&G[a][b].z!=null){s+=G[a][b].z;c++;}}
    G[i][j].z=c?s/c:fb;}
  const Z=G.map(r=>r.map(p=>p.z));
  for(let i=0;i<=N;i++)for(let j=0;j<=M;j++){let s=0,c=0;
    for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){const a=i+di,b=j+dj;if(a>=0&&a<=N&&b>=0&&b<=M){s+=Z[a][b];c++;}}
    G[i][j].z=s/c;}
}
// КТ-адаптивный сплинт: окклюзионные поверхности сегментируются по плотности (эмаль/кость)
function buildWaferCT(){
  if(!vol){wafer.ctDiag={ok:false,reason:'нет объёма КТ'};return null;}
  const [nx,ny,nz]=vol.dims,[sx,sy,sz]=vol.spacing,D=vol.data;
  // 1) эмаль/плотная ткань — адаптивный порог
  let T=1500,PX,PY,PZ;
  for(const tt of[1500,1200,900]){PX=[];PY=[];PZ=[];for(let z=0;z<nz;z++)for(let y=0;y<ny;y++){const b=z*nx*ny+y*nx;
      for(let x=0;x<nx;x++)if(D[b+x]>tt){PX.push(x*sx);PY.push(y*sy);PZ.push(z*sz);}}T=tt;if(PX.length>=500)break;}
  let n=PX.length;
  if(n<500){wafer.ctDiag={ok:false,reason:'дентиция не распознаётся (мало плотных вокселей)',enamel:n};return null;}
  // 2) дентальная полоса по z (гистограмма), исключаем основание черепа
  let zmin=1e9,zmax=-1e9;for(let i=0;i<n;i++){if(PZ[i]<zmin)zmin=PZ[i];if(PZ[i]>zmax)zmax=PZ[i];}
  const nb=24,hb=new Array(nb).fill(0),bw0=(zmax-zmin)/nb||1;
  for(let i=0;i<n;i++)hb[Math.min(nb-1,Math.floor((PZ[i]-zmin)/bw0))]++;
  let pk=0;for(let i=1;i<nb;i++)if(hb[i]>hb[pk])pk=i;
  const zc=zmin+(pk+0.5)*bw0, half=14; // ±14 мм вокруг дентального пика
  const keep=i=>Math.abs(PZ[i]-zc)<=half;
  const KX=[],KY=[],KZ=[];for(let i=0;i<n;i++)if(keep(i)){KX.push(PX[i]);KY.push(PY[i]);KZ.push(PZ[i]);}
  n=KX.length;if(n<400){wafer.ctDiag={ok:false,reason:'узкая дентальная зона в КТ',enamel:n};return null;}
  // 3) окклюзионная плоскость = медиана z в полосе
  const zs=[...KZ].sort((a,b)=>a-b),z0=zs[zs.length>>1];
  // 4) дуга Y=aX²+bX+c по воксельам у окклюзии
  let AX=[],AY=[];for(let i=0;i<n;i++)if(Math.abs(KZ[i]-z0)<9){AX.push(KX[i]);AY.push(KY[i]);}
  if(AX.length<120){AX=KX;AY=KY;}
  const fit=fitParabola(AX,AY);if(!fit){wafer.ctDiag={ok:false,reason:'дуга не аппроксимируется'};return null;}
  const {a,b,c}=fit;let xmin=1e9,xmax=-1e9;for(let i=0;i<AX.length;i++){if(AX[i]<xmin)xmin=AX[i];if(AX[i]>xmax)xmax=AX[i];}const span=xmax-xmin;
  // физиологичность дентальной дуги (иначе КТ грубая/захватывает кость — честный откат)
  if(span<40||span>74){wafer.ctDiag={ok:false,reason:'ширина дуги вне нормы ('+span.toFixed(0)+' мм) — КТ грубая/захватывает кость',span:+span.toFixed(0)};return null;}
  const vtx=-b/(2*a||1e-6);let ymin=1e9,ymax=-1e9;for(let x=xmin;x<=xmax;x+=1){const yy=a*x*x+b*x+c;if(yy<ymin)ymin=yy;if(yy>ymax)ymax=yy;}
  const depth=ymax-ymin;
  if(depth<7||depth>42||vtx<xmin-6||vtx>xmax+6){wafer.ctDiag={ok:false,reason:'форма не похожа на зубную дугу (глубина '+depth.toFixed(0)+' мм) — нужен дентальный CBCT',span:+span.toFixed(0),depth:+depth.toFixed(0)};return null;}
  xmin+=span*0.05;xmax-=span*0.05;
  const N=60,M=16,fy=x=>a*x*x+b*x+c,dfy=x=>2*a*x+b,antY=a>0?-1:1,stepAP=waferStepAP(),vertG=waferVert(),WALLT=1.8;
  const rad=Math.max(sx,sy)*1.7,r2=rad*rad,cs=Math.max(rad,1.2);
  const frame=si=>{const x=xmin+(xmax-xmin)*si/N,cy=fy(x),dd=dfy(x),nl=Math.hypot(-dd,1)||1;return{x,cy,ndx:-dd/nl,ndy:1/nl};};
  // пространственный индекс (ячейки ~rad) для быстрой выборки окклюзии
  let gx0=1e9,gy0=1e9;for(let i=0;i<n;i++){if(KX[i]<gx0)gx0=KX[i];if(KY[i]<gy0)gy0=KY[i];}
  const buckets=new Map(),bkey=(cx,cy)=>cx*100003+cy;
  for(let i=0;i<n;i++){const k=bkey(Math.floor((KX[i]-gx0)/cs),Math.floor((KY[i]-gy0)/cs));let arr=buckets.get(k);if(!arr){arr=[];buckets.set(k,arr);}arr.push(i);}
  const sampleZ=(fx,fyy,upper)=>{let best=upper?1e9:-1e9,hit=false;const cx=Math.floor((fx-gx0)/cs),cy=Math.floor((fyy-gy0)/cs);
    for(let ax=cx-1;ax<=cx+1;ax++)for(let ay=cy-1;ay<=cy+1;ay++){const arr=buckets.get(bkey(ax,ay));if(!arr)continue;
      for(const i of arr){if(upper?(KZ[i]<z0):(KZ[i]>=z0))continue;const dx=KX[i]-fx,dy=KY[i]-fyy;
        if(dx*dx+dy*dy<=r2){hit=true;if(upper){if(KZ[i]<best)best=KZ[i];}else if(KZ[i]>best)best=KZ[i];}}}
    return hit?best:null;};
  // ═══ сегментация боковых поверхностей коронок: привязка вокселей к станциям (o,z) ═══
  const SU=Array.from({length:N+1},()=>[]),SL=Array.from({length:N+1},()=>[]);
  for(let i=0;i<n;i++){const si=Math.max(0,Math.min(N,Math.round((KX[i]-xmin)/((xmax-xmin)||1)*N))),f=frame(si);
    const o=(KX[i]-f.x)*f.ndx+(KY[i]-f.cy)*f.ndy;if(Math.abs(o)>12)continue;(KZ[i]>=z0?SU:SL)[si].push({o,z:KZ[i]});}
  const segm=st=>{if(st.length<4)return null;let ol=1e9,ob=-1e9,zl=1e9,zh=-1e9;for(const p of st){if(p.o<ol)ol=p.o;if(p.o>ob)ob=p.o;if(p.z<zl)zl=p.z;if(p.z>zh)zh=p.z;}return{ol,ob,zl,zh};};
  // per-station: центр коронки (CO), полуширина (HW), высоты стенок в/ч (WU) и н/ч (WL) из высоты коронок
  const CO=new Array(N+1).fill(null),HW=new Array(N+1).fill(null),WU=new Array(N+1).fill(null),WL=new Array(N+1).fill(null);
  for(let i=0;i<=N;i++){const su=segm(SU[i]),sl=segm(SL[i]);let cen=null,hw=0,wu=null,wl=null;
    if(su){cen=(su.ol+su.ob)/2;hw=Math.max(hw,(su.ob-su.ol)/2);wu=Math.max(2,Math.min(5.5,0.55*(su.zh-su.zl)));}
    if(sl){const c2=(sl.ol+sl.ob)/2;cen=cen==null?c2:(cen+c2)/2;hw=Math.max(hw,(sl.ob-sl.ol)/2);wl=Math.max(2,Math.min(5.5,0.55*(sl.zh-sl.zl)));}
    CO[i]=cen;HW[i]=hw||null;WU[i]=wu;WL[i]=wl;}
  const fillA=(A,def)=>{for(let i=0;i<=N;i++)if(A[i]==null){let bi=-1,bd=1e9;for(let j=0;j<=N;j++)if(A[j]!=null&&Math.abs(j-i)<bd){bd=Math.abs(j-i);bi=j;}A[i]=bi>=0?A[bi]:def;}
    const B=A.slice();for(let i=0;i<=N;i++){let s=0,c2=0;for(let d=-2;d<=2;d++){const a2=i+d;if(a2>=0&&a2<=N){s+=B[a2];c2++;}}A[i]=s/c2;}};
  fillA(CO,0);fillA(HW,4.2);fillA(WU,3.5);fillA(WL,3.5);
  for(let i=0;i<=N;i++)HW[i]=Math.max(3,Math.min(8,HW[i]));
  // окклюзионные поверхности (OT/OB): band переменной ширины, центр = коронка
  const OT=[],OB=[];let nUpC=0,nLoC=0,ncC=0;
  for(let i=0;i<=N;i++){const f=frame(i),bandHalf=HW[i]+WALLT;OT.push([]);OB.push([]);
    for(let j=0;j<=M;j++){const o=CO[i]+(j/M-0.5)*2*bandHalf,fx=f.x+o*f.ndx,fyy=f.cy+o*f.ndy;
      const tz=sampleZ(fx,fyy,true),bz=sampleZ(fx,fyy+antY*stepAP,false);
      if(Math.abs(o-CO[i])<HW[i]*0.8){ncC++;if(tz!=null)nUpC++;if(bz!=null)nLoC++;}
      OT[i].push({x:fx,y:fyy,z:tz});OB[i].push({x:fx,y:fyy,z:bz});}}
  const cov=Math.min(nUpC,nLoC)/Math.max(1,ncC);
  if(cov<0.5){wafer.ctDiag={ok:false,reason:'не распознаны обе зубные дуги (покрытие '+(cov*100|0)+'%) — вероятно КТ грубая/обрезана',enamel:n,span:+span.toFixed(0)};return null;}
  fillSmooth(OT,z0+1.5);fillSmooth(OB,z0-1.5);
  // солид: ложа под зубы (окклюзия) + ретенционные стенки по сегментированным боковым поверхностям коронок
  const VT=[],VB=[];
  for(let i=0;i<=N;i++){const bandHalf=HW[i]+WALLT;VT.push([]);VB.push([]);
    for(let j=0;j<=M;j++){const o=(j/M-0.5)*2*bandHalf,t=Math.max(0,Math.min(1,(Math.abs(o)-HW[i])/(WALLT||1))),e=t*t*(3-2*t);
      let zt=OT[i][j].z+vertG,zb=OB[i][j].z;
      if(zt<zb+WAFER.minTh){const m=(zt+zb)/2;zt=m+WAFER.minTh/2;zb=m-WAFER.minTh/2;}
      VT[i].push({x:OT[i][j].x,y:OT[i][j].y,z:zt+WU[i]*e});VB[i].push({x:OB[i][j].x,y:OB[i][j].y,z:zb-WL[i]*e});}}
  const meanW=((WU.reduce((p,q)=>p+q,0)+WL.reduce((p,q)=>p+q,0))/(2*(N+1)));
  wafer.ctDiag={ok:true,enamel:n,span:+span.toFixed(0),coverage:+(cov*100).toFixed(0),threshold:T,z0:+z0.toFixed(0),wall:+meanW.toFixed(1),mode:'сегм. коронок'};
  return gridToSolid(VT,VB);
}
function buildWaferMesh(){let m=null;if(wafer.ct!==false&&vol)m=buildWaferCT();wafer.src=m?'ct':'param';return m||buildWaferParam();}
function waferSTL(T){
  const n=T.length,buf=new ArrayBuffer(84+n*50),dv=new DataView(buf);dv.setUint32(80,n,true);let o=84;
  for(const[a,b,c]of T){const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;
    let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const L=Math.hypot(nx,ny,nz)||1;
    dv.setFloat32(o,nx/L,true);dv.setFloat32(o+4,ny/L,true);dv.setFloat32(o+8,nz/L,true);o+=12;
    for(const p of[a,b,c]){dv.setFloat32(o,p.x,true);dv.setFloat32(o+4,p.y,true);dv.setFloat32(o+8,p.z,true);o+=12;}
    dv.setUint16(o,0,true);o+=2;}
  return buf;
}
function drawWafer3D(T,yaw,pitch){
  fit();ctx.clearRect(0,0,cv.width,cv.height);
  // фон
  const g=ctx.createLinearGradient(0,0,0,cv.height);g.addColorStop(0,'#f7f8ff');g.addColorStop(1,'#eef0fb');ctx.fillStyle=g;ctx.fillRect(0,0,cv.width,cv.height);
  if(!T||!T.length)return;
  const cY=Math.cos(yaw),sY=Math.sin(yaw),cP=Math.cos(pitch),sP=Math.sin(pitch);
  const R=v=>{const x1=v.x*cY-v.y*sY,y1=v.x*sY+v.y*cY,z1=v.z;const y2=y1*cP-z1*sP,z2=y1*sP+z1*cP;return{x:x1,y:y2,z:z2};};
  let mnx=1/0,mxx=-1/0,mnz=1/0,mxz=-1/0;const RT=[];
  for(const t of T){const r=[R(t[0]),R(t[1]),R(t[2])];RT.push(r);for(const p of r){mnx=Math.min(mnx,p.x);mxx=Math.max(mxx,p.x);mnz=Math.min(mnz,p.z);mxz=Math.max(mxz,p.z);}}
  const sc=Math.min(cv.width/(mxx-mnx||1),cv.height/(mxz-mnz||1))*0.72;
  const ox=cv.width/2-(mnx+mxx)/2*sc,oz=cv.height/2+(mnz+mxz)/2*sc;
  const idx=RT.map((r,i)=>[i,(r[0].y+r[1].y+r[2].y)/3]).sort((a,b)=>a[1]-b[1]);
  const Lt={x:-0.35,y:-0.5,z:0.79};
  for(const[i]of idx){const r=RT[i];
    let nx=(r[1].x-r[0].x)*(r[2].z-r[0].z)-(r[1].z-r[0].z)*(r[2].x-r[0].x);
    let ny=(r[1].z-r[0].z)*(r[2].y-r[0].y)-(r[1].y-r[0].y)*(r[2].z-r[0].z);
    let nz=(r[1].x-r[0].x)*(r[2].y-r[0].y)-(r[1].y-r[0].y)*(r[2].x-r[0].x);
    const l=Math.hypot(nx,ny,nz)||1;const dif=Math.abs((nx*Lt.x+ny*Lt.y+nz*Lt.z)/l);
    const sh=Math.round(150+95*dif),g2=Math.round(140+100*dif);
    ctx.fillStyle=`rgb(${Math.round(120+90*dif)},${g2},${Math.min(255,sh+20)})`;
    ctx.beginPath();ctx.moveTo(ox+r[0].x*sc,oz-r[0].z*sc);ctx.lineTo(ox+r[1].x*sc,oz-r[1].z*sc);ctx.lineTo(ox+r[2].x*sc,oz-r[2].z*sc);ctx.closePath();ctx.fill();}
}
function waferAnim(){if(step!=='wafer'){waferRAF=null;return;}waferYaw+=0.011;if(waferMesh)drawWafer3D(waferMesh,waferYaw,waferPitch);waferRAF=requestAnimationFrame(waferAnim);}
function exportSTL(){const buf=waferSTL(waferMesh||buildWaferMesh());const a=document.createElement('a');
  a.download='ОРТОС_сплинт_'+(patient.name||'пациент')+'.stl';a.href=URL.createObjectURL(new Blob([buf],{type:'model/stl'}));a.click();}

// ── DICOM → ТРГ ──
function parseDcm(buf){
  const dv=new DataView(buf),N=buf.byteLength;let o=0;
  if(N>132){let s='';for(let i=128;i<132;i++)s+=String.fromCharCode(dv.getUint8(i));if(s==='DICM')o=132;}
  let implicit=false;const T={};
  const rs=(off,len)=>{let s='';for(let i=0;i<len;i++)s+=String.fromCharCode(dv.getUint8(off+i));return s.replace(/\0+$/,'').trim();};
  while(o+8<=N){
    const g=dv.getUint16(o,true),e=dv.getUint16(o+2,true);o+=4;const explicit=(g===0x0002)?true:!implicit;let vr=null,len;
    if(explicit){vr=String.fromCharCode(dv.getUint8(o),dv.getUint8(o+1));o+=2;if(['OB','OW','OF','SQ','UT','UN','UC','UR'].includes(vr)){o+=2;len=dv.getUint32(o,true);o+=4;}else{len=dv.getUint16(o,true);o+=2;}}
    else{len=dv.getUint32(o,true);o+=4;}
    if(len===0xFFFFFFFF){while(o+8<=N){const dg=dv.getUint16(o,true),de=dv.getUint16(o+2,true),dl=dv.getUint32(o+4,true);o+=8;if(dg===0xFFFE&&de===0xE0DD)break;if(dg===0xFFFE&&de===0xE000&&dl!==0xFFFFFFFF)o+=dl;}continue;}
    const off=o;o+=len;const tag=((g<<16)|e)>>>0;
    if(g===0x0002&&e===0x0010){const ts=rs(off,len);implicit=(ts==='1.2.840.10008.1.2');}
    else if(tag===0x00280010)T.rows=dv.getUint16(off,true);else if(tag===0x00280011)T.cols=dv.getUint16(off,true);
    else if(tag===0x00280030)T.ps=rs(off,len).split('\\').map(Number);else if(tag===0x00180050)T.thick=parseFloat(rs(off,len))||0;
    else if(tag===0x00200032)T.ipp=rs(off,len).split('\\').map(Number);else if(tag===0x00281053)T.slope=parseFloat(rs(off,len))||1;
    else if(tag===0x00281052)T.intercept=parseFloat(rs(off,len))||0;else if(tag===0x00280100)T.bits=dv.getUint16(off,true);
    else if(tag===0x00280103)T.rep=dv.getUint16(off,true);else if(tag===0x00200013)T.inst=parseInt(rs(off,len))||0;
    else if(tag===0x7FE00010){T.pixOff=off;T.pixLen=len;break;}
  }
  if(!T.rows||!T.cols||T.pixOff==null)return null;
  const n=T.rows*T.cols,bits=T.bits||16,rep=T.rep||0,px=new Int16Array(n);
  if(bits<=8){for(let i=0;i<n;i++)px[i]=dv.getUint8(T.pixOff+i);}
  else if(rep===1){for(let i=0;i<n;i++)px[i]=dv.getInt16(T.pixOff+i*2,true);}
  else{for(let i=0;i<n;i++)px[i]=dv.getUint16(T.pixOff+i*2,true);}
  return{rows:T.rows,cols:T.cols,ps:T.ps||[1,1],thick:T.thick||1,ipp:T.ipp||[0,0,T.inst||0],slope:T.slope||1,intercept:T.intercept||0,inst:T.inst||0,px};
}
function assembleVolume(sl){
  sl=sl.filter(Boolean);if(sl.length<3)return null;sl.sort((a,b)=>(a.ipp[2]-b.ipp[2])||(a.inst-b.inst));
  const r=sl[0].rows,c=sl[0].cols,nz=sl.length;let zsp=sl[0].thick||1;const dz=Math.abs(sl[nz-1].ipp[2]-sl[0].ipp[2])/(nz-1);if(dz>0.01)zsp=dz;
  const sx=sl[0].ps[1]||1,sy=sl[0].ps[0]||1,data=new Int16Array(c*r*nz);
  for(let z=0;z<nz;z++){const s=sl[z],b=z*c*r;for(let i=0;i<c*r;i++)data[b+i]=(s.px[i]*s.slope+s.intercept)|0;}
  return{dims:[c,r,nz],spacing:[sx,sy,zsp],data};
}
function buildLateralDRR(v){
  const [nx,ny,nz]=v.dims,[sx,sy,sz]=v.spacing,d=v.data,mpp=0.4;
  const W=Math.round(ny*sy/mpp),H=Math.round(nz*sz/mpp),cl=h=>h<-200?0:(h>1800?2000:h+200);
  const acc=new Float32Array(W*H);let mx=1;
  for(let vv=0;vv<H;vv++){const zmm=(H-1-vv)*mpp,zv=Math.min(nz-1,Math.max(0,Math.round(zmm/sz)));
    for(let u=0;u<W;u++){const ymm=u*mpp,yv=Math.min(ny-1,Math.max(0,Math.round(ymm/sy)));let a=0;const b=zv*nx*ny+yv*nx;for(let x=0;x<nx;x++)a+=cl(d[b+x]);acc[vv*W+u]=a;if(a>mx)mx=a;}}
  const off=document.createElement('canvas');off.width=W;off.height=H;const im=new ImageData(W,H),P=im.data,inv=1/mx;
  for(let i=0;i<acc.length;i++){let g=Math.pow(acc[i]*inv,0.6)*255;g=g>255?255:g;const o=i*4;P[o]=P[o+1]=P[o+2]=g;P[o+3]=255;}
  off.getContext('2d').putImageData(im,0,0);return{canvas:off,W,H,mpp};
}
function loadDicom(files){
  const arr=[...files].filter(f=>/\.dcm$/i.test(f.name)||!/\./.test(f.name));
  if(!arr.length){toast('В папке нет файлов DICOM (.dcm).');return;}
  building=true; render(); toast('Читаю '+arr.length+' срезов DICOM…');
  Promise.all(arr.map(f=>f.arrayBuffer().then(b=>{try{return parseDcm(b);}catch(e){return null;}}))).then(sl=>{
    vol=assembleVolume(sl); building=false;
    if(!vol){ alert('Не удалось собрать объём. Возможно, DICOM сжатый (JPEG/JPEG2000) — тогда выгрузите несжатую серию.'); render(); return; }
    const drr=buildLateralDRR(vol);const im=new Image();
    im.onload=()=>{ img=im; scale=1/drr.mpp; autoView(); setStep('points'); toast('ТРГ построена из МСКТ ('+vol.dims[2]+' срезов). Масштаб '+scale.toFixed(2)+' px/мм.'); };
    im.src=drr.canvas.toDataURL('image/png');
  });
}

// ── вид / отрисовка ──
function fit(){const r=cv.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);cv.width=Math.max(2,r.width*dpr);cv.height=Math.max(2,r.height*dpr);}
function autoView(){if(!img)return;const r=cv.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
  const z=Math.min(r.width*dpr/img.width,r.height*dpr/img.height)*0.9;view.zoom=z;view.ox=(r.width*dpr-img.width*z)/2;view.oy=(r.height*dpr-img.height*z)/2;}
const toS=p=>({x:view.ox+p.x*view.zoom,y:view.oy+p.y*view.zoom});
const toI=(x,y)=>({x:(x-view.ox)/view.zoom,y:(y-view.oy)/view.zoom});
function render(){
  if(step==='wafer'){ fit(); if(!waferMesh)waferMesh=buildWaferMesh(); drawWafer3D(waferMesh,waferYaw,waferPitch);
    $('empty').style.display='none'; updateBadge(); if(!waferRAF)waferRAF=requestAnimationFrame(waferAnim); return; }
  fit();ctx.clearRect(0,0,cv.width,cv.height);
  const showPhoto=(step==='photo'&&photo);
  const pic=showPhoto?photo:img;
  const planWarp=(step==='plan'&&img&&anyMove());
  if(pic){ctx.imageSmoothingEnabled=true;
    if(showPhoto){const r=cv.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);const z=Math.min(r.width*dpr/photo.width,r.height*dpr/photo.height)*0.92;
      ctx.drawImage(photo,(cv.width-photo.width*z)/2,(cv.height-photo.height*z)/2,photo.width*z,photo.height*z);}
    else if(planWarp){ if(warpDirty||!warpCv){warpCv=buildWarp();warpDirty=false;}
      ctx.globalAlpha=overlay;ctx.drawImage(img,view.ox,view.oy,img.width*view.zoom,img.height*view.zoom);ctx.globalAlpha=1; // «до» — ghost
      if(warpCv)ctx.drawImage(warpCv,view.ox,view.oy,img.width*view.zoom,img.height*view.zoom); } // «после» — деформация
    else ctx.drawImage(img,view.ox,view.oy,img.width*view.zoom,img.height*view.zoom);}
  $('empty').style.display=(img||photo||building)?'none':'';
  $('shimmerWrap')&&0;
  // шиммер при построении
  let sh=document.querySelector('.shimmer'); if(building&&!sh){sh=document.createElement('div');sh.className='shimmer';$('stage').appendChild(sh);} if(!building&&sh)sh.remove();
  if(showPhoto||!img) { updateBadge(); return; }
  const P=(step==='plan')?planned():null;
  const dLines=(src,wid,dash,alpha)=>{ctx.save();ctx.globalAlpha=alpha==null?1:alpha;ctx.lineWidth=wid;ctx.setLineDash(dash||[]);
    LINES.forEach(([a,b,c])=>{if(src[a]&&src[b]){ctx.strokeStyle=c;const A=toS(src[a]),B=toS(src[b]);ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke();}});ctx.restore();};
  const dProf=(src,col,wid,dash,alpha)=>{ctx.save();ctx.globalAlpha=alpha==null?1:alpha;ctx.strokeStyle=col;ctx.lineWidth=wid;ctx.setLineDash(dash||[]);ctx.beginPath();let st=false;
    PROFILE.forEach(k=>{if(src[k]){const S=toS(src[k]);if(!st){ctx.moveTo(S.x,S.y);st=true;}else ctx.lineTo(S.x,S.y);}});ctx.stroke();ctx.restore();};
  if(step==='plan'){
    // линии остеотомий (сегментация ТРГ)
    const seg=osteotomy();ctx.save();ctx.lineWidth=2;ctx.setLineDash([7,5]);ctx.font='700 11px Inter,sans-serif';
    seg.forEach(sg=>{const A=toS(sg.a),B=toS(sg.b);ctx.strokeStyle=sg.col;ctx.globalAlpha=0.9;
      ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke();
      ctx.setLineDash([]);ctx.globalAlpha=1;ctx.fillStyle=sg.col;const mx=(A.x+B.x)/2,my=(A.y+B.y)/2;
      ctx.fillText(sg.label,mx+6,my-5);ctx.setLineDash([7,5]);});
    ctx.restore();
    dLines(LM,1.5,[],0.4); dProf(LM,'#9aa3c2',2,[5,4],0.6);
    if(P){dLines(P,1.8,[]); dProf(P,'#18c3b6',2.8);}
  } else if(step==='analysis'){ dLines(LM,1.8,[]); dProf(LM,'#8a94b8',1.8,[4,4]); }
  else if(step==='points'){ dLines(LM,1.4,[],0.8); }
  // точки
  const label=(step==='points');
  const dpr=Math.min(devicePixelRatio||1,2);
  LM_DEF.forEach(l=>{const k=l.id;if(!LM[k])return;const S=toS(LM[k]);const cur=(k===pickId&&step==='points');
    ctx.beginPath();ctx.arc(S.x,S.y,cur?6:4,0,7);ctx.fillStyle=cur?'#ffb020':(SOFTSET.has(k)?'#8a63ff':'#5b6cff');ctx.fill();
    ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();
    if(label){ctx.fillStyle='#1a2140';ctx.font='600 '+(12*dpr/ (devicePixelRatio||1))+'px Inter,sans-serif';ctx.fillText(l.abbr,S.x+7,S.y-6);}});
  updateBadge();
}
function updateBadge(){
  const b=$('badge');let h='';
  if(img&&step!=='photo'){ h+=`<span class="chip">ТРГ · <b>${scale?scale.toFixed(2)+' px/мм':'без калибровки'}</b></span>`;
    const n=HARD.filter(k=>LM[k]).length; h+=`<span class="chip">Точки: <b>${Object.keys(LM).length}/${LM_DEF.length}</b></span>`; }
  if(step==='photo'&&photo) h+=`<span class="chip">Фото пациента</span>`;
  b.innerHTML=h;
}

// ── панели по шагам ──
function renderPanel(){
  const p=$('panel');
  if(step==='patient'){
    p.innerHTML=`<div class="card view">
      <h3>👤 Пациент</h3><div class="desc">Заполните данные — они попадут в план и отчёт. Затем загрузите МСКТ.</div>
      <div class="field"><label>ФИО / № карты</label><input type="text" id="pName" value="${esc(patient.name)}"></div>
      <div class="two"><div class="field"><label>Пол</label><select id="pSex"><option value="M"${patient.sex==='M'?' selected':''}>мужской</option><option value="F"${patient.sex==='F'?' selected':''}>женский</option></select></div>
        <div class="field"><label>Дата рождения</label><input type="text" id="pDob" value="${esc(patient.dob)}" placeholder="дд.мм.гггг"></div></div>
      <button class="btn" id="goTrg" style="margin-top:4px">🧊 Загрузить МСКТ (DICOM) →</button>
      <div class="note">Поддержка несжатого DICOM. Из серии строится боковая ТРГ, масштаб берётся из DICOM автоматически.</div>
    </div>`;
    $('pName').onchange=e=>patient.name=e.target.value;$('pSex').onchange=e=>patient.sex=e.target.value;$('pDob').onchange=e=>patient.dob=e.target.value;
    $('goTrg').onclick=()=>$('dcmInput').click();
  }
  else if(step==='trg'){
    p.innerHTML=`<div class="card view"><h3>🧊 МСКТ → ТРГ</h3>
      <div class="desc">${img?'Боковая ТРГ построена. Перейдите к расстановке точек.':'Загрузите серию МСКТ (DICOM) — программа построит боковую ТРГ (проекцию) и возьмёт масштаб из DICOM.'}</div>
      <button class="btn" id="loadDcm2">🧊 Загрузить МСКТ (DICOM)</button>
      <div class="btn-row"><button class="btn ghost" id="loadFilm">📷 Готовая плёнка ТРГ</button></div>
      ${img?'<button class="btn" id="toPoints" style="margin-top:10px">→ К расстановке точек</button>':''}
      <div class="note">Сжатый DICOM (JPEG/JPEG2000) — выгрузите несжатую серию.</div></div>`;
    $('loadDcm2').onclick=()=>$('dcmInput').click();$('loadFilm').onclick=()=>$('imgInput').click();
    if($('toPoints'))$('toPoints').onclick=()=>setStep('points');
  }
  else if(step==='points'){
    if(!img){ p.innerHTML=emptyStepCard('Сначала постройте ТРГ','Загрузите МСКТ на шаге «МСКТ → ТРГ».'); return; }
    if(!pickId) pickId = ORDER.find(id=>!LM[id]) || ORDER[0];
    const l=LBL[pickId]; const idx=ORDER.indexOf(pickId)+1;
    const listHard=HARD.map(id=>lmRow(id)).join('');
    const listSoft=LM_DEF.filter(x=>x.kind==='soft').map(x=>lmRow(x.id)).join('');
    p.innerHTML=`<div class="hint-card view">
        <div class="hint-ill">${window.skullSVG(pickId)}</div>
        <div class="hint-body"><div class="pt">${l.abbr} <span class="ru">— ${l.ru}</span></div>
          <div class="txt">${l.hint}</div>
          <div class="nav"><button class="btn ghost sm" id="prevPt">← Назад</button><button class="btn sm" id="nextPt" style="width:auto">Пропустить →</button><span class="idx">${idx} / ${ORDER.length}</span></div>
        </div></div>
      <div class="card view"><div class="sect-label">Костные точки</div><div class="lm-list">${listHard}</div>
        <div class="sect-label" style="margin-top:14px">Мягкие ткани (профиль)</div><div class="lm-list">${listSoft}</div>
        <div class="btn-row"><button class="btn ghost sm" id="clrPts" style="width:100%">Очистить все</button></div>
        <div class="note">Выберите точку слева по подсказке и кликните на ТРГ. Поставленную можно перетащить.</div></div>`;
    $('prevPt').onclick=()=>{const i=ORDER.indexOf(pickId);pickId=ORDER[(i-1+ORDER.length)%ORDER.length];renderPanel();render();};
    $('nextPt').onclick=()=>advancePick();
    $('clrPts').onclick=()=>{if(confirm('Убрать все точки?')){LM={};pickId=ORDER[0];renderPanel();render();}};
    p.querySelectorAll('.lm').forEach(r=>r.onclick=()=>{pickId=r.dataset.k;renderPanel();render();});
  }
  else if(step==='photo'){
    p.innerHTML=`<div class="card view"><h3>📷 Фото пациента</h3>
      <div class="desc">${photo?'Фото загружено. Используется для документации и сопоставления профиля.':'Загрузите фотографию профиля пациента (в естественном положении головы).'}</div>
      <button class="btn" id="loadPhoto">📷 Загрузить фото</button>
      ${photo?'<button class="btn ghost" id="delPhoto" style="margin-top:9px">Удалить фото</button>':''}
      <div class="note">Фото сохраняется в проекте и попадает в план. Планирование перемещений ведётся на ТРГ.</div></div>`;
    $('loadPhoto').onclick=()=>$('photoInput').click();
    if($('delPhoto'))$('delPhoto').onclick=()=>{photo=null;renderPanel();render();};
  }
  else if(step==='analysis'){
    if(!img){ p.innerHTML=emptyStepCard('Нет данных','Постройте ТРГ и расставьте точки.'); return; }
    const rows=analyse(LM);
    p.innerHTML=`<div class="card view"><h3>📐 Цефалометрия</h3><div id="anBox" style="margin-top:6px">${rows.map(anRow).join('')}</div>
      <div class="note">Нормы ориентировочные (взрослые). Линейные (мм) требуют масштаба (есть, т.к. из МСКТ). Точность зависит от расстановки точек.</div></div>`;
  }
  else if(step==='plan'){
    if(!img){ p.innerHTML=emptyStepCard('Нет данных','Постройте ТРГ и расставьте точки.'); return; }
    p.innerHTML=`<div class="card view"><h3>🦷 Хирургическое перемещение</h3>
        <div class="grp2"><h4>Верхняя челюсть <span class="tag">Le Fort I</span></h4>
          ${sl('mxAdv','Выдвижение',-10,10,0.5,'мм')}${sl('mxImp','Импакция (+вверх)',-5,6,0.5,'мм')}${sl('mxPitch','Наклон (питч)',-8,8,0.5,'°')}</div>
        <div class="grp2"><h4>Нижняя челюсть <span class="tag">BSSO</span></h4>
          ${sl('mdAdv','Выдвижение',-12,12,0.5,'мм')}${sl('mdRot','Ротация',-10,10,0.5,'°')}
          <label class="chk"><input type="checkbox" id="autorot" ${plan.autorot?'checked':''}> Авторотация по импакции в/ч</label></div>
        <div class="grp2"><h4>Подбородок <span class="tag">гениопластика</span></h4>
          ${sl('chAdv','Выдвижение',-10,10,0.5,'мм')}${sl('chVert','Вертикаль (+вниз)',-8,8,0.5,'мм')}</div>
        <div class="slider-row"><label>Исходный профиль</label><input type="range" id="ov" min="0" max="1" step="0.05" value="${overlay}"><span class="val">прозр.</span></div>
        <button class="btn ghost" id="resetPlan">Сбросить перемещения</button></div>
      <div class="card view"><div class="sect-label">Сводка и анализ до → после</div><div id="rep"></div>
        <div class="btn-row"><button class="btn" id="toWafer" style="width:100%">🖨️ Сформировать шаблон (сплинт) →</button></div>
        <div class="btn-row"><button class="btn sm ghost" id="expPng" style="width:100%">⬇ План (PNG)</button></div></div>`;
    bindSliders(); if($('autorot'))$('autorot').onchange=e=>{plan.autorot=e.target.checked;invalidateWarp();waferMesh=null;render();renderPanel();};
    $('ov').oninput=e=>{overlay=+e.target.value;render();};
    $('resetPlan').onclick=()=>{plan={mxAdv:0,mxImp:0,mxPitch:0,mdAdv:0,mdRot:0,chAdv:0,chVert:0,autorot:false};invalidateWarp();waferMesh=null;renderPanel();render();};
    $('toWafer').onclick=()=>setStep('wafer');
    $('expPng').onclick=exportPng; renderReport($('rep'));
  }
  else if(step==='wafer'){
    if(!img){ p.innerHTML=emptyStepCard('Нет данных','Постройте ТРГ, расставьте точки и спланируйте перемещения.'); return; }
    waferMesh=buildWaferMesh(); // строим до панели, чтобы знать режим (КТ/параметрический)
    const stepAP=waferStepAP(), isCT=(wafer.src==='ct'), dg=wafer.ctDiag||{};
    const wsl=(k,label,mn,mx,st,u)=>`<div class="slider-row"><label>${label}</label><input type="range" id="w_${k}" min="${mn}" max="${mx}" step="${st}" value="${wafer[k]}"><span class="val" id="wv_${k}">${wafer[k]}${u}</span></div>`;
    const modeChip = isCT
      ? `<div class="mode-chip ok">✓ Дуга, ложа и <b>стенки — по МСКТ</b> (сегментация эмали + боковых поверхностей коронок; дуга ${dg.span} мм; стенки ≈${dg.wall} мм; покрытие ${dg.coverage}%)</div>`
      : `<div class="mode-chip warn">⚠ Параметрическая дуга${dg.reason?' — '+dg.reason:''}. На дентальном CBCT (≤0.4 мм) дуга строится по реальным окклюзионным поверхностям.</div>`;
    p.innerHTML=`<div class="card view"><h3>🖨️ Хирургический шаблон</h3>
        <div class="desc">Функциональный окклюзионный сплинт: центральные <b>ложа под зубы</b> + буккальные/язычные <b>ретенционные стенки</b> — надевается на зубы в запланированном смыкании и служит интраоперационным <b>ключом окклюзии</b>. Печать на 3D-принтере, формат <b>STL</b>.</div>
        ${modeChip}
        <label class="chk" style="margin-top:8px"><input type="checkbox" id="wCt" ${wafer.ct!==false?'checked':''}> Адаптировать дугу по МСКТ (сегментация зубов)</label>
        <div class="grp2" style="margin-top:12px"><h4>Тип шаблона</h4>
          <div class="seg-toggle">
            <button class="seg-btn${wafer.type==='inter'?' on':''}" data-t="inter">Промежуточный</button>
            <button class="seg-btn${wafer.type==='final'?' on':''}" data-t="final">Финальный</button></div>
          <div class="note" style="margin-top:6px">${wafer.type==='final'?'Индексирует обе челюсти в итоговом положении (ключ финальной окклюзии).':'Индексирует перемещённую в/ч к исходной н/ч (ставится после Le Fort I).'}</div></div>
        <div class="grp2"><h4>Геометрия дуги ${isCT?'<span class="tag">запасная</span>':''}</h4>
          ${wsl('archW','Ширина дуги',38,64,1,' мм')}${wsl('archD','Глубина (перёд→моляр)',30,52,1,' мм')}
          ${wsl('height','Высота блока',7,16,0.5,' мм')}${wsl('teeth','Зубных лож',8,16,1,'')}
          ${isCT?'<div class="note" style="margin-top:4px">В режиме МСКТ форма дуги и ложа берутся из КТ; эти ползунки — для запасного режима.</div>':''}</div>
        <button class="btn" id="dlStl" style="margin-top:4px">⬇ Скачать STL (для 3D-печати)</button>
        <div class="btn-row"><button class="btn ghost sm" id="snapStl" style="width:100%">⬇ Вид шаблона (PNG)</button></div></div>
      <div class="card view"><div class="sect-label">Параметры из плана</div>
        <div class="an-row" style="grid-template-columns:1fr auto"><span class="k">Логика</span><span class="v" style="font-size:12px">${wafer.type==='inter'?'в/ч перемещена, н/ч исходная':'обе челюсти в итоге'}</span></div>
        <div class="an-row" style="grid-template-columns:1fr auto"><span class="k">Сагиттальный шаг дуг</span><span class="v" style="color:var(--accent)">${fmt(stepAP)} мм</span></div>
        <div class="an-row" style="grid-template-columns:1fr auto"><span class="k">Выдвижение в/ч (Le Fort I)</span><span class="v">${fmt(plan.mxAdv)} мм</span></div>
        ${wafer.type==='inter'
          ? `<div class="an-row" style="grid-template-columns:1fr auto"><span class="k">Вертик. зазор (импакция в/ч)</span><span class="v" style="color:var(--accent)">${fmt(waferVert())} мм</span></div>
             <div class="an-row" style="grid-template-columns:1fr auto"><span class="k">Нижняя челюсть</span><span class="v" style="font-size:12px">исходная (BSSO не выполнен)</span></div>`
          : `<div class="an-row" style="grid-template-columns:1fr auto"><span class="k">Выдвижение н/ч (BSSO)</span><span class="v">${fmt(plan.mdAdv)} мм</span></div>`}
        <div class="note">${wafer.type==='inter'
          ? 'Промежуточный: в/ч в запланированном положении, н/ч — в исходном. Фиксируется только выдвижение в/ч; импакция в/ч открывает/закрывает прикус против неподвижной н/ч (шаблон клиновидный). Ставится интраоперационно для позиционирования в/ч после Le Fort I.'
          : 'Финальный: обе челюсти в итоговом положении — ключ финальной окклюзии.'} ${isCT?'Окклюзионные поверхности сегментированы из МСКТ по плотности.':'Размеры дуги параметрические — подгоните под модель пациента.'} Инструмент планирования, не мед. изделие — проверяйте клинически.</div></div>`;
    $('wCt').onchange=e=>{wafer.ct=e.target.checked;waferMesh=null;renderPanel();render();};
    p.querySelectorAll('.seg-btn').forEach(b=>b.onclick=()=>{wafer.type=b.dataset.t;waferMesh=null;renderPanel();render();});
    ['archW','archD','height','teeth'].forEach(k=>{const el=$('w_'+k);if(!el)return;const u=k==='teeth'?'':' мм';
      el.oninput=e=>{wafer[k]=+e.target.value;$('wv_'+k).textContent=wafer[k]+u;if(wafer.src!=='ct')waferMesh=buildWaferParam();};});
    $('dlStl').onclick=exportSTL;
    $('snapStl').onclick=()=>{const a=document.createElement('a');a.download='ОРТОС_шаблон.png';a.href=cv.toDataURL('image/png');a.click();};
  }
}
function lmRow(id){const l=LBL[id];return `<div class="lm${id===pickId?' cur':''}${LM[id]?' ok':''}" data-k="${id}"><span class="ck">${LM[id]?'✓':'○'}</span><span class="t">${l.abbr} <small>· ${l.ru}</small></span></div>`;}
function anRow(r){const col=r.st==='норма'?'var(--good)':(r.st==='—'?'var(--ink-faint)':'var(--warn)');
  return `<div class="an-row"><span class="k">${r.key}</span><span class="v">${r.val!=null&&!isNaN(r.val)?r.val.toFixed(1):'—'}</span><span class="s" style="color:${col}">${r.st}</span><span class="n">норма ${r.norm}${r.extra?' · '+r.extra:''}</span></div>`;}
function sl(k,label,mn,mx,st,u){return `<div class="slider-row"><label>${label}</label><input type="range" id="s_${k}" min="${mn}" max="${mx}" step="${st}" value="${plan[k]}"><span class="val" id="v_${k}">${fmt(plan[k])}${u}</span></div>`;}
function bindSliders(){['mxAdv','mxImp','mxPitch','mdAdv','mdRot','chAdv','chVert'].forEach(k=>{const el=$('s_'+k);if(!el)return;const u=(k.includes('Pitch')||k.includes('Rot'))?'°':'мм';
  el.oninput=e=>{plan[k]=+e.target.value;$('v_'+k).textContent=fmt(plan[k])+u;invalidateWarp();waferMesh=null;render();renderReport($('rep'));};});}
function renderReport(box){if(!box)return;const mdR=plan.autorot?plan.mxImp*1.1:plan.mdRot;
  const mv=[['Верхняя челюсть (Le Fort I)',`выдв. ${fmt(plan.mxAdv)} · импакция ${fmt(plan.mxImp)} · питч ${fmt(plan.mxPitch)}°`],
    ['Нижняя челюсть (BSSO)',`выдв. ${fmt(plan.mdAdv)} · ротация ${fmt(mdR)}°${plan.autorot?' (авто)':''}`],
    ['Подбородок',`выдв. ${fmt(plan.chAdv)} · вертикаль ${fmt(plan.chVert)}`]];
  const b=analyse(LM),a=analyse(planned());const keep=['SNA, °','SNB, °','ANB, °','Wits, мм','U1–NA, мм','L1–NB, мм'];
  box.innerHTML=mv.map(([t,v])=>`<div style="margin-bottom:7px"><div style="font-size:12px;font-weight:700;color:var(--ink)">${t}</div><div style="font-size:12px;color:var(--ink-soft);font-variant-numeric:tabular-nums">${v}</div></div>`).join('')
    +'<div class="sep"></div>'+keep.map(key=>{const rb=b.find(x=>x.key===key),ra=a.find(x=>x.key===key);const vb=rb&&rb.val!=null?rb.val.toFixed(1):'—',va=ra&&ra.val!=null?ra.val.toFixed(1):'—';
      return `<div class="an-row" style="grid-template-columns:1fr auto"><span class="k">${key}</span><span class="v" style="font-size:13px">${vb} → <span style="color:var(--accent)">${va}</span></span></div>`;}).join('');
}
function emptyStepCard(t,d){return `<div class="card view"><h3>${t}</h3><div class="desc">${d}</div><button class="btn" onclick="document.getElementById('dcmInput').click()">🧊 Загрузить МСКТ</button></div>`;}
function esc(s){return(s||'').replace(/"/g,'&quot;');}

// ── шаги ──
function setStep(s){ if(s==='plan')invalidateWarp(); if(s==='wafer')waferMesh=null; step=s;
  document.querySelectorAll('.step').forEach(x=>{x.classList.toggle('on',x.dataset.s===s);});
  markDone(); renderPanel(); render(); }
function markDone(){ document.querySelectorAll('.step').forEach(x=>{const s=x.dataset.s;let done=false;
  if(s==='patient')done=!!patient.name; if(s==='trg')done=!!img; if(s==='points')done=HARD.every(k=>LM[k]); if(s==='photo')done=!!photo;
  x.classList.toggle('done',done&&x.dataset.s!==step);}); }
function advancePick(){const i=ORDER.indexOf(pickId);const nx=ORDER.slice(i+1).find(id=>!LM[id]);pickId=nx||ORDER[(i+1)%ORDER.length];renderPanel();render();}

// ── события канваса ──
let drag=null,pan=null;
cv.addEventListener('mousedown',e=>{const r=cv.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
  const sx=(e.clientX-r.left)*dpr,sy=(e.clientY-r.top)*dpr;
  if(e.button===1||e.shiftKey){pan={sx,sy,ox:view.ox,oy:view.oy};return;}
  if(step!=='points'||!img)return;const ip=toI(sx,sy);
  let best=null,bd=14*dpr;LM_DEF.forEach(l=>{if(LM[l.id]){const S=toS(LM[l.id]);const d=Math.hypot(S.x-sx,S.y-sy);if(d<bd){bd=d;best=l.id;}}});
  if(best){drag=best;pickId=best;renderPanel();render();return;}
  if(pickId){LM[pickId]=ip;popAt(sx,sy);advancePick();}});
window.addEventListener('mousemove',e=>{const r=cv.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);const sx=(e.clientX-r.left)*dpr,sy=(e.clientY-r.top)*dpr;
  if(pan){view.ox=pan.ox+(sx-pan.sx);view.oy=pan.oy+(sy-pan.sy);render();return;}
  if(drag){LM[drag]=toI(sx,sy);render();}});
window.addEventListener('mouseup',()=>{if(drag){drag=null;renderPanel();}pan=null;});
cv.addEventListener('wheel',e=>{if(!img||step==='photo')return;e.preventDefault();const r=cv.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
  const sx=(e.clientX-r.left)*dpr,sy=(e.clientY-r.top)*dpr,bef=toI(sx,sy);view.zoom*=e.deltaY<0?1.12:0.89;const af=toI(sx,sy);view.ox+=(af.x-bef.x)*view.zoom;view.oy+=(af.y-bef.y)*view.zoom;render();},{passive:false});
cv.addEventListener('dragover',e=>e.preventDefault());
cv.addEventListener('drop',e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f&&f.type.startsWith('image')){const rd=new FileReader();rd.onload=()=>{const im=new Image();im.onload=()=>{img=im;scale=0;autoView();setStep('points');toast('Снимок загружен. Откалибруйте при необходимости.');};im.src=rd.result;};rd.readAsDataURL(f);}});
// анимация «пончик» при установке точки
function popAt(x,y){const d=document.createElement('div');const r=cv.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
  d.style.cssText=`position:absolute;left:${x/dpr-9}px;top:${y/dpr-9}px;width:18px;height:18px;border-radius:50%;border:2px solid #5b6cff;pointer-events:none;z-index:5`;
  d.animate([{transform:'scale(.4)',opacity:1},{transform:'scale(1.8)',opacity:0}],{duration:450,easing:'ease-out'});
  $('stage').appendChild(d);setTimeout(()=>d.remove(),460);}

// ── инпуты ──
$('dcmInput').addEventListener('change',e=>{if(e.target.files.length)loadDicom(e.target.files);e.target.value='';});
$('imgInput').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{const im=new Image();im.onload=()=>{img=im;scale=0;autoView();setStep('points');toast('Плёнка ТРГ загружена.');};im.src=rd.result;};rd.readAsDataURL(f);e.target.value='';});
$('photoInput').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{const im=new Image();im.onload=()=>{photo=im;renderPanel();render();toast('Фото загружено.');};im.src=rd.result;};rd.readAsDataURL(f);e.target.value='';});
$('emptyLoad').onclick=()=>$('dcmInput').click();
$('steps').addEventListener('click',e=>{const s=e.target.closest('.step');if(s)setStep(s.dataset.s);});
$('saveBtn').onclick=save; $('openBtn').onclick=()=>$('openInput').click();
$('openInput').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{const o=JSON.parse(rd.result);patient=o.patient||patient;scale=o.scale||0;LM=o.LM||{};plan=Object.assign(plan,o.plan||{});
  const done=()=>{setStep('points');};if(o.img){const im=new Image();im.onload=()=>{img=im;autoView();done();};im.src=o.img;}else done();if(o.photo){const pm=new Image();pm.onload=()=>{photo=pm;};pm.src=o.photo;}toast('Проект открыт.');}catch(err){alert('Не удалось открыть файл');}};rd.readAsText(f);e.target.value='';});

function save(){const o={v:1,patient,scale,LM,plan,img:img?img.src:null,photo:photo?photo.src:null};
  const a=document.createElement('a');a.download=(patient.name||'план')+'.orthos';a.href=URL.createObjectURL(new Blob([JSON.stringify(o)],{type:'application/json'}));a.click();}
function exportPng(){const a=document.createElement('a');a.download='ОРТОС_план_'+(patient.name||'пациент')+'.png';a.href=cv.toDataURL('image/png');a.click();}
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('on');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('on'),2400);}

window.addEventListener('resize',render);
renderPanel(); render();

// тест-хук
window.__orthos={ loadDicom:f=>loadDicom(f), set:(k,x,y)=>{LM[k]={x,y};}, calib:s=>{scale=s;}, analyse:()=>analyse(LM), planned, setPlan:p=>{Object.assign(plan,p);invalidateWarp();waferMesh=null;},
  setWafer:o=>{Object.assign(wafer,o);waferMesh=null;}, stl:()=>waferSTL(buildWaferMesh()), waferTris:()=>buildWaferMesh().length,
  ctDiag:()=>{buildWaferMesh();return{src:wafer.src,diag:wafer.ctDiag};}, injectVol:v=>{vol=v;waferMesh=null;},
  warpInfo:()=>{const w=buildWarp();return{ok:!!w,w:w&&w.width,h:w&&w.height};}, osteotomy:()=>osteotomy().map(s=>s.label),
  step:s=>setStep(s), state:()=>({step,scale,n:Object.keys(LM).length,hasImg:!!img,hasVol:!!vol,stepAP:waferStepAP(),vert:waferVert(),wtype:wafer.type}) };
