import { marketPhase, quoteFreshness } from './session-monitor-core.js';

const API='/api/index';
const INTRADAY_API='/api/intraday';
const AUTO_REFRESH_MS=300_000;
const POST_CLOSE_MANAGER_MS=600_000;
const EOD_KEY='egx-tfe-rc2-v169-eod-manager';
const EXP_KEY='egx-tfe-rc2-v169-portfolio';
const PANEL_ID='rc2LivePortfolioPanel';
const BANNER_ID='rc2LiveRefreshBanner';

const n=v=>Number.isFinite(Number(v))?Number(v):null;
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,d=3)=>n(v)===null?'—':Number(v).toLocaleString('en-GB',{maximumFractionDigits:d});
const pct=v=>n(v)===null?'—':`${fmt(v,2)}%`;
const money=v=>n(v)===null?'—':`${Number(v).toLocaleString('en-GB',{maximumFractionDigits:0})} ج.م`;
const load=(k,f)=>{try{return JSON.parse(localStorage.getItem(k)||'null')??f}catch{return f}};

let latestScan=window.__RC2_UI_SCAN__?.scan||null;
let latestEffectiveDate=window.__RC2_UI_SCAN__?.effectiveDate||null;
let busy=false,lastQuoteAt=0,lastPmRun=0;

function holdings(){
  const rows=[];
  const eod=load(EOD_KEY,{});
  for(const h of Array.isArray(eod.holdings)?eod.holdings:[]){
    if(h?.ticker&&n(h.qty)>0&&n(h.avgCost)>0)rows.push({source:'مدير المحفظة',ticker:String(h.ticker).toUpperCase(),qty:n(h.qty),avg:n(h.avgCost),stop:n(h.stop)});
  }
  const exp=load(EXP_KEY,[]);
  for(const h of Array.isArray(exp)?exp:[]){
    if(h?.ticker&&n(h.qty)>0&&n(h.entry)>0)rows.push({source:'المحفظة التجريبية',ticker:String(h.ticker).toUpperCase(),qty:n(h.qty),avg:n(h.entry),stop:n(h.stop),id:h.id});
  }
  return rows;
}
function uniqueTickers(rows){return [...new Set(rows.map(x=>x.ticker).filter(Boolean))]}
function chunks(a,size=10){const out=[];for(let i=0;i<a.length;i+=size)out.push(a.slice(i,i+size));return out}

async function intradayBatch(tickers){
  const q=new URLSearchParams({tickers:tickers.join(','),t:String(Date.now())});
  const r=await fetch(`${INTRADAY_API}?${q}`,{cache:'no-store'}),d=await r.json().catch(()=>({}));
  if(!r.ok||!d.ok)throw new Error(d.error||`INTRADAY_HTTP_${r.status}`);
  return d;
}

async function historyFallback(ticker){
  const q=new URLSearchParams({route:'history',ticker,limit:'3',t:String(Date.now())});
  const r=await fetch(`${API}?${q}`,{cache:'no-store'}),d=await r.json().catch(()=>({}));
  if(!r.ok||!d.ok)throw new Error(d.error||`HISTORY_HTTP_${r.status}`);
  const bar=Array.isArray(d.bars)?d.bars.at(-1):null;
  const price=n(bar?.close),date=bar?.date||d.lastSession||null;
  if(!(price>0)||!date)throw new Error('HISTORY_CLOSE_UNAVAILABLE');
  const phase=marketPhase();
  if(phase.phase==='OPEN'&&date>=phase.date)throw new Error('HISTORY_CURRENT_BAR_NOT_USED_DURING_OPEN');
  return {
    ticker,
    quote:{
      price,open:n(bar?.open),high:n(bar?.high),low:n(bar?.low),volume:n(bar?.volume),
      sourceSessionDate:date,sourceMarketTime:'14:30',sourceMarketMinutes:870,
      delayedMinutes:0,fetchedAt:new Date().toISOString(),source:'HISTORY_LAST_CLOSE'
    },
    fallback:'HISTORY_LAST_CLOSE'
  };
}

async function quotesFor(tickers){
  const map=new Map(),errors=[];
  for(const group of chunks(tickers,10)){
    try{
      const d=await intradayBatch(group);
      for(const x of d.results||[])if(x?.ticker)map.set(String(x.ticker).toUpperCase(),x);
    }catch{}
  }
  const missing=tickers.filter(t=>!map.has(t));
  const fallback=await Promise.all(missing.map(async ticker=>{
    try{return await historyFallback(ticker)}catch(e){errors.push({ticker,error:e.message});return null}
  }));
  for(const x of fallback)if(x?.ticker)map.set(x.ticker,x);
  return {map,errors};
}

