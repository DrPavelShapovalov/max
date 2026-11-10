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
let overlay=0.85, building=false;
// фото-морф: привязка фото к мягкотканным ориентирам ТРГ и прогноз профиля
let photoLM={}, photoPick=null, photoOverlay=1, photoView={z:1,ox:0,oy:0}, photoDrag=null, photoWarpCv=null, photoWarpDirty=true;
const PHOTO_SET=['G','Prn','Sn','Ls','Li','Pog2','Me2'];
const invalidatePhotoWarp=()=>{photoWarpDirty=true;};

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

// ═══ Фото-морф: прогноз профиля пациента по плану (привязка к мягкотканным точкам ТРГ) ═══
// МНК-подобие src→dst (scale+поворот+сдвиг), ≥2 соответствия
function fitSim(src,dst){
  const n=src.length;let msx=0,msy=0,mdx=0,mdy=0;
  for(let i=0;i<n;i++){msx+=src[i].x;msy+=src[i].y;mdx+=dst[i].x;mdy+=dst[i].y;}
  msx/=n;msy/=n;mdx/=n;mdy/=n;let a=0,b=0,d=0;
  for(let i=0;i<n;i++){const sx=src[i].x-msx,sy=src[i].y-msy,dx=dst[i].x-mdx,dy=dst[i].y-mdy;a+=sx*dx+sy*dy;b+=sx*dy-sy*dx;d+=sx*sx+sy*sy;}
  d=d||1;const cos=a/d,sin=b/d; // включают масштаб: s·cosθ, s·sinθ
  return{cos,sin,tx:mdx-(cos*msx-sin*msy),ty:mdy-(sin*msx+cos*msy),
    applyVec:v=>({x:cos*v.x-sin*v.y,y:sin*v.x+cos*v.y})};
}
function photoCorr(){ const src=[],dst=[],ids=[];
  PHOTO_SET.forEach(id=>{if(LM[id]&&photoLM[id]){src.push(LM[id]);dst.push(photoLM[id]);ids.push(id);}});
  return{src,dst,ids}; }
function photoAfter(){ const {src,dst,ids}=photoCorr(); if(src.length<2)return null;
  const T=fitSim(src,dst),P=planned(),after={};
  ids.forEach(id=>{ if(!P[id])return; after[id]=add(photoLM[id],T.applyVec(sub(P[id],LM[id]))); });
  return{ids:ids.filter(id=>after[id]),after,before:photoLM}; }
function buildPhotoWarp(){
  if(!photo)return null;const W=photo.naturalWidth||photo.width,H=photo.naturalHeight||photo.height;
  const pa=photoAfter(); if(!pa||pa.ids.length<2)return null;
  const B=[],A=[];
  pa.ids.forEach(id=>{B.push(photoLM[id]);A.push(pa.after[id]);});
  [[0,0],[W/2,0],[W,0],[W,H/2],[W,H],[W/2,H],[0,H],[0,H/2]].forEach(([x,y])=>{B.push({x,y});A.push({x,y});});
  if(B.length<3)return null;
  const tris=delaunay(B),out=document.createElement('canvas');out.width=W;out.height=H;const g=out.getContext('2d');g.drawImage(photo,0,0);
  for(const[i,j,k]of tris)affTri(g,photo,B[i],B[j],B[k],A[i],A[j],A[k]);
  return out;
}
function advancePhotoPick(){const i=PHOTO_SET.indexOf(photoPick);const nx=PHOTO_SET.slice(i+1).find(id=>!photoLM[id]);photoPick=nx||PHOTO_SET[(i+1)%PHOTO_SET.length];renderPanel();render();}

