const ARCHIVE_KEY='egx-tfe-rc2-v169-forward-archive';
const GUARD_ID='rc2SnapshotDateGuard';
const PANEL_GUARD_ID='rc2SessionSnapshotGuard';
const MARKET_GUARD_ID='rc2MarketFreshnessGuard';
const HOTFIX_ID='V16_MARKET_TRUTH_UI_HOTFIX_20260910_1';

const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate=value=>{
  const s=String(value||'');
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?`${Number(m[3])}/${Number(m[2])}/${m[1]}`:(s||'—');
};
const setHtml=(el,html)=>{if(el&&el.innerHTML!==html)el.innerHTML=html};
const setText=(el,text)=>{if(el&&el.textContent!==text)el.textContent=text};

function archiveRows(){
  try{
    const rows=JSON.parse(localStorage.getItem(ARCHIVE_KEY)||'[]');
    return Array.isArray(rows)?rows:[];
  }catch{return []}
}

function latestSnapshotDate(){
  return archiveRows().map(x=>x?.sessionDate).filter(Boolean).sort().at(-1)||null;
}

let marketTruth=null;
let marketFetchAt=0;
let marketLoading=false;

function summarizeMarket(market){
  const symbols=Array.isArray(market?.symbols)?market.symbols:[];
  const sessionDate=market?.sessionDate||market?.latestMarketSession||null;
  const byTicker=new Map(symbols.map(row=>[String(row?.ticker||'').toUpperCase(),row]));
  let current=0,lagged=0,unverified=0,review=0;
  for(const row of symbols){
    const verified=row?.symbolVerified===true;
    const last=String(row?.lastSession||'');
    const isLagged=Boolean(verified&&last&&sessionDate&&(row?.staleData===true||row?.sessionLagged===true||last<sessionDate));
    const isCurrent=Boolean(verified&&last&&sessionDate&&last===sessionDate&&row?.staleData!==true&&row?.updateFailed!==true);
    if(!verified||!last)unverified++;
    else if(isLagged)lagged++;
    else if(isCurrent)current++;
    else review++;
  }
  return {sessionDate,symbols,byTicker,total:symbols.length,current,lagged,unverified,review,generatedAt:market?.generatedAt||null};
}

function marketFromUi(){
  const market=window.__RC2_UI_SCAN__?.market;
  return Array.isArray(market?.symbols)&&market.symbols.length?summarizeMarket(market):null;
}

async function loadMarketTruth(force=false){
  const embedded=marketFromUi();
  if(embedded?.symbols?.length){marketTruth=embedded;return embedded}
  const now=Date.now();
  if(marketLoading)return marketTruth;
  if(!force&&marketTruth&&now-marketFetchAt<60000)return marketTruth;
  marketLoading=true;
  marketFetchAt=now;
  try{
    const response=await fetch(`/api/index?route=market-index&t=${now}`,{cache:'no-store',headers:{accept:'application/json'}});
    if(!response.ok)throw new Error(`market-index HTTP ${response.status}`);
    const json=await response.json();
    marketTruth=summarizeMarket(json);
    scheduleApply();
    return marketTruth;
  }catch(error){
    console.warn(HOTFIX_ID,'market truth fetch failed',error);
    return marketTruth;
  }finally{marketLoading=false}
}

function currentMeta(){
  const payload=window.__RC2_UI_SCAN__||{};
  const scan=payload.scan||{};
  const market=payload.market||{};
  const currentDate=payload.effectiveDate||scan?.universe?.sessionDate||market?.sessionDate||marketTruth?.sessionDate||null;
  return {
    currentDate,
    scanned:Number(scan?.summary?.scanned??marketTruth?.current??0),
    published:Number(scan?.summary?.publicationEligibleTotal??scan?.recommendations?.length??0),
    engine:scan?.engine||'TFE_V20_FUSION_RC2'
  };
}

function ensureDashboardGuard(){
  const grid=document.getElementById('recommendationGrid');
  const panel=grid?.closest('.panel');
  if(!panel)return null;
  let guard=document.getElementById(GUARD_ID);
  if(!guard){
    guard=document.createElement('div');
    guard.id=GUARD_ID;
    guard.className='rc2-note';
    guard.style.cssText='margin:10px 0 12px;border-color:#347f7a;background:#092a2f;line-height:1.8';
    grid.insertAdjacentElement('beforebegin',guard);
  }
  return guard;
}

