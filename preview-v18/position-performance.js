// Appended to preview-v18/app.js by build-v18-decision-board.cjs.
function renderRecommendationPositionPerformance(){
  const perf=state.data?.recommendationPositionPerformance;if(!perf)return;
  const view=document.querySelector('[data-view="agreement"]');if(!view)return;
  let panel=document.getElementById('recommendationPositionPerformancePanel');
  if(!panel){panel=document.createElement('section');panel.id='recommendationPositionPerformancePanel';panel.className='panel';const league=document.getElementById('enginePerformanceLeaguePanel');if(league)league.after(panel);else view.prepend(panel)}
  const rows=(perf.top10||[]);const rate=v=>Number.isFinite(Number(v))?`${fmt(v,1)}%`:'—';
  const bestCount=perf.bestByTargetCount;const bestRate=perf.bestByTargetRate;
  panel.innerHTML=`<div class="panel-head"><div><div class="eyebrow">RECOMMENDATION NUMBER PERFORMANCE</div><h2>أي رقم توصية يحقق الهدف أكثر؟</h2><p>Future-only من <b>${esc(perf.trackingStartsOn)}</b>. الرقم هو ترتيب التوصية وقت إصدارها داخل قائمة V18 اليومية.</p></div><span class="pill">Rank 1–10</span></div>
  <div class="performance-kpis"><div class="metric"><span>أكثر رقم حقق Target</span><strong>${bestCount&&bestCount.target1Hits>0?`#${bestCount.recommendationNumber}`:'—'}</strong></div><div class="metric good"><span>عدد مرات الهدف</span><strong>${bestCount?fmt(bestCount.target1Hits,0):'—'}</strong></div><div class="metric"><span>أفضل نسبة نجاح مؤهلة</span><strong>${bestRate?`#${bestRate.recommendationNumber}`:'—'}</strong></div><div class="metric good"><span>Target% المحسوم</span><strong>${bestRate?rate(bestRate.targetHitRateResolvedPct):'—'}</strong></div></div>
  <div class="performance-note"><b>مهم:</b> «الأكثر تحقيقًا للهدف» بالعدد وحده لا يكفي. لذلك نعرض أيضًا Target% من الصفقات المحسومة، ولا نعتبر ترتيبًا متفوقًا رسميًا قبل ${fmt(perf.rankingMinimumResolvedSignals,0)} نتائج محسومة.</div>
  <div class="table-wrap"><table class="wide performance-table"><thead><tr><th>رقم التوصية</th><th>ظهرت</th><th>تفعّلت</th><th>Target 1</th><th>Stop</th><th>Ambiguous</th><th>Unresolved</th><th>Activation%</th><th>Target% من المحسوم</th><th>Target% من المتفعّل</th><th>الحكم</th></tr></thead><tbody>${rows.map(x=>`<tr><td><b>#${fmt(x.recommendationNumber,0)}</b></td><td>${fmt(x.issuedSignals,0)}</td><td>${fmt(x.referenceActivated,0)}</td><td class="pos"><b>${fmt(x.target1Hits,0)}</b></td><td class="neg">${fmt(x.stopHits,0)}</td><td>${fmt(x.ambiguous,0)}</td><td>${fmt(x.unresolved,0)}</td><td>${rate(x.activationRatePct)}</td><td><b>${rate(x.targetHitRateResolvedPct)}</b></td><td>${rate(x.targetHitRateActivatedPct)}</td><td>${x.rankingEligible?'Sample eligible':'Sample building'}</td></tr>`).join('')}</tbody></table></div>`;
  if(!document.getElementById('positionPerformanceStyle')){const s=document.createElement('style');s.id='positionPerformanceStyle';s.textContent='.performance-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-bottom:12px}@media(max-width:760px){.performance-kpis{grid-template-columns:1fr 1fr}}';document.head.appendChild(s)}
}
if(typeof renderAgreement==='function'){
  const __renderAgreementWithEnginePerformance=renderAgreement;
  renderAgreement=function(){__renderAgreementWithEnginePerformance();renderRecommendationPositionPerformance()};
}
