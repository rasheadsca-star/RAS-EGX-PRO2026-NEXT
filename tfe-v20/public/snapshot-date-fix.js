const ARCHIVE_KEY='egx-tfe-rc2-v169-forward-archive';
const GUARD_ID='rc2SnapshotDateGuard';
const PANEL_GUARD_ID='rc2SessionSnapshotGuard';

const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate=value=>{
  const s=String(value||'');
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?`${Number(m[3])}/${Number(m[2])}/${m[1]}`:(s||'—');
};
const setHtml=(el,html)=>{if(el&&el.innerHTML!==html)el.innerHTML=html};
const setText=(el,text)=>{if(el&&el.textContent!==text)el.textContent=text};

function archiveRows(){
  if(typeof localStorage==='undefined')return [];
  try{
    const rows=JSON.parse(localStorage.getItem(ARCHIVE_KEY)||'[]');
    return Array.isArray(rows)?rows:[];
  }catch{return []}
}

function latestSnapshotDate(){
  return archiveRows().map(x=>x?.sessionDate).filter(Boolean).sort().at(-1)||null;
}

function currentMeta(){
  const payload=typeof window!=='undefined'?(window.__RC2_UI_SCAN__||{}):{};
  const scan=payload.scan||{};
  const market=payload.market||{};
  const currentDate=payload.effectiveDate||scan?.universe?.sessionDate||market?.sessionDate||null;
  return {
    currentDate,
    scanned:Number(scan?.summary?.scanned??0),
    published:Number(scan?.summary?.publicationEligibleTotal??scan?.recommendations?.length??0),
    engine:scan?.engine||'TFE_V20_FUSION_RC2'
  };
}

function ensureDashboardGuard(){
  if(typeof document==='undefined')return null;
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
  setHtml(guard,todayLine+frozenLine+(noToday?'<br><span>عدم وجود توصيات اليوم نتيجة بوابات RC2 الحالية، وليس بسبب توقف تحديث البيانات.</span>':''));
}

function renderMonitorGuard(){
  if(typeof document==='undefined')return;
  const panel=document.getElementById('rc2SessionMonitorPanel');
  if(!panel)return;
  const meta=currentMeta();
  const signals=typeof window!=='undefined'&&Array.isArray(window.__RC2_SESSION_MONITOR_LAST__?.signals)?window.__RC2_SESSION_MONITOR_LAST__.signals:[];
  const signalDate=signals.map(x=>x?.sessionDate).filter(Boolean).sort().at(-1)||latestSnapshotDate();
  const stale=Boolean(meta.currentDate&&signalDate&&signalDate<meta.currentDate);
  const head=panel.querySelector('.sm-head h2');
  const intro=panel.querySelector('.sm-head p');
  if(meta.currentDate) setText(head,stale?'متابعة آخر Snapshot توصيات مجمّد':'متابعة الجلسة للمرشحين');
  if(intro&&stale){
    setHtml(intro,`البطاقات أدناه تتابع إشارات Snapshot <b>${esc(fmtDate(signalDate))}</b> فقط. جلسة السوق الحالية هي <b>${esc(fmtDate(meta.currentDate))}</b>، ولا يتم تقديم هذه الإشارات القديمة كتوصيات اليوم.`);
  }
  let guard=document.getElementById(PANEL_GUARD_ID);
  if(!guard){
    guard=document.createElement('div');
    guard.id=PANEL_GUARD_ID;
    guard.style.cssText='margin:12px 0;padding:11px 13px;border:1px solid #8b692d;border-radius:12px;background:#2b2413;color:#ffe2a2;line-height:1.75;font-size:12px';
    const source=panel.querySelector('.sm-source');
    if(source) source.insertAdjacentElement('afterend',guard); else panel.prepend(guard);
  }
  if(stale){
    if(guard.hidden)guard.hidden=false;
    setHtml(guard,`<b>جلسة السوق الحالية: ${esc(fmtDate(meta.currentDate))}</b> · ${esc(meta.scanned)} سهم تم فحصه · ${meta.published>0?`${esc(meta.published)} توصية منشورة`:'لا توجد توصيات منشورة اليوم'}.<br><b>Snapshot المتابع أدناه: ${esc(fmtDate(signalDate))}</b> — سجل تاريخي/Forward Evidence فقط.`);
    panel.querySelectorAll('.sm-kpi span').forEach(el=>{
      if(el.textContent.includes('من توصيات الجلسة'))setText(el,`من توصيات Snapshot ${fmtDate(signalDate)}`);
    });
  }else if(!guard.hidden){
    guard.hidden=true;
  }
}

function apply(){renderDashboardGuard();renderMonitorGuard()}
let scheduled=false;
function scheduleApply(){
  if(scheduled)return;
  scheduled=true;
  queueMicrotask(()=>{scheduled=false;apply()});
}

function bootSnapshotDateFix(){
  window.addEventListener('rc2:ui-scan',scheduleApply);
  window.addEventListener('rc2:session-monitor',scheduleApply);
  window.addEventListener('storage',e=>{if(e.key===ARCHIVE_KEY)scheduleApply()});

  const observer=typeof MutationObserver!=='undefined'?new MutationObserver(scheduleApply):null;
  const start=()=>{
    if(observer&&document.body)observer.observe(document.body,{childList:true,subtree:true});
    scheduleApply();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
}

if(typeof window!=='undefined'&&typeof document!=='undefined')bootSnapshotDateFix();