function marketTruthLine(){
  if(!marketTruth?.sessionDate)return '';
  const extra=marketTruth.review?` · مراجعة أخرى ${esc(marketTruth.review)}`:'';
  return `<br><span style="color:#cfeef0"><b>حقيقة لقطة السوق ${esc(fmtDate(marketTruth.sessionDate))}:</b> محدث ${esc(marketTruth.current)} · متأخر ${esc(marketTruth.lagged)} · غير متحقق ${esc(marketTruth.unverified)}${extra} · الإجمالي ${esc(marketTruth.total)}.</span>`;
}

function renderDashboardGuard(){
  const guard=ensureDashboardGuard();
  if(!guard)return;
  const meta=currentMeta();
  if(!meta.currentDate){if(!guard.hidden)guard.hidden=true;return}
  if(guard.hidden)guard.hidden=false;
  const frozenDate=latestSnapshotDate();
  const stale=Boolean(frozenDate&&frozenDate<meta.currentDate);
  const noToday=meta.published===0;
  const todayLine=`<b>جلسة السوق الحالية: ${esc(fmtDate(meta.currentDate))}</b> · تم فحص ${esc(meta.scanned)} سهم · ${meta.published>0?`تم نشر ${esc(meta.published)} توصية RC2`:'لا توجد توصيات RC2 منشورة اليوم'}.`;
  const frozenLine=frozenDate
    ? stale
      ? `<br><span style="color:#ffd77e"><b>آخر Snapshot توصيات محفوظ: ${esc(fmtDate(frozenDate))}</b> — للمتابعة التاريخية فقط، وليس Snapshot جلسة ${esc(fmtDate(meta.currentDate))}.</span>`
      : `<br><span>Snapshot التوصيات المتاح: ${esc(fmtDate(frozenDate))}.</span>`
    : '<br><span>لا يوجد Snapshot توصيات محفوظ حتى الآن.</span>';
  setHtml(guard,todayLine+marketTruthLine()+frozenLine+(noToday?'<br><span>عدم وجود توصيات اليوم نتيجة بوابات RC2 الحالية، وليس بسبب توقف تحديث البيانات.</span>':''));
}

function renderMonitorGuard(){
  const panel=document.getElementById('rc2SessionMonitorPanel');
  if(!panel)return;
  const meta=currentMeta();
  const signals=Array.isArray(window.__RC2_SESSION_MONITOR_LAST__?.signals)?window.__RC2_SESSION_MONITOR_LAST__.signals:[];
  const signalDate=signals.map(x=>x?.sessionDate).filter(Boolean).sort().at(-1)||latestSnapshotDate();
  const stale=Boolean(meta.currentDate&&signalDate&&signalDate<meta.currentDate);
  const head=panel.querySelector('.sm-head h2');
  const intro=panel.querySelector('.sm-head p');
  if(meta.currentDate)setText(head,stale?'متابعة آخر Snapshot توصيات مجمّد':'متابعة الجلسة للمرشحين');
  if(intro&&stale){
    setHtml(intro,`البطاقات أدناه تتابع إشارات Snapshot <b>${esc(fmtDate(signalDate))}</b> فقط. جلسة السوق الحالية هي <b>${esc(fmtDate(meta.currentDate))}</b>، ولا يتم تقديم هذه الإشارات القديمة كتوصيات اليوم.`);
  }
  let guard=document.getElementById(PANEL_GUARD_ID);
  if(!guard){
    guard=document.createElement('div');
    guard.id=PANEL_GUARD_ID;
    guard.style.cssText='margin:12px 0;padding:11px 13px;border:1px solid #8b692d;border-radius:12px;background:#2b2413;color:#ffe2a2;line-height:1.75;font-size:12px';
    const source=panel.querySelector('.sm-source');
    if(source)source.insertAdjacentElement('afterend',guard);else panel.prepend(guard);
  }
  if(stale){
    if(guard.hidden)guard.hidden=false;
    setHtml(guard,`<b>جلسة السوق الحالية: ${esc(fmtDate(meta.currentDate))}</b> · ${esc(meta.scanned)} سهم تم فحصه · ${meta.published>0?`${esc(meta.published)} توصية منشورة`:'لا توجد توصيات منشورة اليوم'}.<br><b>Snapshot المتابع أدناه: ${esc(fmtDate(signalDate))}</b> — سجل تاريخي/Forward Evidence فقط.`+marketTruthLine());
    panel.querySelectorAll('.sm-kpi span').forEach(el=>{
      if(el.textContent.includes('من توصيات الجلسة'))setText(el,`من توصيات Snapshot ${fmtDate(signalDate)}`);
    });
  }else if(!guard.hidden){
    guard.hidden=true;
  }
}

