#!/usr/bin/env node
'use strict';
const path = require('path');
const {
  readDailyOutput,
  readHistoricalIntelligence,
  readPreviousBridge,
  readCurrentDailyCards,
  writeJsonAtomic,
} = require('./io.cjs');
const {
  evaluateConversionGate,
  buildTrackedPosition,
  assessExitState,
  round,
} = require('./gates.cjs');
const { reconstructDailyRowsAsOf } = require('./as-of-reconstruction.cjs');

const DISCLAIMER_AR = 'التحويل إلى متابعة استثمارية هو تصنيف بحثي مستقل عن التوصية اليومية، ولا يمثل توصية شخصية بالشراء أو الاحتفاظ أو البيع.';
const HIGH_DISCLAIMER_AR = 'القمة التاريخية مستوى مرجعي لإعادة التقييم وليست سعر بيع مضمونًا.';
const BRIDGE_EMPTY_STATE_AR = 'لا توجد مراكز استثمارية محولة نشطة حاليًا';

const PUBLIC_ENUM_AR = Object.freeze({
  NOT_EXECUTED: 'لم يتم التنفيذ اليومي', NOT_QUALIFIED: 'غير مؤهل للتحويل', EXECUTION_ELIGIBLE_OR_RESEARCH_ASSUMED: 'أهلية تنفيذ متحققة أو افتراض بحثي موثق',
  AVAILABLE: 'متاح', UNAVAILABLE: 'غير متاح', FAILED: 'غير متاح', VALID: 'صالح', HIGH: 'مرتفع', MEDIUM: 'متوسط', LOW: 'منخفض',
  NORMAL: 'طبيعي', ELEVATED: 'مرتفع', ACTIVE: 'نشط', EXTENDED_WATCH: 'متابعة ممتدة', INFO: 'معلومة', NOTICE: 'تنبيه', IMPORTANT: 'تنبيه مهم', CRITICAL: 'تنبيه حرج',
  CONVERSION_GATE: 'فحص بوابة التحويل', NEW_CONVERSION_CANDIDATE: 'مرشح تحويل جديد', TARGET_APPROACH: 'اقتراب من القمة المرجعية', BREAKOUT: 'متابعة اختراق', EXIT_SIGNAL: 'إشارة خروج بحثية',
  AMBIGUOUS_TREATED_AS_STOP: 'ملامسة الهدف والوقف في الجلسة نفسها وحُسب الوقف تحفظيًا', NOT_ENTERED_OPEN_OUTSIDE_RANGE: 'لم يدخل لأن الافتتاح خارج النطاق', CLOSED_AT_SESSION_END: 'أغلق في نهاية الجلسة',
  HIGH_NO_DETECTED_DISCONTINUITY_SOURCE_NOT_AUTHORITATIVE: 'ثقة مرتفعة دون انقطاع مكتشف، والمصدر غير رسمي للإجراءات الرأسمالية', MEDIUM_ADJUSTED_SOURCE_NOT_AUTHORITATIVE: 'ثقة متوسطة من سعر معدل، والمصدر غير رسمي للإجراءات الرأسمالية',
});
function publicValue(value) {
  if (Array.isArray(value)) return value.map(publicValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !key.endsWith('Code')).map(([key, item]) => [key, publicValue(item)]));
  if (typeof value === 'string' && /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(value)) return PUBLIC_ENUM_AR[value] || 'حالة داخلية محجوبة';
  return value;
}
function toPublicDataset(dataset) { return publicValue(dataset); }

function compareMeaningful(previous, current) {
  if (!previous) return ['أول مراجعة يومية لهذا المركز.'];
  const changes = [];
  if (Number(current.StrengthScore) > Number(previous.StrengthScore) + 5) changes.push('القوة الفنية ارتفعت.');
  if (Number(current.StrengthScore) < Number(previous.StrengthScore) - 5) changes.push('القوة الفنية انخفضت.');
  if (Number(current.distanceToHistoricalHighPct) < Number(previous.distanceToHistoricalHighPct) - 2) changes.push('المسافة إلى القمة تقلصت.');
  if (Number(current.distanceToHistoricalHighPct) > Number(previous.distanceToHistoricalHighPct) + 2) changes.push('المسافة إلى القمة زادت.');
  if (current.FinancialRisk !== previous.FinancialRisk) changes.push('المخاطر المالية تغيرت.');
  if (current.currentInvestmentClassification !== previous.currentInvestmentClassification) changes.push('التصنيف البحثي تغير.');
  return changes;
}

function alert(type, priority, ticker, textAr, evidence = []) {
  return { type, priority, ticker, textAr, evidenceReferences: evidence };
}

