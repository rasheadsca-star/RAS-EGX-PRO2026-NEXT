'use strict';

const LABELS_AR = Object.freeze({
  STRONG_CONFIRMED_CANDIDATE: 'مرشح استثماري قوي بعد التأكيد',
  STAGED_INVESTMENT_CANDIDATE: 'مرشح استثماري تدريجي',
  HIGH_RISK_RECOVERY: 'فرصة تعافٍ عالية المخاطر',
  POSITIVE_WATCH: 'مراقبة إيجابية',
  BOTTOM_WATCH: 'مراقبة قاع',
  VALUE_TRAP_RISK: 'خطر مصيدة قيمة',
  WAIT: 'انتظار',
  INSUFFICIENT_FINANCIAL_DATA: 'بيانات مالية غير كافية',
  REVIEW_REQUIRED: 'إعادة مراجعة مطلوبة',
});

const DECISION_RANK = Object.freeze({
  STRONG_CONFIRMED_CANDIDATE: 1,
  STAGED_INVESTMENT_CANDIDATE: 2,
  POSITIVE_WATCH: 3,
  HIGH_RISK_RECOVERY: 4,
  BOTTOM_WATCH: 5,
  WAIT: 6,
  INSUFFICIENT_FINANCIAL_DATA: 7,
  VALUE_TRAP_RISK: 8,
  REVIEW_REQUIRED: 9,
});

const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const clamp = value => Math.min(100, Math.max(0, Number(value)));

function newsComponent(news) {
  if (!news || news.coverageStatus === 'SOURCE_COVERAGE_UNAVAILABLE') return null;
  return clamp(50 + Number(news.newsImpactScore || 0) / 2);
}

function overallDataConfidence(market, fundamental, news) {
  const historical = finite(market?.dataConfidence) ? Number(market.dataConfidence) : 0;
  const fundamentalMap = { HIGH: 100, MEDIUM: 75, LOW: 40, UNAVAILABLE: 0 };
  const f = fundamentalMap[fundamental?.fundamentalDataConfidence] ?? 0;
  const n = news?.coverageStatus === 'SOURCE_COVERAGE_UNAVAILABLE' ? 0
    : news?.materialEvents?.length ? Number(news.newsConfidence || 0) : 85;
  return Number((historical * 0.4 + f * 0.4 + n * 0.2).toFixed(2));
}

