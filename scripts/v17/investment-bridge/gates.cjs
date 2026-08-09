'use strict';

const CLASSIFICATION_AR = Object.freeze({
  NOT_QUALIFIED: 'غير مؤهل للتحويل',
  EXTENDED_WATCH: 'مرشح متابعة ممتدة',
  MEDIUM_TERM: 'مرشح للتحويل إلى استثمار متوسط الأجل',
  MEDIUM_LONG_TERM: 'مرشح للتحويل إلى استثمار متوسط/طويل الأجل',
  ACTIVE_POSITION: 'مركز استثماري قيد المتابعة',
  REVIEW_REQUIRED: 'إعادة تقييم مطلوبة',
  EXIT_SIGNAL: 'إشارة خروج بحثية',
});

const EXIT_STATES_AR = Object.freeze({
  RESEARCH_HOLD: 'استمرار الاحتفاظ البحثي',
  HOLD_WITH_MONITORING: 'استمرار مع مراقبة',
  REDUCE_RISK_REVIEW: 'تقليل المخاطرة / مراجعة',
  IMMEDIATE_REVIEW: 'إعادة تقييم فورية',
  EXIT_SIGNAL: 'إشارة خروج بحثية',
  REFERENCE_TARGET_REACHED: 'تم الوصول إلى الهدف المرجعي',
  BREAKOUT_CONFIRMING: 'اختراق القمة قيد التأكيد',
  BREAKOUT_CONFIRMED: 'اختراق مؤكد',
  FAILED_BREAKOUT: 'فشل الاختراق',
});

const ALERT_PRIORITY_AR = Object.freeze({
  INFO: 'معلومة',
  NOTICE: 'تنبيه',
  IMPORTANT: 'تنبيه مهم',
  CRITICAL: 'تنبيه حرج',
});