function buildBridgeDataset({ daily, historical, previous = null, asOf = new Date() }) {
  const previousActive = new Map((previous?.activePositions || []).map(row => [row.ticker, row]));
  const newMatches = [];
  const newConversionCandidates = [];
  const activePositions = [];
  const approachingHigh = [];
  const breakoutWatch = [];
  const reviewRequired = [];
  const exitSignals = [];
  const closedPositions = previous?.closedPositions || [];
  const alerts = [];
  const pilotRows = [];
  const decisionHistory = [...(previous?.decisionHistory || [])];

  for (const row of daily.rows) {
    const historicalDecision = historical.byTicker.get(row.ticker) || null;
    const historicalMatch = Boolean(historicalDecision) || historical.inventoryTickers?.has(row.ticker) === true;
    const gate = evaluateConversionGate({ daily: row, historicalDecision });
    const detail = historicalDecision?.detail || historicalDecision;
    const pilot = {
      ticker: row.ticker,
      companyArabic: row.companyNameAr || detail?.companyNameAr || null,
      dailySelection: true,
      executionStatus: gate.classificationCode === 'NOT_EXECUTED' ? 'NOT_EXECUTED' : 'EXECUTION_ELIGIBLE_OR_RESEARCH_ASSUMED',
      historicalInventoryMatch: historicalMatch,
      historicalDrawdownPct: round(detail?.historical?.drawdownFromHighPct),
      recoveryPositionPct: round(detail?.historical?.recoveryPositionPct),
      recoveryStage: detail?.technical?.recoveryStageAr || detail?.technical?.recoveryStage || null,
      RecoveryScore: round(detail?.technical?.recoveryScore),
      StrengthScore: round(detail?.technical?.strengthScore),
      financialEvidence: detail?.fundamental?.fundamentalDataConfidence || 'UNAVAILABLE',
      newsEvidence: detail?.news?.coverageStatus || 'UNAVAILABLE',
      conversionGateResult: gate.classificationAr,
      reasonsAr: gate.reasonsAr,
      failures: gate.failures,
    };
    pilotRows.push(pilot);
    if (historicalMatch) {
      newMatches.push({
        ticker: row.ticker,
        historicalRecovery: 'نعم',
        drawdownFromHighPct: pilot.historicalDrawdownPct,
        recoveryPositionPct: pilot.recoveryPositionPct,
        recoveryStage: pilot.recoveryStage,
        historicalResearchDecision: historicalDecision?.currentDecisionAr || 'تاريخ سعري متاح دون قرار استخبارات متكامل',
        conversionStateAr: gate.classificationAr,
        badgeAr: gate.classificationCode === 'MEDIUM_LONG_TERM'
          ? '🟢 مرشح للتحويل إلى استثمار متوسط/طويل الأجل'
          : gate.classificationCode === 'EXTENDED_WATCH'
            ? '🟡 مرشح متابعة ممتدة — البيانات المالية غير مكتملة'
            : gate.passed
              ? '🔵 متوافق مع الحصر التاريخي'
              : 'غير مؤهل',
      });
    }
    decisionHistory.push({
      at: asOf.toISOString(),
      ticker: row.ticker,
      kind: 'CONVERSION_GATE',
      immutable: true,
      gate,
      sourceFiles: [daily.file, historical.file].filter(Boolean),
    });
    if (!gate.passed) continue;
    const position = buildTrackedPosition({ daily: row, historicalDecision, gate, asOf });
    const previousPosition = previousActive.get(position.ticker);
    if (previousPosition) {
      position.previousReviewState = previousPosition.dailyReview?.state || null;
      position.conversionDate = previousPosition.conversionDate;
      position.conversionReferencePrice = previousPosition.conversionReferencePrice;
      position.highestPriceSinceConversion = Math.max(Number(previousPosition.highestPriceSinceConversion || position.currentPrice), Number(position.currentPrice));
      position.lowestPriceSinceConversion = Math.min(Number(previousPosition.lowestPriceSinceConversion || position.currentPrice), Number(position.currentPrice));
    } else {
      newConversionCandidates.push(position);
      alerts.push(alert('NEW_CONVERSION_CANDIDATE', 'NOTICE', position.ticker, 'سهم ظهر في توصيات اليوم ويتطابق مع شروط التعافي التاريخي', [daily.file, historical.file]));
    }
    const review = assessExitState(position, detail);
    position.dailyReview = {
      state: review.state,
      sectionAr: 'متابعة المراكز الاستثمارية المحولة من التوصيات اليومية',
      decisionAr: review.stateAr,
      whyAr: review.reasonsAr,
      changedSinceYesterdayAr: compareMeaningful(previousPosition, position),
      latestMaterialEvent: detail?.news?.latestMaterialEvent || null,
      disclaimerAr: DISCLAIMER_AR,
      historicalHighDisclaimerAr: HIGH_DISCLAIMER_AR,
    };
    activePositions.push(position);
    if (position.distanceToHistoricalHighPct !== null && position.distanceToHistoricalHighPct <= 10) {
      approachingHigh.push(position);
      alerts.push(alert('TARGET_APPROACH', position.distanceToHistoricalHighPct <= 5 ? 'IMPORTANT' : 'NOTICE', position.ticker, position.distanceToHistoricalHighPct <= 5 ? 'قرب القمة التاريخية — مراجعة الاحتفاظ/تخفيف المركز' : 'السهم أصبح على بعد أقل من 10% من القمة المرجعية'));
    }
    if (['BREAKOUT_CONFIRMING', 'BREAKOUT_CONFIRMED'].includes(review.state)) {
      breakoutWatch.push(position);
      alerts.push(alert('BREAKOUT', 'IMPORTANT', position.ticker, 'اختراق القمة السابقة قيد التأكيد'));
    }
    if (['IMMEDIATE_REVIEW', 'REDUCE_RISK_REVIEW', 'FAILED_BREAKOUT'].includes(review.state)) reviewRequired.push(position);
    if (review.state === 'EXIT_SIGNAL') {
      exitSignals.push(position);
      alerts.push(alert('EXIT_SIGNAL', 'CRITICAL', position.ticker, 'ظهرت إشارة خروج بحثية بعد تغير جوهري في المخاطر أو الأخبار'));
    }
  }

  const stats = buildStats(activePositions, closedPositions);
  const sourceHealth = {
    dailyOutput: daily.file ? 'AVAILABLE' : 'FAILED',
    historicalIntelligence: historical.snapshot?.decisions?.length ? 'AVAILABLE' : 'FAILED',
    failureSafeAr: daily.file && historical.snapshot?.decisions?.length
      ? null
      : 'بيانات اليوم غير مكتملة — آخر موقف موثوق محفوظ',
  };

  return {
    schemaVersion: '17.0.0-investment-bridge-1',
    generatedAt: asOf.toISOString(),
    marketDate: daily.dataset?.sessionId || daily.dataset?.marketDate || asOf.toISOString().slice(0, 10),
    researchOnly: true,
    independenceStatementAr: DISCLAIMER_AR,
    historicalHighDisclaimerAr: HIGH_DISCLAIMER_AR,
    newMatches,
    newConversionCandidates,
    activePositions,
    approachingHigh,
    breakoutWatch,
    reviewRequired,
    exitSignals,
    closedPositions,
    alerts,
    coverage: {
      dailySelections: daily.rows.length,
      historicalMatches: newMatches.length,
      convertedOrExtended: newConversionCandidates.length,
    },
    performance: stats,
    sourceHealth,
    lastKnownValid: sourceHealth.failureSafeAr ? previous?.lastKnownValid || previous || null : null,
    pilotSanityRows: pilotRows,
    decisionHistory,
  };
}

