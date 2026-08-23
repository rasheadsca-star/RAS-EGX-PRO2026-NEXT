(()=>{
'use strict';
if(window.__EGX_PORTFOLIO_DEEP_ANALYSIS__)return;
window.__EGX_PORTFOLIO_DEEP_ANALYSIS__=true;

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
  if(Number.isFinite(a.ema20)&&Number.isFinite(a.ema50))add('EMA20 مقابل EMA50',12,a.ema20>a.ema50?1:-1,a.ema20>a.ema50?'المتوسط السريع أعلى المتوسط المتوسط':'المتوسط السريع أسفل المتوسط المتوسط');
  if(Number.isFinite(a.sma50))add('السعر مقابل SMA50',8,p>a.sma50?.8:-.8,p>a.sma50?'فوق متوسط 50 جلسة':'أسفل متوسط 50 جلسة');
  if(Number.isFinite(a.sma200))add('السعر مقابل SMA200',8,p>a.sma200?.8:-.8,p>a.sma200?'فوق الاتجاه طويل الأجل':'أسفل الاتجاه طويل الأجل');
  if(Number.isFinite(a.macd.hist))add('MACD Histogram',12,a.macd.hist>0?1:-1,a.macd.hist>0?'MACD يدعم الزخم الصاعد':'MACD يدعم الزخم الهابط');
  if(Number.isFinite(a.rsi14)){
    let st=0,why=`RSI ${fmt(a.rsi14,1)}`;
    if(a.rsi14>=52&&a.rsi14<=68){st=.9;why+=' زخم صحي';}
    else if(a.rsi14>76){st=-.35;why+=' تشبع شرائي';}
    else if(a.rsi14<38){st=-.8;why+=' ضعف/تشبع بيعي يحتاج تأكيد';}
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
    add('هندسة الدعم/المقاومة',6,st,`مساحة صعود ${fmt(up,1)}% مقابل مسافة دعم ${fmt(down,1)}%`);
  }
  const total=signals.reduce((s,x)=>s+x.weight,0)||1;
  let bull=22,bear=22,side=28;
  signals.forEach(x=>{bull+=x.weight*Math.max(x.state,0);bear+=x.weight*Math.max(-x.state,0);side+=x.weight*(1-Math.abs(x.state))*.58;});
  const sum=bull+bear+side;bull=bull/sum*100;bear=bear/sum*100;side=100-bull-bear;
  const sorted=[['BULL',bull],['SIDE',side],['BEAR',bear]].sort((a,b)=>b[1]-a[1]);
  const spread=sorted[0][1]-sorted[1][1],confidence=spread>=18?'مرتفع':spread>=9?'متوسط':'منخفض';
  return{signals,total,bull,bear,side,dominant:sorted[0][0],spread,confidence};
}

function analyze(doc,holding,meta){
  const rows=(doc?.sessions||[]).filter(r=>[r.open,r.high,r.low,r.close].every(v=>Number.isFinite(Number(v)))).sort((a,b)=>String(a.date||a.sessionDate||'').localeCompare(String(b.date||b.sessionDate||'')));
  if(rows.length<30)throw Error('لا توجد جلسات تاريخية كافية للتحليل العميق');
  const closes=rows.map(r=>Number(r.close)),price=num(meta?.price)??closes.at(-1),ema20=ema(closes,20),ema50=ema(closes,50),sma20=sma(closes,20),sma50=sma(closes,50),sma200=sma(closes,200),rsi14=rsi(closes),mac=macd(closes),atr14=atr(rows),vr=volumeRatio(rows),fib=fibonacci(rows),lv=levels(rows,price),ret1=pct(closes.at(-1),closes.at(-2)),ret5=closes.length>5?pct(closes.at(-1),closes.at(-6)):null,ret20=closes.length>20?pct(closes.at(-1),closes.at(-21)):null,sl=slope(closes,20);
  const a={ticker:holding.ticker,nameAr:doc.companyNameAr||meta?.companyNameAr||'',nameEn:doc.companyNameEn||meta?.companyNameEn||'',rows,price,ema20,ema50,sma20,sma50,sma200,rsi14,macd:mac,atr14,volumeRatio:vr,fib,supports:lv.supports,resistances:lv.resistances,ret1,ret5,ret20,slope20:sl,session:doc.lastSession||rows.at(-1)?.date,quantity:num(holding.quantity)||0,avg:num(holding.averagePrice)||0};
  a.value=a.price*a.quantity;a.cost=a.avg*a.quantity;a.pnl=a.value-a.cost;a.pnlPct=a.cost?pct(a.value,a.cost):null;a.model=evidenceModel(a);
  const s1=a.supports[0]?.level??a.fib?.r618??(a.price-(a.atr14||a.price*.025));
  const s2=a.supports[1]?.level??a.fib?.r786??(a.price-2*(a.atr14||a.price*.025));
  const r1=a.resistances[0]?.level??a.fib?.e1272??(a.price+(a.atr14||a.price*.025));
  const r2=a.resistances[1]?.level??a.fib?.e1618??(a.price+2*(a.atr14||a.price*.025));
  a.stop=Math.max(.0001,s1-(a.atr14||a.price*.02)*.35);
  a.targets=[r1,r2,a.fib?.e1618].filter(Number.isFinite).filter(v=>v>a.price*1.002).filter((v,i,arr)=>arr.findIndex(x=>Math.abs(x-v)/Math.max(v,.0001)<.004)===i).slice(0,3);
  a.entryZone=[Math.max(.0001,s1-(a.atr14||a.price*.02)*.18),s1+(a.atr14||a.price*.02)*.22].sort((x,y)=>x-y);
  a.recommendation=recommend(a,s1,s2,r1,r2);
  return a;
}

function recommend(a,s1,s2,r1,r2){
  const m=a.model,p=a.price,rsi=a.rsi14,pnl=a.pnlPct;
  let action='احتفاظ / مراقبة',tone='neutral',why='السيناريوهات متقاربة ولا توجد أفضلية فنية كافية لقرار هجومي.';
  if(m.bull>=52&&m.bull>=m.bear+10){action=(p<=s1+(a.atr14||p*.02)*.7&&rsi<70)?'زيادة تدريجية مشروطة':'احتفاظ إيجابي';tone='positive';why='تجمّع الأدلة يميل للصعود مع بقاء هيكل الاتجاه أفضل من سيناريو الهبوط.';}
  if(m.bear>=50&&m.bear>=m.bull+9){action=p<=s1*1.012?'خفض مخاطرة / بيع دفاعي':'تخفيف جزئي';tone='negative';why='الترجيح الفني يميل للهبوط؛ حماية رأس المال أهم من انتظار انعكاس غير مؤكد.';}
  if(m.side>=44&&m.spread<10){action='احتفاظ بحذر / انتظار كسر';tone='warning';why='السيناريو العرضي هو الأقرب؛ القرار الأفضل انتظار خروج مؤكد من النطاق.';}
  if(Number.isFinite(rsi)&&rsi>78&&p>=r1*.975&&m.bear>30){action='تخفيف جزئي قرب المقاومة';tone='warning';why='تشبع شرائي مع اقتراب من مقاومة؛ تخفيف المخاطرة أفضل من مطاردة امتداد الحركة.';}
  if(Number.isFinite(pnl)&&pnl<-10&&m.bear>=45){action='خفض مخاطرة';tone='negative';why='خسارة قائمة مع ترجيح فني هابط؛ لا يُفضّل متوسط التكلفة قبل ظهور انعكاس موثق.';}
  const invalidation=`إغلاق واضح أسفل ${fmt(s1,3)} يضعف السيناريو الإيجابي؛ وقف فني تقريبي ${fmt(a.stop,3)}.`;
  return{action,tone,why,invalidation,s1,s2,r1,r2};
}

function probabilityBar(label,value,cls){return `<div class="pda-prob"><div><span>${esc(label)}</span><b>${fmt(value,1)}%</b></div><div class="pda-track"><i class="${cls}" style="width:${clamp(value,0,100)}%"></i></div></div>`;}
function signalClass(state){return state>.25?'pos':state<-.25?'neg':'neu';}
function toneClass(t){return t==='positive'?'pos':t==='negative'?'neg':t==='warning'?'warn':'neu';}

function chart(a){
  const rows=a.rows.slice(-80),closes=rows.map(r=>Number(r.close)),e20=emaSeries(closes,20),e50=emaSeries(closes,50),W=980,H=430,L=58,R=38,T=24,B=330,VT=350,VB=395,pw=W-L-R;
  const candidates=[...rows.flatMap(r=>[num(r.low),num(r.high)]),...a.supports.map(x=>x.level),...a.resistances.map(x=>x.level),a.fib?.r382,a.fib?.r500,a.fib?.r618,a.fib?.e1272,a.price].filter(Number.isFinite);let min=Math.min(...candidates),max=Math.max(...candidates);const pad=(max-min)*.06||a.price*.03;min-=pad;max+=pad;const x=i=>L+(i+.5)*pw/rows.length,y=v=>T+(max-v)/(max-min)*(B-T),cw=Math.max(3,Math.min(9,pw/rows.length*.62));
  const vols=rows.map(r=>num(r.volume)||0),mv=Math.max(...vols,1),vy=v=>VB-v/mv*(VB-VT);
  let grid='';for(let i=0;i<=4;i++){const yy=T+i*(B-T)/4,val=max-i*(max-min)/4;grid+=`<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" class="pda-grid"/><text x="${L-6}" y="${yy+4}" text-anchor="end" class="pda-axis">${fmt(val,2)}</text>`;}
  let candles='',vol='';rows.forEach((r,i)=>{const o=Number(r.open),h=Number(r.high),l=Number(r.low),c=Number(r.close),up=c>=o,xx=x(i),yy=Math.min(y(o),y(c)),hh=Math.max(1.4,Math.abs(y(o)-y(c)));candles+=`<line x1="${xx}" x2="${xx}" y1="${y(h)}" y2="${y(l)}" class="pda-wick ${up?'up':'down'}"/><rect x="${xx-cw/2}" y="${yy}" width="${cw}" height="${hh}" class="pda-candle ${up?'up':'down'}"/>`;vol+=`<rect x="${xx-cw/2}" y="${vy(vols[i])}" width="${cw}" height="${VB-vy(vols[i])}" class="pda-vol ${up?'up':'down'}"/>`;});
  const path=(vals,cls)=>{let d='';vals.forEach((v,i)=>{if(!Number.isFinite(v))return;d+=`${d?'L':'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;});return `<path d="${d}" class="${cls}"/>`;};
  const hline=(v,label,cls)=>Number.isFinite(v)&&v>=min&&v<=max?`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" class="pda-level ${cls}"/><text x="${W-R-3}" y="${y(v)-4}" text-anchor="end" class="pda-label">${esc(label)} ${fmt(v,2)}</text>`:'';
  const fib=a.fib?[hline(a.fib.r382,'Fib 38.2','fib'),hline(a.fib.r500,'Fib 50','fib'),hline(a.fib.r618,'Fib 61.8','fib')].join(''):'';
  const dates=[0,Math.floor(rows.length/2),rows.length-1].filter((v,i,s)=>s.indexOf(v)===i).map(i=>`<text x="${x(i)}" y="${H-10}" text-anchor="middle" class="pda-axis">${esc(String(rows[i]?.date||'').slice(5))}</text>`).join('');
  return `<div class="pda-chart-wrap"><svg viewBox="0 0 ${W} ${H}" class="pda-chart" role="img" aria-label="الشارت الفني ${esc(a.ticker)}">${grid}${candles}${vol}${path(e20,'pda-ema20')}${path(e50,'pda-ema50')}${hline(a.price,'السعر','price')}${hline(a.supports[0]?.level,'دعم','support')}${hline(a.resistances[0]?.level,'مقاومة','resistance')}${fib}${dates}</svg></div><div class="pda-legend"><span>شموع 80 جلسة</span><span>EMA20</span><span>EMA50</span><span>Fibonacci 38.2 / 50 / 61.8</span><span>دعم/مقاومة</span></div>`;
}

function metric(label,value,note=''){return `<div class="pda-metric"><small>${esc(label)}</small><b>${esc(value)}</b>${note?`<em>${esc(note)}</em>`:''}</div>`;}
function scenarioTable(a){
  const s1=a.recommendation.s1,s2=a.recommendation.s2,r1=a.recommendation.r1,r2=a.recommendation.r2;
  const rows=[
    ['صاعد',a.model.bull,`الثبات أعلى ${fmt(a.ema20,3)} ثم اختراق ${fmt(r1,3)}`,`الأهداف ${a.targets.length?a.targets.map(x=>fmt(x,3)).join(' ثم '):fmt(r2,3)}`,`يفشل بكسر ${fmt(s1,3)}`,'pos'],
    ['عرضي',a.model.side,`التداول بين ${fmt(s1,3)} و${fmt(r1,3)}`,`تذبذب/تجميع داخل النطاق`,`يُلغى بالخروج المؤكد من النطاق`,'neu'],
    ['هابط',a.model.bear,`إغلاق أسفل ${fmt(s1,3)}`,`الدعم التالي ${fmt(s2,3)} ثم وقف ${fmt(a.stop,3)}`,`يضعف باستعادة ${fmt(r1,3)}`,'neg']
  ];
  return `<div class="pda-scenarios"><table><thead><tr><th>السيناريو</th><th>الترجيح</th><th>شرط التفعيل</th><th>الهدف/المسار</th><th>الإلغاء</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="${r[5]}"><b>${r[0]}</b></td><td><b>${fmt(r[1],1)}%</b></td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td></tr>`).join('')}</tbody></table></div>`;
}

function stockCard(a,weight){
  const topSignals=[...a.model.signals].sort((x,y)=>Math.abs(y.state*y.weight)-Math.abs(x.state*x.weight)).slice(0,8);
  const trend=a.model.bull>a.model.bear+12?'اتجاه مرجح صاعد':a.model.bear>a.model.bull+12?'اتجاه مرجح هابط':'اتجاه غير حاسم';
  return `<article class="pda-stock" data-ticker="${esc(a.ticker)}"><div class="pda-stock-head"><div><h3>${esc(a.ticker)} <small>${esc(a.nameAr||a.nameEn)}</small></h3><div class="pda-sub">جلسة ${esc(a.session||'—')} · وزن المحفظة ${fmt(weight,1)}% · ${esc(trend)}</div></div><div class="pda-action ${toneClass(a.recommendation.tone)}"><small>القرار الفني للمحفظة</small><b>${esc(a.recommendation.action)}</b><span>ثقة ${esc(a.model.confidence)}</span></div></div>
  <div class="pda-overview">${metric('السعر',fmt(a.price,3),`متوسط شراء ${fmt(a.avg,3)}`)}${metric('ربح/خسارة',`${fmt(a.pnlPct,2)}%`,`${fmt(a.pnl,0)} ج.م`)}${metric('RSI14',fmt(a.rsi14,1),a.rsi14>70?'مرتفع':a.rsi14<40?'ضعيف':'طبيعي')}${metric('Volume Ratio',`${fmt(a.volumeRatio,2)}×`,'مقابل 20 جلسة')}${metric('ATR14',fmt(a.atr14,3),'التذبذب')}${metric('Momentum 20D',`${fmt(a.ret20,2)}%`,'زخم متوسط')}</div>
  <div class="pda-prob-grid">${probabilityBar('استمرار/حركة صاعدة',a.model.bull,'bull')}${probabilityBar('حركة عرضية / تجميع',a.model.side,'side')}${probabilityBar('تصحيح / حركة هابطة',a.model.bear,'bear')}</div>
  ${chart(a)}
  <div class="pda-two"><section><h4>مصفوفة الأدلة الفنية</h4><div class="pda-signals">${topSignals.map(s=>`<div><span class="pda-dot ${signalClass(s.state)}"></span><b>${esc(s.name)}</b><em>${esc(s.why)}</em><strong>${s.state>0?'+':s.state<0?'−':'='}</strong></div>`).join('')}</div></section><section><h4>Fibonacci والمستويات</h4><div class="pda-level-grid">${metric('دعم 1',fmt(a.supports[0]?.level,3),`${a.supports[0]?.touches||0} لمسات`)}${metric('دعم 2',fmt(a.supports[1]?.level,3),'')}${metric('مقاومة 1',fmt(a.resistances[0]?.level,3),`${a.resistances[0]?.touches||0} لمسات`)}${metric('مقاومة 2',fmt(a.resistances[1]?.level,3),'')}${metric('Fib 50%',fmt(a.fib?.r500,3),a.fib?.direction==='UP'?'موجة صاعدة':'موجة هابطة')}${metric('Fib 61.8%',fmt(a.fib?.r618,3),'منطقة محورية')}</div></section></div>
  ${scenarioTable(a)}
  <div class="pda-plan"><div><b>منطقة التعامل المشروطة</b><span>${fmt(a.entryZone[0],3)} – ${fmt(a.entryZone[1],3)}</span></div><div><b>وقف فني تقريبي</b><span>${fmt(a.stop,3)}</span></div><div><b>الأهداف الفنية</b><span>${a.targets.length?a.targets.map(x=>fmt(x,3)).join(' / '):'لا يوجد هدف موثوق أعلى السعر حاليًا'}</span></div></div>
  <div class="pda-thesis ${toneClass(a.recommendation.tone)}"><b>${esc(a.recommendation.why)}</b><span>${esc(a.recommendation.invalidation)}</span></div></article>`;
}

function ensureStyle(){if(document.getElementById('portfolioDeepAnalysisStyle'))return;const s=document.createElement('style');s.id='portfolioDeepAnalysisStyle';s.textContent=`
#portfolioDeepAnalysis{margin-top:14px}.pda-hero{padding:16px;border-bottom:1px solid #244d63}.pda-hero h2{margin:0 0 6px;font-size:21px}.pda-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;padding:12px}.pda-summary .card b{font-size:18px}.pda-disclaimer{margin:0 12px 12px;padding:9px 11px;border:1px solid #6b5932;background:#2b2418;color:#ffe7a0;border-radius:9px;font-size:11px;line-height:1.7}.pda-list{display:grid;gap:14px;padding:12px}.pda-stock{border:1px solid #315a70;background:#081a28;border-radius:14px;overflow:hidden}.pda-stock-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:13px 14px;background:#0d2638}.pda-stock-head h3{margin:0;font-size:19px;color:#52c7ff}.pda-stock-head h3 small{font-size:12px;color:#b7d1df;font-weight:500;margin-right:7px}.pda-sub{font-size:11px;color:#91adbb;margin-top:5px}.pda-action{min-width:190px;border:1px solid #395467;background:#0b1d29;border-radius:10px;padding:8px 11px}.pda-action small,.pda-action span{display:block;font-size:10px;color:#9db6c2}.pda-action b{display:block;margin:4px 0;font-size:14px}.pda-action.pos{border-color:#2e8065}.pda-action.neg{border-color:#8b4851}.pda-action.warn{border-color:#8b7038}.pda-overview,.pda-level-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px;padding:11px}.pda-metric{background:#0d2a3e;border:1px solid #264e64;border-radius:9px;padding:8px}.pda-metric small{display:block;color:#8eafbf;font-size:10px}.pda-metric b{display:block;margin-top:4px;font-size:15px}.pda-metric em{display:block;color:#7f9dab;font-size:9px;font-style:normal;margin-top:3px}.pda-prob-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;padding:0 11px 11px}.pda-prob{background:#091f2e;border:1px solid #25495d;border-radius:9px;padding:8px}.pda-prob>div:first-child{display:flex;justify-content:space-between;font-size:11px}.pda-track{height:7px;background:#152f40;border-radius:99px;overflow:hidden;margin-top:7px}.pda-track i{display:block;height:100%}.pda-track .bull{background:#39c58c}.pda-track .side{background:#d5aa4d}.pda-track .bear{background:#e16c77}.pda-chart-wrap{margin:0 11px;overflow:auto;background:#06131d;border:1px solid #234658;border-radius:11px}.pda-chart{display:block;width:100%;min-width:760px}.pda-grid{stroke:#173747;stroke-width:1}.pda-axis{fill:#7998a8;font-size:10px}.pda-wick{stroke-width:1}.pda-candle.up,.pda-wick.up{fill:#35b981;stroke:#35b981}.pda-candle.down,.pda-wick.down{fill:#df6c76;stroke:#df6c76}.pda-vol.up{fill:#245f4b}.pda-vol.down{fill:#643842}.pda-ema20{fill:none;stroke:#54b9e7;stroke-width:1.8}.pda-ema50{fill:none;stroke:#d7aa4d;stroke-width:1.8}.pda-level{stroke-width:1.1;stroke-dasharray:6 5}.pda-level.support{stroke:#38b981}.pda-level.resistance{stroke:#e2a24a}.pda-level.fib{stroke:#9a7bdf;opacity:.85}.pda-level.price{stroke:#eaf8ff;stroke-width:1.35}.pda-label{fill:#d8ecf4;font-size:9px}.pda-legend{display:flex;gap:12px;flex-wrap:wrap;padding:7px 13px;color:#8ca9b7;font-size:10px}.pda-two{display:grid;grid-template-columns:1.25fr .75fr;gap:10px;padding:0 11px 11px}.pda-two section{background:#091f2e;border:1px solid #274a5c;border-radius:10px;padding:10px}.pda-two h4{margin:0 0 8px;font-size:13px}.pda-signals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.pda-signals>div{position:relative;background:#0d293a;border-radius:8px;padding:7px 29px 7px 8px}.pda-signals b{display:block;font-size:10px}.pda-signals em{display:block;font-style:normal;font-size:9px;color:#91abb8;margin-top:3px}.pda-signals strong{position:absolute;right:8px;top:9px;font-size:15px}.pda-dot{position:absolute;right:21px;top:12px;width:6px;height:6px;border-radius:50%}.pda-dot.pos{background:#38c58c}.pda-dot.neg{background:#e16b76}.pda-dot.neu{background:#caa54e}.pda-level-grid{grid-template-columns:repeat(3,1fr);padding:0}.pda-scenarios{overflow:auto;margin:0 11px 11px}.pda-scenarios table{min-width:760px;background:#091d2b;border:1px solid #29495b;border-radius:10px;overflow:hidden}.pda-scenarios th,.pda-scenarios td{font-size:10px}.pda-scenarios .pos{color:#49d69c}.pda-scenarios .neg{color:#f07d87}.pda-scenarios .neu{color:#e5bd61}.pda-plan{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:0 11px 11px}.pda-plan>div{background:#0d293a;border:1px solid #295064;border-radius:9px;padding:8px}.pda-plan b,.pda-plan span{display:block;font-size:10px}.pda-plan span{color:#d7eaf3;margin-top:4px}.pda-thesis{margin:0 11px 13px;padding:10px;border-radius:9px;border:1px solid #345466;background:#0c2331}.pda-thesis b,.pda-thesis span{display:block;font-size:11px;line-height:1.6}.pda-thesis span{color:#9eb8c4;margin-top:4px}.pda-thesis.pos{border-color:#2e765f}.pda-thesis.neg{border-color:#824750}.pda-thesis.warn{border-color:#776333}.pda-empty{padding:28px;text-align:center;color:#9cb4c0}.pda-loading{padding:25px;text-align:center;color:#8fb4c8}
@media(max-width:1000px){.pda-summary{grid-template-columns:repeat(3,1fr)}.pda-overview{grid-template-columns:repeat(3,1fr)}.pda-two{grid-template-columns:1fr}.pda-plan{grid-template-columns:1fr}.pda-signals{grid-template-columns:1fr}}
@media(max-width:600px){.pda-summary{grid-template-columns:repeat(2,1fr)}.pda-overview{grid-template-columns:repeat(2,1fr)}.pda-prob-grid{grid-template-columns:1fr}.pda-stock-head{align-items:stretch;flex-direction:column}.pda-action{min-width:0}.pda-level-grid{grid-template-columns:repeat(2,1fr)}}
`;document.head.appendChild(s);}

function ensureHost(){let host=document.getElementById('portfolioDeepAnalysis');if(host)return host;const panels=[...document.querySelectorAll('.panel')],tablePanel=panels.find(p=>p.querySelector('#rows'))||panels.at(-1);host=document.createElement('section');host.id='portfolioDeepAnalysis';host.className='panel';if(tablePanel?.parentNode)tablePanel.parentNode.insertBefore(host,tablePanel.nextSibling);else document.querySelector('.wrap')?.appendChild(host);return host;}
function summaryCard(l,v,n='',c=''){return `<div class="card"><small>${esc(l)}</small><b class="${c}">${esc(v)}</b><small>${esc(n)}</small></div>`;}

async function render(){
  ensureStyle();const host=ensureHost();if(!host)return;const portfolio=readPortfolio();
  if(!portfolio.length){host.innerHTML='<div class="pda-hero"><h2>التحليل الفني العميق للمحفظة</h2><div class="muted">Chart + Fibonacci + Momentum + سيناريوهات مرجّحة</div></div><div class="pda-empty">أضف أسهمًا إلى المحفظة لبدء التحليل العميق.</div>';return;}
  host.innerHTML='<div class="pda-hero"><h2>التحليل الفني العميق للمحفظة</h2><div class="muted">جارٍ تحليل كل سهم عبر الشارت، الاتجاه، الزخم، الحجم، Fibonacci، الدعم والمقاومة والسيناريوهات…</div></div><div class="pda-loading">يتم بناء السيناريوهات الفنية لكل سهم…</div>';
  try{
    if(!indexMap.size){const idx=await getJson(INDEX_URL);indexMap=new Map((idx.stocks||[]).map(x=>[String(x.ticker).toUpperCase(),x]));}
    const results=await Promise.all(portfolio.map(async h=>{try{return{ok:true,a:analyze(await history(String(h.ticker).toUpperCase()),{...h,ticker:String(h.ticker).toUpperCase()},indexMap.get(String(h.ticker).toUpperCase()))};}catch(error){return{ok:false,ticker:h.ticker,error:error.message};}}));
    const good=results.filter(x=>x.ok).map(x=>x.a),total=good.reduce((s,a)=>s+a.value,0),weighted=k=>total?good.reduce((s,a)=>s+a.model[k]*(a.value/total),0):0,bull=weighted('bull'),bear=weighted('bear'),side=weighted('side'),bias=bull-bear;
    const stance=bias>=12?'ميل صاعد':bias<=-12?'ميل هابط':'ميل مختلط/عرضي',stanceCls=bias>=12?'good':bias<=-12?'bad':'warn';
    const actions={add:good.filter(a=>/زيادة|إيجابي/.test(a.recommendation.action)).length,hold:good.filter(a=>/احتفاظ|انتظار|مراقبة/.test(a.recommendation.action)).length,reduce:good.filter(a=>/تخفيف|خفض|بيع/.test(a.recommendation.action)).length};
    host.innerHTML=`<div class="pda-hero"><h2>التحليل الفني العميق للمحفظة</h2><div class="muted">كل سهم يُحلل مستقلًا ثم تُجمع النتائج بوزن قيمة المركز داخل المحفظة.</div></div><div class="pda-summary">${summaryCard('الميل الفني للمحفظة',stance,`Bull ${fmt(bull,1)}% · Bear ${fmt(bear,1)}%`,stanceCls)}${summaryCard('سيناريو صاعد مرجح',`${fmt(bull,1)}%`,'موزون بقيمة المراكز','good')}${summaryCard('سيناريو عرضي',`${fmt(side,1)}%`,'تجميع/تذبذب','warn')}${summaryCard('سيناريو هابط',`${fmt(bear,1)}%`,'تصحيح/كسر','bad')}${summaryCard('القرارات',`${actions.add}/${actions.hold}/${actions.reduce}`,'إيجابي / احتفاظ / تخفيف')}</div><div class="pda-disclaimer">الاحتمالات المعروضة هي <b>ترجيحات فنية Evidence‑Weighted</b> وليست احتمالات إحصائية مضمونة أو توقعًا يقينيًا للسعر. تتغير تلقائيًا مع كل جلسة وبيانات جديدة.</div><div class="pda-list">${results.map(x=>x.ok?stockCard(x.a,total?x.a.value/total*100:0):`<div class="pda-stock"><div class="pda-empty">${esc(x.ticker)} — تعذر التحليل: ${esc(x.error)}</div></div>`).join('')}</div>`;
  }catch(error){host.innerHTML=`<div class="pda-hero"><h2>التحليل الفني العميق للمحفظة</h2></div><div class="pda-empty">تعذر بناء التحليل: ${esc(error.message)}</div>`;}
}

function schedule(){clearTimeout(renderTimer);renderTimer=setTimeout(render,180);}
function boot(){schedule();const rows=document.getElementById('rows');if(rows)new MutationObserver(schedule).observe(rows,{childList:true,subtree:true,characterData:true});window.addEventListener('storage',e=>{if(e.key===KEY)schedule();});document.addEventListener('click',e=>{if(e.target.closest('#add,[data-del],#clearBtn'))setTimeout(schedule,80);});document.getElementById('file')?.addEventListener('change',()=>setTimeout(schedule,250));}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();