(()=>{
'use strict';
if(window.__EGX_PORTFOLIO_TECH_SCENARIOS__)return;
window.__EGX_PORTFOLIO_TECH_SCENARIOS__=true;

const KEY='egx-v137-portfolio';
const BASE=new URL('../../',location.href);
const INDEX_URL=new URL('data/quant/stock-intelligence-index.json',BASE).href;
const HISTORY_URL=t=>new URL(`data/history/${encodeURIComponent(t)}.json`,BASE).href;
const cache=new Map();
let indexMap=new Map();
let renderTimer=null;

const num=v=>Number.isFinite(Number(v))?Number(v):null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const fmt=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString('ar-EG',{maximumFractionDigits:d}):'—';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=(cur,prev)=>Number.isFinite(cur)&&Number.isFinite(prev)&&prev!==0?(cur/prev-1)*100:null;

function readPortfolio(){try{const p=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(p)?p:[];}catch{return[];}}
async function getJson(url){const r=await fetch(`${url}${url.includes('?')?'&':'?'}v=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();}
async function history(ticker){if(!cache.has(ticker))cache.set(ticker,getJson(HISTORY_URL(ticker)));return cache.get(ticker);}

function emaSeries(values,period){const out=Array(values.length).fill(null);if(values.length<period)return out;const k=2/(period+1);let cur=mean(values.slice(0,period));out[period-1]=cur;for(let i=period;i<values.length;i++){cur=values[i]*k+cur*(1-k);out[i]=cur;}return out;}
function ema(values,period){const s=emaSeries(values,period);return [...s].reverse().find(Number.isFinite)??null;}
function sma(values,period){return values.length>=period?mean(values.slice(-period)):null;}
function rsi(values,period=14){if(values.length<=period)return null;let gains=0,losses=0;for(let i=values.length-period;i<values.length;i++){const d=values[i]-values[i-1];if(d>=0)gains+=d;else losses-=d;}if(losses===0)return 100;const rs=(gains/period)/(losses/period);return 100-(100/(1+rs));}
function atr(rows,period=14){if(rows.length<=period)return null;const tr=[];for(let i=1;i<rows.length;i++){const h=num(rows[i].high),l=num(rows[i].low),pc=num(rows[i-1].close);if([h,l,pc].every(Number.isFinite))tr.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));}return tr.length>=period?mean(tr.slice(-period)):null;}
function macd(values){const e12=emaSeries(values,12),e26=emaSeries(values,26),line=values.map((_,i)=>Number.isFinite(e12[i])&&Number.isFinite(e26[i])?e12[i]-e26[i]:null),compact=line.filter(Number.isFinite);if(compact.length<9)return{line:null,signal:null,hist:null};const sig=ema(compact,9),latest=[...line].reverse().find(Number.isFinite);return{line:latest,signal:sig,hist:Number.isFinite(latest)&&Number.isFinite(sig)?latest-sig:null};}
function volumeRatio(rows,period=20){const vs=rows.map(r=>num(r.volume)).filter(Number.isFinite);if(vs.length<period+1)return null;const latest=vs.at(-1),avg=mean(vs.slice(-(period+1),-1));return avg?latest/avg:null;}
function slope(values,period=20){const v=values.slice(-period).filter(Number.isFinite);if(v.length<5)return null;const n=v.length,mx=(n-1)/2,my=mean(v);let top=0,bot=0;v.forEach((y,x)=>{top+=(x-mx)*(y-my);bot+=(x-mx)**2;});return bot?top/bot:null;}

function fibonacci(rows){const data=rows.slice(-80);if(data.length<20)return null;let hi=-Infinity,lo=Infinity,hiI=-1,loI=-1;data.forEach((r,i)=>{const h=num(r.high),l=num(r.low);if(h>hi){hi=h;hiI=i;}if(l<lo){lo=l;loI=i;}});if(!Number.isFinite(hi)||!Number.isFinite(lo)||hi<=lo)return null;const up=loI<hiI,rg=hi-lo;return up?{direction:'UP',high:hi,low:lo,r236:hi-.236*rg,r382:hi-.382*rg,r500:hi-.5*rg,r618:hi-.618*rg,r786:hi-.786*rg,e1272:hi+.272*rg,e1618:hi+.618*rg}:{direction:'DOWN',high:hi,low:lo,r236:lo+.236*rg,r382:lo+.382*rg,r500:lo+.5*rg,r618:lo+.618*rg,r786:lo+.786*rg,e1272:lo-.272*rg,e1618:lo-.618*rg};}
function swings(rows){const s=[],r=[];for(let i=2;i<rows.length-2;i++){const lo=num(rows[i].low),hi=num(rows[i].high);if(lo!==null&&lo<=num(rows[i-1].low)&&lo<=num(rows[i-2].low)&&lo<=num(rows[i+1].low)&&lo<=num(rows[i+2].low))s.push(lo);if(hi!==null&&hi>=num(rows[i-1].high)&&hi>=num(rows[i-2].high)&&hi>=num(rows[i+1].high)&&hi>=num(rows[i+2].high))r.push(hi);}return{s,r};}
function cluster(levels,t=.012){const sorted=levels.filter(Number.isFinite).sort((a,b)=>a-b),out=[];for(const x of sorted){const c=out.at(-1);if(!c||Math.abs(x-c.m)/Math.max(c.m,.0001)>t)out.push({v:[x],m:x});else{c.v.push(x);c.m=mean(c.v);}}return out.map(x=>({level:x.m,touches:x.v.length}));}
function levels(rows,price){const sw=swings(rows.slice(-100));return{supports:cluster(sw.s).filter(x=>x.level<price).sort((a,b)=>b.level-a.level).slice(0,3),resistances:cluster(sw.r).filter(x=>x.level>price).sort((a,b)=>a.level-b.level).slice(0,3)};}

function evidenceModel(a){
  const signals=[];
  const add=(name,weight,state,why)=>signals.push({name,weight,state:clamp(state,-1,1),why});
  const p=a.price;
  if(Number.isFinite(a.ema20))add('السعر مقابل EMA20',11,p>a.ema20?1:-1,p>a.ema20?'السعر أعلى EMA20':'السعر أسفل EMA20');
  if(Number.isFinite(a.ema20)&&Number.isFinite(a.ema50))add('EMA20 مقابل EMA50',12,a.ema20>a.ema50?1:-1,a.ema20>a.ema50?'المتوسط السريع أعلى EMA50':'المتوسط السريع أسفل EMA50');
  if(Number.isFinite(a.sma50))add('السعر مقابل SMA50',8,p>a.sma50?.8:-.8,p>a.sma50?'فوق متوسط 50 جلسة':'أسفل متوسط 50 جلسة');
  if(Number.isFinite(a.sma200))add('السعر مقابل SMA200',8,p>a.sma200?.8:-.8,p>a.sma200?'فوق الاتجاه طويل الأجل':'أسفل الاتجاه طويل الأجل');
  if(Number.isFinite(a.macd.hist))add('MACD Histogram',12,a.macd.hist>0?1:-1,a.macd.hist>0?'MACD يدعم الزخم الصاعد':'MACD يدعم الزخم الهابط');
  if(Number.isFinite(a.rsi14)){
    let st=0,why=`RSI ${fmt(a.rsi14,1)}`;
    if(a.rsi14>=52&&a.rsi14<=68){st=.9;why+=' زخم صحي';}
    else if(a.rsi14>76){st=-.35;why+=' تشبع شرائي';}
    else if(a.rsi14<38){st=-.8;why+=' ضعف واضح/تشبع بيعي';}
    else if(a.rsi14>=45&&a.rsi14<52)st=-.15;
    else if(a.rsi14>68&&a.rsi14<=76)st=.25;
    add('RSI14',12,st,why);
  }
  if(Number.isFinite(a.volumeRatio)){
    const dir=Number.isFinite(a.ret1)?Math.sign(a.ret1):0;
    const st=a.volumeRatio>=1.2?clamp(dir*.85,-.85,.85):a.volumeRatio<.7?0:dir*.25;
    add('تأكيد الحجم',9,st,`حجم اليوم ${fmt(a.volumeRatio,2)}× متوسط 20 جلسة`);
  }
  if(Number.isFinite(a.ret5))add('زخم 5 جلسات',8,clamp(a.ret5/7,-1,1),`عائد 5 جلسات ${fmt(a.ret5,2)}%`);
  if(Number.isFinite(a.ret20))add('زخم 20 جلسة',8,clamp(a.ret20/14,-1,1),`عائد 20 جلسة ${fmt(a.ret20,2)}%`);
  if(a.fib){
    let st=0;
    if(a.fib.direction==='UP')st=p>=a.fib.r500?.7:p>=a.fib.r618?.35:-.45;
    else st=p<=a.fib.r500?-.7:p<=a.fib.r618?-.35:.25;
    add('هيكل Fibonacci',6,st,`الموجة ${a.fib.direction==='UP'?'صاعدة':'هابطة'}؛ 50%=${fmt(a.fib.r500,3)} و61.8%=${fmt(a.fib.r618,3)}`);
  }
  const s1=a.supports[0]?.level,r1=a.resistances[0]?.level;
  if(Number.isFinite(s1)&&Number.isFinite(r1)){
    const down=(p/s1-1)*100,up=(r1/p-1)*100,ratio=up/Math.max(down,.3),st=ratio>1.6?.7:ratio<.7?-.7:0;
    add('هندسة الدعم/المقاومة',6,st,`مساحة أعلى السعر ${fmt(up,1)}% مقابل مسافة الدعم ${fmt(down,1)}%`);
  }
  let bull=22,bear=22,side=28;
  signals.forEach(x=>{bull+=x.weight*Math.max(x.state,0);bear+=x.weight*Math.max(-x.state,0);side+=x.weight*(1-Math.abs(x.state))*.58;});
  const sum=bull+bear+side;bull=bull/sum*100;bear=bear/sum*100;side=100-bull-bear;
  const sorted=[['BULL',bull],['SIDE',side],['BEAR',bear]].sort((a,b)=>b[1]-a[1]);
  const spread=sorted[0][1]-sorted[1][1],confidence=spread>=18?'مرتفع':spread>=9?'متوسط':'منخفض';
  return{signals,bull,bear,side,dominant:sorted[0][0],spread,confidence};
}

function analyze(doc,holding,meta){
  const rows=(doc?.sessions||[]).filter(r=>[r.open,r.high,r.low,r.close].every(v=>Number.isFinite(Number(v)))).sort((a,b)=>String(a.date||a.sessionDate||'').localeCompare(String(b.date||b.sessionDate||'')));
  if(rows.length<30)throw Error('لا توجد جلسات تاريخية كافية للتحليل العميق');
  const closes=rows.map(r=>Number(r.close));
  const price=num(meta?.price)??closes.at(-1),ema20=ema(closes,20),ema50=ema(closes,50),sma20=sma(closes,20),sma50=sma(closes,50),sma200=sma(closes,200),rsi14=rsi(closes),mac=macd(closes),atr14=atr(rows),vr=volumeRatio(rows),fib=fibonacci(rows),lv=levels(rows,price),ret1=pct(closes.at(-1),closes.at(-2)),ret5=closes.length>5?pct(closes.at(-1),closes.at(-6)):null,ret20=closes.length>20?pct(closes.at(-1),closes.at(-21)):null,sl=slope(closes,20);
  const a={ticker:holding.ticker,nameAr:doc.companyNameAr||meta?.companyNameAr||'',nameEn:doc.companyNameEn||meta?.companyNameEn||'',rows,price,ema20,ema50,sma20,sma50,sma200,rsi14,macd:mac,atr14,volumeRatio:vr,fib,supports:lv.supports,resistances:lv.resistances,ret1,ret5,ret20,slope20:sl,session:doc.lastSession||rows.at(-1)?.date,quantity:num(holding.quantity)||0,avg:num(holding.averagePrice)||0};
  a.value=a.price*a.quantity;a.cost=a.avg*a.quantity;a.pnl=a.value-a.cost;a.pnlPct=a.cost?pct(a.value,a.cost):null;a.model=evidenceModel(a);
  const s1=a.supports[0]?.level??a.fib?.r618??(a.price-(a.atr14||a.price*.025));
  const s2=a.supports[1]?.level??a.fib?.r786??(a.price-2*(a.atr14||a.price*.025));
  const r1=a.resistances[0]?.level??a.fib?.e1272??(a.price+(a.atr14||a.price*.025));
  const r2=a.resistances[1]?.level??a.fib?.e1618??(a.price+2*(a.atr14||a.price*.025));
  a.referenceBand=[Math.max(.0001,s1-(a.atr14||a.price*.02)*.18),s1+(a.atr14||a.price*.02)*.22].sort((x,y)=>x-y);
  a.scenarioLevels={s1,s2,r1,r2};
  a.stance=technicalStance(a);
  return a;
}

function technicalStance(a){
  const m=a.model;
  if(m.bull>=52&&m.bull>=m.bear+10)return{label:'إيجابي فنيًا',tone:'positive',text:'تجمّع الأدلة يميل إلى السيناريو الصاعد، مع ضرورة متابعة شروط الثبات والاختراق الموضحة أدناه.'};
  if(m.bear>=50&&m.bear>=m.bull+9)return{label:'سلبي فنيًا',tone:'negative',text:'تجمّع الأدلة يميل إلى سيناريو التصحيح/الهبوط، وتصبح مستويات الدعم هي نقاط المراقبة الأهم.'};
  if(m.side>=44&&m.spread<10)return{label:'عرضي / غير حاسم',tone:'warning',text:'السيناريوهات متقاربة نسبيًا؛ حركة النطاق أهم من أي إشارة منفردة.'};
  return{label:'مختلط',tone:'neutral',text:'لا توجد أفضلية فنية قوية؛ يلزم تأكيد إضافي من السعر والحجم.'};
}

function probabilityBar(label,value,cls){return `<div class="pta-prob"><div><span>${esc(label)}</span><b>${fmt(value,1)}%</b></div><div class="pta-track"><i class="${cls}" style="width:${clamp(value,0,100)}%"></i></div></div>`;}
function signalClass(state){return state>.25?'pos':state<-.25?'neg':'neu';}
function toneClass(t){return t==='positive'?'pos':t==='negative'?'neg':t==='warning'?'warn':'neu';}

function chart(a){
  const rows=a.rows.slice(-80),closes=rows.map(r=>Number(r.close)),e20=emaSeries(closes,20),e50=emaSeries(closes,50),W=980,H=430,L=58,R=38,T=24,B=330,VT=350,VB=395,pw=W-L-R;
  const candidates=[...rows.flatMap(r=>[num(r.low),num(r.high)]),...a.supports.map(x=>x.level),...a.resistances.map(x=>x.level),a.fib?.r382,a.fib?.r500,a.fib?.r618,a.fib?.e1272,a.price].filter(Number.isFinite);let min=Math.min(...candidates),max=Math.max(...candidates);const pad=(max-min)*.06||a.price*.03;min-=pad;max+=pad;const x=i=>L+(i+.5)*pw/rows.length,y=v=>T+(max-v)/(max-min)*(B-T),cw=Math.max(3,Math.min(9,pw/rows.length*.62));
  const vols=rows.map(r=>num(r.volume)||0),mv=Math.max(...vols,1),vy=v=>VB-v/mv*(VB-VT);
  let grid='';for(let i=0;i<=4;i++){const yy=T+i*(B-T)/4,val=max-i*(max-min)/4;grid+=`<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" class="pta-grid"/><text x="${L-6}" y="${yy+4}" text-anchor="end" class="pta-axis">${fmt(val,2)}</text>`;}
  let candles='',vol='';rows.forEach((r,i)=>{const o=Number(r.open),h=Number(r.high),l=Number(r.low),c=Number(r.close),up=c>=o,xx=x(i),yy=Math.min(y(o),y(c)),hh=Math.max(1.4,Math.abs(y(o)-y(c)));candles+=`<line x1="${xx}" x2="${xx}" y1="${y(h)}" y2="${y(l)}" class="pta-wick ${up?'up':'down'}"/><rect x="${xx-cw/2}" y="${yy}" width="${cw}" height="${hh}" class="pta-candle ${up?'up':'down'}"/>`;vol+=`<rect x="${xx-cw/2}" y="${vy(vols[i])}" width="${cw}" height="${VB-vy(vols[i])}" class="pta-vol ${up?'up':'down'}"/>`;});
  const path=(vals,cls)=>{let d='';vals.forEach((v,i)=>{if(!Number.isFinite(v))return;d+=`${d?'L':'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;});return `<path d="${d}" class="${cls}"/>`;};
  const hline=(v,label,cls)=>Number.isFinite(v)&&v>=min&&v<=max?`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" class="pta-level ${cls}"/><text x="${W-R-3}" y="${y(v)-4}" text-anchor="end" class="pta-label">${esc(label)} ${fmt(v,2)}</text>`:'';
  const fib=a.fib?[hline(a.fib.r382,'Fib 38.2','fib'),hline(a.fib.r500,'Fib 50','fib'),hline(a.fib.r618,'Fib 61.8','fib')].join(''):'';
  const dates=[0,Math.floor(rows.length/2),rows.length-1].filter((v,i,s)=>s.indexOf(v)===i).map(i=>`<text x="${x(i)}" y="${H-10}" text-anchor="middle" class="pta-axis">${esc(String(rows[i]?.date||'').slice(5))}</text>`).join('');
  return `<div class="pta-chart-wrap"><svg viewBox="0 0 ${W} ${H}" class="pta-chart" role="img" aria-label="الشارت الفني ${esc(a.ticker)}">${grid}${candles}${vol}${path(e20,'pta-ema20')}${path(e50,'pta-ema50')}${hline(a.price,'السعر','price')}${hline(a.supports[0]?.level,'دعم','support')}${hline(a.resistances[0]?.level,'مقاومة','resistance')}${fib}${dates}</svg></div><div class="pta-legend"><span>شموع 80 جلسة</span><span>EMA20</span><span>EMA50</span><span>Fibonacci 38.2 / 50 / 61.8</span><span>دعم/مقاومة</span></div>`;
}

function metric(label,value,note=''){return `<div class="pta-metric"><small>${esc(label)}</small><b>${esc(value)}</b>${note?`<em>${esc(note)}</em>`:''}</div>`;}
function scenarioTable(a){
  const {s1,s2,r1,r2}=a.scenarioLevels;
  const rows=[
    ['صاعد',a.model.bull,`الثبات أعلى ${fmt(a.ema20,3)} ثم تجاوز ${fmt(r1,3)}`,`المقاومة التالية ${fmt(r2,3)} / امتداد Fib ${fmt(a.fib?.e1272,3)}`,`يضعف بإغلاق واضح أسفل ${fmt(s1,3)}`,'pos'],
    ['عرضي',a.model.side,`بقاء الحركة بين ${fmt(s1,3)} و${fmt(r1,3)}`,`تذبذب/تجميع داخل النطاق`,`ينتهي بالخروج المؤكد من النطاق`,'neu'],
    ['هابط',a.model.bear,`إغلاق أسفل ${fmt(s1,3)}`,`الدعم التالي ${fmt(s2,3)}`,`يضعف باستعادة ${fmt(r1,3)}`,'neg']
  ];
  return `<div class="pta-scenarios"><table><thead><tr><th>السيناريو</th><th>الوزن الفني</th><th>شرط التفعيل</th><th>المسار الفني</th><th>الإبطال</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="${r[5]}"><b>${r[0]}</b></td><td><b>${fmt(r[1],1)}%</b></td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td></tr>`).join('')}</tbody></table></div>`;
}

function stockCard(a,weight){
  const topSignals=[...a.model.signals].sort((x,y)=>Math.abs(y.state*y.weight)-Math.abs(x.state*x.weight)).slice(0,8);
  return `<article class="pta-stock"><div class="pta-stock-head"><div><h3>${esc(a.ticker)} <small>${esc(a.nameAr||a.nameEn)}</small></h3><div class="pta-sub">جلسة ${esc(a.session||'—')} · وزن المركز ${fmt(weight,1)}% · نتيجة المركز ${fmt(a.pnlPct,2)}%</div></div><div class="pta-stance ${toneClass(a.stance.tone)}"><small>الخلاصة الفنية</small><b>${esc(a.stance.label)}</b><span>ثقة الترجيح: ${esc(a.model.confidence)}</span></div></div>
  <div class="pta-overview">${metric('السعر',fmt(a.price,3),`متوسط التكلفة ${fmt(a.avg,3)}`)}${metric('نتيجة المركز',`${fmt(a.pnlPct,2)}%`,`${fmt(a.pnl,0)} ج.م`)}${metric('RSI14',fmt(a.rsi14,1),a.rsi14>70?'مرتفع':a.rsi14<40?'ضعيف':'طبيعي')}${metric('Volume Ratio',`${fmt(a.volumeRatio,2)}×`,'مقابل 20 جلسة')}${metric('ATR14',fmt(a.atr14,3),'مقياس التذبذب')}${metric('Momentum 20D',`${fmt(a.ret20,2)}%`,'زخم متوسط')}</div>
  <div class="pta-prob-grid">${probabilityBar('سيناريو صاعد',a.model.bull,'bull')}${probabilityBar('سيناريو عرضي',a.model.side,'side')}${probabilityBar('سيناريو هابط',a.model.bear,'bear')}</div>
  ${chart(a)}
  <div class="pta-two"><section><h4>مصفوفة الأدلة الفنية</h4><div class="pta-signals">${topSignals.map(s=>`<div><span class="pta-dot ${signalClass(s.state)}"></span><b>${esc(s.name)}</b><em>${esc(s.why)}</em><strong>${s.state>0?'+':s.state<0?'−':'='}</strong></div>`).join('')}</div></section><section><h4>Fibonacci والمستويات</h4><div class="pta-level-grid">${metric('دعم 1',fmt(a.supports[0]?.level,3),`${a.supports[0]?.touches||0} لمسات`)}${metric('دعم 2',fmt(a.supports[1]?.level,3),'')}${metric('مقاومة 1',fmt(a.resistances[0]?.level,3),`${a.resistances[0]?.touches||0} لمسات`)}${metric('مقاومة 2',fmt(a.resistances[1]?.level,3),'')}${metric('Fib 50%',fmt(a.fib?.r500,3),a.fib?.direction==='UP'?'موجة صاعدة':'موجة هابطة')}${metric('Fib 61.8%',fmt(a.fib?.r618,3),'منطقة محورية')}</div></section></div>
  ${scenarioTable(a)}
  <div class="pta-monitor"><div><b>نطاق مراقبة الدعم</b><span>${fmt(a.referenceBand[0],3)} – ${fmt(a.referenceBand[1],3)}</span></div><div><b>EMA20 / EMA50</b><span>${fmt(a.ema20,3)} / ${fmt(a.ema50,3)}</span></div><div><b>الخلاصة</b><span>${esc(a.stance.text)}</span></div></div></article>`;
}

function ensureStyle(){if(document.getElementById('portfolioTechnicalAnalysisStyle'))return;const s=document.createElement('style');s.id='portfolioTechnicalAnalysisStyle';s.textContent=`
#portfolioTechnicalAnalysis{margin-top:14px}.pta-hero{padding:16px;border-bottom:1px solid #244d63}.pta-hero h2{margin:0 0 6px;font-size:21px}.pta-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;padding:12px}.pta-summary .card b{font-size:18px}.pta-disclaimer{margin:0 12px 12px;padding:9px 11px;border:1px solid #6b5932;background:#2b2418;color:#ffe7a0;border-radius:9px;font-size:11px;line-height:1.7}.pta-list{display:grid;gap:14px;padding:12px}.pta-stock{border:1px solid #315a70;background:#081a28;border-radius:14px;overflow:hidden}.pta-stock-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:13px 14px;background:#0d2638}.pta-stock-head h3{margin:0;font-size:19px;color:#52c7ff}.pta-stock-head h3 small{font-size:12px;color:#b7d1df;font-weight:500;margin-right:7px}.pta-sub{font-size:11px;color:#91adbb;margin-top:5px}.pta-stance{min-width:190px;border:1px solid #395467;background:#0b1d29;border-radius:10px;padding:8px 11px}.pta-stance small,.pta-stance span{display:block;font-size:10px;color:#9db6c2}.pta-stance b{display:block;margin:4px 0;font-size:14px}.pta-stance.pos{border-color:#2e8065}.pta-stance.neg{border-color:#8b4851}.pta-stance.warn{border-color:#8b7038}.pta-overview,.pta-level-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px;padding:11px}.pta-metric{background:#0d2a3e;border:1px solid #264e64;border-radius:9px;padding:8px}.pta-metric small{display:block;color:#8eafbf;font-size:10px}.pta-metric b{display:block;margin-top:4px;font-size:15px}.pta-metric em{display:block;color:#7f9dab;font-size:9px;font-style:normal;margin-top:3px}.pta-prob-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;padding:0 11px 11px}.pta-prob{background:#091f2e;border:1px solid #25495d;border-radius:9px;padding:8px}.pta-prob>div:first-child{display:flex;justify-content:space-between;font-size:11px}.pta-track{height:7px;background:#152f40;border-radius:99px;overflow:hidden;margin-top:7px}.pta-track i{display:block;height:100%}.pta-track .bull{background:#39c58c}.pta-track .side{background:#d5aa4d}.pta-track .bear{background:#e16c77}.pta-chart-wrap{margin:0 11px;overflow:auto;background:#06131d;border:1px solid #234658;border-radius:11px}.pta-chart{display:block;width:100%;min-width:760px}.pta-grid{stroke:#173747;stroke-width:1}.pta-axis{fill:#7998a8;font-size:10px}.pta-wick{stroke-width:1}.pta-candle.up,.pta-wick.up{fill:#35b981;stroke:#35b981}.pta-candle.down,.pta-wick.down{fill:#df6c76;stroke:#df6c76}.pta-vol.up{fill:#245f4b}.pta-vol.down{fill:#643842}.pta-ema20{fill:none;stroke:#54b9e7;stroke-width:1.8}.pta-ema50{fill:none;stroke:#d7aa4d;stroke-width:1.8}.pta-level{stroke-width:1.1;stroke-dasharray:6 5}.pta-level.support{stroke:#38b981}.pta-level.resistance{stroke:#e2a24a}.pta-level.fib{stroke:#9a7bdf;opacity:.85}.pta-level.price{stroke:#eaf8ff;stroke-width:1.35}.pta-label{fill:#d8ecf4;font-size:9px}.pta-legend{display:flex;gap:12px;flex-wrap:wrap;padding:7px 13px;color:#8ca9b7;font-size:10px}.pta-two{display:grid;grid-template-columns:1.25fr .75fr;gap:10px;padding:0 11px 11px}.pta-two section{background:#091f2e;border:1px solid #274a5c;border-radius:10px;padding:10px}.pta-two h4{margin:0 0 8px;font-size:13px}.pta-signals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.pta-signals>div{position:relative;background:#0d293a;border-radius:8px;padding:7px 29px 7px 8px}.pta-signals b{display:block;font-size:10px}.pta-signals em{display:block;font-style:normal;font-size:9px;color:#91abb8;margin-top:3px}.pta-signals strong{position:absolute;right:8px;top:9px;font-size:15px}.pta-dot{position:absolute;right:21px;top:12px;width:6px;height:6px;border-radius:50%}.pta-dot.pos{background:#38c58c}.pta-dot.neg{background:#e16b76}.pta-dot.neu{background:#caa54e}.pta-level-grid{grid-template-columns:repeat(3,1fr);padding:0}.pta-scenarios{overflow:auto;margin:0 11px 11px}.pta-scenarios table{min-width:760px;background:#091d2b;border:1px solid #29495b;border-radius:10px;overflow:hidden}.pta-scenarios th,.pta-scenarios td{font-size:10px}.pta-scenarios .pos{color:#49d69c}.pta-scenarios .neg{color:#f07d87}.pta-scenarios .neu{color:#e5bd61}.pta-monitor{display:grid;grid-template-columns:.7fr .7fr 1.6fr;gap:7px;padding:0 11px 13px}.pta-monitor>div{background:#0d293a;border:1px solid #295064;border-radius:9px;padding:8px}.pta-monitor b,.pta-monitor span{display:block;font-size:10px}.pta-monitor span{color:#d7eaf3;margin-top:4px;line-height:1.6}.pta-empty{padding:28px;text-align:center;color:#9cb4c0}.pta-loading{padding:25px;text-align:center;color:#8fb4c8}
@media(max-width:1000px){.pta-summary{grid-template-columns:repeat(3,1fr)}.pta-overview{grid-template-columns:repeat(3,1fr)}.pta-two{grid-template-columns:1fr}.pta-monitor{grid-template-columns:1fr}.pta-signals{grid-template-columns:1fr}}
@media(max-width:600px){.pta-summary{grid-template-columns:repeat(2,1fr)}.pta-overview{grid-template-columns:repeat(2,1fr)}.pta-prob-grid{grid-template-columns:1fr}.pta-stock-head{align-items:stretch;flex-direction:column}.pta-stance{min-width:0}.pta-level-grid{grid-template-columns:repeat(2,1fr)}}
`;document.head.appendChild(s);}

function ensureHost(){let host=document.getElementById('portfolioTechnicalAnalysis');if(host)return host;const panels=[...document.querySelectorAll('.panel')],tablePanel=panels.find(p=>p.querySelector('#rows'))||panels.at(-1);host=document.createElement('section');host.id='portfolioTechnicalAnalysis';host.className='panel';if(tablePanel?.parentNode)tablePanel.parentNode.insertBefore(host,tablePanel.nextSibling);else document.querySelector('.wrap')?.appendChild(host);return host;}
function summaryCard(l,v,n='',c=''){return `<div class="card"><small>${esc(l)}</small><b class="${c}">${esc(v)}</b><small>${esc(n)}</small></div>`;}

async function render(){
  ensureStyle();const host=ensureHost();if(!host)return;const portfolio=readPortfolio();
  if(!portfolio.length){host.innerHTML='<div class="pta-hero"><h2>التحليل الفني العميق للمحفظة</h2><div class="muted">Chart + Fibonacci + Momentum + سيناريوهات مرجّحة</div></div><div class="pta-empty">أضف أسهمًا إلى المحفظة لبدء التحليل.</div>';return;}
  host.innerHTML='<div class="pta-hero"><h2>التحليل الفني العميق للمحفظة</h2><div class="muted">جارٍ تحليل الشارت والاتجاه والزخم والحجم وFibonacci والدعم والمقاومة لكل سهم…</div></div><div class="pta-loading">يتم بناء السيناريوهات الفنية…</div>';
  try{
    if(!indexMap.size){const idx=await getJson(INDEX_URL);indexMap=new Map((idx.stocks||[]).map(x=>[String(x.ticker).toUpperCase(),x]));}
    const results=await Promise.all(portfolio.map(async h=>{try{return{ok:true,a:analyze(await history(String(h.ticker).toUpperCase()),{...h,ticker:String(h.ticker).toUpperCase()},indexMap.get(String(h.ticker).toUpperCase()))};}catch(error){return{ok:false,ticker:h.ticker,error:error.message};}}));
    const good=results.filter(x=>x.ok).map(x=>x.a),total=good.reduce((s,a)=>s+a.value,0),weighted=k=>total?good.reduce((s,a)=>s+a.model[k]*(a.value/total),0):0,bull=weighted('bull'),bear=weighted('bear'),side=weighted('side'),bias=bull-bear;
    const stance=bias>=12?'ميل فني صاعد':bias<=-12?'ميل فني هابط':'ميل فني مختلط/عرضي',stanceCls=bias>=12?'good':bias<=-12?'bad':'warn';
    const positive=good.filter(a=>a.stance.tone==='positive').length,negative=good.filter(a=>a.stance.tone==='negative').length,unclear=good.length-positive-negative;
    host.innerHTML=`<div class="pta-hero"><h2>التحليل الفني العميق للمحفظة</h2><div class="muted">كل سهم يُحلل مستقلًا ثم تُجمع أوزان السيناريوهات بحسب قيمة المركز داخل المحفظة.</div></div><div class="pta-summary">${summaryCard('الميل الفني للمحفظة',stance,`صاعد ${fmt(bull,1)}% · هابط ${fmt(bear,1)}%`,stanceCls)}${summaryCard('السيناريو الصاعد',`${fmt(bull,1)}%`,'وزن فني مجمع','good')}${summaryCard('السيناريو العرضي',`${fmt(side,1)}%`,'وزن فني مجمع','warn')}${summaryCard('السيناريو الهابط',`${fmt(bear,1)}%`,'وزن فني مجمع','bad')}${summaryCard('تصنيف الأسهم',`${positive}/${unclear}/${negative}`,'إيجابي / مختلط / سلبي')}</div><div class="pta-disclaimer">النسب المعروضة هي <b>أوزان ترجيح فني Evidence‑Weighted</b> ناتجة من مؤشرات الشارت وليست احتمالات إحصائية معايرة ولا ضمانًا لحركة السعر. الغرض منها مقارنة قوة السيناريوهات ومراقبة شروط التفعيل والإبطال.</div><div class="pta-list">${results.map(x=>x.ok?stockCard(x.a,total?x.a.value/total*100:0):`<div class="pta-stock"><div class="pta-empty">${esc(x.ticker)} — تعذر التحليل: ${esc(x.error)}</div></div>`).join('')}</div>`;
  }catch(error){host.innerHTML=`<div class="pta-hero"><h2>التحليل الفني العميق للمحفظة</h2></div><div class="pta-empty">تعذر بناء التحليل: ${esc(error.message)}</div>`;}
}

function schedule(){clearTimeout(renderTimer);renderTimer=setTimeout(render,180);}
function boot(){schedule();const rows=document.getElementById('rows');if(rows)new MutationObserver(schedule).observe(rows,{childList:true,subtree:true,characterData:true});window.addEventListener('storage',e=>{if(e.key===KEY)schedule();});document.addEventListener('click',e=>{if(e.target.closest('#add,[data-del],#clearBtn'))setTimeout(schedule,80);});document.getElementById('file')?.addEventListener('change',()=>setTimeout(schedule,250));}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();