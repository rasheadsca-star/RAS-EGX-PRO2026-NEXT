'use strict';

const ENDPOINT='/api/recommendation-history';
const REFRESH_MS=300000;
let state={data:null,loading:false,lastLoadedAt:0};

const E=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const N=v=>Number.isFinite(Number(v))?Number(v):null;
const F=(v,d=2)=>N(v)==null?'—':Number(v).toLocaleString('en-GB',{maximumFractionDigits:d});
const P=v=>N(v)==null?'—':`${F(v,1)}%`;

function addStyle(){
  if(document.getElementById('rc2CompleteHistoryStyle'))return;
  const s=document.createElement('style');s.id='rc2CompleteHistoryStyle';s.textContent=`
    .rc2-history-master{margin-bottom:16px}.rc2-history-master .history-kpis{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:10px;margin:12px 0}
    .rc2-history-master .history-kpi{background:#081d2c;border:1px solid #17384c;border-radius:12px;padding:11px}.rc2-history-master .history-kpi small{display:block;color:#8fa9b8;margin-bottom:5px}.rc2-history-master .history-kpi b{font-size:19px;display:block}.rc2-history-master .history-kpi span{font-size:11px;color:#8fa9b8}
    .rc2-history-controls{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0}.rc2-history-controls .control{min-width:150px}.rc2-history-source{font-size:11px;padding:3px 7px;border-radius:999px;white-space:nowrap}.rc2-history-source.published{background:#123c31;color:#65e6ad}.rc2-history-source.replay{background:#2b3047;color:#b7a0ff}
    .rc2-history-outcome{font-weight:800}.rc2-history-outcome.good{color:#3edb9a}.rc2-history-outcome.bad{color:#ff7181}.rc2-history-outcome.warn{color:#f7c866}.rc2-history-outcome.neutral{color:#9db4c2}.rc2-history-note{font-size:12px;color:#9db4c2;background:#071a28;border:1px solid #17384c;border-radius:10px;padding:10px;margin:8px 0}.rc2-history-count{font-size:12px;color:#9db4c2}
    @media(max-width:1000px){.rc2-history-master .history-kpis{grid-template-columns:repeat(3,minmax(110px,1fr))}}@media(max-width:640px){.rc2-history-master .history-kpis{grid-template-columns:repeat(2,minmax(110px,1fr))}.rc2-history-controls .control{min-width:0;flex:1 1 140px}}
  `;document.head.appendChild(s);
}

function inject(){
  if(document.getElementById('rc2CompleteHistoryPanel'))return;
  const view=document.getElementById('view-evidence');if(!view)return;
  addStyle();
  const panel=document.createElement('article');panel.className='panel rc2-history-master';panel.id='rc2CompleteHistoryPanel';
  panel.innerHTML=`
    <div class="panel-head split"><div><h2>السجل التاريخي الكامل — RC2</h2><p>Published RC2 المحفوظ على السيرفر + Historical Replay بنتائج كل الصفقات التاريخية. المصدران منفصلان بوضوح.</p></div><div class="evidence-actions"><button class="btn" id="rc2HistoryRefresh">تحديث السجل</button><button class="btn" id="rc2HistoryCsv">CSV كامل</button></div></div>
    <div class="rc2-history-note"><b>Published</b> = توصيات RC2 التي تم حفظ Snapshot لها فعليًا. <b>Historical Replay</b> = إعادة اختبار بدون Look-ahead وليست ادعاءً بأنها نُشرت حيًا في ذلك التاريخ.</div>
    <div class="history-kpis" id="rc2HistoryKpis"><div class="empty">جارٍ تحميل السجل…</div></div>
    <div class="rc2-history-controls">
      <select class="control" id="rc2HistorySource"><option value="all">Published + Replay</option><option value="published">Published RC2 فقط</option><option value="replay">Historical Replay فقط</option></select>
      <select class="control" id="rc2HistoryOutcome"><option value="all">كل النتائج</option><option value="TARGET1">حقق T1</option><option value="TARGET2">لمس T2</option><option value="STOP">Stop</option><option value="OPEN">مفتوحة</option><option value="PENDING_ENTRY">بانتظار الدخول</option><option value="EXPIRED_NO_ENTRY">بدون دخول</option><option value="TIME_EXIT">خروج زمني</option></select>
      <input class="control" id="rc2HistoryTicker" placeholder="بحث بالرمز">
      <span class="rc2-history-count" id="rc2HistoryCount"></span>
    </div>
    <div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>المصدر</th><th>#</th><th>السهم</th><th>النتيجة</th><th>الدخول</th><th>T1</th><th>T2</th><th>Stop</th><th>الخروج</th><th>Net</th><th>المدة</th><th>Fusion</th></tr></thead><tbody id="rc2HistoryRows"><tr><td colspan="13"><div class="empty">جارٍ التحميل…</div></td></tr></tbody></table></div>`;
  const first=view.querySelector('.evidence-grid');view.insertBefore(panel,first||view.firstChild);
  document.getElementById('rc2HistoryRefresh').onclick=()=>load(true);
  document.getElementById('rc2HistoryCsv').onclick=()=>window.open(`${ENDPOINT}?scope=all&format=csv&t=${Date.now()}`,'_blank');
  ['rc2HistorySource','rc2HistoryOutcome','rc2HistoryTicker'].forEach(id=>document.getElementById(id).addEventListener(id==='rc2HistoryTicker'?'input':'change',renderRows));
}