function ensureStyle(){
  if(document.getElementById('rc2LiveRefreshStyle'))return;
  const x=document.createElement('style');x.id='rc2LiveRefreshStyle';
  x.textContent=`#${BANNER_ID},#${PANEL_ID}{border-color:#287e79;background:linear-gradient(145deg,#08252d,#091b29)}#${BANNER_ID}{margin:0 0 14px;padding:12px 14px}#${BANNER_ID} .lr-row{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}#${BANNER_ID} .lr-recs{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}.lr-chip{padding:5px 8px;border:1px solid #2d6c72;border-radius:999px;font-size:10px}.lr-chip.good{color:#caffdf;border-color:#2d7b5b}.lr-chip.warn{color:#ffe2a2;border-color:#86682d}#${PANEL_ID}{margin:0 0 14px}#${PANEL_ID} .lr-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:10px 0}#${PANEL_ID} .lr-k{padding:9px;border:1px solid #24485b;border-radius:9px;background:#071923}#${PANEL_ID} .lr-k small{display:block;color:#8faabb;font-size:9px}#${PANEL_ID} table small{color:#91adbd}.lr-good{color:#72e4ab}.lr-bad{color:#ff8d98}.lr-warn{color:#ffd77e}@media(max-width:780px){#${PANEL_ID} .lr-kpis{grid-template-columns:1fr 1fr}}`;
  document.head.appendChild(x);
}
function ensureBanner(){
  ensureStyle();let p=document.getElementById(BANNER_ID);if(p)return p;
  p=document.createElement('article');p.id=BANNER_ID;p.className='panel';
  const dash=document.getElementById('view-dashboard'),hero=dash?.querySelector('.hero-grid');
  if(hero)hero.insertAdjacentElement('afterend',p);else dash?.prepend(p);return p;
}
function ensurePanel(){
  ensureStyle();let p=document.getElementById(PANEL_ID);if(p)return p;
  p=document.createElement('article');p.id=PANEL_ID;p.className='panel';
  const v=document.getElementById('view-portfolio'),pm=document.getElementById('pmDesk');
  if(pm)pm.insertAdjacentElement('afterend',p);else v?.prepend(p);return p;
}
function effectiveDate(scan){
  const dates=[scan?.universe?.sessionDate,...(scan?.recommendations||[]).map(x=>x?.sessionDate)].filter(Boolean).sort();
  return dates.at(-1)||null;
}
function latestArchivedSnapshotDate(){
  try {
    const rows=JSON.parse(localStorage.getItem('egx-tfe-rc2-v169-forward-archive')||'[]');
    return Array.isArray(rows)?rows.map(x=>x?.sessionDate).filter(Boolean).sort().at(-1)||null:null;
  } catch { return null; }
}
function renderSessionFreshness(){
  const box=document.getElementById('opsFreshness'),scan=latestScan;if(!box||!scan)return;
  const dataSession=effectiveDate(scan),snapshot=latestArchivedSnapshotDate();
  const published=Number(scan?.publicationEligibleTotal??scan?.summary?.publicationEligibleTotal??scan?.universe?.publicationEligibleTotal??(scan?.recommendations||[]).length);
  if(!dataSession||!(snapshot&&dataSession>snapshot))return;
  const phase=marketPhase();
  const none=Number.isFinite(published)&&published===0;
  const label=none?`جلسة ${dataSession}: لا توصيات جديدة`:`جلسة البيانات ${dataSession}`;
  const detail=none
    ?`تم تحديث وفحص جلسة ${dataSession}؛ 0 سهم اجتاز بوابات النشر. Snapshot ${snapshot} سجل متابعة تاريخي فقط. السوق مغلق الآن (${phase.phase}).`
    :`جلسة البيانات ${dataSession} أحدث من Snapshot ${snapshot}. لا يُعرض السجل القديم كتوصية حالية؛ حالة السوق ${phase.phase}.`;
  box.innerHTML=`<div class="ops-head"><div><h3>حداثة التوصية</h3><p>فصل واضح بين جلسة البيانات وآخر Snapshot منشور.</p></div><span class="ops-pill ${none?'warn':'neutral'}">${esc(label)}</span></div><div class="ops-note ${none?'warn':''}">${esc(detail)}</div>`;
}

