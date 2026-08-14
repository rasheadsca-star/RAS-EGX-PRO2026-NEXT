(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const num=(v,d=2)=>v===null||v===undefined||v===''?'—':Number(v).toLocaleString('ar-EG',{maximumFractionDigits:d});
  const pct=v=>v===null||v===undefined?'—':`${num(v,2)}%`;
  const load=async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);return r.json();};
  const state={archives:[],forward:null,filter:'ALL'};
  const statusAr=v=>({RESEARCH_ONLY:'بحث فقط',EXECUTION_GRADE:'Execution Grade',BLOCKED:'محظور'}[v]||v||'—');
  const horizonState=e=>e?.status==='RESOLVED'?'محسوم':e?.status==='PENDING'?'Pending':e?.status||'—';

  function counts(core){const x={ACTIONABLE:0,WATCH:0,WAIT:0,AVOID:0};for(const o of core?.opportunities||[])if(x[o.status]!==undefined)x[o.status]++;return x;}
  function forwardFor(hash){return (state.forward?.evaluations||[]).filter(x=>x.immutableSignalHash===hash).sort((a,b)=>Number(a.horizonSessions)-Number(b.horizonSessions));}
  function horizonCard(e){
    const pending=e.status==='PENDING';
    return `<div class="horizon ${pending?'pending':'resolved'}"><span>${esc(e.horizonSessions)} جلسة</span><strong>${esc(horizonState(e))}</strong><small>Applied: ${pending?'—':pct(e.appliedPortfolio?.netReturnPct)}</small><small>Research: ${pending?'—':pct(e.researchEvaluation?.equalWeightIssuedNetReturnPct)}</small><small>${e.evaluationSessionDate?`حتى ${esc(e.evaluationSessionDate)}`:'لا توجد جلسة تقييم مكتملة بعد'}</small></div>`;
  }
  function archiveCard(a){
    const c=a.immutableCore||{};const sc=counts(c);const f=forwardFor(a.immutableSignalHash);
    const rev=(state.archives.filter(x=>x.sessionDate===a.sessionDate).sort((x,y)=>String(x.archivedAt).localeCompare(String(y.archivedAt))).findIndex(x=>x.immutableSignalHash===a.immutableSignalHash)+1);
    return `<article class="signal-card"><div class="signal-head"><div><span class="eyebrow">${esc(a.sessionDate)} • revision ${rev}</span><h2>${esc(statusAr(c.executionStatus))}</h2><code title="${esc(a.immutableSignalHash)}">${esc(a.immutableSignalHash.slice(0,16))}…</code></div><div class="exposure"><span>التعرض المطبق</span><strong>${pct(c.portfolio?.recommendedExposurePct)}</strong><small>نقد ${pct(c.portfolio?.cashPct)}</small></div></div>
      <div class="signal-metrics"><div><span>الفرص</span><strong>${(c.opportunities||[]).length}</strong></div><div><span>ACTIONABLE</span><strong>${sc.ACTIONABLE}</strong></div><div><span>WATCH</span><strong>${sc.WATCH}</strong></div><div><span>WAIT</span><strong>${sc.WAIT}</strong></div><div><span>AVOID</span><strong>${sc.AVOID}</strong></div><div><span>Champion</span><strong>${esc(c.activeChampion||'—')}</strong></div></div>
      <div class="immutability"><strong>Immutable core</strong><span>هذا القرار لا يُعاد كتابته عند إضافة مؤشرات أو نتائج مستقبلية. archivedAt: ${esc(a.archivedAt||'—')}</span></div>
      <div class="horizons">${f.length?f.map(horizonCard).join(''):'<div class="empty">لا توجد Forward evaluations لهذا الإصدار.</div>'}</div>
      <details><summary>الفرص الصادرة في هذا الإصدار</summary><div class="opps">${(c.opportunities||[]).map(o=>`<div><strong>${esc(o.ticker)}</strong><span>${esc(o.status)}</span><small>دخول ${num(o.entryLow,4)}–${num(o.entryHigh,4)} • وقف ${num(o.stop,4)} • هدف1 ${num(o.target1,4)} • وزن ${pct(o.positionWeightPct)}</small></div>`).join('')||'<span>لا توجد فرص.</span>'}</div></details>
    </article>`;
  }
  function render(){
    const rows=state.archives.filter(a=>state.filter==='ALL'||a.sessionDate===state.filter).sort((a,b)=>`${b.sessionDate}:${b.archivedAt}`.localeCompare(`${a.sessionDate}:${a.archivedAt}`));
    $('resultCount').textContent=`${rows.length} إصدار`;$('history').innerHTML=rows.map(archiveCard).join('')||'<div class="empty">لا توجد إصدارات لهذه الجلسة.</div>';
  }
  async function init(){try{
    const [index,forward]=await Promise.all([load('../data/v20/signal-archive/index.json'),load('../data/v20/forward-evaluation.json')]);state.forward=forward;
    state.archives=await Promise.all((index.entries||[]).map(e=>load(`../${e.file}`)));
    const dates=[...new Set(state.archives.map(x=>x.sessionDate).filter(Boolean))].sort().reverse();$('archiveCount').textContent=String(state.archives.length);$('sessionCount').textContent=`${dates.length} جلسة إصدار مستقلة`;
    for(const d of dates){const o=document.createElement('option');o.value=d;o.textContent=d;$('sessionFilter').appendChild(o);}
    $('sessionFilter').addEventListener('change',e=>{state.filter=e.target.value;render();});render();$('loading').classList.add('hidden');$('history').classList.remove('hidden');
  }catch(error){$('loading').classList.add('hidden');$('error').classList.remove('hidden');$('error').textContent=`تعذر تحميل سجل الإشارات: ${error.message}`;}}
  init();
})();
