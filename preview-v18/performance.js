// Appended to app.js by the V18.3 build so it shares the same state/helpers scope.
function renderEnginePerformanceLeague(){
  const league=state.data?.enginePerformanceLeague;if(!league)return;
  const view=document.querySelector('[data-view="agreement"]');if(!view)return;
  let panel=document.getElementById('enginePerformanceLeaguePanel');
  if(!panel){panel=document.createElement('section');panel.id='enginePerformanceLeaguePanel';panel.className='panel';const anchor=view.querySelector('.panel');if(anchor)anchor.before(panel);else view.prepend(panel)}
  const rows=league.engines||[];
  const rate=v=>Number.isFinite(Number(v))?`${fmt(v,1)}%`:'—';
  const statusAr=s=>({WAITING_FOR_2026_09_07:'يبدأ من 7 سبتمبر',TRACKING:'جاري القياس',NO_SIGNALS_YET:'لا توجد إشارات بعد'})[s]||s||'—';
  panel.innerHTML=`<div class="panel-head"><div><div class="eyebrow">ENGINE PERFORMANCE LEAGUE</div><h2>مقارنة المحركات — النتائج المستقبلية فقط</h2><p>بداية القياس: <b>${esc(league.trackingStartsOn)}</b> · لا Backfill قبل هذا التاريخ · الترتيب الرسمي يبدأ بعد ${fmt(league.rankingMinimumResolvedSignals,0)} نتائج محسومة لكل محرك.</p></div><span class="pill">Future Only</span></div>
  <div class="performance-note"><b>طريقة الحساب:</b> الإشارة تُنسب لكل محرك ساهم فيها. Target/Stop يُقاس من الجلسات التالية فقط. إذا لمس الهدف والوقف في نفس شمعة OHLC تكون النتيجة AMBIGUOUS ولا تدخل في Win/Loss. Execution-Confirmed يظل منفصلًا حتى يتوفر تأكيد افتتاح/سيولة حقيقي.</div>
  <div class="table-wrap"><table class="wide performance-table"><thead><tr><th>الترتيب</th><th>المحرك</th><th>إشارات</th><th>تفعّلت Reference</th><th>Target 1</th><th>Stop</th><th>Ambiguous</th><th>Unresolved</th><th>Activation%</th><th>Target% من المحسوم</th><th>Target% من المتفعّل</th><th>الحالة</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${x.leagueRank?`#${x.leagueRank}`:'—'}</td><td><b>${esc(x.labelAr||x.label||x.engineId)}</b><small>${esc(x.engineId)}</small></td><td>${fmt(x.issuedSignals,0)}</td><td>${fmt(x.referenceActivated,0)}</td><td class="pos">${fmt(x.target1Hits,0)}</td><td class="neg">${fmt(x.stopHits,0)}</td><td>${fmt(x.ambiguous,0)}</td><td>${fmt(x.unresolved,0)}</td><td>${rate(x.activationRatePct)}</td><td><b>${rate(x.targetHitRateResolvedPct)}</b></td><td>${rate(x.targetHitRateActivatedPct)}</td><td>${esc(statusAr(x.status))}${x.rankingEligible?' · Ranked':' · Sample building'}</td></tr>`).join('')}</tbody></table></div>
  <div class="performance-summary">محركات بها إشارات: <b>${fmt(league.summary?.enginesWithSignals,0)}</b> / ${fmt(league.summary?.enginesTracked,0)} · إشارات Forward فريدة: <b>${fmt(league.summary?.totalUniqueIssuedSignals,0)}</b> · نتائج محسومة حاليًا: <b>${fmt(league.summary?.totalResolvedReferenceSignals,0)}</b>.</div>`;
  if(!document.getElementById('performanceLeagueStyle')){const s=document.createElement('style');s.id='performanceLeagueStyle';s.textContent='.performance-note{margin:14px 0;padding:12px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.025);line-height:1.8}.performance-table small{display:block;opacity:.65;margin-top:3px}.performance-summary{margin-top:12px;opacity:.85}.performance-table td,.performance-table th{white-space:nowrap}';document.head.appendChild(s)}
}
if(typeof renderAgreement==='function'){
  const __v182RenderAgreement=renderAgreement;
  renderAgreement=function(){__v182RenderAgreement();renderEnginePerformanceLeague()};
}