function renderBanner(){
  const p=ensureBanner(),scan=latestScan,date=latestEffectiveDate||effectiveDate(scan),recs=(scan?.recommendations||[]).slice(0,8),universe=scan?.universe?.sessionDate;
  p.innerHTML=`<div class="lr-row"><div><b>المزامنة التلقائية مفعلة</b><div><small>آخر بيانات فعلية: ${esc(date||'—')}${universe&&date&&universe!==date?` · Universe summary ${esc(universe)}`:''} · تحديث كل 5 دقائق</small></div></div><button class="btn" id="lrRefreshNow">تحديث الآن</button></div><div class="lr-recs">${recs.length?recs.map(r=>`<span class="lr-chip good"><b>${esc(r.ticker)}</b> ${fmt(r.price,4)} · Fusion ${fmt(r.scores?.fusionRank,1)} · ${esc(r.sessionDate||date||'—')}</span>`).join(''):'<span class="lr-chip warn">لا توجد توصيات منشورة في آخر Scan.</span>'}</div>`;
  p.querySelector('#lrRefreshNow').onclick=()=>document.getElementById('refreshBtn')?.click();
  renderSessionFreshness();
}
function usablePrice(result){
  const fresh=quoteFreshness(result?.quote);
  const allowed=['DELAYED_LIVE','LAGGING','CLOSED_SESSION','PRE_OPEN_REFERENCE','MARKET_CLOSED'];
  return {fresh,price:allowed.includes(fresh.state)?n(result?.quote?.price):null};
}
function renderPortfolio(rows,q){
  const p=ensurePanel(),now=new Date().toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
  let priced=0,total=0,cost=0;
  const body=rows.map(h=>{
    const r=q.map.get(h.ticker),u=usablePrice(r),price=u.price,value=price>0?h.qty*price:null,pnl=price>0&&h.avg>0?(price/h.avg-1)*100:null,pnlCash=value!==null?value-h.qty*h.avg:null;
    if(value!==null){priced++;total+=value;cost+=h.qty*h.avg}
    const sourceLabel=r?.fallback==='HISTORY_LAST_CLOSE'?'آخر إغلاق متاح من History':u.fresh.labelAr||'غير متاح';
    return `<tr><td><b>${esc(h.ticker)}</b><br><small>${esc(h.source)}</small></td><td>${fmt(price,4)}</td><td>${fmt(h.avg,4)}</td><td>${fmt(h.qty,0)}</td><td>${money(value)}</td><td class="${pnl>0?'lr-good':pnl<0?'lr-bad':''}">${pct(pnl)}<br><small>${money(pnlCash)}</small></td><td>${fmt(h.stop,4)}</td><td><small>${esc(sourceLabel)}<br>${esc(r?.quote?.sourceSessionDate||'—')} ${esc(r?.quote?.sourceMarketTime||'')}</small></td></tr>`;
  }).join('');
  const totalPnl=priced?total-cost:null;
  p.innerHTML=`<div class="panel-head split"><div><h2>المحفظة — أسعار ونتائج محدثة</h2><p>أثناء الجلسة: مصدر متأخر. بعد الإغلاق/قبل الافتتاح: آخر Close متاح من History عند غياب المصدر المتأخر.</p></div><span class="badge neutral">آخر تحديث ${esc(now)}</span></div><div class="lr-kpis"><div class="lr-k"><small>المراكز</small><b>${rows.length}</b></div><div class="lr-k"><small>مراكز مسعّرة</small><b>${priced}/${rows.length}</b></div><div class="lr-k"><small>القيمة الحالية المعروفة</small><b>${money(priced?total:null)}</b></div><div class="lr-k"><small>P/L المعروف</small><b class="${totalPnl>0?'lr-good':totalPnl<0?'lr-bad':''}">${money(totalPnl)}</b></div></div>${rows.length?`<div class="table-wrap"><table><thead><tr><th>السهم</th><th>السعر الحالي/آخر إغلاق</th><th>متوسط/مرجع الدخول</th><th>الكمية</th><th>القيمة</th><th>P/L</th><th>Stop</th><th>المصدر</th></tr></thead><tbody>${body}</tbody></table></div>`:'<div class="rc2-note">لا توجد مراكز محفوظة حاليًا.</div>'}${q.errors.length?`<div class="rc2-note">تعذر تسعير ${q.errors.length} مركز؛ لم يتم اختراع سعر بديل.</div>`:''}<div class="rc2-note">scoringImpact=NONE · recommendationMutationAllowed=false · executionAllowed=false</div>`;
}
async function refreshQuotes(){
  if(busy)return;busy=true;
  try{
    const rows=holdings(),tickers=uniqueTickers(rows),q=tickers.length?await quotesFor(tickers):{map:new Map(),errors:[]};
    lastQuoteAt=Date.now();renderPortfolio(rows,q);renderBanner();
    const phase=marketPhase();
    if(phase.phase==='POST_CLOSE'&&Date.now()-lastPmRun>POST_CLOSE_MANAGER_MS){const b=document.getElementById('pmRun');if(b&&!b.disabled){lastPmRun=Date.now();b.click()}}
  }catch(e){ensurePanel().innerHTML=`<div class="rc2-note">تعذر تحديث أسعار المحفظة: ${esc(e.message)}. لا توجد أسعار مفترضة.</div>`}
  finally{busy=false}
}

window.addEventListener('rc2:ui-scan',e=>{latestScan=e.detail?.scan||latestScan;latestEffectiveDate=e.detail?.effectiveDate||effectiveDate(latestScan);renderBanner();if(Date.now()-lastQuoteAt>60_000)void refreshQuotes()});
window.addEventListener('storage',e=>{if([EOD_KEY,EXP_KEY].includes(e.key))void refreshQuotes()});
document.addEventListener('click',e=>{if(['pmAdd','pmRun','addPortfolioBtn'].includes(e.target?.id))setTimeout(()=>void refreshQuotes(),500)});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-lastQuoteAt>120_000)void refreshQuotes()});
setInterval(()=>{if(document.visibilityState==='visible')void refreshQuotes()},AUTO_REFRESH_MS);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>void refreshQuotes(),1800),{once:true});else setTimeout(()=>void refreshQuotes(),1800);