function round(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function isValidExecution(daily) {
  if (!daily) return false;
  if (daily.executionStatus === 'KEEP_CASH' || daily.status === 'KEEP_CASH') return false;
  if (daily.executionStatus === 'NOT_EXECUTED' || daily.executionStatus === 'UNFILLED') return false;
  if (daily.filled === false || daily.executed === false) return false;
  if (daily.actualExecutionPrice || daily.executionPrice) return true;
  if (daily.status === 'EXECUTED' || daily.executionStatus === 'EXECUTED' || daily.executionStatus === 'FILLED') return true;
  return daily.researchOnly !== true && daily.liveExecutionEnabled === true;
}

function hasInsufficientFundamentals(detail) {
  const confidence = detail?.fundamental?.fundamentalDataConfidence || 'UNAVAILABLE';
  return !['HIGH', 'MEDIUM'].includes(confidence) || detail?.fundamental?.fundamentalQualityScore == null;
}

function hasSevereFinancialRisk(detail) {
  return ['HIGH', 'VERY_HIGH', 'SEVERE'].includes(detail?.risk?.classification)
    || ['HIGH', 'VERY_HIGH', 'SEVERE'].includes(detail?.fundamental?.financialRisk?.classification);
}

function hasValueTrapRisk(detail) {
  return ['HIGH', 'SEVERE', 'VERY_HIGH'].includes(detail?.valueTrapRisk?.classification)
    || ['HIGH', 'SEVERE', 'VERY_HIGH'].includes(detail?.fundamental?.valueTrapRisk?.classification);
}

function hasMaterialNegativeNews(detail) {
  return detail?.severeVerifiedNegativeEvent === true
    || (detail?.news?.materialEvents || []).some(event => ['SEVERE_NEGATIVE', 'MATERIAL_NEGATIVE'].includes(event.impact));
}

function hasCorporateActionProblem(detail) {
  const quality = detail?.historicalDataQuality || {};
  const reasons = quality.reasons || [];
  return quality.status === 'REVIEW_REQUIRED'
    || String(quality.corporateActionConfidence || '').includes('UNKNOWN')
    || reasons.some(reason => String(reason).includes('CORPORATE_ACTION'));
}

function evaluateConversionGate({ daily, historicalDecision }) {
  const reasonsAr = [];
  const failures = [];
  const detail = historicalDecision?.detail || historicalDecision;
  const technical = detail?.technical || {};
  const historical = detail?.historical || {};
  const quality = detail?.historicalDataQuality || {};
  const recoveryStage = technical.recoveryStage;

  if (!daily) { failures.push('DAILY_NOT_SELECTED'); reasonsAr.push('السهم غير موجود في توصيات اليوم المعتمدة.'); }
  if (daily && !isValidExecution(daily)) { failures.push('NOT_EXECUTED'); reasonsAr.push('لم تتحقق أهلية التنفيذ اليومية، لذلك لا يتم إنشاء مركز متابعة استثماري.'); }
  if (!detail) { failures.push('NOT_IN_HISTORICAL_UNIVERSE'); reasonsAr.push('السهم غير موجود في حصر التعافي التاريخي.'); }
  if (detail && quality.status !== 'VALID') { failures.push('INVALID_LONG_HISTORY'); reasonsAr.push('البيانات التاريخية الطويلة غير صالحة أو تحتاج مراجعة.'); }
  if (detail && hasCorporateActionProblem(detail)) { failures.push('CORPORATE_ACTION_REVIEW'); reasonsAr.push('يوجد احتمال مشكلة إجراء رأسمالي أو حاجة مراجعة قبل التحويل.'); }
  if (detail && !(Number(historical.drawdownFromHighPct) >= 10 && Number(historical.recoveryPositionPct) >= 20)) {
    failures.push('WEAK_RECOVERY_STRUCTURE');
    reasonsAr.push('هيكل الهبوط/التعافي غير كافٍ للتحويل البحثي.');
  }
  if (detail && !['EARLY_RECOVERY', 'CONFIRMED_RECOVERY'].includes(recoveryStage)) {
    failures.push('RECOVERY_STAGE_NOT_ACCEPTABLE');
    reasonsAr.push('مرحلة التعافي الحالية ليست بداية تعافٍ أو تعافٍ مؤكد.');
  }
  if (detail && !(Number(technical.strengthScore) >= 45)) { failures.push('LOW_TECHNICAL_STRENGTH'); reasonsAr.push('القوة الفنية أقل من الحد الأدنى.'); }
  if (detail && !(Number(technical.recoveryScore) >= 40)) { failures.push('LOW_RECOVERY_QUALITY'); reasonsAr.push('جودة التعافي أقل من الحد الأدنى.'); }
  if (detail && Number(technical.rsi14) >= 75) { failures.push('SEVERE_TECHNICAL_EXTENSION'); reasonsAr.push('السهم في امتداد فني/RSI مرتفع يمنع التحويل الطبيعي.'); }
  if (detail && hasMaterialNegativeNews(detail)) { failures.push('MATERIAL_NEGATIVE_NEWS'); reasonsAr.push('يوجد خبر أو إفصاح سلبي جوهري موثق.'); }
  if (detail && hasSevereFinancialRisk(detail)) { failures.push('SEVERE_FINANCIAL_RISK'); reasonsAr.push('المخاطر المالية مرتفعة بصورة تمنع التحويل.'); }
  if (detail && hasValueTrapRisk(detail)) { failures.push('VALUE_TRAP_RISK'); reasonsAr.push('مخاطر مصيدة القيمة مرتفعة.'); }
  if (detail && Number(detail.overallDataConfidence) < 30) { failures.push('LOW_DATA_CONFIDENCE'); reasonsAr.push('ثقة البيانات غير كافية.'); }

  if (failures.length) {
    return {
      passed: false,
      classificationCode: failures.includes('NOT_EXECUTED') ? 'NOT_EXECUTED' : 'NOT_QUALIFIED',
      classificationAr: failures.includes('NOT_EXECUTED') ? 'لم يتم التنفيذ اليومي' : CLASSIFICATION_AR.NOT_QUALIFIED,
      failures,
      reasonsAr,
    };
  }

  if (hasInsufficientFundamentals(detail)) {
    return {
      passed: true,
      classificationCode: 'EXTENDED_WATCH',
      classificationAr: 'مرشح متابعة ممتدة — البيانات المالية غير مكتملة',
      failures: ['INSUFFICIENT_FUNDAMENTALS_FOR_FULL_INVESTMENT_LABEL'],
      reasonsAr: ['فنيًا وتاريخيًا مؤهل للمتابعة الممتدة، لكن البيانات المالية غير مكتملة فلا يُسمى مرشحًا استثماريًا متكاملًا.'],
    };
  }

  const fundamentalQuality = Number(detail.fundamental?.fundamentalQualityScore);
  const current = Number(historical.current);
  const high = Number(historical.high);
  const distanceToHighPct = high > 0 && Number.isFinite(current) ? ((high - current) / high) * 100 : null;
  if (fundamentalQuality >= 70 && Number(distanceToHighPct) >= 15 && detail.dataCompleteness === 'FULL') {
    return {
      passed: true,
      classificationCode: 'MEDIUM_LONG_TERM',
      classificationAr: CLASSIFICATION_AR.MEDIUM_LONG_TERM,
      failures: [],
      reasonsAr: ['الأدلة التاريخية والفنية والمالية كافية لتصنيف متوسط/طويل الأجل بحثيًا.'],
    };
  }

  return {
    passed: true,
    classificationCode: 'MEDIUM_TERM',
    classificationAr: CLASSIFICATION_AR.MEDIUM_TERM,
    failures: [],
    reasonsAr: ['الأدلة كافية لتصنيف متابعة استثمارية متوسطة الأجل بحثيًا.'],
  };
}

function buildTrackedPosition({ daily, historicalDecision, gate, asOf }) {
  const detail = historicalDecision.detail || historicalDecision;
  const h = detail.historical || {};
  const t = detail.technical || {};
  const conversionPrice = Number(daily.actualExecutionPrice || daily.executionPrice || daily.price || h.current);
  const current = Number(h.current);
  const high = Number(h.high);
  const returnPct = Number.isFinite(conversionPrice) && conversionPrice > 0 && Number.isFinite(current)
    ? ((current - conversionPrice) / conversionPrice) * 100
    : null;
  return {
    ticker: detail.ticker,
    companyArabic: detail.companyNameAr,
    dailyRecommendationDate: daily.signalDate || daily.date || daily.sessionId || null,
    dailyEntryPrice: daily.price ?? daily.plan?.entryLow ?? null,
    actualExecutionPrice: daily.actualExecutionPrice ?? daily.executionPrice ?? null,
    conversionDate: asOf.toISOString().slice(0, 10),
    conversionReferencePrice: round(conversionPrice),
    historicalHigh: h.high ?? null,
    historicalHighDate: h.highDate ?? null,
    postPeakLow: h.postPeakLow ?? null,
    postPeakLowDate: h.postPeakLowDate ?? null,
    currentPrice: h.current ?? null,
    distanceToHistoricalHighPct: high > 0 && Number.isFinite(current) ? round(((high - current) / high) * 100) : null,
    recoveryPositionPct: round(h.recoveryPositionPct),
    RecoveryScore: round(t.recoveryScore),
    StrengthScore: round(t.strengthScore),
    FundamentalQuality: detail.fundamental?.fundamentalQualityScore ?? null,
    ValuationScore: detail.fundamental?.valuation?.score ?? null,
    FinancialRisk: detail.risk?.classification || detail.fundamental?.financialRisk?.classification || 'UNAVAILABLE',
    NewsImpact: detail.news?.newsImpactScore ?? null,
    NewsConfidence: detail.news?.newsConfidence ?? null,
    DataConfidence: detail.overallDataConfidence ?? null,
    currentInvestmentClassification: gate.classificationAr,
    highestPriceSinceConversion: h.current ?? null,
    lowestPriceSinceConversion: h.current ?? null,
    unrealizedReturnPct: round(returnPct),
    status: gate.classificationCode === 'EXTENDED_WATCH' ? 'EXTENDED_WATCH' : 'ACTIVE',
    riskState: deriveRiskState(detail),
    lastReviewedAt: asOf.toISOString(),
  };
}

function deriveRiskState(detail) {
  if (hasMaterialNegativeNews(detail) || hasSevereFinancialRisk(detail) || hasValueTrapRisk(detail)) return 'UNACCEPTABLE';
  if (Number(detail?.technical?.rsi14) >= 70) return 'ELEVATED';
  return 'NORMAL';
}

function assessExitState(position, detail) {
  const reasonsAr = [];
  const current = Number(detail?.historical?.current ?? position.currentPrice);
  const high = Number(position.historicalHigh);
  const distance = high > 0 && Number.isFinite(current) ? ((high - current) / high) * 100 : null;
  if (hasMaterialNegativeNews(detail)) return { state: 'EXIT_SIGNAL', stateAr: EXIT_STATES_AR.EXIT_SIGNAL, reasonsAr: ['ظهر حدث سلبي جوهري موثق يستدعي إشارة خروج بحثية.'] };
  if (hasSevereFinancialRisk(detail) || hasValueTrapRisk(detail)) return { state: 'IMMEDIATE_REVIEW', stateAr: EXIT_STATES_AR.IMMEDIATE_REVIEW, reasonsAr: ['ارتفعت المخاطر المالية أو مخاطر مصيدة القيمة.'] };
  if (Number(detail?.technical?.strengthScore) < 35) return { state: 'REDUCE_RISK_REVIEW', stateAr: EXIT_STATES_AR.REDUCE_RISK_REVIEW, reasonsAr: ['القوة الفنية هبطت دون مستوى المتابعة الآمنة.'] };
  const previousBreakout = ['BREAKOUT_CONFIRMING', 'BREAKOUT_CONFIRMED'].includes(position?.previousReviewState || position?.dailyReview?.state);
  if (previousBreakout && distance !== null && distance >= 2) return { state: 'FAILED_BREAKOUT', stateAr: EXIT_STATES_AR.FAILED_BREAKOUT, reasonsAr: ['عاد السعر أسفل القمة المرجعية بأكثر من 2% بعد محاولة الاختراق.'] };
  if (distance !== null && distance < 0 && (detail?.technical?.breakoutConfirmed === true || Number(detail?.technical?.sessionsAboveHistoricalHigh) >= 2)) return { state: 'BREAKOUT_CONFIRMED', stateAr: EXIT_STATES_AR.BREAKOUT_CONFIRMED, reasonsAr: ['ثبت السعر أعلى القمة المرجعية في أكثر من جلسة أو ورد تأكيد فني صريح.'] };
  if (distance !== null && distance < 0) return { state: 'BREAKOUT_CONFIRMING', stateAr: EXIT_STATES_AR.BREAKOUT_CONFIRMING, reasonsAr: ['اختراق القمة السابقة قيد التأكيد، ولا يتم الخروج تلقائيًا.'] };
  if (distance !== null && distance <= 0) return { state: 'REFERENCE_TARGET_REACHED', stateAr: EXIT_STATES_AR.REFERENCE_TARGET_REACHED, reasonsAr: ['تم الوصول إلى القمة المرجعية ويلزم تقييم الاختراق.'] };
  if (distance !== null && distance <= 5) return { state: 'HOLD_WITH_MONITORING', stateAr: EXIT_STATES_AR.HOLD_WITH_MONITORING, reasonsAr: ['قرب القمة التاريخية — مراجعة الاحتفاظ/تخفيف المركز.'] };
  if (distance !== null && distance <= 10) return { state: 'HOLD_WITH_MONITORING', stateAr: EXIT_STATES_AR.HOLD_WITH_MONITORING, reasonsAr: ['الاقتراب من منطقة القمة التاريخية — يلزم إعادة تقييم.'] };
  reasonsAr.push('اتجاه التعافي ما زال قائمًا ولا توجد إشارة خروج بحثية مؤكدة.');
  return { state: 'RESEARCH_HOLD', stateAr: EXIT_STATES_AR.RESEARCH_HOLD, reasonsAr };
}

module.exports = {
  CLASSIFICATION_AR,
  EXIT_STATES_AR,
  ALERT_PRIORITY_AR,
  round,
  isValidExecution,
  evaluateConversionGate,
  buildTrackedPosition,
  assessExitState,
};