function buildDailyRecommendationBadges(rows, historical) {
  return rows.map(row => {
    const historicalDecision = historical.byTicker.get(row.ticker) || null;
    const gate = evaluateConversionGate({ daily: row, historicalDecision });
    const historicalMatch = Boolean(historicalDecision) || historical.inventoryTickers?.has(row.ticker) === true;
    const green = historicalMatch && gate.passed && gate.classificationCode === 'MEDIUM_LONG_TERM';
    return {
      ticker: row.ticker,
      historicalMatch,
      conversionAllowed: gate.passed,
      badgeTone: green ? 'positive' : historicalMatch ? 'neutral' : 'muted',
      badgeAr: green ? '🟢 مؤهل للتحويل البحثي متوسط/طويل الأجل' : historicalMatch ? '🔵 مطابق للحصر التاريخي — لم يتحقق التحويل' : 'لا يوجد تطابق تاريخي',
    };
  });
}

function buildStats(activePositions, closedPositions) {
  const returns = closedPositions.map(row => Number(row.returnPct)).filter(Number.isFinite);
  const average = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : null;
  const sorted = [...returns].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  return {
    numberConverted: activePositions.length + closedPositions.length,
    openPositions: activePositions.length,
    closedPositions: closedPositions.length,
    averageReturnPct: round(average),
    medianReturnPct: round(median),
    winRatePct: returns.length ? round((returns.filter(x => x > 0).length / returns.length) * 100) : null,
    averageHoldingPeriodDays: null,
    maxDrawdownPct: null,
    historicalHighReachRatePct: null,
    successfulBreakoutRatePct: null,
    separateFromDailyStrategy: true,
  };
}

function runBuild(root = path.resolve(process.env.GITHUB_WORKSPACE || '.'), asOf = new Date()) {
  const daily = readDailyOutput(root);
  daily.rows = reconstructDailyRowsAsOf(root, daily.rows, asOf);
  const historical = readHistoricalIntelligence(root);
  const dailyCards = readCurrentDailyCards(root);
  const previous = readPreviousBridge(root).dataset;
  const dataset = buildBridgeDataset({ daily, historical, previous, asOf });
  dataset.dailyRecommendationBadges = buildDailyRecommendationBadges(dailyCards.rows, historical);
  const out = path.join(root, 'data/v17/investment-bridge/current.json');
  const publicDataset = toPublicDataset(dataset);
  writeJsonAtomic(out, publicDataset);
  return publicDataset;
}

if (require.main === module) {
  const dataset = runBuild();
  console.log(JSON.stringify({
    generatedAt: dataset.generatedAt,
    dailySelections: dataset.coverage.dailySelections,
    historicalMatches: dataset.coverage.historicalMatches,
    convertedOrExtended: dataset.coverage.convertedOrExtended,
    alerts: dataset.alerts.length,
  }, null, 2));
}

module.exports = { BRIDGE_EMPTY_STATE_AR, buildBridgeDataset, buildDailyRecommendationBadges, buildStats, publicValue, toPublicDataset, runBuild };
