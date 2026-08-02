'use strict';

/* Professional V16 policy overlay: separates usable Pilot research from professional proof. */
gate = function pilotAwareGate(recommendation) {
  const modelResult = model(recommendation.strategyId) || {};
  const stabilityScore = N(recommendation.modelStabilityScore) ?? N(modelResult.stabilityScore) ?? 0;
  const financial = fs(fund(recommendation.ticker), recommendation.close);
  const issues = [];
  const passed = [];
  const minimumRiskReward = N(S.d?.guardrails?.minimumRiskReward) ?? 1.15;
  const maximumRsi = N(S.d?.guardrails?.maximumRecommendationRsi) ?? 78;

  if ((N(recommendation.riskReward) || 0) < minimumRiskReward) {
    issues.push(['fail', `العائد/المخاطرة ${F(recommendation.riskReward)} أقل من الحد ${F(minimumRiskReward)}`]);
  } else {
    passed.push(`العائد/المخاطرة ${F(recommendation.riskReward)} اجتاز الحد.`);
  }

  if ((N(recommendation.rsi14) || 0) > maximumRsi) {
    issues.push(['fail', `RSI ${F(recommendation.rsi14, 1)} أعلى من الحد المهني ${F(maximumRsi, 0)} — مطاردة ممنوعة.`]);
  } else if ((N(recommendation.rsi14) || 0) >= 74) {
    issues.push(['warn', `RSI ${F(recommendation.rsi14, 1)} مرتفع ويحتاج تأكيد افتتاح.`]);
  } else {
    passed.push('لا توجد سخونة سعرية محظورة.');
  }

  if ((N(recommendation.ret5Pct) || 0) > (N(S.d?.guardrails?.maximumRecommendationReturn5Pct) ?? 15)) {
    issues.push(['fail', `صعود ${P(recommendation.ret5Pct)} خلال 5 جلسات يتجاوز حد المطاردة.`]);
  }

  if (stabilityScore < 10) {
    issues.push(['fail', 'النموذج لم يحقق الحد الأدنى حتى لوضع Pilot.']);
  } else if (stabilityScore < 70) {
    issues.push(['warn', `ثبات النموذج ${F(stabilityScore, 0)}/100 — Pilot منخفض المخاطرة فقط.`]);
  } else {
    passed.push(`ثبات النموذج ${F(stabilityScore, 0)}/100.`);
  }

  if (recommendation.modelEvidenceTier === 'PILOT_SHORT_SAMPLE' || S.d?.evidenceTier === 'PILOT_SHORT_SAMPLE') {
    issues.push(['warn', `العينة النهائية ${F(S.v?.sessions?.test, 0)} جلسة؛ لا يُستخدم وصف «مثبت».`]);
  }

  if (!S.p?.executionGrade) {
    issues.push(['fail', 'أسعار التنفيذ غير موثقة.']);
  } else {
    passed.push('أسعار الجلسة اجتازت بوابة الحقيقة.');
  }

  if (financial.score < 50) {
    issues.push(['warn', 'التحليل المالي غير مكتمل؛ القرار فني قصير الأجل فقط.']);
  } else {
    passed.push('المراجعة المالية مقبولة.');
  }

  const hardBlocked = issues.some(item => item[0] === 'fail');
  const pilot = recommendation.pilotRiskMode === 'REDUCED_RISK'
    || recommendation.modelEvidenceTier === 'PILOT_SHORT_SAMPLE'
    || stabilityScore < 70;
  const status = hardBlocked ? 'blocked' : (issues.length || pilot ? 'caution' : 'eligible');
  const label = hardBlocked ? 'محجوبة مهنيًا' : pilot ? 'Pilot منخفض المخاطرة' : issues.length ? 'مراجعة بحذر' : 'صالحة للمراجعة';
  const cls = hardBlocked ? 'bad' : status === 'eligible' ? 'good' : 'warn';

  return {
    status,
    label,
    cls,
    i: issues,
    ok: passed,
    st: {
      score: stabilityScore,
      label: stabilityScore >= 70 ? 'مستقر نسبيًا' : stabilityScore >= 25 ? 'حساس لدورة السوق' : 'غير مستقر — Pilot فقط',
      cls: stabilityScore >= 70 ? 'good' : 'warn',
      reason: A(recommendation.modelStabilityReasonsAr || modelResult.stabilityReasonsAr).join(' — '),
    },
    f: financial,
    pilot,
  };
};

calc = function pilotRiskPositionSize() {
  const recommendation = S.sel;
  const capital = N($('capitalInput').value) || 0;
  const requestedRiskPct = N($('riskPctInput').value) || 0;
  const maximumWeightPct = N($('maxWeightInput').value) || 0;
  if (!recommendation?.entryHigh || !recommendation?.stopLoss) {
    $('positionResult').innerHTML = '<div class="empty">لا توجد خطة قابلة للحساب.</div>';
    return;
  }

  const gateResult = gate(recommendation);
  if (gateResult.status === 'blocked') {
    $('positionResult').innerHTML = '<div class="professional-verdict bad">تم منع حساب مركز تنفيذي لعدم اجتياز بوابة مهنية صلبة.</div>';
    $('addPortfolioBtn').disabled = true;
    return;
  }

  const effectiveRiskPct = gateResult.pilot ? Math.min(requestedRiskPct, 0.25) : requestedRiskPct;
  const riskAmount = capital * effectiveRiskPct / 100;
  const riskPerShare = recommendation.entryHigh - recommendation.stopLoss;
  const quantityByRisk = riskPerShare > 0 ? Math.floor(riskAmount / riskPerShare) : 0;
  const quantityByWeight = Math.floor(capital * maximumWeightPct / 100 / recommendation.entryHigh);
  const quantityByLiquidity = Math.floor((N(recommendation.averageTurnover20Egp) || 0) * 0.005 / recommendation.entryHigh);
  const quantity = Math.max(0, Math.min(quantityByRisk, quantityByWeight, quantityByLiquidity || quantityByRisk));
  const notional = quantity * recommendation.entryHigh;
  const cashRisk = quantity * riskPerShare;

  $('positionResult').innerHTML = [
    ['وضع المخاطرة', gateResult.pilot ? 'Pilot مخفّض' : 'قياسي'],
    ['المخاطرة المطلوبة', P(requestedRiskPct)],
    ['المخاطرة الفعلية', P(effectiveRiskPct)],
    ['الكمية القصوى', F(quantity, 0)],
    ['قيمة المركز', M(notional)],
    ['الخطر عند الوقف', M(cashRisk)],
    ['وزن المركز', capital ? P(notional / capital * 100) : '—'],
  ].map(item => `<div class="result-row"><span>${item[0]}</span><b>${item[1]}</b></div>`).join('');

  Object.assign($('addPortfolioBtn').dataset, { q: quantity, nv: notional, risk: cashRisk });
  $('addPortfolioBtn').disabled = quantity <= 0;
};
