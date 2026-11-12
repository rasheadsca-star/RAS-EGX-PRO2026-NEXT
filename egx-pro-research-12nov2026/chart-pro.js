(()=>{'use strict';
const D=document,source=D.getElementById('data'),selector=D.getElementById('weight');if(!source||!selector)return;
let ref;try{ref=JSON.parse(source.textContent)}catch{return}
const ranks=ref.rankings||{},F=(x,n=2)=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))?Number(x).toLocaleString('en-US',{minimumFractionDigits:n,maximumFractionDigits:n}):'—';
const style=D.createElement('style');style.textContent='#egxChartPro input{background:#143a54;border:1px solid #4a7793;color:#eef8ff;border-radius:8px;padding:9px;font:inherit;min-width:170px}#egxChartPro{padding:17px;background:#0b2032;border:1px solid #31546c;border-radius:15px;margin:18px 0}#egxChartPro h2{margin:0;color:#9cddff}#egxChartPro .toolbar,#egxChartPro .legend{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:11px 0}#egxChartPro select,#egxChartPro button{background:#143a54;border:1px solid #4a7793;color:#eef8ff;padding:9px;border-radius:8px;cursor:pointer;font:inherit}#egxChartPro .board{background:#081b2c;border:1px solid #294c64;border-radius:12px;overflow:hidden;touch-action:none;cursor:crosshair}#egxChartPro canvas{display:block;width:100%;height:490px}#egxChartPro .legend{font-size:12px;color:#b7cada}#egxChartPro .notice{font-size:12px;line-height:1.8;color:#ffe2ac;border-right:3px solid #d4a75b;padding:7px 11px;background:#302a26}#egxChartPro .status{font-size:12px;color:#9ecde5;margin:9px 0}#egxChartPro .muted{font-size:12px;color:#a6bcca}@media(max-width:700px){#egxChartPro canvas{height:380px}#egxChartPro{padding:9px}}';D.head.append(style);
const box=D.createElement('section');box.id='egxChartPro';
box.innerHTML='<h2>الشارت التفاعلي الاحترافي — الأسهم البحثية</h2><p class="muted">شموع يابانية يومية | أحجام التداول | متوسط 20 و50 جلسة | مستويات الدخول والأهداف والوقف</p><div class="toolbar"><label>بحث بالرمز أو الاسم <input id="cpSearch" type="search" placeholder="مثال: NIPH أو النيل" autocomplete="off"></label><label>السهم <select id="cpSymbol"></select></label><span id="cpUniverseCount" class="muted"></span><label>الفترة <select id="cpRange"><option value="20">20 جلسة</option><option value="40">40 جلسة</option><option value="70">70 جلسة</option><option value="100" selected>100 جلسة</option></select></label><button id="cpZoomIn">+ تكبير</button><button id="cpZoomOut">− تصغير</button><button id="cpReset">إعادة ضبط</button></div><div class="status" id="cpStatus">جارٍ التحميل</div><div class="board"><canvas id="cpCanvas" aria-label="تاريخ الشموع والأحجام والمستويات"></canvas></div><div class="legend" id="cpLegend"></div><p class="notice">السجل التاريخي مصدره ملفات GitHub الخارجية، وليس تدقيق EGX الرسمي لجميع الجلسات. أي تعارض في جلسة 12 نوفمبر تُقدَّم فيه أرقام التقرير الرسمي. الشارت لا يغيّر ترتيب التوصيات أو مصدرها.</p><p class="muted">حرّك الماوس لقراءة OHLC والحجم؛ عجلة الماوس للتكبير، واسحب الرسم أفقيًا للتنقل. لا تُنشأ شموع وهمية عند غياب البيانات. لا توجد أوامر تداول.</p>';
selector.closest('.panel')?.insertAdjacentElement('afterend',box);
const sym=box.querySelector('#cpSymbol'),period=box.querySelector('#cpRange'),canvas=box.querySelector('canvas'),ctx=canvas.getContext('2d'),status=box.querySelector('#cpStatus'),legend=box.querySelector('#cpLegend');
const all=new Map(),catalog=new Map();Object.values(ranks).forEach(rs=>(rs||[]).forEach(r=>{if(/^[A-Z0-9.]{2,15}$/.test(r.ticker||'')&&!all.has(r.ticker))all.set(r.ticker,r)}));
for(const [ticker,r] of all)catalog.set(ticker,{ticker,name:r.name||ticker,hasHistoricalFile:true,hasResearchPlan:true});
const search=box.querySelector('#cpSearch'),counter=box.querySelector('#cpUniverseCount');
let chosen='',plan=null,data=[],number=100,shift=0,hover=-1,requestId=0,drag=null,chartWidth=750;
function options(){
const active=chosen;
const q=search.value.trim().toLocaleUpperCase();
const list=[...catalog.values()].filter(x=>!q||x.ticker.includes(q)||String(x.name||'').toLocaleUpperCase().includes(q)).sort((a,b)=>a.ticker.localeCompare(b.ticker));
sym.replaceChildren();
if(!list.length){const opt=D.createElement('option');opt.value='';opt.textContent='لا توجد أسهم مطابقة';sym.append(opt);sym.disabled=true;counter.textContent='0 من '+catalog.size;return}
sym.disabled=false;
for(const r of list){const o=D.createElement('option');o.value=r.ticker;o.textContent=r.ticker+(r.name&&r.name!==r.ticker?' — '+r.name:'')+(r.hasHistoricalFile===false?' (تاريخ غير متاح)':'');sym.append(o)}
counter.textContent=list.length+' من '+catalog.size+' سهم';
if(list.some(r=>r.ticker===active))sym.value=active;
else if(!q){sym.value=list.some(r=>r.ticker==='INFI')?'INFI':list[0].ticker;}
else sym.selectedIndex=0;
chosen=sym.value;plan=(ranks[selector.value]||[]).find(r=>r.ticker===chosen)||all.get(chosen)||null;
}
async function loadCatalog(){
try{
const response=await fetch('chart-universe.json?v=20261112-all',{cache:'no-store'});
if(!response.ok)throw Error('HTTP '+response.status);
const d=await response.json();
if(d.schemaVersion!=='research-chart-universe-v1'||!Array.isArray(d.symbols)||d.symbols.length<150)throw Error('Catalog incomplete');
for(const r of d.symbols){
if(!/^[A-Z0-9.]{2,15}$/.test(r.ticker||''))continue;
catalog.set(r.ticker,{ticker:r.ticker,name:r.name||all.get(r.ticker)?.name||r.ticker,hasHistoricalFile:r.hasHistoricalFile,hasResearchPlan:all.has(r.ticker)});
}
const previous=chosen;options();if(chosen!==previous)load(chosen);
}catch(e){counter.textContent=catalog.size+' رمزًا بحثيًا فقط — تعذر تحميل قائمة السوق: '+e.message;}
}
function clean(raw){let m=new Map();for(const r of raw?.sessions||[]){const date=r.date||r.sessionDate,o=Number(r.open),h=Number(r.high),l=Number(r.low),c=Number(r.close),vol=Number(r.volume);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||![o,h,l,c].every(v=>Number.isFinite(v)&&v>0)||h<Math.max(o,c)||l>Math.min(o,c))continue;const bar={date,open:o,high:h,low:l,close:c,volume:Number.isFinite(vol)&&vol>=0?vol:0,source:r.source||raw.primarySource||'external'};if(!m.has(date)||String(bar.source).includes('mubasher'))m.set(date,bar)}return [...m.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-160)}
function official(){let h=Number(plan?.high),l=Number(plan?.low),c=Number(plan?.close);if(![h,l,c].every(Number.isFinite)||h<l||c<l||c>h)return null;return{date:ref.date,open:null,high:h,low:l,close:c,volume:0,source:'Official EGX PDF',partial:true}}
async function load(t){if(!t)return;chosen=t;plan=(ranks[selector.value]||[]).find(r=>r.ticker===t)||all.get(t)||null;const id=++requestId;status.textContent='جارٍ تحميل الشموع التاريخية لـ '+t;let a=[];try{const r=await fetch('../data/history/'+encodeURIComponent(t)+'.json',{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);a=clean(await r.json())}catch(e){status.textContent='سجل التاريخ غير متاح: '+e.message}
if(id!==requestId)return;let o=official(),conflict=false;if(o){const i=a.findIndex(x=>x.date===o.date);if(i>=0){let old=a[i];conflict=Math.abs(old.close-o.close)>.0001||Math.abs(old.high-o.high)>.0001||Math.abs(old.low-o.low)>.0001;o.open=old.open;o.volume=old.volume;o.partial=false;a[i]=o}else a.push(o)}
data=a.sort((a,b)=>a.date.localeCompare(b.date));number=Math.min(data.length,Number(period.value));shift=0;hover=-1;
status.textContent=t+' | '+data.length+' جلسة متاحة | آخر تاريخ '+(data.at(-1)?.date||'—')+(conflict?' | اختلاف مع المصدر الخارجي: أُخذت أسعار الجلسة الرسمية':'');
if(data.length<2)status.textContent+=' | التاريخ غير كافٍ لشموع ومؤشرات فنية؛ لا تُستكمل ببيانات مصطنعة';draw()}
function ave(p){return data.map((x,i)=>i<p-1?null:data.slice(i-p+1,i+1).reduce((s,z)=>s+z.close,0)/p)}
function draw(){let rect=canvas.getBoundingClientRect(),w=Math.max(300,rect.width),h=Math.max(320,rect.height),dpr=Math.min(2,devicePixelRatio||1);chartWidth=w;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#081b2c';ctx.fillRect(0,0,w,h);
if(!data.length){ctx.fillStyle='#e7cf9e';ctx.font='16px Tahoma';ctx.textAlign='center';ctx.fillText('لا توجد شموع تاريخية موثقة متاحة لهذا السهم',w/2,h/2);legend.textContent='لا يمكن رسم الشارت أو المتوسطات دون بيانات تاريخية صالحة';return}
const left=20,right=85,top=28,bottom=h*.70,volTop=h*.76,volBottom=h-32,plot=w-left-right,end=Math.max(0,data.length-shift),start=Math.max(0,end-number),v=data.slice(start,end),slot=plot/Math.max(v.length,1);
const levels=[['الدخول',Number(plan?.entry),'#66caff'],['هدف 1',Number(plan?.target1??plan?.t1),'#67dcac'],['هدف 2',Number(plan?.target2??plan?.t2),'#319c7c'],['الوقف',Number(plan?.stop),'#ff7e91']].filter(z=>Number.isFinite(z[1])&&z[1]>0);
const max=Math.max(1,...v.map(x=>x.high),...levels.map(x=>x[1])),min=Math.min(max*.99,...v.map(x=>x.low),...levels.map(x=>x[1])),buffer=Math.max(.01,(max-min)*.09),lo=Math.max(0,min-buffer),hi=max+buffer,Y=p=>top+(hi-p)/(hi-lo)*(bottom-top),X=i=>left+(i+.5)*slot;
ctx.font='11px Arial';ctx.textAlign='right';ctx.strokeStyle='#28465b';for(let i=0;i<6;i++){const price=lo+(hi-lo)*i/5,y=Y(price);ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.fillStyle='#9db6c6';ctx.fillText(F(price),w-6,y+4)}
let mv=Math.max(1,...v.map(x=>x.volume||0)),bw=Math.max(2,Math.min(15,slot*.65));v.forEach((r,i)=>{const x=X(i),up=r.open==null||r.close>=r.open,col=up?'#47d7ab':'#ed7185';if(r.volume){let vh=(r.volume/mv)*(volBottom-volTop);ctx.fillStyle=up?'#246b5eaa':'#9e4555aa';ctx.fillRect(x-bw/2,volBottom-vh,bw,vh)}
ctx.strokeStyle=col;ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(x,Y(r.high));ctx.lineTo(x,Y(r.low));ctx.stroke();if(r.open!==null){ctx.fillStyle=col;let yy=Y(Math.max(r.open,r.close)),hh=Math.max(2,Math.abs(Y(r.open)-Y(r.close)));ctx.fillRect(x-bw/2,yy,bw,hh)}else{ctx.fillStyle=col;ctx.beginPath();ctx.arc(x,Y(r.close),3,0,Math.PI*2);ctx.fill()}});
for(const [p,col] of [[20,'#f4bb6c'],[50,'#989aff']]){let a=ave(p);ctx.beginPath();ctx.lineWidth=1.5;ctx.strokeStyle=col;let started=false;for(let i=0;i<v.length;i++){const price=a[start+i];if(price==null){started=false;continue}if(!started){ctx.moveTo(X(i),Y(price));started=true}else ctx.lineTo(X(i),Y(price))}ctx.stroke()}
for(const [label,price,color] of levels){let y=Y(price);ctx.setLineDash([5,4]);ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.setLineDash([]);ctx.textAlign='right';ctx.fillStyle=color;ctx.fillText(label+' '+F(price),w-6,y-5)}
ctx.fillStyle='#aac1d2';ctx.textAlign='center';ctx.font='10px Arial';let step=Math.max(1,Math.ceil(v.length/7));for(let i=0;i<v.length;i+=step)ctx.fillText(v[i].date.slice(5),X(i),h-12);
ctx.textAlign='left';ctx.fillText('EGP',left,15);ctx.fillText('Volume',left,volTop+12);
if(hover>=0&&hover<v.length){const r=v[hover],x=X(hover);ctx.setLineDash([3,4]);ctx.strokeStyle='#d8e9f3';ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,volBottom);ctx.stroke();ctx.setLineDash([]);let info=r.date+'  O '+(r.open==null?'—':F(r.open))+' H '+F(r.high)+' L '+F(r.low)+' C '+F(r.close)+' V '+F(r.volume,0);ctx.font='11px Arial';let tw=Math.min(w-12,ctx.measureText(info).width+14),px=Math.max(5,Math.min(w-tw-5,x-tw/2));ctx.fillStyle='#23465ce9';ctx.fillRect(px,top+3,tw,24);ctx.fillStyle='#fff';ctx.fillText(info,px+7,top+19)}
let last=data.at(-1);legend.textContent='السهم '+chosen+' • الإغلاق '+F(last?.close)+' ج.م • SMA20 '+F(ave(20).at(-1))+' • SMA50 '+F(ave(50).at(-1))+' • مرجع الجلسة '+ref.date}
function zoom(f){number=Math.min(data.length,Math.max(8,Math.round(number*f)));shift=Math.min(shift,Math.max(0,data.length-number));draw()}
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY>0?1.2:.8)},{passive:false});
canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,shift};canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener('pointermove',e=>{if(drag){shift=Math.max(0,Math.min(data.length-number,drag.shift+Math.round((e.clientX-drag.x)/((chartWidth-105)/Math.max(number,1)))))}const r=canvas.getBoundingClientRect();hover=Math.floor(((e.clientX-r.left)-20)/Math.max(1,chartWidth-105)*Math.min(number,data.length-shift));draw()});
canvas.addEventListener('pointerup',()=>drag=null);canvas.addEventListener('pointercancel',()=>drag=null);canvas.addEventListener('pointerleave',()=>{hover=-1;drag=null;draw()});
box.querySelector('#cpZoomIn').onclick=()=>zoom(.8);box.querySelector('#cpZoomOut').onclick=()=>zoom(1.25);box.querySelector('#cpReset').onclick=()=>{shift=0;number=Math.min(data.length,Number(period.value));draw()};
sym.onchange=()=>load(sym.value);period.onchange=()=>{number=Math.min(data.length,Number(period.value));shift=0;draw()};
selector.addEventListener('change',()=>{plan=(ranks[selector.value]||[]).find(r=>r.ticker===chosen)||all.get(chosen)||null;draw()});
search.addEventListener('input',()=>{const before=chosen;options();if(before!==chosen)load(chosen)});
const table=D.getElementById('ranking');table?.addEventListener('click',e=>{const row=e.target.closest('tr'),txt=row?.querySelector('td:nth-child(2)')?.textContent||'',match=txt.match(/\b[A-Z]{2,12}\b/);if(!match||!catalog.has(match[0]))return;const t=match[0];if(![...sym.options].some(x=>x.value===t)){let o=D.createElement('option');o.value=t;o.textContent=t;sym.append(o)}sym.value=t;box.scrollIntoView({behavior:'smooth',block:'center'});load(t)});
if('ResizeObserver'in window)new ResizeObserver(()=>draw()).observe(canvas.parentElement);else window.addEventListener('resize',draw);
options();load(chosen);loadCatalog();
})();