function integrateStock(market, fundamental, news, horizonKey = 'maxAvailable') {
  const horizon = market?.horizons?.[horizonKey] || null;
  const technical = market?.horizons?.technical || {};
  const severeNegative = (news?.materialEvents || []).some(event => event.decisionEligible && event.newsImpactScore <= -55 && event.materiality >= 75);
  const newsScore = newsComponent(news);
  const inputsAvailable = finite(fundamental?.fundamentalQualityScore)
    && finite(fundamental?.valuation?.score)
    && finite(newsScore)
    && finite(market?.recoveryScore)
    && finite(market?.strengthScore);
  const confidence = overallDataConfidence(market, fundamental, news);
  const score = inputsAvailable ? Number((
    Number(fundamental.fundamentalQualityScore) * 0.30
    + Number(market.recoveryScore) * 0.20
    + Number(market.strengthScore) * 0.15
    + Number(fundamental.valuation.score) * 0.15
    + Number(newsScore) * 0.10
    + confidence * 0.10
  ).toFixed(2)) : null;
  const classification = classifyIntegrated({ market, fundamental, news, horizon, score, confidence, severeNegative });
  const positives = [];
  const negatives = [];
  if (horizon?.currentDrawdownPct >= 35) positives.push('يتداول السهم بخصم تاريخي جوهري عن القمة المعدلة المختارة.');
  if (horizon?.recoveryPositionPct <= 30) positives.push('ما زال السهم قريبًا من قاع دورة الهبوط بعد القمة.');
  if (['EARLY_RECOVERY', 'RECOVERY_CONFIRMED'].includes(market?.recoveryStage)) positives.push('توجد إشارات فنية على بدء التعافي أو تأكيده.');
  if (finite(fundamental?.fundamentalQualityScore) && fundamental.fundamentalQualityScore >= 65) positives.push('الجودة المالية المحسوبة من البيانات الموثقة جيدة نسبيًا.');
  if (fundamental?.fundamentalDataConfidence === 'UNAVAILABLE') negatives.push('لا توجد قوائم مالية منظمة وموثقة كافية للحكم على جودة الشركة.');
  if (fundamental?.valuation?.status === 'VALUATION_DATA_INSUFFICIENT') negatives.push('بيانات التقييم السعري غير كافية.');
  if (news?.coverageStatus === 'SOURCE_COVERAGE_UNAVAILABLE') negatives.push('تغطية الأخبار والإفصاحات الآلية غير متاحة حاليًا.');
  if (['HIGH', 'VERY_HIGH'].includes(fundamental?.financialRisk?.classification)) negatives.push('المخاطر المالية مرتفعة وفق الأدلة المتاحة.');
  if (fundamental?.valueTrapRisk?.classification === 'HIGH') negatives.push('توجد مؤشرات مرتفعة لاحتمال مصيدة قيمة.');
  if (market?.dataQualityStatus !== 'VALID') negatives.push('البيانات التاريخية أو الإجراء الرأسمالي يحتاج مراجعة.');
  if (severeNegative) negatives.push('يوجد حدث سلبي رسمي وجوهري يفرض إعادة المراجعة.');
  return {
    ticker: market.ticker,
    companyNameAr: market.companyNameAr || market.displayName || null,
    companyNameEn: market.companyNameEn || null,
    selectedHorizon: horizonKey,
    historical: horizon,
    horizons: market.horizons || {},
    historicalDataQuality: {
      status: market.dataQualityStatus,
      reasons: market.dataQualityReasons || [],
      confidence: market.dataConfidence ?? null,
      corporateActionConfidence: market.corporateActionConfidence || null,
      coverageStart: market.coverageStart || null,
      coverageEnd: market.coverageEnd || null,
      sessionCount: market.sessionCount || 0,
    },
    technical: {
      recoveryStage: market.recoveryStage,
      recoveryStageAr: market.recoveryStageAr,
      recoveryScore: market.recoveryScore,
      strengthScore: market.strengthScore,
      rsi14: technical.rsi14,
      ema20: technical.ema20,
      ema50: technical.ema50,
      ema200: technical.ema200,
      momentum5Pct: technical.momentum5Pct,
      momentum20Pct: technical.momentum20Pct,
      momentum60Pct: technical.momentum60Pct,
      momentum120Pct: technical.momentum120Pct,
      volumeExpansionRatio: technical.volumeExpansionRatio,
    },
    fundamental,
    news,
    investmentResearchScore: score,
    classificationCode: classification.code,
    classificationAr: LABELS_AR[classification.code],
    classificationReasonsAr: classification.reasonsAr,
    risk: fundamental?.financialRisk || { classification: 'UNAVAILABLE', labelAr: 'غير متاح', score: null },
    valueTrapRisk: fundamental?.valueTrapRisk || { classification: 'UNAVAILABLE', labelAr: 'غير متاح', score: null, reasons: [] },
    overallDataConfidence: confidence,
    dataCompleteness: inputsAvailable ? 'FULL' : (market?.dataQualityStatus === 'VALID' ? 'PARTIAL' : 'UNAVAILABLE'),
    decisionState: classification.code === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED'
      : inputsAvailable ? 'VALID' : 'INCOMPLETE_DATA',
    positivesAr: positives,
    negativesAr: negatives,
    severeVerifiedNegativeEvent: severeNegative,
    evidenceReferences: [
      'data/v17/historical-recovery/long-history/compact-market.json',
      ...(fundamental?.provenance || []).map(item => item.sourceUrl || item.source).filter(Boolean),
      ...(news?.materialEvents || []).map(item => item.sourceUrl || item.officialReference).filter(Boolean),
    ],
  };
}