function outcomeTone(x){
  if(x.target2Hit||x.outcome==='TARGET1')return'good';
  if(String(x.outcome||'').startsWith('STOP'))return'bad';
  if(['OPEN','PENDING_ENTRY','AWAITING_NEXT_SESSION'].includes(x.outcome))return'warn';
  return'neutral';
}
function sourceType(x){return x.sourceType==='HISTORICAL_REPLAY'?'replay':'published'}
function sourceLabel(x){return sourceType(x)==='replay'?'Historical Replay':'Published RC2'}
function resultLabel(x){
  if(x.target2Hit)return x.outcome==='TARGET1'?'حقق T1 ولمس T2':'لمس T2';
  return x.outcomeLabelAr||x.outcome||'—';
}

function renderKpis(){
  const p=state.data?.published?.summary||{},r=state.data?.replay?.summary||{};
  const k=[
    ['Published محفوظ',F(p.totalSignals,0),`${F(p.resolved,0)} محسومة · ${F(p.open,0)} مفتوحة`],
    ['T1 Published',P(p.target1HitPct),`T2 ${P(p.target2HitPct)}`],
    ['Stop Published',P(p.stopPct),`Time Exit ${P(p.timeExitPct)}`],
    ['Avg Net Published',P(p.avgNetPct),`PF ${F(p.profitFactor,2)}`],
    ['متوسط الهدف المخطط',P(p.avgPlannedTarget1Pct),`T2 ${P(p.avgPlannedTarget2Pct)}`],
    ['متوسط مسافة الوقف',P(p.avgPlannedStopPct),`T1 في ${F(p.avgSessionsToTarget1,1)} جلسة`],
    ['Replay entered',F(r.entered,0),`${F(r.totalSignals,0)} signal شامل no-entry`],
    ['T1 Replay',P(r.target1Pct),`Stop ${P(r.stopPct)}`],
    ['Avg Net Replay',P(r.avgNetPct),`PF ${F(r.profitFactor,2)}`],
    ['Entry Rate Published',P(p.entryRatePct),`${F(p.expiredNoEntry,0)} انتهت بدون دخول`],
    ['متوسط مدة الصفقة',F(p.avgSessionsHeld,1),'جلسة — Published'],
    ['آخر تحديث للسجل',state.data?.published?.archive?.updatedAt?new Date(state.data.published.archive.updatedAt).toLocaleString('ar-EG'):'—','Server archive'],
  ];
  const box=document.getElementById('rc2HistoryKpis');if(!box)return;box.innerHTML=k.map(x=>`<div class="history-kpi"><small>${E(x[0])}</small><b>${E(x[1])}</b><span>${E(x[2])}</span></div>`).join('');
}