function ensureMarketGuard(){
  const results=document.getElementById('marketResults');
  if(!results)return null;
  let guard=document.getElementById(MARKET_GUARD_ID);
  if(!guard){
    guard=document.createElement('div');
    guard.id=MARKET_GUARD_ID;
    guard.dataset.hotfix=HOTFIX_ID;
    guard.style.cssText='margin:10px 0 12px;padding:12px 14px;border:1px solid #347f7a;border-radius:12px;background:#092a2f;color:#d9fbff;line-height:1.8;font-size:12px';
    results.insertAdjacentElement('beforebegin',guard);
  }
  return guard;
}

function isLaggedRow(row,sessionDate){
  const verified=row?.symbolVerified===true;
  const last=String(row?.lastSession||'');
  return Boolean(verified&&last&&sessionDate&&(row?.staleData===true||row?.sessionLagged===true||last<sessionDate));
}

function enforceMarketRows(){
  if(!marketTruth?.byTicker?.size)return;
  document.querySelectorAll('#marketResults [data-market]').forEach(el=>{
    const ticker=String(el.getAttribute('data-market')||'').toUpperCase();
    const row=marketTruth.byTicker.get(ticker);
    if(!row)return;
    const status=el.querySelector('.market-status');
    const lagged=isLaggedRow(row,marketTruth.sessionDate);
    const unverified=row?.symbolVerified!==true||!row?.lastSession;
    if(lagged||unverified||row?.updateFailed===true){
      el.classList.add('withheld-row');
      if(status){
        status.classList.remove('recommended','outside');
        status.classList.add('datawarn');
        const label=lagged?`مراجعة بيانات · آخر جلسة ${fmtDate(row.lastSession)}`:unverified?'بيانات غير متحققة':'مراجعة تحديث البيانات';
        setText(status,label);
      }
      el.dataset.marketTruth='review';
      el.title=lagged?`بيانات ${ticker} أقدم من جلسة السوق ${fmtDate(marketTruth.sessionDate)}`:'بيانات السهم ليست متحققة كجلسة سوق حالية';
    }else{
      el.dataset.marketTruth='current';
    }
  });
}

function renderMarketGuard(){
  const guard=ensureMarketGuard();
  if(!guard)return;
  if(!marketTruth?.sessionDate){
    setHtml(guard,'<b>جارٍ التحقق من حداثة لقطة السوق…</b>');
    loadMarketTruth();
    return;
  }
  const extra=marketTruth.review?` · مراجعة أخرى <b>${esc(marketTruth.review)}</b>`:'';
  setHtml(guard,`<b>لقطة السوق — جلسة ${esc(fmtDate(marketTruth.sessionDate))}</b> · محدث <b>${esc(marketTruth.current)}</b> · متأخر <b style="color:#ffd77e">${esc(marketTruth.lagged)}</b> · غير متحقق <b style="color:#ffb4b4">${esc(marketTruth.unverified)}</b>${extra} · الإجمالي ${esc(marketTruth.total)}.<br><span>أي سهم آخر جلسة له أقدم من جلسة السوق يُعرض كمراجعة بيانات ولا يُعامل كسهم حالي.</span>`);
  enforceMarketRows();
}

function apply(){
  const embedded=marketFromUi();
  if(embedded?.symbols?.length)marketTruth=embedded;
  renderDashboardGuard();
  renderMonitorGuard();
  renderMarketGuard();
  if(!marketTruth?.symbols?.length)loadMarketTruth();
}

let scheduled=false;
function scheduleApply(){
  if(scheduled)return;
  scheduled=true;
  queueMicrotask(()=>{scheduled=false;apply()});
}

window.addEventListener('rc2:ui-scan',()=>{loadMarketTruth(true);scheduleApply()});
window.addEventListener('rc2:session-monitor',scheduleApply);
window.addEventListener('storage',e=>{if(e.key===ARCHIVE_KEY)scheduleApply()});

const observer=new MutationObserver(scheduleApply);
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',()=>{
    observer.observe(document.body,{childList:true,subtree:true});
    loadMarketTruth(true);
    scheduleApply();
  },{once:true});
}else{
  observer.observe(document.body,{childList:true,subtree:true});
  loadMarketTruth(true);
  scheduleApply();
}

console.info(HOTFIX_ID,'loaded');