function classifyIntegrated({ market, fundamental, news, horizon, score, confidence, severeNegative }) {
  const reasonsAr = [];
  if (market?.dataQualityStatus !== 'VALID' || /REVIEW|AMBIGUOUS|CONFIRMED/i.test(String(market?.corporateActionConfidence || ''))) {
    reasonsAr.push('مراجعة البيانات التاريخية أو الإجراء الرأسمالي شرط سابق لأي قرار متكامل.');
    return { code: 'REVIEW_REQUIRED', reasonsAr };
  }
  if (severeNegative) {
    reasonsAr.push('حدث سلبي رسمي مرتفع الأهمية يستلزم إعادة المراجعة فورًا.');
    return { code: 'REVIEW_REQUIRED', reasonsAr };
  }
  if (fundamental?.fundamentalDataConfidence === 'UNAVAILABLE' || !finite(fundamental?.fundamentalQualityScore)) {
    reasonsAr.push('لا توجد بيانات مالية موثقة كافية لإصدار تصنيف استثماري متكامل.');
    return { code: 'INSUFFICIENT_FINANCIAL_DATA', reasonsAr };
  }
  if (fundamental.fundamentalDataConfidence === 'LOW' || !finite(fundamental?.valuation?.score) || news?.coverageStatus === 'SOURCE_COVERAGE_UNAVAILABLE') {
    reasonsAr.push('اكتمال البيانات أو حداثتها أو تغطية الأخبار لا يكفي لتصنيف إيجابي.');
    return { code: 'INSUFFICIENT_FINANCIAL_DATA', reasonsAr };
  }
  if (fundamental.valueTrapRisk?.classification === 'HIGH') {
    reasonsAr.push('الخصم السعري يتزامن مع تدهور مالي يرفع خطر مصيدة القيمة.');
    return { code: 'VALUE_TRAP_RISK', reasonsAr };
  }
  if (['HIGH', 'VERY_HIGH'].includes(fundamental.financialRisk?.classification)) {
    reasonsAr.push('المخاطر المالية تمنع التصنيف الإيجابي رغم الإشارات السعرية.');
    return { code: horizon?.recoveryPositionPct <= 30 ? 'HIGH_RISK_RECOVERY' : 'WAIT', reasonsAr };
  }
  const recoveryPositive = ['EARLY_RECOVERY', 'RECOVERY_CONFIRMED'].includes(market.recoveryStage);
  if (score >= 78 && confidence >= 80 && fundamental.fundamentalQualityScore >= 65 && recoveryPositive && horizon?.currentDrawdownPct >= 25 && horizon?.recoveryPositionPct <= 40) {
    reasonsAr.push('اكتملت بوابات الجودة المالية والتعافي الفني والثقة والتقييم.');
    return { code: 'STRONG_CONFIRMED_CANDIDATE', reasonsAr };
  }
  if (score >= 68 && confidence >= 70 && fundamental.fundamentalQualityScore >= 55 && recoveryPositive && horizon?.recoveryPositionPct <= 45) {
    reasonsAr.push('توجد جودة مالية مقبولة وتعافٍ فني، مع حاجة إلى تدرج ومتابعة الأدلة.');
    return { code: 'STAGED_INVESTMENT_CANDIDATE', reasonsAr };
  }
  if (recoveryPositive && fundamental.fundamentalQualityScore >= 50) {
    reasonsAr.push('التعافي الفني والجودة المالية يسمحان بالمراقبة دون اكتمال بوابات المرشح.');
    return { code: 'POSITIVE_WATCH', reasonsAr };
  }
  if (market.recoveryStage === 'BOTTOMING' && horizon?.recoveryPositionPct <= 30) {
    reasonsAr.push('السهم في منطقة قاع دورة الهبوط دون تعافٍ مؤكد.');
    return { code: 'BOTTOM_WATCH', reasonsAr };
  }
  reasonsAr.push('الشروط المتكاملة الحالية لا تكفي لرفع التصنيف.');
  return { code: 'WAIT', reasonsAr };
}

module.exports = { LABELS_AR, DECISION_RANK, integrateStock, classifyIntegrated, overallDataConfidence, newsComponent };
