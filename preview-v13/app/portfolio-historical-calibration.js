(()=>{
'use strict';
if(window.__EGX_PORTFOLIO_HISTORICAL_CALIBRATION__)return;
window.__EGX_PORTFOLIO_HISTORICAL_CALIBRATION__=true;

const KEY='egx-v137-portfolio';
const BASE=new URL('../../',location.href);
const HISTORY_URL=t=>new URL(`data/history/${encodeURIComponent(t)}.json`,BASE).href;
const cache=new Map();
let timer=null,running=false,lastSignature='';

const num=v=>Number.isFinite(Number(v))?Number(v):null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const median=a=>{const x=a.filter(Number.isFinite).sort((p,q)=>p-q);if(!x.length)return null;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2;};
const fmt=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString('ar-EG',{maximumFractionDigits:d}):'—';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=(cur,prev)=>Number.isFinite(cur)&&Number.isFinite(prev)&&prev!==0?(cur/prev-1)*100:null;

function portfolio(){try{const p=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(p)?p:[];}catch{return[];}}
async function getJson(url){const r=await fetch(`${url}?cal=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();}
async function history(ticker){if(!cache.has(ticker))cache.set(ticker,getJson(HISTORY_URL(ticker)));return cache.get(ticker);}
function cleanRows(doc){return (doc?.sessions||[]).filter(r=>[r.open,r.high,r.low,r.close].every(v=>Number.isFinite(Number(v)))).sort((a,b)=>String(a.date||a.sessionDate||'').localeCompare(String(b.date||b.sessionDate||'')));}

function emaSeries(values,period){const out=Array(values.length).fill(null);if(values.length<period)return out;const k=2/(period+1);let cur=mean(values.slice(0,period));out[period-1]=cur;for(let i=period;i<values.length;i++){cur=values[i]*k+cur*(1-k);out[i]=cur;}return out;}
function ema(values,period){const s=emaSeries(values,period);return [...s].reverse().find(Number.isFinite)??null;}
function rsi(values,period=14){if(values.length<=period)return null;let g=0,l=0;for(let i=values.length-period;i<values.length;i++){const d=values[i]-values[i-1];if(d>=0)g+=d;else l-=d;}if(l===0)return 100;const rs=(g/period)/(l/period);return 100-(100/(1+rs));}
function atr(rows,period=14){if(rows.length<=period)return null;const tr=[];for(let i=1;i<rows.length;i++){const h=num(rows[i].high),lo=num(rows[i].low),pc=num(rows[i-1].close);if([h,lo,pc].every(Number.isFinite))tr.push(Math.max(h-lo,Math.abs(h-pc),Math.abs(lo-pc)));}return tr.length>=period?mean(tr.slice(-period)):null;}
function macd(values){const e12=emaSeries(values,12),e26=emaSeries(values,26),line=values.map((_,i)=>Number.isFinite(e12[i])&&Number.isFinite(e26[i])?e12[i]-e26[i]:null),compact=line.filter(Number.isFinite);if(compact.length<9)return{line:null,signal:null,hist:null};const signal=ema(compact,9),latest=[...line].reverse().find(Number.isFinite);return{line:latest,signal,hist:Number.isFinite(latest)&&Number.isFinite(signal)?latest-signal:null};}
function volumeRatio(rows,period=20){const vols=rows.map(r=>num(r.volume)).filter(Number.isFinite);if(vols.length<period+1)return null;const latest=vols.at(-1),avg=mean(vols.slice(-(period+1),-1));return avg?latest/avg:null;}
function slopePct(values,period=20){const v=values.slice(-period);if(v.length<period)return null;const base=mean(v);if(!base)return null;const n=v.length,mx=(n-1)/2,my=mean(v);let top=0,bot=0;v.forEach((y,x)=>{top+=(x-mx)*(y-my);bot+=(x-mx)**2;});return bot?(top/bot)/base*100:null;}

function stateAt(rows,end){
  if(end<54)return null;
  const w=rows.slice(0,end+1),closes=w.map(r=>Number(r.close)),price=closes.at(-1),e20=ema(closes,20),e50=ema(closes,50),r=rsi(closes),m=macd(closes),vr=volumeRatio(w),a=atr(w),ret5=closes.length>5?pct(price,closes.at(-6)):null,ret20=closes.length>20?pct(price,closes.at(-21)):null,sl=slopePct(closes,20);
  if(![price,e20,e50,r,a].every(Number.isFinite))return null;
  return{
    price,
    priceEma20Pct:pct(price,e20),
    emaGapPct:pct(e20,e50),
    rsi:r,
    macdPct:Number.isFinite(m.hist)?m.hist/price*100:0,
    volumeRatio:Number.isFinite(vr)?vr:1,
    ret5:Number.isFinite(ret5)?ret5:0,
    ret20:Number.isFinite(ret20)?ret20:0,
    atrPct:a/price*100,
    slope20:Number.isFinite(sl)?sl:0
  };
}
function componentDistance(a,b){
  const parts=[
    [a.priceEma20Pct,b.priceEma20Pct,5,.16],
    [a.emaGapPct,b.emaGapPct,4,.16],
    [a.rsi,b.rsi,22,.15],
    [a.macdPct,b.macdPct,1.6,.13],
    [a.volumeRatio,b.volumeRatio,1.2,.08],
    [a.ret5,b.ret5,9,.10],
    [a.ret20,b.ret20,18,.10],
    [a.atrPct,b.atrPct,3,.07],
    [a.slope20,b.slope20,.7,.05]
  ];
  return parts.reduce((s,[x,y,scale,w])=>s+w*clamp(Math.abs(x-y)/scale,0,2.2),0);
}
function thresholdFor(state,h){return Math.max(h===1?.8:h===3?1.35:1.8,.48*state.atrPct*Math.sqrt(h));}
function weightedHorizon(matches,h){
  const rows=[];let bull=0,side=0,bear=0,sumW=0,exp=0,pos=0;
  for(const m of matches){
    const end=m.index+h;if(end>=m.rows.length)continue;
    const ret=pct(Number(m.rows[end].close),Number(m.rows[m.index].close));if(!Number.isFinite(ret))continue;
    const th=thresholdFor(m.state,h),w=m.sim;
    if(ret>th)bull+=w;else if(ret<-th)bear+=w;else side+=w;
    sumW+=w;exp+=w*ret;if(ret>0)pos+=w;rows.push(ret);
  }
  if(!sumW)return null;
  const prior=.55,den=sumW+prior*3;
  return{h,n:rows.length,bull:(bull+prior)/den*100,side:(side+prior)/den*100,bear:(bear+prior)/den*100,expected:exp/sumW,median:median(rows),positivePct:pos/sumW*100,best:Math.max(...rows),worst:Math.min(...rows)};
}
function calibrate(rows){
  if(rows.length<65)return{ready:false,reason:`السجل المتاح ${rows.length} جلسة؛ نحتاج 65 جلسة على الأقل للمعايرة.`};
  const current=stateAt(rows,rows.length-1);if(!current)return{ready:false,reason:'تعذر بناء بصمة فنية للحالة الحالية.'};
  const candidates=[];
  for(let i=54;i<=rows.length-6;i++){
    const st=stateAt(rows,i);if(!st)continue;
    const d=componentDistance(current,st),sim=Math.exp(-1.55*d);
    candidates.push({index:i,state:st,sim,d,rows,date:rows[i].date||rows[i].sessionDate||''});
  }
  candidates.sort((a,b)=>b.sim-a.sim);
  let matches=candidates.filter(x=>x.sim>=.18).slice(0,24);if(matches.length<10)matches=candidates.slice(0,Math.min(14,candidates.length));
  if(matches.length<8)return{ready:false,reason:`الحالات التاريخية المشابهة غير كافية (${matches.length}).`};
  const h1=weightedHorizon(matches,1),h3=weightedHorizon(matches,3),h5=weightedHorizon(matches,5);if(!h1||!h3||!h5)return{ready:false,reason:'تعذر حساب نتائج ما بعد الحالات المشابهة.'};
  const mix=(key)=>.2*h1[key]+.35*h3[key]+.45*h5[key];
  const empirical={bull:mix('bull'),side:mix('side'),bear:mix('bear')};
  const avgSim=mean(matches.map(x=>x.sim)),quality=clamp(avgSim*clamp(matches.length/18,0,1),0,1);
  const sampleLabel=matches.length>=18&&avgSim>=.55?'قوية':matches.length>=12&&avgSim>=.4?'متوسطة':'محدودة';
  return{ready:true,current,matches,horizons:[h1,h3,h5],empirical,avgSimilarity:avgSim*100,quality,sampleLabel,latestMatchDate:matches[0]?.date||null};
}

function evidenceProbabilities(card){
  const p=[...card.querySelectorAll('.pta-prob-grid .pta-prob')].map(el=>{const t=el.textContent||'',m=t.match(/([0-9]+(?:[.,][0-9]+)?)\s*%/);return m?Number(m[1].replace(',','.')):null;});
  if(p.length<3||p.some(x=>!Number.isFinite(x)))return{bull:33,side:34,bear:33};
  return{bull:p[0],side:p[1],bear:p[2]};
}
function blend(evidence,cal){
  const alpha=clamp(.28+.42*cal.quality,.28,.68),final={};
  for(const k of ['bull','side','bear'])final[k]=evidence[k]*(1-alpha)+cal.empirical[k]*alpha;
  const sum=final.bull+final.side+final.bear;for(const k of ['bull','side','bear'])final[k]=final[k]/sum*100;
  const sorted=Object.entries(final).sort((a,b)=>b[1]-a[1]),spread=sorted[0][1]-sorted[1][1];
  return{...final,alpha,dominant:sorted[0][0],spread,confidence:spread>=15&&cal.sampleLabel==='قوية'?'مرتفع':spread>=8&&cal.sampleLabel!=='محدودة'?'متوسط':'منخفض'};
}
function labelFor(k){return k==='bull'?'صاعد':k==='bear'?'هابط':'عرضي';}
function bar(label,value,cls){return `<div class="phc-prob"><div><span>${esc(label)}</span><b>${fmt(value,1)}%</b></div><div class="phc-track"><i class="${cls}" style="width:${clamp(value,0,100)}%"></i></div></div>`;}
function horizonRow(h){return `<tr><td>${h.h} جلسة</td><td>${h.n}</td><td class="phc-pos">${fmt(h.bull,1)}%</td><td>${fmt(h.side,1)}%</td><td class="phc-neg">${fmt(h.bear,1)}%</td><td>${fmt(h.expected,2)}%</td><td>${fmt(h.median,2)}%</td><td>${fmt(h.positivePct,1)}%</td></tr>`;}
function calibrationPanel(ticker,cal,final){
  if(!cal.ready)return `<section class="phc-panel phc-limited"><div class="phc-title"><b>المعايرة التاريخية</b><span>${esc(cal.reason)}</span></div></section>`;
  return `<section class="phc-panel"><div class="phc-title"><div><b>المعايرة التاريخية للحالة الفنية</b><span>${cal.matches.length} حالة مشابهة · متوسط التشابه ${fmt(cal.avgSimilarity,1)}% · جودة العينة ${esc(cal.sampleLabel)}</span></div><div class="phc-final"><small>الترجيح النهائي المعاير</small><b>${esc(labelFor(final.dominant))} ${fmt(final[final.dominant],1)}%</b><span>ثقة ${esc(final.confidence)} · وزن الدليل التاريخي ${fmt(final.alpha*100,0)}%</span></div></div><div class="phc-probs">${bar('صاعد',final.bull,'bull')}${bar('عرضي',final.side,'side')}${bar('هابط',final.bear,'bear')}</div><div class="phc-table"><table><thead><tr><th>الأفق</th><th>العينة</th><th>صاعد تاريخيًا</th><th>عرضي</th><th>هابط</th><th>متوسط العائد</th><th>الوسيط</th><th>عائد موجب</th></tr></thead><tbody>${cal.horizons.map(horizonRow).join('')}</tbody></table></div><div class="phc-note">المعايرة تقارن بصمة ${esc(ticker)} الحالية مع أقرب الحالات السابقة في EMA/RSI/MACD/الحجم/الزخم/ATR، ثم تقيس ما حدث فعليًا بعدها. هي تقدير تجريبي مشروط بالعينة وليست ضمانًا لمسار السعر.</div></section>`;
}

function ensureStyle(){if(document.getElementById('portfolioHistoricalCalibrationStyle'))return;const s=document.createElement('style');s.id='portfolioHistoricalCalibrationStyle';s.textContent=`
.phc-panel{margin:0 11px 11px;padding:11px;border:1px solid #35586c;background:#081c29;border-radius:10px}.phc-title{display:flex;justify-content:space-between;gap:10px;align-items:center}.phc-title>div:first-child>b{display:block;font-size:13px}.phc-title span{display:block;color:#91adba;font-size:10px;margin-top:4px}.phc-final{min-width:210px;padding:8px 10px;background:#0d2939;border:1px solid #31576a;border-radius:9px}.phc-final small,.phc-final span{display:block;font-size:9px;color:#92adba}.phc-final b{display:block;margin:3px 0;font-size:14px}.phc-probs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:9px}.phc-prob{background:#0c2636;border:1px solid #294b5c;border-radius:8px;padding:7px}.phc-prob>div:first-child{display:flex;justify-content:space-between;font-size:10px}.phc-track{height:6px;margin-top:6px;background:#173647;border-radius:99px;overflow:hidden}.phc-track i{display:block;height:100%}.phc-track .bull{background:#39c58c}.phc-track .side{background:#d5aa4d}.phc-track .bear{background:#e16c77}.phc-table{overflow:auto;margin-top:9px}.phc-table table{min-width:680px;background:#091d2a}.phc-table th,.phc-table td{font-size:9px;padding:7px}.phc-pos{color:#49d69c}.phc-neg{color:#f07d87}.phc-note{font-size:9px;color:#8ca8b5;line-height:1.7;margin-top:8px}.phc-limited{color:#d9b96c}.phc-portfolio{margin:0 12px 12px;padding:11px;border:1px solid #345a6e;background:#0a2231;border-radius:10px}.phc-portfolio h3{margin:0 0 4px;font-size:14px}.phc-portfolio .phc-probs{margin-top:8px}.phc-portfolio-meta{font-size:10px;color:#91adba;line-height:1.6}
@media(max-width:700px){.phc-title{align-items:stretch;flex-direction:column}.phc-final{min-width:0}.phc-probs{grid-template-columns:1fr}}
`;document.head.appendChild(s);}

function tickerFromCard(card){const h=card.querySelector('.pta-stock-head h3');return String(h?.firstChild?.textContent||h?.textContent||'').trim().split(/\s+/)[0].toUpperCase();}
function holdingMap(){return new Map(portfolio().map(h=>[String(h.ticker||'').toUpperCase(),h]));}
async function applyCard(card,holdings){
  const ticker=tickerFromCard(card);if(!ticker)return null;
  const doc=await history(ticker),rows=cleanRows(doc),cal=calibrate(rows),evidence=evidenceProbabilities(card),final=cal.ready?blend(evidence,cal):null;
  card.querySelector('.phc-panel')?.remove();
  const target=card.querySelector('.pta-prob-grid');if(target)target.insertAdjacentHTML('afterend',calibrationPanel(ticker,cal,final||{bull:evidence.bull,side:evidence.side,bear:evidence.bear,dominant:'side',confidence:'منخفض',alpha:0}));
  const h=holdings.get(ticker),qty=num(h?.quantity)||0,price=rows.length?Number(rows.at(-1).close):0,value=qty*price;
  return{ticker,ready:cal.ready,final,value,cal};
}
function portfolioPanel(results){
  const ready=results.filter(r=>r?.ready&&r.final&&r.value>0);if(!ready.length)return'';const total=ready.reduce((s,r)=>s+r.value,0),w=k=>ready.reduce((s,r)=>s+r.final[k]*(r.value/total),0),bull=w('bull'),side=w('side'),bear=w('bear'),sorted=[['bull',bull],['side',side],['bear',bear]].sort((a,b)=>b[1]-a[1]),avgQuality=mean(ready.map(r=>r.cal.quality))*100;
  return `<div class="phc-portfolio"><h3>الترجيح التاريخي المعاير للمحفظة</h3><div class="phc-portfolio-meta">يُجمع بعد معايرة كل سهم تاريخيًا ثم يُوزن حسب قيمة المركز. أسهم معايرة: ${ready.length} · جودة تاريخية مجمعة تقريبية ${fmt(avgQuality,1)}% · السيناريو الأعلى ${labelFor(sorted[0][0])}.</div><div class="phc-probs">${bar('صاعد معاير',bull,'bull')}${bar('عرضي معاير',side,'side')}${bar('هابط معاير',bear,'bear')}</div></div>`;
}
async function run(){
  if(running)return;const host=document.getElementById('portfolioTechnicalAnalysis');if(!host)return;const cards=[...host.querySelectorAll('.pta-stock')].filter(c=>c.querySelector('.pta-prob-grid'));if(!cards.length)return;
  const sig=cards.map(tickerFromCard).join('|')+'|'+(host.querySelector('.pta-hero')?.textContent||'');if(sig===lastSignature&&cards.every(c=>c.querySelector('.phc-panel')))return;
  running=true;ensureStyle();try{
    const d=host.querySelector('.pta-disclaimer');if(d)d.innerHTML='النسب الأساسية أعلى كل سهم هي <b>Evidence‑Weighted</b>. أسفلها يضيف النظام <b>معايرة تاريخية Walk‑Forward</b> مبنية على الحالات السابقة المشابهة ونتائج 1/3/5 جلسات، ثم يمزج الدليل الفني مع الدليل التاريخي مع خفض وزن التاريخ تلقائيًا عند ضعف العينة.';
    const holdings=holdingMap(),results=[];for(const card of cards){try{results.push(await applyCard(card,holdings));}catch(error){const ticker=tickerFromCard(card);card.querySelector('.phc-panel')?.remove();card.querySelector('.pta-prob-grid')?.insertAdjacentHTML('afterend',`<section class="phc-panel phc-limited"><div class="phc-title"><b>المعايرة التاريخية ${esc(ticker)}</b><span>تعذر الحساب: ${esc(error.message)}</span></div></section>`);}}
    host.querySelector('.phc-portfolio')?.remove();const html=portfolioPanel(results);if(html){const list=host.querySelector('.pta-list');if(list)list.insertAdjacentHTML('beforebegin',html);}
    lastSignature=sig;
  }finally{running=false;}
}
function schedule(){clearTimeout(timer);timer=setTimeout(run,350);}
function boot(){ensureStyle();schedule();const root=document.querySelector('.wrap')||document.body;new MutationObserver(m=>{if(m.some(x=>[...x.addedNodes].some(n=>n.nodeType===1&&(n.matches?.('#portfolioTechnicalAnalysis,.pta-stock')||n.querySelector?.('.pta-stock')))))schedule();}).observe(root,{childList:true,subtree:true});window.addEventListener('storage',e=>{if(e.key===KEY){lastSignature='';schedule();}});document.addEventListener('click',e=>{if(e.target.closest('#add,[data-del],#clearBtn')){lastSignature='';setTimeout(schedule,500);}});document.getElementById('file')?.addEventListener('change',()=>{lastSignature='';setTimeout(schedule,700);});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();