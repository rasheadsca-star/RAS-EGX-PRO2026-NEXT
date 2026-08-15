(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const numeric=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
  const num=(v,d=2)=>numeric(v)===null?'—':numeric(v).toLocaleString('ar-EG',{maximumFractionDigits:d});
  const pct=v=>numeric(v)===null?'—':`${num(v,2)}%`;
  const load=async(url,optional=false)=>{try{const r=await fetch(url,{cache:'no-store'});if(!r.ok){if(optional)return null;throw new Error(`${url}: HTTP ${r.status}`)}return r.json()}catch(e){if(optional)return null;throw e}};
  const roleAr=r=>({MISSING:'ناقص',STALE:'قديم',CONFLICT:'تعارض حرج'}[r]||r);
  const observedAr=c=>({OBSERVED_CURRENT_CRITICAL_SOURCE_CONFLICT:'تعارض مصدر حرج قائم حاليًا',OBSERVED_TRUSTED_SR_ROW_STALE:'صف S/R موثوق لكنه قديم عن الجلسة المرجعية',OBSERVED_V17_HISTORY50_SYMBOL_MISSING:'لا يوجد سجل للرمز داخل history-50 المرجعي',OBSERVED_V17_HISTORY50_CURRENT_SESSION_ROW_MISSING:'history-50 لا يحتوي صف الجلسة الحالية',OBSERVED_V17_HISTORY50_CURRENT_OHLC_INVALID:'صف الجلسة الحالية في history-50 غير صالح كـOHLC',OBSERVED_V17_HISTORY50_CURRENT_ROW_NOT_SOURCE_SESSION_VERIFIED:'صف الجلسة موجود لكن sourceSessionVerified غير مثبت',OBSERVED_INTERNAL_SR_ROW_MISSING:'مدخل history-50 موجود لكن صف Internal S/R غير موجود',OBSERVED_AGGREGATE_MISSING_REQUIRES_V17_REBUILD_REVIEW:'الحالة تحتاج مراجعة وإعادة بناء V17 لتحديد سبب الاستبعاد النهائي'}[c]||c||'—');
  const supState=s=>({ELIGIBLE_FOR_V17_REVIEW:'صالح للمراجعة داخل V17',SUPPLEMENTAL_EVIDENCE_INCOMPLETE:'دليل إضافي غير مكتمل',UNAVAILABLE:'غير متاح'}[s]||s||'—');
  function badge(role){return `<span class="role role-${esc(String(role).toLowerCase())}">${esc(roleAr(role))}</span>`}
  function sourceBlock(title,kind,items){return `<section class="source-box ${kind}"><div class="source-title"><b>${esc(title)}</b></div><div class="source-facts">${items.map(([label,value,sub])=>`<div><span>${esc(label)}</span><strong>${esc(value??'—')}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`).join('')}</div></section>`}
  function card(row){
    const roles=row.remediationRoles||[],h=row.authoritativeV17?.history50||{},sr=row.authoritativeV17?.internalSr||{},sup=row.supplementalCandidate||{},conf=row.authoritativeV17?.conflict||null,ready=sup.eligibleForV17Review===true;
    const authBlock=sourceBlock('V17 authoritative input','authoritative',[
      ['المسار',h.inputPath||'data/history-50.json',`rows ${h.rowCount??0} • valid OHLC ${h.validOhlcCount??0}`],
      ['آخر جلسة',h.latestSession||'—',h.currentSessionRowPresent?'صف الجلسة الحالية موجود':'صف الجلسة الحالية غير موجود'],
      ['Current OHLC',h.currentSessionOhlcValid?'صالح':'غير صالح/غير متاح',h.currentSessionSource||'—'],
      ['Source session',h.currentSessionSourceVerified?'Verified':'غير مثبت',h.currentSessionSourceQuality||h.marketSource||'—'],
      ['Internal S/R',sr.rowExists?(sr.sessionAligned?'صف حالي':'صف غير متزامن'):'لا يوجد صف',`trusted=${sr.trustedForExecution===true?'yes':'no'} • eligible=${sr.executionEligible===true?'yes':'no'}`],
      ['Conflict',conf?`${conf.source||'—'} • ${pct(conf.maxDiffPct)}`:'لا يوجد على هذا target',conf?.state||'—']
    ]);
    const supBlock=sourceBlock('Yahoo supplemental review candidate','supplemental',[
      ['الحالة',supState(sup.status),`fetch ${row.acquisitionAttempt?.status||'—'}`],
      ['Identity',sup.identityVerified?'Verified':'غير متحقق',`score ${num(sup.identityScore,0)} • ${sup.identityPolicy||'—'}`],
      ['آخر جلسة',sup.latestSession||'—',`accepted rows ${sup.acceptedRowCount??0}`],
      ['Current OHLC',sup.currentSessionOhlc?.valid?'صالح':'غير متاح/غير صالح',sup.currentSessionOhlc?`O ${num(sup.currentSessionOhlc.open,4)} H ${num(sup.currentSessionOhlc.high,4)} L ${num(sup.currentSessionOhlc.low,4)} C ${num(sup.currentSessionOhlc.close,4)}`:'—'],
      ['Price reconcile',sup.priceReconciled?'متطابق ضمن الحد':'غير متطابق/غير متاح',`diff ${pct(sup.currentPriceDifferencePct)} • limit ${pct(sup.priceTolerancePct)}`],
      ['V17 trust','NO',`executionEligible=false • future rejected ${sup.futureRowsRejected??0}`]
    ]);
    return `<article class="symbol-card ${ready?'warn':'bad'}" data-role="${esc(roles.join(' '))}" data-review-ready="${ready?'true':'false'}"><div class="symbol-head"><div><strong>${esc(row.symbol)}</strong><small>${roles.map(badge).join('')}</small></div><span class="review-state ${ready?'review-ready':'review-blocked'}">${ready?'ELIGIBLE FOR V17 REVIEW':'REVIEW EVIDENCE INCOMPLETE'}</span></div><div class="observed"><b>Observed condition</b><span>${esc(observedAr(row.observedCondition||row.diagnosis))}</span><small>Cause verified: NO — لا يتم استنتاج سبب corporate action أو source fault بدون دليل.</small></div><div class="source-grid">${authBlock}${supBlock}</div><div class="guard"><strong>Review candidate only — لا يفتح التنفيذ تلقائيًا.</strong><span>Yahoo هنا دليل إضافي للمراجعة فقط؛ لا يصبح V17 trusted evidence، ولا يغيّر Execution Grade، ولا يحل AFMC أو أي تعارض تلقائيًا.</span></div></article>`;
  }
  async function init(){try{
    const regression=await load('../data/v20/regression.json');
    const audit=regression.supportResistanceRemediation||await load('../data/v20/sr-remediation-audit.json',true);
    if(!audit)throw new Error('S/R remediation evidence missing');
    if(audit.schemaVersion!=='20.0.0-sr-remediation-audit-3')throw new Error(`Unsupported remediation schema ${audit.schemaVersion||'missing'}`);
    const gap=audit.currentGap||{},summary=audit.summary||{},targets=audit.targets||audit.symbols||[];
    $('session').textContent=`جلسة ${audit.sessionDate||'—'}`;
    $('targetCount').textContent=String(summary.targetCount??targets.length);
    $('missingCount').textContent=String(summary.missingTargetCount??audit.missingSymbols?.length??0);
    $('roleSummary').textContent=`Missing ${summary.missingTargetCount??0} • Stale ${summary.staleTargetCount??0} • Conflict ${summary.conflictTargetCount??0}`;
    $('reviewReadyCount').textContent=String(summary.supplementalReviewReadyCount??0);
    $('coverageGap').textContent=`+${gap.trustedGap??0}`;$('coverageText').textContent=`${gap.trustedCount??0}/${gap.candidateUniverseCount??0} → مطلوب ${gap.requiredTrustedCount??'—'}`;
    $('freshGap').textContent=`+${gap.trustedFreshGap??0}`;$('freshText').textContent=`${gap.trustedFreshCount??0}/${gap.candidateUniverseCount??0} → مطلوب ${gap.requiredTrustedFreshCount??'—'}`;
    $('criticalGap').textContent=`+${gap.criticalGap??0}`;$('criticalText').textContent=`≈${gap.criticalEquivalent??0}/${gap.candidateUniverseCount??0} → مطلوب ${gap.requiredCriticalEquivalent??'—'}`;
    $('conflictGap').textContent=`${gap.sourceConflictCount??0}→0`;$('conflictText').textContent=(audit.conflictSymbols||[]).join('، ')||'لا يوجد';
    $('symbolCards').innerHTML=targets.length?targets.map(card).join(''):'<div class="empty">لا توجد remediation targets في الـevidence الحالية.</div>';
    const conflictRows=targets.filter(x=>(x.remediationRoles||[]).includes('CONFLICT'));
    $('conflicts').innerHTML=conflictRows.length?conflictRows.map(x=>{const c=x.authoritativeV17?.conflict||{};return `<article class="conflict-card"><strong>${esc(x.symbol)}</strong><span>${esc(c.source||'—')} • ${esc(c.state||'—')}</span><small>maxDiff ${pct(c.maxDiffPct)} • automatic resolution = NO • Yahoo review candidate لا يلغي التعارض.</small></article>`}).join(''):'<div class="empty">لا توجد تعارضات حرجة ضمن targets الحالية.</div>';
    $('integrity').textContent=audit.inputIntegrity?.unchanged===true?'Protected V17/history-50 hashes unchanged':'Integrity check not confirmed';
    $('loading').classList.add('hidden');
  }catch(error){$('loading').classList.add('hidden');$('error').classList.remove('hidden');$('error').textContent=`تعذر تحميل Remediation Audit: ${error.message}`;}}
  init();
})();