function allRows(){return[...(state.data?.published?.rows||[]),...(state.data?.replay?.rows||[])]}
function renderRows(){
  const body=document.getElementById('rc2HistoryRows');if(!body)return;
  const src=document.getElementById('rc2HistorySource')?.value||'all',out=document.getElementById('rc2HistoryOutcome')?.value||'all',q=String(document.getElementById('rc2HistoryTicker')?.value||'').trim().toUpperCase();
  let rows=allRows().filter(x=>src==='all'||sourceType(x)===src).filter(x=>{
    if(out==='all')return true;if(out==='TARGET2')return x.target2Hit===true;if(out==='STOP')return String(x.outcome||'').startsWith('STOP');return x.outcome===out;
  }).filter(x=>!q||String(x.ticker||'').toUpperCase().includes(q));
  rows.sort((a,b)=>String(b.sessionDate||'').localeCompare(String(a.sessionDate||''))||Number(a.rank??999)-Number(b.rank??999)||String(a.ticker||'').localeCompare(String(b.ticker||'')));
  const c=document.getElementById('rc2HistoryCount');if(c)c.textContent=`${rows.length.toLocaleString('en-GB')} سجل`;
  body.innerHTML=rows.length?rows.map(x=>`<tr>
    <td>${E(x.sessionDate||'—')}</td><td><span class="rc2-history-source ${sourceType(x)}">${E(sourceLabel(x))}</span></td><td>${E(x.rank??'—')}</td><td><b>${E(x.ticker||'—')}</b></td>
    <td><span class="rc2-history-outcome ${outcomeTone(x)}">${E(resultLabel(x))}</span></td><td>${x.entryPrice!=null?F(x.entryPrice,3):(x.entryLow!=null?`${F(x.entryLow,3)}–${F(x.entryHigh,3)}`:'—')}</td>
    <td>${F(x.target1,3)}</td><td>${F(x.target2,3)}</td><td>${F(x.stop,3)}</td><td>${x.exitPrice!=null?`${F(x.exitPrice,3)} · ${E(x.exitDate||'')}`:E(x.exitDate||'—')}</td><td class="${N(x.netPct)>0?'green':N(x.netPct)<0?'red':''}">${P(x.netPct)}</td><td>${F(x.sessionsToExit,0)}</td><td>${F(x.fusionRankScore??x.fusionRank,1)}</td>
  </tr>`).join(''):'<tr><td colspan="13"><div class="empty">لا توجد سجلات مطابقة للفلاتر.</div></td></tr>';
}

async function load(force=false){
  inject();if(state.loading)return;if(!force&&state.data&&Date.now()-state.lastLoadedAt<REFRESH_MS){renderKpis();renderRows();return}
  state.loading=true;const k=document.getElementById('rc2HistoryKpis');if(k&&!state.data)k.innerHTML='<div class="empty">جارٍ حساب السجل التاريخي…</div>';
  try{
    const r=await fetch(`${ENDPOINT}?scope=all&symbols=220&t=${Date.now()}`,{cache:'no-store'});const d=await r.json();if(!r.ok||d?.ok!==true)throw new Error(d?.error||`HTTP ${r.status}`);
    state.data=d;state.lastLoadedAt=Date.now();renderKpis();renderRows();
  }catch(e){if(k)k.innerHTML=`<div class="empty">تعذر تحميل السجل: ${E(e.message)}</div>`}finally{state.loading=false}
}

inject();
document.addEventListener('click',e=>{const t=e.target.closest?.('.tab[data-view="evidence"]');if(t)setTimeout(()=>load(false),0)});
window.addEventListener('rc2:ui-scan',()=>{if(document.getElementById('view-evidence')?.classList.contains('active'))load(true)});
setInterval(()=>{if(document.visibilityState==='visible'&&document.getElementById('view-evidence')?.classList.contains('active'))load(true)},REFRESH_MS);
