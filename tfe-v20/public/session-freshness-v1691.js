import { marketPhase } from './session-monitor-core.js';

const ARCHIVE_KEY='egx-tfe-rc2-v169-forward-archive';
const esc=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function archivedSnapshotDate(){
  try{
    const rows=JSON.parse(localStorage.getItem(ARCHIVE_KEY)||'[]');
    return Array.isArray(rows)?rows.map(x=>x?.sessionDate).filter(Boolean).sort().at(-1)||null:null;
  }catch{return null}
}
function dataSession(scan){
  return [scan?.universe?.sessionDate,...(scan?.recommendations||[]).map(x=>x?.sessionDate)].filter(Boolean).sort().at(-1)||null;
}
function publicationCount(scan){
  const value=scan?.publicationEligibleTotal??scan?.summary?.publicationEligibleTotal??scan?.universe?.publicationEligibleTotal??(scan?.recommendations||[]).length;
  return Number.isFinite(Number(value))?Number(value):null;
}
function render(scan){
  const box=document.getElementById('opsFreshness'),session=dataSession(scan),snapshot=archivedSnapshotDate();
  if(!box||!session||!snapshot||session<=snapshot)return;
  const phase=marketPhase(),published=publicationCount(scan),none=published===0;
  const label=none?`جلسة ${session}: لا توصيات جديدة`:`جلسة البيانات ${session}`;
  const detail=none
    ?`تم تحديث وفحص جلسة ${session}؛ 0 سهم اجتاز بوابات النشر. Snapshot ${snapshot} سجل متابعة تاريخي فقط. السوق مغلق الآن (${phase.phase}).`
    :`جلسة البيانات ${session} أحدث من Snapshot ${snapshot}. لا يُعرض السجل القديم كتوصية حالية؛ حالة السوق ${phase.phase}.`;
  box.innerHTML=`<div class="ops-head"><div><h3>حداثة التوصية</h3><p>فصل واضح بين جلسة البيانات وآخر Snapshot منشور.</p></div><span class="ops-pill ${none?'warn':'neutral'}">${esc(label)}</span></div><div class="ops-note ${none?'warn':''}">${esc(detail)}</div>`;
}
window.addEventListener('rc2:ui-scan',event=>render(event.detail?.scan));
if(window.__RC2_UI_SCAN__?.scan){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>render(window.__RC2_UI_SCAN__.scan),0),{once:true});
  else setTimeout(()=>render(window.__RC2_UI_SCAN__.scan),0);
}
