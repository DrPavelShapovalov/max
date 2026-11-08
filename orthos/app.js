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
function planned(){
  const {H,V}=axes();const s=scale||1;const P={};for(const k in LM)P[k]={x:LM[k].x,y:LM[k].y};
  const mxT=add(mul(H,plan.mxAdv*s),mul(V,-plan.mxImp*s)),mdT=mul(H,plan.mdAdv*s),chT=add(mul(H,plan.chAdv*s),mul(V,plan.chVert*s));
  const mdRot=plan.autorot?(plan.mxImp*1.1):plan.mdRot;const pivMx=LM.PNS||LM.ANS||LM.A,pivMd=LM.Ar||LM.Go;
  ['A','ANS','PNS','U1t','U1a'].forEach(k=>{if(!LM[k])return;let q=pivMx?rot(LM[k],pivMx,d2r(plan.mxPitch)):LM[k];P[k]=add(q,mxT);});
  ['B','L1t','L1a','Pog','Gn','Me'].forEach(k=>{if(!LM[k])return;let q=pivMd?rot(LM[k],pivMd,d2r(mdRot)):LM[k];P[k]=add(q,mdT);});
  ['Pog','Gn','Me'].forEach(k=>{if(P[k])P[k]=add(P[k],chT);});
  [['Prn','A',0.3,0.2],['Sn','A',0.5,0.5],['Ls','U1t',0.6,0.6],['Li','L1t',0.6,0.65],['Pog2','Pog',0.9,0.9],['Me2','Me',1,1]]
   .forEach(([sk,src,rh,rv])=>{if(!LM[sk]||!LM[src]||!P[src])return;const d=sub(P[src],LM[src]);P[sk]=add(LM[sk],add(mul(H,dot(d,H)*rh),mul(V,dot(d,V)*rv)));});
  return P;
}
const fmt=x=>(x>=0?'+':'')+(+x).toFixed(1);

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
  fit();ctx.clearRect(0,0,cv.width,cv.height);
  const showPhoto=(step==='photo'&&photo);
  const pic=showPhoto?photo:img;
  if(pic){ctx.imageSmoothingEnabled=true;
    if(showPhoto){const r=cv.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);const z=Math.min(r.width*dpr/photo.width,r.height*dpr/photo.height)*0.92;
      ctx.drawImage(photo,(cv.width-photo.width*z)/2,(cv.height-photo.height*z)/2,photo.width*z,photo.height*z);}
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
    dLines(LM,1.5,[],0.4); dProf(LM,'#9aa3c2',2,[5,4],0.6);
    if(P){dLines(P,1.8,[]); dProf(P,'#18c3b6',2.6);}
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
        <div class="btn-row"><button class="btn sm" id="expPng" style="width:100%">⬇ План (PNG)</button></div></div>`;
    bindSliders(); if($('autorot'))$('autorot').onchange=e=>{plan.autorot=e.target.checked;render();renderPanel();};
    $('ov').oninput=e=>{overlay=+e.target.value;render();};
    $('resetPlan').onclick=()=>{plan={mxAdv:0,mxImp:0,mxPitch:0,mdAdv:0,mdRot:0,chAdv:0,chVert:0,autorot:false};renderPanel();render();};
    $('expPng').onclick=exportPng; renderReport($('rep'));
  }
}
function lmRow(id){const l=LBL[id];return `<div class="lm${id===pickId?' cur':''}${LM[id]?' ok':''}" data-k="${id}"><span class="ck">${LM[id]?'✓':'○'}</span><span class="t">${l.abbr} <small>· ${l.ru}</small></span></div>`;}
function anRow(r){const col=r.st==='норма'?'var(--good)':(r.st==='—'?'var(--ink-faint)':'var(--warn)');
  return `<div class="an-row"><span class="k">${r.key}</span><span class="v">${r.val!=null&&!isNaN(r.val)?r.val.toFixed(1):'—'}</span><span class="s" style="color:${col}">${r.st}</span><span class="n">норма ${r.norm}${r.extra?' · '+r.extra:''}</span></div>`;}
function sl(k,label,mn,mx,st,u){return `<div class="slider-row"><label>${label}</label><input type="range" id="s_${k}" min="${mn}" max="${mx}" step="${st}" value="${plan[k]}"><span class="val" id="v_${k}">${fmt(plan[k])}${u}</span></div>`;}
function bindSliders(){['mxAdv','mxImp','mxPitch','mdAdv','mdRot','chAdv','chVert'].forEach(k=>{const el=$('s_'+k);if(!el)return;const u=(k.includes('Pitch')||k.includes('Rot'))?'°':'мм';
  el.oninput=e=>{plan[k]=+e.target.value;$('v_'+k).textContent=fmt(plan[k])+u;render();renderReport($('rep'));};});}
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
function setStep(s){ step=s; document.querySelectorAll('.step').forEach(x=>{x.classList.toggle('on',x.dataset.s===s);});
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
window.__orthos={ loadDicom:f=>loadDicom(f), set:(k,x,y)=>{LM[k]={x,y};}, calib:s=>{scale=s;}, analyse:()=>analyse(LM), planned, setPlan:p=>Object.assign(plan,p),
  step:s=>setStep(s), state:()=>({step,scale,n:Object.keys(LM).length,hasImg:!!img,hasVol:!!vol}) };