// ═══ Хирургический шаблон (окклюзионный сплинт) — параметрическая 3D-модель ═══
let wafer={type:'final',archW:52,archD:40,height:11,band:11,teeth:12,ct:true,src:'param',ctDiag:null};
let waferMesh=null,waferYaw=0.6,waferPitch=0.5,waferRAF=null,waferDrag=null,waferSpin=true,waferZoom=1;
let scanU=null,scanL=null; // STL внутриротовых сканов (верхняя/нижняя челюсть)
let planView='trg';        // контроль результата на шаге «План»: 'trg' | 'skull3d'
let skullMesh=null,skullYaw=0.5,skullPitch=0.12,skullZoom=1,skullDrag=null,skullBuilding=false;
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
const WAFER={bandW:15, trough:0.30, wallH:4.5, sockT:2.8, sockB:2.8, sig:2.8, minTh:2.0};
const wallProfile=(o,W)=>{const Wc=W*WAFER.trough,t=Math.max(0,Math.min(1,(Math.abs(o)-Wc)/(W/2-Wc||1)));return WAFER.wallH*t*t*(3-2*t);};
// параметрический сплинт (обобщённая дуга — запасной режим / нет КТ-дентиции)
function buildWaferParam(){
  const aw=wafer.archW/2,ad=wafer.archD,half=wafer.height/2,W=WAFER.bandW,vert=waferVert();
  const N=120,M=24,nt=Math.max(6,wafer.teeth|0);
  const stepU=Math.max(-0.5,Math.min(0.5,waferStepAP()/(ad||1)));
  const cuspO=Math.min(3.0,(W*WAFER.trough)*0.78),cg=1.2,gss=(x,s)=>Math.exp(-(x*x)/(2*s*s));
  // отпечаток зуба: 2 бугра (буккальный+язычный) + центральная фиссура
  const occProf=o=>gss(o-cuspO,cg)+gss(o+cuspO,cg)+0.35*gss(o,cg*1.5);
  // модуляция по зубам: провал между зубами (межзубные перегородки)
  const toothMod=u=>{const ph=((u+1)/2)*nt,f=ph-Math.floor(ph);return 0.32+0.68*Math.pow(Math.sin(Math.PI*f),0.7);};
  const C=u=>({x:aw*u,y:ad*u*u}),Nrm=u=>{const nx=2*ad*u,ny=-aw,l=Math.hypot(nx,ny)||1;let r={x:nx/l,y:ny/l};if(r.y<0)r={x:-r.x,y:-r.y};return r;};
  const VT=[],VB=[];
  for(let i=0;i<=N;i++){const u=-1+2*i/N,c=C(u),nr=Nrm(u);VT.push([]);VB.push([]);
    for(let j=0;j<=M;j++){const o=(j/M-0.5)*W,Fx=c.x+o*nr.x,Fy=c.y+o*nr.y,w=wallProfile(o,W);
      const occT=half-WAFER.sockT*occProf(o)*toothMod(u)+vert, occB=-half+WAFER.sockB*occProf(o)*toothMod(u-stepU);
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
// заполнить ТОЛЬКО пустые узлы heightmap (без размывания — сохраняет бугры/режущие края)
function fillHoles(G,fb){const N=G.length-1,M=G[0].length-1;
  for(let i=0;i<=N;i++)for(let j=0;j<=M;j++)if(G[i][j].z==null){let s=0,c=0,r=1;
    while(c===0&&r<=4){for(let di=-r;di<=r;di++)for(let dj=-r;dj<=r;dj++){const a=i+di,b=j+dj;if(a>=0&&a<=N&&b>=0&&b<=M&&G[a][b].z!=null){s+=G[a][b].z;c++;}}r++;}
    G[i][j].z=c?s/c:fb;}
  // лёгкий медианный фильтр 3×3 только против одиночных выбросов сегментации (бугры сохраняются)
  const Z=G.map(r=>r.map(p=>p.z));
  for(let i=1;i<N;i++)for(let j=1;j<M;j++){const w=[];for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++)w.push(Z[i+di][j+dj]);
    w.sort((a,b)=>a-b);const med=w[4];if(Math.abs(Z[i][j]-med)>1.2)G[i][j].z=med;}
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
// Общее ядро: строит сплинт из облака точек окклюзии (верх z≥z0, низ z<z0).
// Используется и для КТ (воксели эмали), и для STL-сканов (вершины мешей).
function waferFromCloud(KX,KY,KZ,n,z0,rad,opt){
  const fail=d=>{d.ok=false;opt.diag(d);return null;};
  let AX=[],AY=[];for(let i=0;i<n;i++)if(Math.abs(KZ[i]-z0)<9){AX.push(KX[i]);AY.push(KY[i]);}
  if(AX.length<120){AX=KX;AY=KY;}
  const fit=fitParabola(AX,AY);if(!fit)return fail({reason:'дуга не аппроксимируется'});
  const {a,b,c}=fit;let xmin=1e9,xmax=-1e9;for(let i=0;i<AX.length;i++){if(AX[i]<xmin)xmin=AX[i];if(AX[i]>xmax)xmax=AX[i];}const span=xmax-xmin;
  if(span<40||span>74)return fail({reason:'ширина дуги вне нормы ('+span.toFixed(0)+' мм)'+(opt.ctHint?' — КТ грубая/захватывает кость':' — проверьте ориентацию скана (окклюзия вверх) и масштаб'),span:+span.toFixed(0)});
  const vtx=-b/(2*a||1e-6);let ymin=1e9,ymax=-1e9;for(let x=xmin;x<=xmax;x+=1){const yy=a*x*x+b*x+c;if(yy<ymin)ymin=yy;if(yy>ymax)ymax=yy;}
  const depth=ymax-ymin;
  if(depth<7||depth>42||vtx<xmin-6||vtx>xmax+6)return fail({reason:'форма не похожа на зубную дугу (глубина '+depth.toFixed(0)+' мм)'+(opt.ctHint?' — нужен дентальный CBCT':''),span:+span.toFixed(0),depth:+depth.toFixed(0)});
  xmin+=span*0.05;xmax-=span*0.05;
  const N=96,M=26,fy=x=>a*x*x+b*x+c,dfy=x=>2*a*x+b,antY=a>0?-1:1,stepAP=waferStepAP(),vertG=waferVert(),WALLT=1.8;
  const r2=rad*rad,cs=Math.max(rad,1.0);
  const frame=si=>{const x=xmin+(xmax-xmin)*si/N,cy=fy(x),dd=dfy(x),nl=Math.hypot(-dd,1)||1;return{x,cy,ndx:-dd/nl,ndy:1/nl};};
  let gx0=1e9,gy0=1e9;for(let i=0;i<n;i++){if(KX[i]<gx0)gx0=KX[i];if(KY[i]<gy0)gy0=KY[i];}
  const buckets=new Map(),bkey=(cx,cy)=>cx*100003+cy;
  for(let i=0;i<n;i++){const k=bkey(Math.floor((KX[i]-gx0)/cs),Math.floor((KY[i]-gy0)/cs));let arr=buckets.get(k);if(!arr){arr=[];buckets.set(k,arr);}arr.push(i);}
  const sampleZ=(fx,fyy,upper)=>{let best=upper?1e9:-1e9,hit=false;const cx=Math.floor((fx-gx0)/cs),cy=Math.floor((fyy-gy0)/cs);
    for(let ax=cx-1;ax<=cx+1;ax++)for(let ay=cy-1;ay<=cy+1;ay++){const arr=buckets.get(bkey(ax,ay));if(!arr)continue;
      for(const i of arr){if(upper?(KZ[i]<z0):(KZ[i]>=z0))continue;const dx=KX[i]-fx,dy=KY[i]-fyy;
        if(dx*dx+dy*dy<=r2){hit=true;if(upper){if(KZ[i]<best)best=KZ[i];}else if(KZ[i]>best)best=KZ[i];}}}
    return hit?best:null;};
  // сегментация боковых поверхностей коронок (o,z по станциям)
  const SU=Array.from({length:N+1},()=>[]),SL=Array.from({length:N+1},()=>[]);
  for(let i=0;i<n;i++){const si=Math.max(0,Math.min(N,Math.round((KX[i]-xmin)/((xmax-xmin)||1)*N))),f=frame(si);
    const o=(KX[i]-f.x)*f.ndx+(KY[i]-f.cy)*f.ndy;if(Math.abs(o)>12)continue;(KZ[i]>=z0?SU:SL)[si].push({o,z:KZ[i]});}
  const segm=st=>{if(st.length<4)return null;let ol=1e9,ob=-1e9,zl=1e9,zh=-1e9;for(const p of st){if(p.o<ol)ol=p.o;if(p.o>ob)ob=p.o;if(p.z<zl)zl=p.z;if(p.z>zh)zh=p.z;}return{ol,ob,zl,zh};};
  const CO=new Array(N+1).fill(null),HW=new Array(N+1).fill(null),WU=new Array(N+1).fill(null),WL=new Array(N+1).fill(null);
  for(let i=0;i<=N;i++){const su=segm(SU[i]),sl=segm(SL[i]);let cen=null,hw=0,wu=null,wl=null;
    if(su){cen=(su.ol+su.ob)/2;hw=Math.max(hw,(su.ob-su.ol)/2);wu=Math.max(2,Math.min(5.5,0.55*(su.zh-su.zl)));}
    if(sl){const c2=(sl.ol+sl.ob)/2;cen=cen==null?c2:(cen+c2)/2;hw=Math.max(hw,(sl.ob-sl.ol)/2);wl=Math.max(2,Math.min(5.5,0.55*(sl.zh-sl.zl)));}
    CO[i]=cen;HW[i]=hw||null;WU[i]=wu;WL[i]=wl;}
  const fillA=(A,def)=>{for(let i=0;i<=N;i++)if(A[i]==null){let bi=-1,bd=1e9;for(let j=0;j<=N;j++)if(A[j]!=null&&Math.abs(j-i)<bd){bd=Math.abs(j-i);bi=j;}A[i]=bi>=0?A[bi]:def;}
    const B=A.slice();for(let i=0;i<=N;i++){let s=0,c2=0;for(let d=-2;d<=2;d++){const a2=i+d;if(a2>=0&&a2<=N){s+=B[a2];c2++;}}A[i]=s/c2;}};
  fillA(CO,0);fillA(HW,4.2);fillA(WU,3.5);fillA(WL,3.5);
  for(let i=0;i<=N;i++)HW[i]=Math.max(3,Math.min(8,HW[i]));
  const OT=[],OB=[];let nUpC=0,nLoC=0,ncC=0;
  for(let i=0;i<=N;i++){const f=frame(i),bandHalf=HW[i]+WALLT;OT.push([]);OB.push([]);
    for(let j=0;j<=M;j++){const o=CO[i]+(j/M-0.5)*2*bandHalf,fx=f.x+o*f.ndx,fyy=f.cy+o*f.ndy;
      const tz=sampleZ(fx,fyy,true),bz=sampleZ(fx,fyy+antY*stepAP,false);
      if(Math.abs(o-CO[i])<HW[i]*0.8){ncC++;if(tz!=null)nUpC++;if(bz!=null)nLoC++;}
      OT[i].push({x:fx,y:fyy,z:tz});OB[i].push({x:fx,y:fyy,z:bz});}}
  const cov=Math.min(nUpC,nLoC)/Math.max(1,ncC);
  if(cov<0.5)return fail({reason:'не распознаны обе дуги (покрытие '+(cov*100|0)+'%)'+(opt.ctHint?' — КТ грубая/обрезана':' — проверьте, что оба скана в одном положении смыкания'),span:+span.toFixed(0)});
  fillHoles(OT,z0+1.5);fillHoles(OB,z0-1.5);
  const VT=[],VB=[];
  for(let i=0;i<=N;i++){const bandHalf=HW[i]+WALLT;VT.push([]);VB.push([]);
    for(let j=0;j<=M;j++){const o=(j/M-0.5)*2*bandHalf,t=Math.max(0,Math.min(1,(Math.abs(o)-HW[i])/(WALLT||1))),e=t*t*(3-2*t);
      let zt=OT[i][j].z+vertG,zb=OB[i][j].z;
      if(zt<zb+WAFER.minTh){const m=(zt+zb)/2;zt=m+WAFER.minTh/2;zb=m-WAFER.minTh/2;}
      VT[i].push({x:OT[i][j].x,y:OT[i][j].y,z:zt+WU[i]*e});VB[i].push({x:OB[i][j].x,y:OB[i][j].y,z:zb-WL[i]*e});}}
  const meanW=((WU.reduce((p,q)=>p+q,0)+WL.reduce((p,q)=>p+q,0))/(2*(N+1)));
  opt.diag({ok:true,span:+span.toFixed(0),coverage:+(cov*100).toFixed(0),z0:+z0.toFixed(0),wall:+meanW.toFixed(1),mode:opt.mode});
  return gridToSolid(VT,VB);
}
// КТ-адаптивный сплинт: окклюзионные поверхности сегментируются по плотности (эмаль/кость)
function buildWaferCT(){
  if(!vol){wafer.ctDiag={ok:false,reason:'нет объёма КТ'};return null;}
  const [nx,ny,nz]=vol.dims,[sx,sy,sz]=vol.spacing,D=vol.data;
  let T=1500,PX,PY,PZ;
  for(const tt of[1500,1200,900]){PX=[];PY=[];PZ=[];for(let z=0;z<nz;z++)for(let y=0;y<ny;y++){const b=z*nx*ny+y*nx;
      for(let x=0;x<nx;x++)if(D[b+x]>tt){PX.push(x*sx);PY.push(y*sy);PZ.push(z*sz);}}T=tt;if(PX.length>=500)break;}
  let n=PX.length;
  if(n<500){wafer.ctDiag={ok:false,reason:'дентиция не распознаётся (мало плотных вокселей)',enamel:n};return null;}
  let zmin=1e9,zmax=-1e9;for(let i=0;i<n;i++){if(PZ[i]<zmin)zmin=PZ[i];if(PZ[i]>zmax)zmax=PZ[i];}
  const nb=24,hb=new Array(nb).fill(0),bw0=(zmax-zmin)/nb||1;
  for(let i=0;i<n;i++)hb[Math.min(nb-1,Math.floor((PZ[i]-zmin)/bw0))]++;
  let pk=0;for(let i=1;i<nb;i++)if(hb[i]>hb[pk])pk=i;
  const zc=zmin+(pk+0.5)*bw0, half=14;
  const KX=[],KY=[],KZ=[];for(let i=0;i<n;i++)if(Math.abs(PZ[i]-zc)<=half){KX.push(PX[i]);KY.push(PY[i]);KZ.push(PZ[i]);}
  n=KX.length;if(n<400){wafer.ctDiag={ok:false,reason:'узкая дентальная зона в КТ',enamel:n};return null;}
  const zs=[...KZ].sort((p,q)=>p-q),z0=zs[zs.length>>1];
  return waferFromCloud(KX,KY,KZ,n,z0,Math.max(sx,sy)*1.25,{ctHint:true,mode:'сегм. коронок',diag:d=>{d.enamel=n;d.threshold=T;wafer.ctDiag=d;}});
}
// собственные значения/векторы симметричной 3×3 (вращения Якоби) — для PCA
function eig3sym(M){
  const a=[M[0].slice(),M[1].slice(),M[2].slice()],V=[[1,0,0],[0,1,0],[0,0,1]],off=[[0,1],[0,2],[1,2]];
  for(let it=0;it<60;it++){let p=0,q=1,mx=-1;for(const[i,j]of off)if(Math.abs(a[i][j])>mx){mx=Math.abs(a[i][j]);p=i;q=j;}
    if(mx<1e-11)break;const th=0.5*Math.atan2(2*a[p][q],a[p][p]-a[q][q]),c=Math.cos(th),s=Math.sin(th);
    for(let k=0;k<3;k++){const kp=a[k][p],kq=a[k][q];a[k][p]=c*kp-s*kq;a[k][q]=s*kp+c*kq;}
    for(let k=0;k<3;k++){const pk=a[p][k],qk=a[q][k];a[p][k]=c*pk-s*qk;a[q][k]=s*pk+c*qk;}
    for(let k=0;k<3;k++){const kp=V[k][p],kq=V[k][q];V[k][p]=c*kp-s*kq;V[k][q]=s*kp+c*kq;}}
  const ev=[{v:a[0][0],e:[V[0][0],V[1][0],V[2][0]]},{v:a[1][1],e:[V[0][1],V[1][1],V[2][1]]},{v:a[2][2],e:[V[0][2],V[1][2],V[2][2]]}];
  ev.sort((p,q)=>q.v-p.v);return ev; // по убыванию дисперсии: [ширина, глубина, нормаль]
}
// автоориентация сканов: PCA-оси → X(ширина)·Y(глубина)·Z(нормаль окклюзии),
// знак Z так, чтобы верхняя дуга была сверху. Возвращает оси e1,e2,e3 и центр.
function orientScans(X,Y,Z,uN,n){
  let cx=0,cy=0,cz=0;for(let i=0;i<n;i++){cx+=X[i];cy+=Y[i];cz+=Z[i];}cx/=n;cy/=n;cz/=n;
  let xx=0,yy=0,zz=0,xy=0,xz=0,yz=0;
  for(let i=0;i<n;i++){const dx=X[i]-cx,dy=Y[i]-cy,dz=Z[i]-cz;xx+=dx*dx;yy+=dy*dy;zz+=dz*dz;xy+=dx*dy;xz+=dx*dz;yz+=dy*dz;}
  const ev=eig3sym([[xx,xy,xz],[xy,yy,yz],[xz,yz,zz]]),e1=ev[0].e,e2=ev[1].e,e3=ev[2].e;
  // знак нормали: проекция верхней дуги должна быть больше нижней
  const proj=i=>(X[i]-cx)*e3[0]+(Y[i]-cy)*e3[1]+(Z[i]-cz)*e3[2];
  let su=0,sl=0;for(let i=0;i<uN;i++)su+=proj(i);for(let i=uN;i<n;i++)sl+=proj(i);
  const sg=(su/Math.max(1,uN))<(sl/Math.max(1,n-uN))?-1:1;
  return {cx,cy,cz,e1,e2,e3:[e3[0]*sg,e3[1]*sg,e3[2]*sg]};
}
// STL-сплинт: ложа строятся по РЕАЛЬНЫМ окклюзионным поверхностям из внутриротовых сканов.
// Пробуем ориентацию «как есть», затем автоориентацию по PCA (и с перестановкой ширина/глубина) —
// берём первую, прошедшую проверку физиологичности дуги в waferFromCloud.
function buildWaferSTL(){
  if(!scanU||!scanL){wafer.stlDiag={ok:false,reason:'нет STL-моделей'};return null;}
  const X=[],Y=[],Z=[];let step=1;
  const nvU=scanU.tris.length*3,nvL=scanL.tris.length*3;
  if(nvU+nvL>90000)step=Math.ceil((nvU+nvL)/90000); // подвыборка плотного скана для скорости
  let c=0;for(const t of scanU.tris)for(const v of t){if(c++%step===0){X.push(v.x);Y.push(v.y);Z.push(v.z);}}
  const uN=X.length;c=0;for(const t of scanL.tris)for(const v of t){if(c++%step===0){X.push(v.x);Y.push(v.y);Z.push(v.z);}}
  const n=X.length;if(n<200){wafer.stlDiag={ok:false,reason:'STL пустые/битые'};return null;}
  // кандидаты преобразований (world → ориентированное)
  const cands=[{name:'как есть',T:i=>[X[i],Y[i],Z[i]]}];
  const o=orientScans(X,Y,Z,uN,n),pr=(i,a)=>(X[i]-o.cx)*a[0]+(Y[i]-o.cy)*a[1]+(Z[i]-o.cz)*a[2];
  cands.push({name:'авто',T:i=>[pr(i,o.e1),pr(i,o.e2),pr(i,o.e3)]});
  cands.push({name:'авто·поворот',T:i=>[pr(i,o.e2),pr(i,o.e1),pr(i,o.e3)]}); // ширина↔глубина
  let lastDiag=null;
  for(const cand of cands){
    const KX=new Array(n),KY=new Array(n),KZ=new Array(n);
    for(let i=0;i<n;i++){const p=cand.T(i);KX[i]=p[0];KY[i]=p[1];KZ[i]=p[2];}
    let uMin=1e9;for(let i=0;i<uN;i++)if(KZ[i]<uMin)uMin=KZ[i];
    let lMax=-1e9;for(let i=uN;i<n;i++)if(KZ[i]>lMax)lMax=KZ[i];
    const z0=(uMin+lMax)/2;let got=null;
    const m=waferFromCloud(KX,KY,KZ,n,z0,0.7,{ctHint:false,mode:'STL-скан',diag:d=>{d.verts=n;d.orient=cand.name;got=d;}});
    if(m){wafer.stlDiag=got;return m;} lastDiag=got;
  }
  wafer.stlDiag=lastDiag||{ok:false,reason:'STL не распознан как зубные ряды'};return null;
}
function buildWaferMesh(){let m=null;
  if(scanU&&scanL){m=buildWaferSTL();if(m){wafer.src='stl';return m;}}
  if(wafer.ct!==false&&vol){m=buildWaferCT();if(m){wafer.src='ct';return m;}}
  wafer.src='param';return buildWaferParam();}
// парсер STL (бинарный + ASCII) → массив треугольников [[{x,y,z}×3]]
function parseSTL(buf){
  const n=buf.byteLength;if(n<84)return[];const dv=new DataView(buf);
  const cnt=dv.getUint32(80,true);
  if(84+cnt*50===n){ const tris=[];let o=84; // бинарный
    for(let i=0;i<cnt;i++){o+=12;const v=[];for(let k=0;k<3;k++){v.push({x:dv.getFloat32(o,true),y:dv.getFloat32(o+4,true),z:dv.getFloat32(o+8,true)});o+=12;}o+=2;tris.push(v);}
    return tris; }
  // ASCII
  const txt=new TextDecoder().decode(new Uint8Array(buf));const tris=[];const re=/vertex\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)/g;let m,cur=[];
  while((m=re.exec(txt))){cur.push({x:+m[1],y:+m[2],z:+m[3]});if(cur.length===3){tris.push(cur);cur=[];}}
  return tris;
}
function loadScan(buf,which){const tris=parseSTL(buf);if(!tris.length){toast('Не удалось прочитать STL.');return;}
  if(which==='U')scanU={tris}; else scanL={tris}; waferMesh=null;
  toast('STL '+(which==='U'?'верхней':'нижней')+' челюсти загружен ('+tris.length+' треуг.).');renderPanel();render();}
function waferSTL(T){
  const n=T.length,buf=new ArrayBuffer(84+n*50),dv=new DataView(buf);dv.setUint32(80,n,true);let o=84;
  for(const[a,b,c]of T){const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;
    let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const L=Math.hypot(nx,ny,nz)||1;
    dv.setFloat32(o,nx/L,true);dv.setFloat32(o+4,ny/L,true);dv.setFloat32(o+8,nz/L,true);o+=12;
    for(const p of[a,b,c]){dv.setFloat32(o,p.x,true);dv.setFloat32(o+4,p.y,true);dv.setFloat32(o+8,p.z,true);o+=12;}
    dv.setUint16(o,0,true);o+=2;}
  return buf;
}
// сглаженные (сваренные по позиции) нормали — убирают фасетный вид треугольников
function waferSmoothNormals(T){
  if(T.__sn)return T.__sn;
  const acc=new Map(),key=p=>Math.round(p.x*16)+'_'+Math.round(p.y*16)+'_'+Math.round(p.z*16);
  for(const t of T){const a=t[0],b=t[1],c=t[2];
    const nx=(b.y-a.y)*(c.z-a.z)-(b.z-a.z)*(c.y-a.y),ny=(b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z),nz=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    for(const p of t){const k=key(p);let v=acc.get(k);if(!v){v={x:0,y:0,z:0};acc.set(k,v);}v.x+=nx;v.y+=ny;v.z+=nz;}}
  const sn=T.map(t=>{let x=0,y=0,z=0;for(const p of t){const v=acc.get(key(p));x+=v.x;y+=v.y;z+=v.z;}const l=Math.hypot(x,y,z)||1;return{x:x/l,y:y/l,z:z/l};});
  try{Object.defineProperty(T,'__sn',{value:sn,enumerable:false,configurable:true});}catch(e){T.__sn=sn;}
  return sn;
}
function drawWafer3D(T,yaw,pitch){
  fit();ctx.clearRect(0,0,cv.width,cv.height);
  const g=ctx.createLinearGradient(0,0,0,cv.height);g.addColorStop(0,'#f7f8ff');g.addColorStop(1,'#eef0fb');ctx.fillStyle=g;ctx.fillRect(0,0,cv.width,cv.height);
  if(!T||!T.length)return;
  const cY=Math.cos(yaw),sY=Math.sin(yaw),cP=Math.cos(pitch),sP=Math.sin(pitch);
  const R=v=>{const x1=v.x*cY-v.y*sY,y1=v.x*sY+v.y*cY,z1=v.z;const y2=y1*cP-z1*sP,z2=y1*sP+z1*cP;return{x:x1,y:y2,z:z2};};
  const SN=waferSmoothNormals(T);
  let mnx=1/0,mxx=-1/0,mnz=1/0,mxz=-1/0;const RT=[];
  for(const t of T){const r=[R(t[0]),R(t[1]),R(t[2])];RT.push(r);for(const p of r){mnx=Math.min(mnx,p.x);mxx=Math.max(mxx,p.x);mnz=Math.min(mnz,p.z);mxz=Math.max(mxz,p.z);}}
  const sc=Math.min(cv.width/(mxx-mnx||1),cv.height/(mxz-mnz||1))*0.72*waferZoom;
  const ox=cv.width/2-(mnx+mxx)/2*sc,oz=cv.height/2+(mnz+mxz)/2*sc;
  const idx=RT.map((r,i)=>[i,(r[0].y+r[1].y+r[2].y)/3]).sort((a,b)=>a[1]-b[1]);
  const Lt={x:-0.32,y:-0.55,z:0.77};ctx.lineJoin='round';
  for(const[i]of idx){const r=RT[i];const sn=R(SN[i]);
    const dif=Math.abs(sn.x*Lt.x+sn.y*Lt.y+sn.z*Lt.z),I=0.42+0.58*dif;
    const spec=Math.pow(dif,18)*60; // лёгкий блик
    const col=`rgb(${Math.min(255,Math.round(118+96*I+spec))},${Math.min(255,Math.round(140+95*I+spec))},${Math.min(255,Math.round(176+78*I+spec))})`;
    ctx.fillStyle=col;ctx.strokeStyle=col;ctx.lineWidth=0.7; // обводка тем же цветом убирает швы
    ctx.beginPath();ctx.moveTo(ox+r[0].x*sc,oz-r[0].z*sc);ctx.lineTo(ox+r[1].x*sc,oz-r[1].z*sc);ctx.lineTo(ox+r[2].x*sc,oz-r[2].z*sc);ctx.closePath();ctx.fill();ctx.stroke();}
}
function waferAnim(){if(step!=='wafer'){waferRAF=null;return;}if(waferSpin&&!waferDrag)waferYaw+=0.009;if(waferMesh)drawWafer3D(waferMesh,waferYaw,waferPitch);waferRAF=requestAnimationFrame(waferAnim);}
function exportSTL(){const buf=waferSTL(waferMesh||buildWaferMesh());const a=document.createElement('a');
  a.download='ОРТОС_сплинт_'+(patient.name||'пациент')+'.stl';a.href=URL.createObjectURL(new Blob([buf],{type:'model/stl'}));a.click();}

// ═══ 3D-реконструкция черепа из МСКТ: сегментация кости (Surface Nets) +
// перемещение подвижных сегментов по плану, просмотр «до → после» ═══
const SKULL_ISO=300; // порог кости (HU): кортикаль + зубы
// прореживание объёма max-pool'ом (тонкая кортикаль не выпадает в дыры)
function downsampleVol(v,targetMax){
  const [nx,ny,nz]=v.dims,D=v.data;
  const sxS=Math.max(1,Math.ceil(nx/targetMax)),syS=Math.max(1,Math.ceil(ny/targetMax)),szS=Math.max(1,Math.ceil(nz/targetMax));
  const dx=Math.ceil(nx/sxS),dy=Math.ceil(ny/syS),dz=Math.ceil(nz/szS);
  const G=new Float32Array(dx*dy*dz);G.fill(-32768);
  for(let z=0;z<nz;z++){const oz=(z/szS)|0;for(let y=0;y<ny;y++){const oy=(y/syS)|0,sb=(z*ny+y)*nx,db=(oz*dy+oy)*dx;
    for(let x=0;x<nx;x++){const ox=(x/sxS)|0,val=D[sb+x],di=db+ox;if(val>G[di])G[di]=val;}}}
  return {G,dims:[dx,dy,dz],steps:[sxS,syS,szS]};
}
// Surface Nets (дуальные вершины по ячейкам) — без больших таблиц, явная индексация
function surfaceNets(G,dims,iso){
  const [dx,dy,dz]=dims,at=(x,y,z)=>G[(z*dy+y)*dx+x],sol=(x,y,z)=>at(x,y,z)>=iso;
  const CO=[[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
  const EDG=[[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[4,5],[4,6],[3,7],[5,7],[6,7]];
  const vidx=new Int32Array(dx*dy*dz).fill(-1),V=[],quads=[];
  for(let z=0;z<dz-1;z++)for(let y=0;y<dy-1;y++)for(let x=0;x<dx-1;x++){
    let mask=0;const hv=[];for(let c=0;c<8;c++){const o=CO[c],h=at(x+o[0],y+o[1],z+o[2]);hv.push(h);if(h>=iso)mask|=1<<c;}
    if(mask===0||mask===255)continue;
    let px=0,py=0,pz=0,ne=0;
    for(const[a,b]of EDG){const ha=hv[a],hb=hv[b];if((ha>=iso)===(hb>=iso))continue;
      const t=(iso-ha)/((hb-ha)||1e-6),oa=CO[a],ob=CO[b];
      px+=oa[0]+t*(ob[0]-oa[0]);py+=oa[1]+t*(ob[1]-oa[1]);pz+=oa[2]+t*(ob[2]-oa[2]);ne++;}
    const vi=V.length;V.push({x:x+px/ne,y:y+py/ne,z:z+pz/ne});vidx[(z*dy+y)*dx+x]=vi;
    const c0=sol(x,y,z),gi=(xx,yy,zz)=>vidx[(zz*dy+yy)*dx+xx];
    if(c0!==sol(x+1,y,z)&&y>0&&z>0){const b=gi(x,y-1,z),c=gi(x,y-1,z-1),d=gi(x,y,z-1);if(b>=0&&c>=0&&d>=0)quads.push(c0?[vi,b,c,d]:[vi,d,c,b]);}
    if(c0!==sol(x,y+1,z)&&x>0&&z>0){const b=gi(x,y,z-1),c=gi(x-1,y,z-1),d=gi(x-1,y,z);if(b>=0&&c>=0&&d>=0)quads.push(c0?[vi,b,c,d]:[vi,d,c,b]);}
    if(c0!==sol(x,y,z+1)&&x>0&&y>0){const b=gi(x,y-1,z),c=gi(x-1,y-1,z),d=gi(x-1,y,z);if(b>=0&&c>=0&&d>=0)quads.push(c0?[vi,b,c,d]:[vi,d,c,b]);}
  }
  const T=[];for(const q of quads){T.push([q[0],q[1],q[2]]);T.push([q[0],q[2],q[3]]);}
  return {V,T};
}
// компоненты связности: оставить крупные костные массивы (череп + н/ч),
// убрать мелкий мусор и ПЛАСТИНЧАТЫЕ объекты (стол/подголовник КТ, срез-артефакты)
function pruneComponents(V,T){
  const nv=V.length,par=new Int32Array(nv);for(let i=0;i<nv;i++)par[i]=i;
  const find=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x];}return x;};
  const uni=(a,b)=>{const ra=find(a),rb=find(b);if(ra!==rb)par[ra]=rb;};
  for(const[a,b,c]of T){uni(a,b);uni(b,c);}
  // по каждому компоненту: число вершин + габаритный бокс (на grid-координатах V)
  const comp=new Map();
  for(let i=0;i<nv;i++){const r=find(i),v=V[i];let e=comp.get(r);
    if(!e){e={n:0,x0:1e9,x1:-1e9,y0:1e9,y1:-1e9,z0:1e9,z1:-1e9};comp.set(r,e);}
    e.n++;if(v.x<e.x0)e.x0=v.x;if(v.x>e.x1)e.x1=v.x;if(v.y<e.y0)e.y0=v.y;if(v.y>e.y1)e.y1=v.y;if(v.z<e.z0)e.z0=v.z;if(v.z>e.z1)e.z1=v.z;}
  let big=0;for(const e of comp.values())if(e.n>big)big=e.n;
  const isPlate=e=>{const d=[e.x1-e.x0,e.y1-e.y0,e.z1-e.z0].sort((a,b)=>a-b);return d[0]<0.14*d[2];};
  const okRoot=new Set();
  for(const[r,e]of comp){ if(e.n===big){okRoot.add(r);continue;}           // череп — всегда
    if(e.n>=0.2*big && !isPlate(e))okRoot.add(r); }                        // крупная кость (н/ч), но не пластина
  const keep=new Int32Array(nv).fill(-1),NV=[];
  for(let i=0;i<nv;i++)if(okRoot.has(find(i))){keep[i]=NV.length;NV.push(V[i]);}
  const NT=[];for(const[a,b,c]of T)if(keep[a]>=0&&keep[b]>=0&&keep[c]>=0)NT.push([keep[a],keep[b],keep[c]]);
  return {V:NV,T:NT};
}
// сглаживание Тобина (λ/μ) — убирает «лесенку» вокселей без усадки
function taubin(V,T,iters){
  const nv=V.length,adj=Array.from({length:nv},()=>new Set());
  for(const t of T){const[a,b,c]=t;adj[a].add(b);adj[a].add(c);adj[b].add(a);adj[b].add(c);adj[c].add(a);adj[c].add(b);}
  const A=adj.map(s=>[...s]),tmp=new Array(nv);
  const pass=lam=>{for(let i=0;i<nv;i++){const ns=A[i],n=ns.length;if(!n){tmp[i]={...V[i]};continue;}
    let sx=0,sy=0,sz=0;for(const k of ns){sx+=V[k].x;sy+=V[k].y;sz+=V[k].z;}
    tmp[i]={x:V[i].x+lam*(sx/n-V[i].x),y:V[i].y+lam*(sy/n-V[i].y),z:V[i].z+lam*(sz/n-V[i].z)};}
    for(let i=0;i<nv;i++)V[i]=tmp[i];};
  for(let i=0;i<iters;i++){pass(0.5);pass(-0.53);}
}
// нормали по вершинам (усреднение нормалей треугольников)
function vertNormals(V,T){
  const N=V.map(()=>({x:0,y:0,z:0}));
  for(const[a,b,c]of T){const A=V[a],B=V[b],C=V[c];
    const ux=B.x-A.x,uy=B.y-A.y,uz=B.z-A.z,vx=C.x-A.x,vy=C.y-A.y,vz=C.z-A.z;
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    for(const i of[a,b,c]){N[i].x+=nx;N[i].y+=ny;N[i].z+=nz;}}
  for(const p of N){const l=Math.hypot(p.x,p.y,p.z)||1;p.x/=l;p.y/=l;p.z/=l;}return N;
}
// карта вершины (рендер-координаты) ↔ пиксели ТРГ: px_u = AP (v.x), px_v = (H-1) - SI (v.z)
// сегментация вершин по ориентирам: 0 неподвижно · 1 в/ч · 2 н/ч · 3 подбородок
function segmentSkull(V){
  const seg=new Uint8Array(V.length);const {H,V:Vv}=axes(),s=scale||1,up=mul(Vv,-1);
  if(!(LM.ANS&&LM.PNS&&LM.U1t))return seg; // недостаточно ориентиров
  const lfA=add(LM.ANS,mul(up,3*s));                               // линия Le Fort I
  const occ=LM.L1t?mul(add(LM.U1t,LM.L1t),0.5):LM.U1t;             // окклюзионная плоскость
  const go=LM.Go||LM.Ar, me=LM.Me||LM.Gn||LM.Pog;
  const genBase=LM.L1a?add(LM.L1a,mul(Vv,7*s)):(me?add(me,mul(up,4*s)):null); // линия гениопластики
  const H2=skullMesh?skullMesh.H:(img?img.height:0);
  for(let i=0;i<V.length;i++){const v=V[i],p={x:v.x,y:(H2-1)-v.z};
    const belowLF=dot(sub(p,lfA),Vv)>0, aboveOcc=dot(sub(p,occ),Vv)<0, belowOcc=!aboveOcc;
    const antPNS=dot(sub(p,LM.PNS),H)>-3*s, antGo=go?dot(sub(p,go),H)>-1*s:true;
    if(belowLF&&aboveOcc&&antPNS){seg[i]=1;continue;}               // верхняя челюсть
    if(belowOcc&&antGo){seg[i]=2;                                    // нижняя челюсть
      if(genBase&&dot(sub(p,genBase),Vv)>0&&dot(sub(p,genBase),H)>-12*s)seg[i]=3;} // подбородок
  }
  return seg;
}
// жёсткие преобразования сегментов (та же математика, что в planned())
function skullSegTx(){
  const {H,V:Vv}=axes(),s=scale||1;
  const mxT=add(mul(H,plan.mxAdv*s),mul(Vv,-plan.mxImp*s)),mdT=mul(H,plan.mdAdv*s),chT=add(mul(H,plan.chAdv*s),mul(Vv,plan.chVert*s));
  const mdR=plan.autorot?(plan.mxImp*1.1):plan.mdRot,pMx=LM.PNS||LM.ANS||LM.A,pMd=LM.Ar||LM.Go;
  return {1:p=>add(pMx?rot(p,pMx,d2r(plan.mxPitch)):p,mxT),
          2:p=>add(pMd?rot(p,pMd,d2r(mdR)):p,mdT),
          3:p=>add(add(pMd?rot(p,pMd,d2r(mdR)):p,mdT),chT)};
}
function buildSkull(){
  if(!vol||!img)return null;
  const tgt=96,ds=downsampleVol(vol,tgt),raw=surfaceNets(ds.G,ds.dims,SKULL_ISO);
  if(raw.V.length<50)return null;
  const {V,T}=pruneComponents(raw.V,raw.T); // убрать осколки/стол КТ (мелкие + пластинчатые)
  if(V.length<50)return null;
  taubin(V,T,4);
  // грид-координаты → рендер-пиксели: x=AP(px_u), y=глубина(ЛП), z=SI
  const [sxS,syS,szS]=ds.steps,[sx,sy,sz]=vol.spacing,s=scale||1;
  const V0=V.map(p=>({x:p.y*syS*sy*s, y:p.x*sxS*sx*s, z:p.z*szS*sz*s}));
  const N=vertNormals(V0,T);
  skullMesh={V0,T,N,H:img.height,seg:null,tri:T.length};
  skullMesh.seg=segmentSkull(V0);
  return skullMesh;
}
// позиции вершин при морфинге t (0 исходное → 1 после плана)
function skullMoved(t){
  const M=skullMesh,tx=skullSegTx(),H=M.H,out=new Array(M.V0.length);
  for(let i=0;i<M.V0.length;i++){const v=M.V0[i],sg=M.seg[i];
    if(!sg||t<=0){out[i]=v;continue;}
    const p={x:v.x,y:(H-1)-v.z},q=tx[sg](p);                  // ceph-пиксель → после плана
    const fx=v.x+(q.x-p.x)*t, fpy=p.y+(q.y-p.y)*t;            // лерп в пиксельном пространстве
    out[i]={x:fx, y:v.y, z:(H-1)-fpy};}                        // обратно в рендер (глубина v.y без изменений)
  return out;
}
const SEG_COL=[[222,220,210],[108,124,255],[24,195,182],[160,91,255]]; // кость · в/ч · н/ч · подбородок
function drawSkull3D(yaw,pitch,t){
  fit();ctx.clearRect(0,0,cv.width,cv.height);
  const g=ctx.createLinearGradient(0,0,0,cv.height);g.addColorStop(0,'#f7f8ff');g.addColorStop(1,'#eef0fb');ctx.fillStyle=g;ctx.fillRect(0,0,cv.width,cv.height);
  const M=skullMesh;if(!M)return;const Vm=skullMoved(t),T=M.T,N=M.N,seg=M.seg;
  const cY=Math.cos(yaw),sY=Math.sin(yaw),cP=Math.cos(pitch),sP=Math.sin(pitch);
  const R=v=>{const x1=v.x*cY-v.y*sY,y1=v.x*sY+v.y*cY,z1=v.z;const y2=y1*cP-z1*sP,z2=y1*sP+z1*cP;return{x:x1,y:y2,z:z2};};
  const PR=new Array(Vm.length);let mnx=1/0,mxx=-1/0,mnz=1/0,mxz=-1/0;
  for(let i=0;i<Vm.length;i++){const r=R(Vm[i]);PR[i]=r;if(r.x<mnx)mnx=r.x;if(r.x>mxx)mxx=r.x;if(r.z<mnz)mnz=r.z;if(r.z>mxz)mxz=r.z;}
  const sc=Math.min(cv.width/(mxx-mnx||1),cv.height/(mxz-mnz||1))*0.82*skullZoom;
  const ox=cv.width/2-(mnx+mxx)/2*sc,oz=cv.height/2+(mnz+mxz)/2*sc;
  const ord=T.map((t2,i)=>[i,(PR[t2[0]].y+PR[t2[1]].y+PR[t2[2]].y)/3]).sort((a,b)=>a[1]-b[1]);
  const Lt={x:-0.3,y:-0.5,z:0.81};ctx.lineJoin='round';
  for(const[i]of ord){const tr=T[i],A=PR[tr[0]],B=PR[tr[1]],C=PR[tr[2]];
    const na=N[tr[0]],nb=N[tr[1]],nc=N[tr[2]],nav={x:na.x+nb.x+nc.x,y:na.y+nb.y+nc.y,z:na.z+nb.z+nc.z};
    const rn=R(nav),rl=Math.hypot(rn.x,rn.y,rn.z)||1,dif=Math.abs((rn.x*Lt.x+rn.y*Lt.y+rn.z*Lt.z)/rl),I=0.46+0.54*dif,spec=Math.pow(dif,16)*42;
    const sg=Math.max(seg[tr[0]],seg[tr[1]],seg[tr[2]]),bc=SEG_COL[sg];
    const col=`rgb(${Math.min(255,Math.round(bc[0]*(0.45+0.55*I)+spec))},${Math.min(255,Math.round(bc[1]*(0.45+0.55*I)+spec))},${Math.min(255,Math.round(bc[2]*(0.45+0.55*I)+spec))})`;
    ctx.fillStyle=col;ctx.strokeStyle=col;ctx.lineWidth=0.6;
    ctx.beginPath();ctx.moveTo(ox+A.x*sc,oz-A.z*sc);ctx.lineTo(ox+B.x*sc,oz-B.z*sc);ctx.lineTo(ox+C.x*sc,oz-C.z*sc);ctx.closePath();ctx.fill();ctx.stroke();}
}
function renderSkull(){
  if(!skullMesh&&!skullBuilding){skullBuilding=true;loadBar(0.3,'Строю 3D-реконструкцию…');
    setTimeout(()=>{try{buildSkull();}catch(e){console.error(e);}skullBuilding=false;loadBar(null);render();},30);
    fit();ctx.clearRect(0,0,cv.width,cv.height);const g=ctx.createLinearGradient(0,0,0,cv.height);g.addColorStop(0,'#f7f8ff');g.addColorStop(1,'#eef0fb');ctx.fillStyle=g;ctx.fillRect(0,0,cv.width,cv.height);updateBadge();return;}
  if(!skullMesh){updateBadge();return;}
  drawSkull3D(skullYaw,skullPitch,overlay);
  const b=$('badge');b.innerHTML=`<span class="chip">3D-череп · <b>${(skullMesh.tri/1000|0)}k треуг.</b></span><span class="chip">до ↔ после: <b>${Math.round(overlay*100)}%</b></span>`;
}

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
    if(len===0xFFFFFFFF){
      if(g===0x7FE0&&e===0x0010){ // инкапсулированные (сжатые) пиксели: таблица смещений + фрагменты
        let dg=dv.getUint16(o,true),de=dv.getUint16(o+2,true),dl=dv.getUint32(o+4,true);o+=8;
        if(dg===0xFFFE&&de===0xE000)o+=dl; // пропустить Basic Offset Table
        const frags=[];
        while(o+8<=N){ dg=dv.getUint16(o,true);de=dv.getUint16(o+2,true);dl=dv.getUint32(o+4,true);o+=8;
          if(dg===0xFFFE&&de===0xE0DD)break; if(dg===0xFFFE&&de===0xE000){frags.push(new Uint8Array(buf,o,dl));o+=dl;} else break; }
        let tot=0;frags.forEach(fr=>tot+=fr.length);const enc=new Uint8Array(tot);let p=0;frags.forEach(fr=>{enc.set(fr,p);p+=fr.length;});
        T.encoded=enc;break;
      }
      while(o+8<=N){const dg=dv.getUint16(o,true),de=dv.getUint16(o+2,true),dl=dv.getUint32(o+4,true);o+=8;if(dg===0xFFFE&&de===0xE0DD)break;if(dg===0xFFFE&&de===0xE000&&dl!==0xFFFFFFFF)o+=dl;}continue;}
    const off=o;o+=len;const tag=((g<<16)|e)>>>0;
    if(g===0x0002&&e===0x0010){T.ts=rs(off,len);implicit=(T.ts==='1.2.840.10008.1.2');}
    else if(tag===0x00280010)T.rows=dv.getUint16(off,true);else if(tag===0x00280011)T.cols=dv.getUint16(off,true);
    else if(tag===0x00280002)T.samples=dv.getUint16(off,true);
    else if(tag===0x00280030)T.ps=rs(off,len).split('\\').map(Number);else if(tag===0x00180050)T.thick=parseFloat(rs(off,len))||0;
    else if(tag===0x00200032)T.ipp=rs(off,len).split('\\').map(Number);else if(tag===0x00281053)T.slope=parseFloat(rs(off,len))||1;
    else if(tag===0x00281052)T.intercept=parseFloat(rs(off,len))||0;else if(tag===0x00280100)T.bits=dv.getUint16(off,true);
    else if(tag===0x00280103)T.rep=dv.getUint16(off,true);else if(tag===0x00200013)T.inst=parseInt(rs(off,len))||0;
    else if(tag===0x0020000E)T.series=rs(off,len);else if(tag===0x00181210)T.kernel=rs(off,len);else if(tag===0x0008103E)T.desc=rs(off,len);
    else if(tag===0x7FE00010){T.pixOff=off;T.pixLen=len;break;}
  }
  if(!T.rows||!T.cols)return null;
  const n=T.rows*T.cols,bits=T.bits||16,rep=T.rep||0,sm=T.samples||1;
  const meta={rows:T.rows,cols:T.cols,ps:T.ps||[1,1],thick:T.thick||1,ipp:T.ipp||[0,0,T.inst||0],slope:T.slope||1,intercept:T.intercept||0,inst:T.inst||0,
    series:T.series||'',kernel:T.kernel||'',desc:T.desc||''};
  if(T.encoded){ return {...meta,compressed:true,ts:T.ts,encoded:T.encoded,bits,rep,samples:sm}; } // декодируется в loadDicom (async)
  if(T.pixOff==null)return null;
  const px=new Int16Array(n);
  if(bits<=8){for(let i=0;i<n;i++)px[i]=dv.getUint8(T.pixOff+i*sm);}
  else if(rep===1){for(let i=0;i<n;i++)px[i]=dv.getInt16(T.pixOff+i*sm*2,true);}
  else{for(let i=0;i<n;i++)px[i]=dv.getUint16(T.pixOff+i*sm*2,true);}
  return {...meta,px};
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
// прогресс-бар загрузки
function loadBar(frac,label){let el=$('loadbar');
  if(!el){el=document.createElement('div');el.id='loadbar';el.className='loadbar';
    el.innerHTML='<div class="lb-card"><div class="lb-title"></div><div class="lb-track"><div class="lb-fill"></div></div><div class="lb-pct"></div></div>';
    $('stage').appendChild(el);}
  if(frac==null){el.remove();return;}
  el.querySelector('.lb-title').textContent=label||'Загрузка…';
  el.querySelector('.lb-fill').style.width=Math.round(frac*100)+'%';
  el.querySelector('.lb-pct').textContent=Math.round(frac*100)+'%';
}
// выбор одной серии (без смешивания костного/мягкотканного кернелов → без полос)
function pickSeries(slices){
  const groups={}; slices.forEach(s=>{(groups[s.series||'_']=groups[s.series||'_']||[]).push(s);});
  const keys=Object.keys(groups); if(keys.length<=1)return{sl:slices,multi:false,info:''};
  const bone=k=>/bone|sharp|lung|b[6-8]\d|h[6-8]\d|y[6-8]\d|edge|детал|кост/i.test((groups[k][0].kernel||'')+' '+(groups[k][0].desc||''));
  // предпочесть НЕ костную серию с наибольшим числом срезов
  keys.sort((a,b)=>(bone(a)-bone(b))||(groups[b].length-groups[a].length));
  const best=keys[0],g=groups[best];
  return{sl:g,multi:true,info:(g[0].desc||g[0].kernel||'серия')+' · '+g.length+' срезов (из '+keys.length+' серий)'};
}
async function loadDicom(files){
  const arr=[...files].filter(f=>/\.dcm$/i.test(f.name)||!/\.[a-z0-9]+$/i.test(f.name));
  if(!arr.length){toast('В папке нет файлов DICOM (.dcm).');return;}
  building=true; loadBar(0,'Чтение DICOM… 0/'+arr.length); render();
  const slices=[]; const codec={}; let done=0, bad=0;
  for(const f of arr){
    try{ const b=await f.arrayBuffer(); const s=parseDcm(b);
      if(s&&s.compressed){ // сжатый кадр — декодируем (RLE/JPEG/JPEG-LS/JPEG2000)
        try{ s.px=await DCMDecode.decodeFrame(s.ts,s.encoded,{rows:s.rows,cols:s.cols,bitsAllocated:s.bits,pixelRep:s.rep,samples:s.samples});
          delete s.encoded; slices.push(s); }
        catch(e2){ codec[(window.DCMDecode?DCMDecode.codecName(s.ts):s.ts)||'сжатие']=1; bad++; } }
      else if(s)slices.push(s); else bad++;
    }catch(err){ bad++; }
    done++; if(done%2===0||done===arr.length){ loadBar(0.85*done/arr.length,'Чтение DICOM… '+done+'/'+arr.length); await new Promise(r=>setTimeout(r)); }
  }
  if(slices.length<3){ building=false; loadBar(null);
    const cn=Object.keys(codec);
    if(cn.length) alert('Не удалось декодировать сжатую серию ('+cn.join(', ')+'). Попробуйте выгрузить серию без сжатия из ВИДАР/RadiAnt.');
    else alert('Не удалось собрать объём из этой серии ('+slices.length+' валидных срезов из '+arr.length+').');
    render(); return; }
  loadBar(0.88,'Выбор серии…'); await new Promise(r=>setTimeout(r));
  const chosen=pickSeries(slices);
  loadBar(0.92,'Сборка объёма…'); await new Promise(r=>setTimeout(r));
  vol=assembleVolume(chosen.sl); building=false;
  if(!vol){ loadBar(null); alert('Не удалось собрать объём из серии.'); render(); return; }
  loadBar(0.97,'Построение ТРГ…'); await new Promise(r=>setTimeout(r));
  const drr=buildLateralDRR(vol);const im=new Image();
  im.onload=()=>{ img=im; scale=1/drr.mpp; loadBar(null); autoView(); setStep('points');
    toast('ТРГ построена ('+vol.dims[2]+' срезов'+(chosen.multi?', 1 серия':'')+'). Масштаб '+scale.toFixed(2)+' px/мм.'+(chosen.multi?' · '+chosen.info:'')); };
  im.src=drr.canvas.toDataURL('image/png');
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
  if(step==='plan'&&planView==='skull3d'&&vol&&img){ $('empty').style.display='none'; renderSkull(); return; }
  fit();ctx.clearRect(0,0,cv.width,cv.height);
  const showPhoto=(step==='photo'&&photo);
  const pic=showPhoto?photo:img;
  const planWarp=(step==='plan'&&img&&anyMove());
  if(pic){ctx.imageSmoothingEnabled=true;
    if(showPhoto){const pw=photo.naturalWidth||photo.width,ph=photo.naturalHeight||photo.height;
      const z=Math.min(cv.width/pw,cv.height/ph)*0.92;photoView={z,ox:(cv.width-pw*z)/2,oy:(cv.height-ph*z)/2};
      const morph=anyMove()&&photoCorr().src.length>=2;
      if(morph){ if(photoWarpDirty||!photoWarpCv){photoWarpCv=buildPhotoWarp();photoWarpDirty=false;}
        ctx.drawImage(photo,photoView.ox,photoView.oy,pw*z,ph*z); // «до» (база)
        if(photoWarpCv){ctx.globalAlpha=photoOverlay;ctx.drawImage(photoWarpCv,photoView.ox,photoView.oy,pw*z,ph*z);ctx.globalAlpha=1;} // «после» поверх с прозрачностью (кроссфейд)
      } else ctx.drawImage(photo,photoView.ox,photoView.oy,pw*z,ph*z); }
    else if(planWarp){ if(warpDirty||!warpCv){warpCv=buildWarp();warpDirty=false;}
      ctx.drawImage(img,view.ox,view.oy,img.width*view.zoom,img.height*view.zoom); // «до» (база)
      if(warpCv){ctx.globalAlpha=overlay;ctx.drawImage(warpCv,view.ox,view.oy,img.width*view.zoom,img.height*view.zoom);ctx.globalAlpha=1;} } // «после» поверх (кроссфейд)
    else ctx.drawImage(img,view.ox,view.oy,img.width*view.zoom,img.height*view.zoom);}
  $('empty').style.display=(img||photo||building)?'none':'';
  $('shimmerWrap')&&0;
  // шиммер при построении
  let sh=document.querySelector('.shimmer'); if(building&&!sh){sh=document.createElement('div');sh.className='shimmer';$('stage').appendChild(sh);} if(!building&&sh)sh.remove();
  if(showPhoto){
    const toP=p=>({x:photoView.ox+p.x*photoView.z,y:photoView.oy+p.y*photoView.z});
    const pa=anyMove()?photoAfter():null;
    if(pa)pa.ids.forEach(id=>{const S=toP(photoLM[id]),A=toP(pa.after[id]);ctx.strokeStyle='#18c3b6';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(S.x,S.y);ctx.lineTo(A.x,A.y);ctx.stroke();
      ctx.beginPath();ctx.arc(A.x,A.y,3,0,7);ctx.fillStyle='#18c3b6';ctx.fill();});
    PHOTO_SET.forEach(id=>{ if(!photoLM[id])return; const S=toP(photoLM[id]),cur=(id===photoPick);
      ctx.beginPath();ctx.arc(S.x,S.y,cur?6:4,0,7);ctx.fillStyle=cur?'#ffb020':'#8a63ff';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();
      ctx.fillStyle='#fff';ctx.font='700 12px Inter,sans-serif';ctx.save();ctx.strokeStyle='#1a1f33';ctx.lineWidth=3;ctx.strokeText(LBL[id].abbr,S.x+7,S.y-6);ctx.fillText(LBL[id].abbr,S.x+7,S.y-6);ctx.restore();});
    updateBadge(); return; }
  if(!img) { updateBadge(); return; }
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
    if(!photo){
      p.innerHTML=`<div class="card view"><h3>📷 Фото профиля</h3>
        <div class="desc">Загрузите фотографию <b>профиля</b> пациента (естественное положение головы, та же сторона, что и ТРГ — лицом вправо). По ней построим прогноз профиля после операции.</div>
        <button class="btn" id="loadPhoto">📷 Загрузить фото профиля</button>
        <div class="note">Затем вы отметите на фото мягкотканные точки (те же, что на ТРГ) — программа привяжет фото к плану и покажет «до → после».</div></div>`;
      $('loadPhoto').onclick=()=>$('photoInput').click(); return;
    }
    if(!photoPick) photoPick = PHOTO_SET.find(id=>!photoLM[id]) || PHOTO_SET[0];
    const l=LBL[photoPick], idx=PHOTO_SET.indexOf(photoPick)+1, nPlaced=PHOTO_SET.filter(id=>photoLM[id]).length;
    const onTrg=PHOTO_SET.filter(id=>LM[id]).length, corr=photoCorr().src.length, moved=anyMove();
    const rows=PHOTO_SET.map(id=>{const L=LBL[id];return `<div class="lm${id===photoPick?' cur':''}${photoLM[id]?' ok':''}" data-k="${id}"><span class="ck">${photoLM[id]?'✓':'○'}</span><span class="t">${L.abbr} <small>· ${L.ru.replace(' (мягк. ткани)','')}</small></span></div>`;}).join('');
    p.innerHTML=`<div class="hint-card view">
        <div class="hint-ill">${window.skullSVG(photoPick)}</div>
        <div class="hint-body"><div class="pt">${l.abbr} <span class="ru">— ${l.ru}</span></div>
          <div class="txt">${l.hint}</div>
          <div class="nav"><button class="btn ghost sm" id="prevPh">← Назад</button><button class="btn sm" id="nextPh" style="width:auto">Пропустить →</button><span class="idx">${idx} / ${PHOTO_SET.length}</span></div>
        </div></div>
      <div class="card view"><div class="sect-label">Мягкотканные точки на фото (${nPlaced}/${PHOTO_SET.length})</div>
        <div class="lm-list">${rows}</div>
        <div class="slider-row" style="margin-top:12px"><label>Исходное ↔ прогноз</label><input type="range" id="phOv" min="0" max="1" step="0.05" value="${photoOverlay}"><span class="val">${moved?'морф':'—'}</span></div>
        <div class="${corr>=2&&moved?'mode-chip ok':'mode-chip warn'}" style="margin-top:4px">${
          corr>=2&&moved ? '✓ Прогноз профиля построен по плану ('+corr+ ' опорных точек). Двигайте «до ↔ прогноз».'
          : (corr<2 ? 'Отметьте ≥2 точек и на фото, и на ТРГ (сейчас: фото '+nPlaced+', ТРГ '+onTrg+').' : 'Задайте перемещения на шаге «План» — и профиль на фото изменится.')}</div>
        <div class="btn-row"><button class="btn sm" id="phPng" style="width:100%">⬇ Фото до→после (PNG)</button></div>
        <div class="btn-row"><button class="btn ghost sm" id="clrPh" style="width:49%">Очистить точки</button><button class="btn ghost sm" id="delPhoto" style="width:49%">Удалить фото</button></div>
        <div class="note">Кликните точку слева, затем поставьте её на фото (можно перетащить). Прогноз = перемещения мягких тканей из плана, перенесённые на фото по вашим опорным точкам.</div></div>`;
    $('prevPh').onclick=()=>{const i=PHOTO_SET.indexOf(photoPick);photoPick=PHOTO_SET[(i-1+PHOTO_SET.length)%PHOTO_SET.length];renderPanel();render();};
    $('nextPh').onclick=()=>advancePhotoPick();
    $('phOv').oninput=e=>{photoOverlay=+e.target.value;render();};
    $('clrPh').onclick=()=>{photoLM={};photoPick=PHOTO_SET[0];invalidatePhotoWarp();renderPanel();render();};
    $('delPhoto').onclick=()=>{photo=null;photoLM={};renderPanel();render();};
    $('phPng').onclick=()=>{const a=document.createElement('a');a.download='ОРТОС_профиль_до-после.png';a.href=cv.toDataURL('image/png');a.click();};
    p.querySelectorAll('.lm').forEach(rw=>rw.onclick=()=>{photoPick=rw.dataset.k;renderPanel();render();});
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
        ${vol?`<div class="grp2"><h4>Контроль результата</h4>
          <div class="seg-toggle">
            <button class="seg-btn${planView==='trg'?' on':''}" data-pv="trg">ТРГ (профиль)</button>
            <button class="seg-btn${planView==='skull3d'?' on':''}" data-pv="skull3d">3D-череп (МСКТ)</button></div>
          ${planView==='skull3d'?'<div class="note" style="margin-top:6px">3D-реконструкция кости из МСКТ. Цветом — перемещаемые сегменты: <b style="color:#5b6cff">в/ч (Le Fort I)</b>, <b style="color:#18c3b6">н/ч (BSSO)</b>, <b style="color:#a05bff">подбородок</b>. 🖱 вращение — тяни мышью, зум — колесо. Сегментация по ориентирам — схематична.</div>':''}</div>`:''}
        <div class="slider-row"><label>До ↔ После</label><input type="range" id="ov" min="0" max="1" step="0.05" value="${overlay}"><span class="val">морф</span></div>
        <button class="btn ghost" id="resetPlan">Сбросить перемещения</button></div>
      <div class="card view"><div class="sect-label">Сводка и анализ до → после</div><div id="rep"></div>
        <div class="btn-row"><button class="btn" id="toWafer" style="width:100%">🖨️ Сформировать шаблон (сплинт) →</button></div>
        <div class="btn-row"><button class="btn sm ghost" id="expPng" style="width:100%">⬇ План (PNG)</button></div></div>`;
    bindSliders(); if($('autorot'))$('autorot').onchange=e=>{plan.autorot=e.target.checked;invalidateWarp();invalidatePhotoWarp();waferMesh=null;render();renderPanel();};
    $('ov').oninput=e=>{overlay=+e.target.value;render();};
    p.querySelectorAll('[data-pv]').forEach(b=>b.onclick=()=>{planView=b.dataset.pv;renderPanel();render();});
    $('resetPlan').onclick=()=>{plan={mxAdv:0,mxImp:0,mxPitch:0,mdAdv:0,mdRot:0,chAdv:0,chVert:0,autorot:false};invalidateWarp();invalidatePhotoWarp();waferMesh=null;renderPanel();render();};
    $('toWafer').onclick=()=>setStep('wafer');
    $('expPng').onclick=exportPng; renderReport($('rep'));
  }
  else if(step==='wafer'){
    if(!img){ p.innerHTML=emptyStepCard('Нет данных','Постройте ТРГ, расставьте точки и спланируйте перемещения.'); return; }
    waferMesh=buildWaferMesh(); // строим до панели, чтобы знать режим (КТ/параметрический)
    const stepAP=waferStepAP(), isSTL=(wafer.src==='stl'), isCT=(wafer.src==='ct'), real=(isSTL||isCT);
    const dg = isSTL?(wafer.stlDiag||{}):(wafer.ctDiag||{});
    const wsl=(k,label,mn,mx,st,u)=>`<div class="slider-row"><label>${label}</label><input type="range" id="w_${k}" min="${mn}" max="${mx}" step="${st}" value="${wafer[k]}"><span class="val" id="wv_${k}">${wafer[k]}${u}</span></div>`;
    const modeChip = isSTL
      ? `<div class="mode-chip ok">✓ Ложа и стенки — <b>по STL-сканам</b> (реальные окклюзионные поверхности зубов: бугры/фиссуры/режущие края; дуга ${dg.span} мм; стенки ≈${dg.wall} мм; покрытие ${dg.coverage}%)${dg.orient&&dg.orient!=='как есть'?' · <b>сканы автоматически сориентированы</b>':''}</div>`
      : isCT
      ? `<div class="mode-chip ok">✓ Дуга, ложа и <b>стенки — по МСКТ</b> (сегментация эмали + боковых поверхностей коронок; дуга ${dg.span} мм; стенки ≈${dg.wall} мм; покрытие ${dg.coverage}%)</div>`
      : `<div class="mode-chip warn">⚠ Параметрическая дуга${dg.reason?' — '+dg.reason:''}. Для точного отпечатка загрузите STL-сканы зубных рядов или дентальный CBCT.</div>`;
    const stlSection=`<div class="grp2" style="margin-top:12px"><h4>Внутриротовые сканы <span class="tag">STL</span></h4>
        <div class="note" style="margin-bottom:9px">3D-сканы зубных рядов → ложа по <b>реальным</b> поверхностям. Оба скана — в одном положении смыкания, окклюзией вверх (ось Z).</div>
        <div class="btn-row"><button class="btn ${scanU?'ghost':''} sm" id="ldStlU" style="width:49%">${scanU?'✓ В/ч ·'+scanU.tris.length:'⬆ Верхняя (в/ч)'}</button><button class="btn ${scanL?'ghost':''} sm" id="ldStlL" style="width:49%">${scanL?'✓ Н/ч ·'+scanL.tris.length:'⬆ Нижняя (н/ч)'}</button></div>
        ${(scanU||scanL)?'<div class="btn-row"><button class="btn ghost sm" id="clrStl" style="width:100%">Убрать сканы</button></div>':''}</div>`;
    p.innerHTML=`<div class="card view"><h3>🖨️ Хирургический шаблон</h3>
        <div class="desc">Функциональный окклюзионный сплинт: центральные <b>ложа под зубы</b> + буккальные/язычные <b>ретенционные стенки</b> — надевается на зубы в запланированном смыкании и служит интраоперационным <b>ключом окклюзии</b>. Печать на 3D-принтере, формат <b>STL</b>.</div>
        ${modeChip}
        ${stlSection}
        <label class="chk" style="margin-top:8px"><input type="checkbox" id="wCt" ${wafer.ct!==false?'checked':''}> Адаптировать дугу по МСКТ (если нет STL)</label>
        <div class="grp2" style="margin-top:12px"><h4>Тип шаблона</h4>
          <div class="seg-toggle">
            <button class="seg-btn${wafer.type==='inter'?' on':''}" data-t="inter">Промежуточный</button>
            <button class="seg-btn${wafer.type==='final'?' on':''}" data-t="final">Финальный</button></div>
          <div class="note" style="margin-top:6px">${wafer.type==='final'?'Индексирует обе челюсти в итоговом положении (ключ финальной окклюзии).':'Индексирует перемещённую в/ч к исходной н/ч (ставится после Le Fort I).'}</div></div>
        <div class="grp2"><h4>Геометрия дуги ${real?'<span class="tag">запасная</span>':''}</h4>
          ${wsl('archW','Ширина дуги',38,64,1,' мм')}${wsl('archD','Глубина (перёд→моляр)',30,52,1,' мм')}
          ${wsl('height','Высота блока',7,16,0.5,' мм')}${wsl('teeth','Зубных лож',8,16,1,'')}
          ${real?`<div class="note" style="margin-top:4px">В режиме ${isSTL?'STL-сканов':'МСКТ'} форма дуги и ложа берутся из ${isSTL?'сканов':'КТ'}; эти ползунки — для запасного режима.</div>`:''}</div>
        <button class="btn" id="dlStl" style="margin-top:4px">⬇ Скачать STL (для 3D-печати)</button>
        <div class="btn-row"><button class="btn ghost sm" id="snapStl" style="width:100%">⬇ Вид шаблона (PNG)</button></div>
        <div class="note" style="margin-top:6px">🖱 Повернуть — тяните мышью по модели · зум — колесо мыши.</div></div>
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
          : 'Финальный: обе челюсти в итоговом положении — ключ финальной окклюзии.'} ${isSTL?'Окклюзионные поверхности взяты напрямую из STL-сканов зубных рядов.':isCT?'Окклюзионные поверхности сегментированы из МСКТ по плотности.':'Размеры дуги параметрические — подгоните под модель пациента.'} Инструмент планирования, не мед. изделие — проверяйте клинически.</div></div>`;
    $('wCt').onchange=e=>{wafer.ct=e.target.checked;waferMesh=null;renderPanel();render();};
    p.querySelectorAll('.seg-btn').forEach(b=>b.onclick=()=>{wafer.type=b.dataset.t;waferMesh=null;renderPanel();render();});
    ['archW','archD','height','teeth'].forEach(k=>{const el=$('w_'+k);if(!el)return;const u=k==='teeth'?'':' мм';
      el.oninput=e=>{wafer[k]=+e.target.value;$('wv_'+k).textContent=wafer[k]+u;if(wafer.src!=='ct')waferMesh=buildWaferParam();};});
    {const sU=$('ldStlU');if(sU)sU.onclick=()=>$('stlUInput').click();
     const sL=$('ldStlL');if(sL)sL.onclick=()=>$('stlLInput').click();
     const sC=$('clrStl');if(sC)sC.onclick=()=>{scanU=scanL=null;waferMesh=null;renderPanel();render();toast('STL-сканы убраны.');};}
    $('dlStl').onclick=exportSTL;
    $('snapStl').onclick=()=>{const a=document.createElement('a');a.download='ОРТОС_шаблон.png';a.href=cv.toDataURL('image/png');a.click();};
  }
}
function lmRow(id){const l=LBL[id];return `<div class="lm${id===pickId?' cur':''}${LM[id]?' ok':''}" data-k="${id}"><span class="ck">${LM[id]?'✓':'○'}</span><span class="t">${l.abbr} <small>· ${l.ru}</small></span></div>`;}
function anRow(r){const col=r.st==='норма'?'var(--good)':(r.st==='—'?'var(--ink-faint)':'var(--warn)');
  return `<div class="an-row"><span class="k">${r.key}</span><span class="v">${r.val!=null&&!isNaN(r.val)?r.val.toFixed(1):'—'}</span><span class="s" style="color:${col}">${r.st}</span><span class="n">норма ${r.norm}${r.extra?' · '+r.extra:''}</span></div>`;}
function sl(k,label,mn,mx,st,u){return `<div class="slider-row"><label>${label}</label><input type="range" id="s_${k}" min="${mn}" max="${mx}" step="${st}" value="${plan[k]}"><span class="val" id="v_${k}">${fmt(plan[k])}${u}</span></div>`;}
function bindSliders(){['mxAdv','mxImp','mxPitch','mdAdv','mdRot','chAdv','chVert'].forEach(k=>{const el=$('s_'+k);if(!el)return;const u=(k.includes('Pitch')||k.includes('Rot'))?'°':'мм';
  el.oninput=e=>{plan[k]=+e.target.value;$('v_'+k).textContent=fmt(plan[k])+u;invalidateWarp();invalidatePhotoWarp();waferMesh=null;render();renderReport($('rep'));};});}
function renderReport(box){if(!box)return;const mdR=plan.autorot?plan.mxImp*1.1:plan.mdRot;
  const mv=[['Верхняя челюсть (Le Fort I)',`выдв. ${fmt(plan.mxAdv)} · импакция ${fmt(plan.mxImp)} · питч ${fmt(plan.mxPitch)}°`],
    ['Нижняя челюсть (BSSO)',`выдв. ${fmt(plan.mdAdv)} · ротация ${fmt(mdR)}°${plan.autorot?' (авто)':''}`],
    ['Подбородок',`выдв. ${fmt(plan.chAdv)} · вертикаль ${fmt(plan.chVert)}`]];
  const b=analyse(LM),a=analyse(planned());const keep=['SNA, °','SNB, °','ANB, °','Wits, мм','U1–NA, мм','L1–NB, мм','SN–MP, °'];
  box.innerHTML=mv.map(([t,v])=>`<div style="margin-bottom:7px"><div style="font-size:12px;font-weight:700;color:var(--ink)">${t}</div><div style="font-size:12px;color:var(--ink-soft);font-variant-numeric:tabular-nums">${v}</div></div>`).join('')
    +'<div class="sep"></div><div class="sect-label" style="margin:2px 0 8px">Цефалометрия: до → после · норма</div>'
    +keep.map(key=>{const rb=b.find(x=>x.key===key),ra=a.find(x=>x.key===key);
      const vb=rb&&rb.val!=null?rb.val.toFixed(1):'—',va=ra&&ra.val!=null?ra.val.toFixed(1):'—';
      const ok=ra&&ra.st==='норма', na=!ra||ra.val==null;
      const col=na?'var(--ink-faint)':(ok?'var(--good)':'var(--warn)');
      const tag=na?'':(ok?'✓':(ra.st==='ниже'?'↑':'↓'));
      return `<div class="norm-row${ok?' hit':''}"><span class="nk">${key} <small>${ra?ra.norm:''}</small></span>`
        +`<span class="nv">${vb} <span style="color:var(--ink-faint)">→</span> <b style="color:${col}">${va}</b></span>`
        +`<span class="ns" style="color:${col}">${tag}</span></div>`;}).join('');
}
function emptyStepCard(t,d){return `<div class="card view"><h3>${t}</h3><div class="desc">${d}</div><button class="btn" onclick="document.getElementById('dcmInput').click()">🧊 Загрузить МСКТ</button></div>`;}
function esc(s){return(s||'').replace(/"/g,'&quot;');}

// ── шаги ──
function setStep(s){ if(s==='plan')invalidateWarp(); if(s==='wafer')waferMesh=null; if(s==='points'||s==='trg')skullMesh=null; step=s;
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
  if(step==='wafer'){waferSpin=false;waferDrag={sx,sy,yaw:waferYaw,pitch:waferPitch};return;}
  if(step==='plan'&&planView==='skull3d'&&vol&&skullMesh){skullDrag={sx,sy,yaw:skullYaw,pitch:skullPitch};return;}
  if(step==='photo'&&photo){const ip={x:(sx-photoView.ox)/photoView.z,y:(sy-photoView.oy)/photoView.z};
    let b2=null,bd2=14*dpr;PHOTO_SET.forEach(id=>{if(photoLM[id]){const S={x:photoView.ox+photoLM[id].x*photoView.z,y:photoView.oy+photoLM[id].y*photoView.z};const d=Math.hypot(S.x-sx,S.y-sy);if(d<bd2){bd2=d;b2=id;}}});
    if(b2){photoDrag=b2;photoPick=b2;renderPanel();render();return;}
    if(photoPick){photoLM[photoPick]={x:ip.x,y:ip.y};invalidatePhotoWarp();popAt(sx,sy);advancePhotoPick();}return;}
  if(e.button===1||e.shiftKey){pan={sx,sy,ox:view.ox,oy:view.oy};return;}
  if(step!=='points'||!img)return;const ip=toI(sx,sy);
  let best=null,bd=14*dpr;LM_DEF.forEach(l=>{if(LM[l.id]){const S=toS(LM[l.id]);const d=Math.hypot(S.x-sx,S.y-sy);if(d<bd){bd=d;best=l.id;}}});
  if(best){drag=best;pickId=best;renderPanel();render();return;}
  if(pickId){LM[pickId]=ip;popAt(sx,sy);advancePick();}});
window.addEventListener('mousemove',e=>{const r=cv.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);const sx=(e.clientX-r.left)*dpr,sy=(e.clientY-r.top)*dpr;
  if(waferDrag){waferYaw=waferDrag.yaw+(sx-waferDrag.sx)*0.006;waferPitch=Math.max(-1.45,Math.min(1.45,waferDrag.pitch+(sy-waferDrag.sy)*0.006));if(waferMesh)drawWafer3D(waferMesh,waferYaw,waferPitch);return;}
  if(skullDrag){skullYaw=skullDrag.yaw+(sx-skullDrag.sx)*0.006;skullPitch=Math.max(-1.3,Math.min(1.3,skullDrag.pitch+(sy-skullDrag.sy)*0.006));renderSkull();return;}
  if(photoDrag){photoLM[photoDrag]={x:(sx-photoView.ox)/photoView.z,y:(sy-photoView.oy)/photoView.z};invalidatePhotoWarp();render();return;}
  if(pan){view.ox=pan.ox+(sx-pan.sx);view.oy=pan.oy+(sy-pan.sy);render();return;}
  if(drag){LM[drag]=toI(sx,sy);render();}});
window.addEventListener('mouseup',()=>{if(drag){drag=null;renderPanel();}if(photoDrag){photoDrag=null;renderPanel();}pan=null;waferDrag=null;skullDrag=null;});
cv.addEventListener('wheel',e=>{if(step==='photo')return;
  if(step==='wafer'){e.preventDefault();waferZoom=Math.max(0.4,Math.min(3,waferZoom*(e.deltaY<0?1.1:0.9)));if(waferMesh)drawWafer3D(waferMesh,waferYaw,waferPitch);return;}
  if(step==='plan'&&planView==='skull3d'&&vol&&skullMesh){e.preventDefault();skullZoom=Math.max(0.4,Math.min(3,skullZoom*(e.deltaY<0?1.1:0.9)));renderSkull();return;}
  if(!img)return;e.preventDefault();const r=cv.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
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
$('stlUInput').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;f.arrayBuffer().then(b=>loadScan(b,'U'));e.target.value='';});
$('stlLInput').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;f.arrayBuffer().then(b=>loadScan(b,'L'));e.target.value='';});
$('steps').addEventListener('click',e=>{const s=e.target.closest('.step');if(s)setStep(s.dataset.s);});
$('saveBtn').onclick=save; $('openBtn').onclick=()=>$('openInput').click();
$('openInput').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{const o=JSON.parse(rd.result);patient=o.patient||patient;scale=o.scale||0;LM=o.LM||{};plan=Object.assign(plan,o.plan||{});photoLM=o.photoLM||{};
  const done=()=>{setStep('points');};if(o.img){const im=new Image();im.onload=()=>{img=im;autoView();done();};im.src=o.img;}else done();if(o.photo){const pm=new Image();pm.onload=()=>{photo=pm;};pm.src=o.photo;}toast('Проект открыт.');}catch(err){alert('Не удалось открыть файл');}};rd.readAsText(f);e.target.value='';});

function save(){const o={v:1,patient,scale,LM,plan,photoLM,img:img?img.src:null,photo:photo?photo.src:null};
  const a=document.createElement('a');a.download=(patient.name||'план')+'.orthos';a.href=URL.createObjectURL(new Blob([JSON.stringify(o)],{type:'application/json'}));a.click();}
function exportPng(){const a=document.createElement('a');a.download='ОРТОС_план_'+(patient.name||'пациент')+'.png';a.href=cv.toDataURL('image/png');a.click();}
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('on');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('on'),2400);}

window.addEventListener('resize',render);
renderPanel(); render();

// тест-хук
window.__orthos={ loadDicom:f=>loadDicom(f), set:(k,x,y)=>{LM[k]={x,y};skullMesh=null;}, calib:s=>{scale=s;skullMesh=null;}, analyse:()=>analyse(LM), planned, setPlan:p=>{Object.assign(plan,p);invalidateWarp();invalidatePhotoWarp();waferMesh=null;},
  setWafer:o=>{Object.assign(wafer,o);waferMesh=null;}, stl:()=>waferSTL(buildWaferMesh()), waferTris:()=>buildWaferMesh().length,
  ctDiag:()=>{buildWaferMesh();return{src:wafer.src,diag:wafer.ctDiag};}, injectVol:v=>{vol=v;waferMesh=null;},
  injectScan:(which,tris)=>{if(which==='U')scanU={tris};else scanL={tris};waferMesh=null;}, waferSrc:()=>{buildWaferMesh();return wafer.src;}, stlDiag:()=>{buildWaferMesh();return wafer.stlDiag;},
  warpInfo:()=>{const w=buildWarp();return{ok:!!w,w:w&&w.width,h:w&&w.height};}, osteotomy:()=>osteotomy().map(s=>s.label),
  waferView:()=>({yaw:+waferYaw.toFixed(3),pitch:+waferPitch.toFixed(3),zoom:+waferZoom.toFixed(2),spin:waferSpin}),
  loadPhotoUrl:url=>new Promise(res=>{const im=new Image();im.onload=()=>{photo=im;res({w:im.naturalWidth||im.width,h:im.naturalHeight||im.height});};im.src=url;}),
  photoSet:(id,x,y)=>{photoLM[id]={x,y};invalidatePhotoWarp();}, photoWarp:()=>{const c=buildPhotoWarp();return{ok:!!c,w:c&&c.width,h:c&&c.height};},
  photoState:()=>{const pa=anyMove()?photoAfter():null;return{hasPhoto:!!photo,placed:Object.keys(photoLM).length,corr:photoCorr().src.length,
    after:pa?pa.ids.map(id=>({id,dx:+(pa.after[id].x-photoLM[id].x).toFixed(1),dy:+(pa.after[id].y-photoLM[id].y).toFixed(1)})):null};},
  buildTRG:()=>new Promise(res=>{const drr=buildLateralDRR(vol);const im=new Image();im.onload=()=>{img=im;scale=1/drr.mpp;skullMesh=null;res({w:img.width,h:img.height,scale});};im.src=drr.canvas.toDataURL('image/png');}),
  setPlanView:v=>{planView=v;}, skullInfo:()=>{skullMesh=null;buildSkull();if(!skullMesh)return{ok:false};
    const sc=[0,0,0,0];for(const s of skullMesh.seg)sc[s]++;const Vm=skullMoved(overlay);
    let moved=0,mxd=0;for(let i=0;i<Vm.length;i++){const d=Math.hypot(Vm[i].x-skullMesh.V0[i].x,Vm[i].z-skullMesh.V0[i].z);if(d>0.5)moved++;if(d>mxd)mxd=d;}
    const ec=new Map(),ek=(a,b)=>a<b?a+'_'+b:b+'_'+a;for(const[a,b,c]of skullMesh.T)for(const[p,q]of[[a,b],[b,c],[c,a]]){const k=ek(p,q);ec.set(k,(ec.get(k)||0)+1);}
    let bound=0;for(const v of ec.values())if(v===1)bound++;
    return{ok:true,verts:skullMesh.V0.length,tris:skullMesh.tri,seg:{fixed:sc[0],maxilla:sc[1],mandible:sc[2],chin:sc[3]},movedVerts:moved,maxDispPx:+mxd.toFixed(1),boundaryEdges:bound};},
  step:s=>setStep(s), state:()=>({step,scale,n:Object.keys(LM).length,hasImg:!!img,hasVol:!!vol,stepAP:waferStepAP(),vert:waferVert(),wtype:wafer.type}) };
