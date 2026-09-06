const BANNER_ID='rc2NextSessionBanner';
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate=value=>{
  const s=String(value||'');
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?`${Number(m[3])}/${Number(m[2])}/${m[1]}`:(s||'—');
};
function nextEgxSession(value){
  const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m)return null;
  const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),12));
  for(let i=0;i<7;i++){
    d.setUTCDate(d.getUTCDate()+1);
    const dow=d.getUTCDay();
    if(dow!==5&&dow!==6)return d.toISOString().slice(0,10);
  }
  return null;
}
function recommendationSession(){
  const payload=window.__RC2_UI_SCAN__||{};
  const scan=payload.scan||{};
  const dates=(Array.isArray(scan.recommendations)?scan.recommendations:[])
    .map(x=>x?.sessionDate).filter(Boolean).sort();
  return dates.at(-1)||payload.effectiveDate||scan?.universe?.sessionDate||null;
}
function ensureBanner(){
  const grid=document.getElementById('recommendationGrid');
  if(!grid)return null;
  let el=document.getElementById(BANNER_ID);
  if(!el){
    el=document.createElement('div');
    el.id=BANNER_ID;
    el.style.cssText='margin:10px 0 12px;padding:12px 14px;border:1px solid #2f7f70;border-radius:12px;background:#082b2d;color:#dff7ef;line-height:1.8;font-size:12px';
    grid.insertAdjacentElement('beforebegin',el);
  }
  return el;
}
function apply(){
  const el=ensureBanner();
  if(!el)return;
  const payload=window.__RC2_UI_SCAN__||{};
  const scan=payload.scan||{};
  const signalDate=recommendationSession();
  const nextDate=nextEgxSession(signalDate);
  const count=Number(scan?.summary?.publicationEligibleTotal??scan?.recommendations?.length??0);
  if(!signalDate){el.hidden=true;return}
  el.hidden=false;
  if(count>0){
    el.innerHTML=`<b>توصيات محسوبة بعد إغلاق جلسة ${esc(fmtDate(signalDate))}</b> — مخصصة للمراجعة/الدخول من الجلسة التالية <b>${esc(fmtDate(nextDate))}</b> أو لاحقًا حسب شروط Entry. <span style="color:#a9d8ca">عدد المرشحين المنشورين: ${esc(count)}.</span>`;
  }else{
    el.innerHTML=`<b>اكتمل فحص جلسة ${esc(fmtDate(signalDate))}</b> — لا توجد توصيات اجتازت بوابات RC2 لهذه الجلسة. الجلسة التالية: <b>${esc(fmtDate(nextDate))}</b>.`;
  }
  const last=document.getElementById('lastUpdate');
  if(last&&count>0&&nextDate){
    last.setAttribute('title',`إشارة ${signalDate} — التنفيذ من ${nextDate} أو لاحقًا`);
  }
}
let queued=false;
function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;apply()})}
window.addEventListener('rc2:ui-scan',schedule);
window.addEventListener('rc2:session-monitor',schedule);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
