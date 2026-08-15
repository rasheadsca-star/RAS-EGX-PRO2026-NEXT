(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const numeric=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
  const num=(v,d=2)=>numeric(v)===null?'—':numeric(v).toLocaleString('ar-EG',{maximumFractionDigits:d});
  const pct=v=>numeric(v)===null?'—':`${num(v,1)}%`;
  const load=async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);return r.json()};
  const statusAr=v=>({ACTIONABLE:'قابل للتنفيذ',WATCH:'مراقبة',WAIT:'انتظار',AVOID:'تجنب'}[v]||v||'—');
  const alignmentAr=v=>({IN_ENTRY_RANGE:'داخل نطاق الدخول',BELOW_ENTRY_RANGE_WAITING:'أقل من النطاق — انتظار',ABOVE_ENTRY_RANGE_DO_NOT_CHASE:'أعلى النطاق — لا تطارد',REBUILD_REQUIRED_PRICE_SCALE_OR_STALENESS_UNVERIFIED:'إعادة بناء الخطة مطلوبة',REBUILD_REQUIRED:'إعادة بناء الخطة مطلوبة',INVALID_PLAN_RELATION:'علاقة الخطة غير صالحة'}[v]||v||'—');
  const tierClass=t=>`tier-${String(t||'RESEARCH_D').toLowerCase().replace('research_','')}`;
  function reason(code){return ({GLOBAL_EXECUTION_GATE_CLOSED:'بوابة التنفيذ العامة مغلقة',CRITICAL_SOURCE_CONFLICT:'تعارض مصدر حرج',MISSING_CRITICAL_SYMBOL_EVIDENCE:'دليل حرج ناقص',LIQUIDITY_NOT_EXECUTION_ELIGIBLE:'السيولة غير مؤهلة',SUPPORT_RESISTANCE_RESEARCH_ONLY:'الدعم/المقاومة بحثية فقط',CURRENT_PRICE_ABOVE_ENTRY_RANGE:'السعر أعلى نطاق الدخول',CURRENT_PRICE_BELOW_ENTRY_RANGE:'السعر أقل نطاق الدخول',CURRENT_TRUSTED_TECHNICAL_TREND_BULLISH:'اتجاه فني حالي صاعد',NET_RR_BELOW_0_5:'Net R/R أقل من 0.5',CURRENT_TECHNICAL_NOT_READY:'التحليل الفني الحالي غير جاهز',CURRENTTECHNICAL_UNAVAILABLE:'التحليل الفني الحالي غير متاح'}[code]||code)}
  function card(profile,index,globalExec){
    const di=profile.decisionIntelligence||{},tp=profile.tradePlan||{},align=tp.alignment||{},rr=tp.riskReward||{},ta=profile.technicalAnalysis||{},confidence=profile.confidence||{},explain=di.explainability||{};
    const status=profile.status||di.execution?.issuedStatus||'WAIT';
    const strengths=(explain.strengths||profile.whyThisStock?.strengths||[]).slice(0,3);
    const weaknesses=(explain.weaknesses||[]).slice(0,3);
    const gaps=(explain.evidenceGaps||[]).slice(0,2);
    const canExecute=globalExec==='EXECUTION_GRADE'&&status==='ACTIONABLE'&&align.eligibleForActionable===true;
    return `<article class="watch-card" data-ticker="${esc(profile.ticker)}"><div class="rank">#${index+1}</div><div class="card-head"><div><span class="ticker">${esc(profile.ticker)}</span><strong>${esc(profile.nameAr||profile.nameEn||'—')}</strong><small>${esc(statusAr(status))} • ${esc(alignmentAr(align.state))}</small></div><div class="score ${tierClass(di.researchTier)}"><span>Research Score</span><strong>${num(di.researchDecisionScore,1)}</strong><small>${esc(di.researchTier||'—')}</small></div></div><div class="metrics"><div><span>السعر</span><strong>${num(profile.price,4)}</strong></div><div><span>Net R/R T1</span><strong>${num(rr.primaryTarget1NetRiskReward??tp.primaryTarget1NetRiskReward,2)}</strong></div><div><span>Evidence coverage</span><strong>${pct(di.scoreEvidenceCoveragePct)}</strong></div><div><span>Data confidence</span><strong>${pct(confidence.dataConfidencePct)}</strong></div><div><span>Execution confidence</span><strong>${pct(confidence.executionConfidencePct)}</strong></div><div><span>Decision technical</span><strong>${ta.currentTechnicalReady?'حالي موثوق':'غير مكتمل/سياق فقط'}</strong></div></div><div class="plan"><span>الدخول ${num(tp.entryLow,4)}–${num(tp.entryHigh,4)}</span><span>وقف ${num(tp.stop,4)}</span><span>هدف1 ${num(tp.target1,4)}</span><span>هدف2 ${num(tp.target2,4)}</span></div><div class="why"><div><b>نقاط قوة</b>${strengths.length?strengths.map(x=>`<span class="good">${esc(reason(x))}</span>`).join(''):'<span>—</span>'}</div><div><b>قيود/ضعف</b>${weaknesses.length?weaknesses.map(x=>`<span class="bad">${esc(reason(x))}</span>`).join(''):'<span>—</span>'}</div><div><b>فجوات دليل</b>${gaps.length?gaps.map(x=>`<span class="warn">${esc(reason(x))}</span>`).join(''):'<span>لا توجد فجوات إضافية مسجلة</span>'}</div></div><div class="decision ${canExecute?'decision-open':'decision-closed'}"><strong>${canExecute?'Execution permission متاح وفق الحالة الحالية':'Research watch فقط — لا توجد Execution permission'}</strong><small>Research Score غير معايرة ولا تنشئ ACTIONABLE أو وزن محفظة أو أمر شراء.</small></div></article>`;
  }
  async function init(){try{
    const [profiles,current,regime]=await Promise.all([load('../data/v20/stock-profiles.json'),load('../data/v20/current.json'),load('../data/v20/market-regime.json')]);
    $('execution').textContent=current.executionStatus==='EXECUTION_GRADE'?'Execution Grade':current.executionStatus==='RESEARCH_ONLY'?'بحث فقط':current.executionStatus||'محظور';
    $('session').textContent=`جلسة ${current.sessionDate||'—'}`;
    $('regime').textContent=regime.verified?regime.regime:'غير متحقق';
    $('exposure').textContent=pct(current.portfolio?.recommendedExposurePct);
    $('cash').textContent=pct(current.portfolio?.cashPct);
    const rows=[...(profiles.profiles||[])]
      .filter(p=>numeric(p.decisionIntelligence?.researchDecisionScore)!==null)
      .sort((a,b)=>Number(b.decisionIntelligence.researchDecisionScore)-Number(a.decisionIntelligence.researchDecisionScore)||Number(a.rank||999)-Number(b.rank||999))
      .slice(0,5);
    if(rows.length!==5)throw new Error(`Expected exactly 5 scored research profiles, received ${rows.length}`);
    $('cards').innerHTML=rows.map((p,i)=>card(p,i,current.executionStatus)).join('');
    $('loading').classList.add('hidden');
    $('cards').classList.remove('hidden');
  }catch(error){
    $('loading').classList.add('hidden');
    $('error').classList.remove('hidden');
    $('error').textContent=`تعذر تحميل Top 5 Research Watch: ${error.message}`;
  }}
  init();
})();