#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const p = (...parts) => path.join(ROOT, ...parts);
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readOptional = (file, fallback = null) => fs.existsSync(file) ? readJson(file) : fallback;
const finite = value => Number.isFinite(Number(value));
const round = (value, digits = 3) => finite(value) ? Number(Number(value).toFixed(digits)) : null;
const avg = values => {
  const xs = values.filter(finite).map(Number);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};

const sourceFile = p('data/stable/v18-global-strategy-ensemble.json');
const policyFile = p('data/v18-global-strategy-policy.json');
const practicalFile = p('data/stable/v15-practical-decision.json');
const ledgerFile = p('data/stable/v18-forward-ledger.json');
const stocksDir = p('data/quant/stocks');

if (!fs.existsSync(sourceFile)) throw new Error('V18.1 enriched output is missing');
if (!fs.existsSync(policyFile)) throw new Error('V18 policy is missing');
if (!fs.existsSync(stocksDir)) throw new Error('Canonical stock directory is missing');

const source = readJson(sourceFile);
const policy = readJson(policyFile);
const practical = readOptional(practicalFile, {});
const ledger = readOptional(ledgerFile, { entries: [] });

if (source.schemaVersion !== '18.1.0-shadow') throw new Error(`V18.2 expects V18.1 input, received ${source.schemaVersion}`);
if (!Array.isArray(source.allCandidates)) throw new Error('V18.1 allCandidates missing');
if (source.rankingPolicy?.code !== 'EVIDENCE_FIRST_THEN_SCORE') throw new Error('Evidence-first ranking must run before V18.2 unification');

const candidateByTicker = new Map(source.allCandidates.map(row => [row.ticker, row]));
const canonicalFiles = fs.readdirSync(stocksDir).filter(name => name.endsWith('.json')).sort();
const canonicalStocks = canonicalFiles.map(name => readJson(path.join(stocksDir, name))).filter(stock => stock && stock.ticker);
const canonicalByTicker = new Map(canonicalStocks.map(stock => [stock.ticker, stock]));

function chartSlice(stock, limit = 60) {
  const chart = stock.chart || {};
  const n = Math.min(limit, Array.isArray(chart.dates) ? chart.dates.length : 0);
  if (!n) return { dates: [], close: [], volume: [] };
  return {
    dates: chart.dates.slice(-n),
    close: Array.isArray(chart.close) ? chart.close.slice(-n) : [],
    volume: Array.isArray(chart.volume) ? chart.volume.slice(-n) : []
  };
}

function candidateStatus(candidate) {
  if (!candidate) return 'UNRANKED';
  if (String(candidate.tier || '').includes('TIER_A')) return 'PILOT';
  if (String(candidate.tier || '').includes('TIER_B_RESEARCH')) return 'RESEARCH';
  if (String(candidate.tier || '').includes('TIER_B')) return 'CONDITIONAL';
  return 'WATCH';
}

const universeScreener = canonicalStocks.map(stock => {
  const i = stock.indicators || {};
  const tech = stock.technical || {};
  const rec = stock.recommendation || {};
  const dq = stock.dataQuality || {};
  const candidate = candidateByTicker.get(stock.ticker);
  return {
    ticker: stock.ticker,
    companyNameAr: stock.companyNameAr || '',
    companyNameEn: stock.companyNameEn || '',
    sector: stock.sector || 'غير مصنف',
    active: stock.active !== false,
    sessionId: stock.sessionId || stock.latest?.date || null,
    close: round(i.close ?? stock.latest?.close, 4),
    change1Pct: round(i.change1Pct, 3),
    return5Pct: round(i.return5Pct, 3),
    return20Pct: round(i.return20Pct, 3),
    return50Pct: round(i.return50Pct, 3),
    sma20: round(i.sma20, 4),
    sma50: round(i.sma50, 4),
    rsi14: round(i.rsi14, 2),
    macd: round(i.macd, 4),
    macdSignal: round(i.macdSignal, 4),
    atrPct: round(i.atrPct, 3),
    averageVolume20: round(i.averageVolume20, 0),
    volumeRatio20: round(i.volumeRatio20, 3),
    averageTurnover20Egp: round(i.averageTurnover20Egp, 0),
    volatility20Pct: round(i.volatility20Pct, 3),
    support20: round(i.support20, 4),
    resistance20: round(i.resistance20, 4),
    high50: round(i.high50, 4),
    distanceFromHigh50Pct: round(i.distanceFromHigh50Pct, 3),
    technicalScore: round(tech.score, 1),
    trendCode: tech.trendCode || 'UNKNOWN',
    trendLabelAr: tech.trendLabelAr || '',
    recommendationStatus: rec.status || 'NONE',
    recommendationStatusAr: rec.statusLabelAr || '',
    recommendationStrategy: rec.strategyId || null,
    recommendationStrategyAr: rec.strategyLabelAr || '',
    recommendationScore: round(rec.recommendationScore, 1),
    adaptiveHealth: rec.adaptive?.strategyHealthStatus || null,
    adaptiveProximityPct: round(rec.adaptive?.proximityPct, 1),
    missingRequirementsAr: Array.isArray(rec.adaptive?.missingRequirementsAr) ? rec.adaptive.missingRequirementsAr : [],
    dataQuality: {
      historySessions: Number(dq.historySessions || 0),
      firstSession: dq.firstSession || null,
      lastSession: dq.lastSession || null,
      averageConfidence: round(dq.averageConfidence, 1),
      symbolVerified: dq.symbolVerified === true,
      eligibilityStatus: dq.eligibilityStatus || null
    },
    decision: candidate ? {
      status: candidateStatus(candidate),
      tier: candidate.tier,
      evidenceRank: candidate.evidenceRank ?? candidate.rank ?? null,
      score: round(candidate.decisionScore, 1),
      labelAr: candidate.decisionLabelAr || '',
      sources: candidate.sources || [],
      strategyFamilies: candidate.strategyFamilies || [],
      relativeStrength: round(candidate.leadership?.relativeStrengthComposite, 1),
      leadershipScore: round(candidate.leadership?.leadershipScore, 1),
      vcp: candidate.leadership?.vcp?.passed === true
    } : null,
    chart: chartSlice(stock)
  };
}).sort((a, b) => {
  const ar = a.decision?.evidenceRank ?? 9999;
  const br = b.decision?.evidenceRank ?? 9999;
  if (ar !== br) return ar - br;
  return (b.technicalScore || 0) - (a.technicalScore || 0) || (b.averageTurnover20Egp || 0) - (a.averageTurnover20Egp || 0);
});

const pilot = source.allCandidates.filter(x => String(x.tier || '').includes('TIER_A'));
const research = source.allCandidates.filter(x => String(x.tier || '').includes('TIER_B_RESEARCH'));
const conditional = source.allCandidates.filter(x => String(x.tier || '').includes('TIER_B') && !String(x.tier || '').includes('TIER_B_RESEARCH'));
const watch = source.allCandidates.filter(x => !String(x.tier || '').includes('TIER_A') && !String(x.tier || '').includes('TIER_B'));
const nearTriggers = universeScreener.filter(x => x.recommendationStatus === 'NEAR_TRIGGER' || (x.adaptiveProximityPct != null && x.adaptiveProximityPct >= 80));
const blocked = universeScreener.filter(x => x.missingRequirementsAr.length || ['REJECTED', 'BLOCKED'].includes(x.recommendationStatus));

const sourceStatsMap = new Map();
for (const row of source.allCandidates) {
  for (const src of row.sources || []) {
    const stat = sourceStatsMap.get(src) || { source: src, candidates: 0, tierA: 0, tierB: 0, research: 0, watch: 0 };
    stat.candidates += 1;
    if (String(row.tier || '').includes('TIER_A')) stat.tierA += 1;
    else if (String(row.tier || '').includes('TIER_B_RESEARCH')) stat.research += 1;
    else if (String(row.tier || '').includes('TIER_B')) stat.tierB += 1;
    else stat.watch += 1;
    sourceStatsMap.set(src, stat);
  }
}
const sourceStats = [...sourceStatsMap.values()].sort((a, b) => b.candidates - a.candidates || a.source.localeCompare(b.source));
const engineAgreement = source.allCandidates.map(row => {
  const sources = row.sources || [];
  const researchSources = sources.filter(x => /^V18_/.test(x));
  const independentSources = sources.filter(x => !/^V18_/.test(x));
  return {
    ticker: row.ticker,
    evidenceRank: row.evidenceRank ?? row.rank ?? null,
    tier: row.tier,
    score: round(row.decisionScore, 1),
    totalSources: sources.length,
    independentSourceCount: independentSources.length,
    researchSourceCount: researchSources.length,
    independentSources,
    researchSources,
    agreementLevel: independentSources.length >= 3 ? 'STRONG' : independentSources.length >= 2 ? 'MULTI_ENGINE' : independentSources.length === 1 ? 'SINGLE_ENGINE' : 'RESEARCH_ONLY'
  };
});

const basketRecommendations = Array.isArray(practical.recommendations) ? practical.recommendations : [];
const basketExposure = basketRecommendations.reduce((sum, x) => sum + Number(x.portfolioWeightPct || 0), 0);
const basketCenter = {
  mode: practical.mode || null,
  status: practical.status || null,
  statusAr: practical.statusAr || '',
  practicalReady: practical.practicalReady === true,
  professionalEvidenceReady: practical.professionalEvidenceReady === true,
  evidenceTier: practical.evidenceTier || null,
  totalExposurePct: round(basketExposure, 2),
  cashReservePct: round(Math.max(0, 100 - basketExposure), 2),
  failedWeightStaysCash: basketRecommendations.every(x => x.cashIfNotTriggered !== false),
  recommendations: basketRecommendations,
  extendedMomentumWatch: Array.isArray(practical.extendedMomentumWatch) ? practical.extendedMomentumWatch : [],
  selectedModel: practical.selectedModel || null,
  validationWindows: practical.validationWindows || null,
  guardrails: practical.guardrails || null,
  marketScan: practical.marketScan || null
};

const evidenceCenter = {
  professionalClaimAllowed: practical.professionalEvidenceReady === true,
  claimLevel: practical.professionalEvidenceReady === true ? 'PROFESSIONAL_EVIDENCE' : 'PILOT_SHADOW_ONLY',
  basketModel: practical.selectedModel ? {
    id: practical.selectedModel.id,
    labelAr: practical.selectedModel.labelAr,
    development: practical.selectedModel.development,
    validation: practical.selectedModel.validation,
    test: practical.selectedModel.test,
    stabilityScore: practical.selectedModel.stabilityScore,
    stabilityLabelAr: practical.selectedModel.stabilityLabelAr,
    stabilityReasonsAr: practical.selectedModel.stabilityReasonsAr,
    evidenceTier: practical.selectedModel.evidenceTier,
    professionalEvidencePassed: practical.selectedModel.professionalEvidencePassed === true
  } : null,
  validationWindows: practical.validationWindows || null,
  perEngine: sourceStats,
  forward: source.forwardLedgerSummary || null
};

const currentSession = source.sessionId;
const currentSessionRows = universeScreener.filter(x => x.sessionId === currentSession);
const verifiedRows = universeScreener.filter(x => x.dataQuality.symbolVerified);
const adequateRows = universeScreener.filter(x => x.dataQuality.historySessions >= 35);
const lowConfidenceRows = universeScreener.filter(x => finite(x.dataQuality.averageConfidence) && x.dataQuality.averageConfidence < 60);

const consistencyMismatches = [];
for (const row of source.allCandidates) {
  const stock = canonicalByTicker.get(row.ticker);
  if (!stock) {
    consistencyMismatches.push({ ticker: row.ticker, field: 'canonical', reason: 'Candidate missing from canonical universe' });
    continue;
  }
  const ci = stock.indicators || {};
  const ct = row.technical || {};
  const pairs = [
    ['price', ct.price, ci.close],
    ['rsi14', ct.rsi14, ci.rsi14],
    ['turnover', ct.averageTurnover20Egp, ci.averageTurnover20Egp],
    ['rvol', ct.volumeRatio20, ci.volumeRatio20]
  ];
  for (const [field, a, b] of pairs) {
    if (!finite(a) || !finite(b)) continue;
    const tolerance = field === 'turnover' ? Math.max(1, Math.abs(Number(b)) * 0.000001) : 0.001;
    if (Math.abs(Number(a) - Number(b)) > tolerance) consistencyMismatches.push({ ticker: row.ticker, field, candidate: Number(a), canonical: Number(b) });
  }
}

const uniqueTickers = new Set(source.allCandidates.map(x => x.ticker));
const false52Labels = source.allCandidates.filter(x => x.leadership && !x.leadership.full52WeekCoverage && x.leadership.highReferenceLabel === '52_WEEK_HIGH');
const researchOnlyTierA = pilot.filter(x => (x.sources || []).every(s => ['V18_RS_LEADERSHIP_SHADOW', 'V18_VCP_SHADOW'].includes(s)));
const outOfRangeScores = source.allCandidates.filter(x => finite(x.decisionScore) && (Number(x.decisionScore) < 0 || Number(x.decisionScore) > 100));
const badLongPlans = source.allCandidates.filter(x => {
  const plan = x.execution?.preferredPlan || {};
  if (![plan.entryLow, plan.entryHigh, plan.stopLoss, plan.target1].every(finite)) return false;
  return Number(plan.entryLow) > Number(plan.entryHigh) || Number(plan.stopLoss) >= Number(plan.entryHigh) || Number(plan.target1) <= Number(plan.entryLow);
});
const overweightBasket = basketRecommendations.filter(x => finite(x.portfolioWeightPct) && Number(x.portfolioWeightPct) > Number(policy.risk?.maximumSinglePositionPct || 12.5));

const integrityChecks = [
  { id: 'UNIQUE_CANDIDATES', labelAr: 'لا يوجد تكرار في المرشحين', passed: uniqueTickers.size === source.allCandidates.length, critical: true },
  { id: 'CANONICAL_MEMBERSHIP', labelAr: 'كل المرشحين موجودون في المصدر Canonical', passed: source.allCandidates.every(x => canonicalByTicker.has(x.ticker)), critical: true },
  { id: 'CURRENT_SESSION_COVERAGE', labelAr: 'تغطية الجلسة الحالية لا تقل عن 90% من الكون', passed: currentSessionRows.length >= Math.ceil(universeScreener.length * 0.9), critical: true },
  { id: 'CANONICAL_CONSISTENCY', labelAr: 'لا يوجد اختلاف بين أرقام القرار وCanonical Truth', passed: consistencyMismatches.length === 0, critical: true },
  { id: 'SCORE_RANGE', labelAr: 'كل Decision Scores داخل 0–100', passed: outOfRangeScores.length === 0, critical: true },
  { id: 'NO_FALSE_52W_LABEL', labelAr: 'لا يتم تسمية Proxy كقمة 52 أسبوع', passed: false52Labels.length === 0, critical: true },
  { id: 'RESEARCH_CANNOT_CREATE_TIER_A', labelAr: 'Research وحده لا ينشئ Tier A', passed: researchOnlyTierA.length === 0, critical: true },
  { id: 'LONG_PLAN_SANITY', labelAr: 'خطط الدخول/الوقف/الهدف متماسكة حسابيًا', passed: badLongPlans.length === 0, critical: true },
  { id: 'BASKET_POSITION_CAP', labelAr: 'لا يتجاوز أي وزن الحد الأقصى للمركز', passed: overweightBasket.length === 0, critical: true },
  { id: 'FAILED_WEIGHT_STAYS_CASH', labelAr: 'الوزن غير المتفعل يبقى نقدًا', passed: basketCenter.failedWeightStaysCash, critical: true },
  { id: 'FORWARD_LEDGER_IMMUTABLE', labelAr: 'لقطات Forward عند الإصدار غير قابلة لإعادة الكتابة', passed: source.forwardLedgerSummary?.immutableIssueSnapshots === true, critical: true }
];
const criticalFailures = integrityChecks.filter(x => x.critical && !x.passed);

const featureManifest = [
  ['EXECUTIVE_DASHBOARD', 'لوحة السوق التنفيذية', 'V16 Market Regime + V18'],
  ['TOP_5_NOW', 'Top 5 الآن حسب Evidence Rank', 'V18 Evidence Ranking'],
  ['FULL_MARKET_SCREENER', 'ماسح كامل للسوق مع بحث وفرز وفلاتر', 'Canonical Stock Intelligence'],
  ['GLOBAL_SEARCH', 'بحث بالسهم أو الاسم أو القطاع', 'Canonical Stock Intelligence'],
  ['STOCK_DETAIL', 'مركز تفاصيل السهم', 'Canonical + Ensemble'],
  ['TECHNICAL_VISUALIZATION', 'رسم سعري ومؤشرات ودعم/مقاومة', 'Canonical Charts'],
  ['EMA_MACD_CONTINUATION', 'EMA–MACD Trend Continuation', 'V18'],
  ['STRATEGY_FAMILIES', 'Breakout / Momentum / Pullback / Reversal / Trend / Basket', 'V13/V15/V16/V18'],
  ['LEADERSHIP_RS', 'Relative Strength Leadership', 'V18.1 Research'],
  ['HIGH_PROXIMITY', 'قرب القمة مع حماية تسمية 52 أسبوع', 'V18.1 Research'],
  ['VCP', 'Volatility Contraction', 'V18.1 Research'],
  ['ENGINE_AGREEMENT', 'توافق واختلاف المحركات', 'V18.2'],
  ['WATCH_NEAR_BLOCKED', 'Watch / Near Trigger / Blocked Reasons', 'V13/V15/V18'],
  ['BASKET_PORTFOLIO', 'Basket Pilot وتوزيع الأوزان', 'V16.9'],
  ['PORTFOLIO_TRACKER', 'متابعة سعر الشراء والكمية محليًا', 'V18.2 UI'],
  ['POSITION_SIZING', 'حاسبة حجم المركز حسب المخاطرة', 'V18 Risk'],
  ['MORNING_CONFIRMATION', 'تأكيد الافتتاح وعدم المطاردة', 'V16.9/V18'],
  ['STRATEGY_REGIME_MATRIX', 'مصفوفة الاستراتيجية × حالة السوق', 'V18.1'],
  ['BACKTEST_EVIDENCE', 'Development / Validation / Test / Evidence', 'V16.9 + Ensemble'],
  ['FORWARD_LEDGER', 'سجل Forward غير قابل لتعديل لقطة الإصدار', 'V18.1'],
  ['DATA_HEALTH', 'صحة البيانات والتغطية والتناسق', 'V18.2'],
  ['ZERO_SIGNAL_GUARD', 'منع صفر إشارات مضلل في سوق داعم', 'V18'],
  ['EXPORT_JSON_CSV', 'تصدير JSON/CSV', 'V18.2 UI'],
  ['PRINT_VIEW', 'طباعة لوحة القرار', 'V18.2 UI']
].map(([id, labelAr, provenance]) => ({ id, labelAr, provenance, enabled: true }));

const unified = {
  ...source,
  schemaVersion: '18.2.0-shadow',
  productName: 'EGX PRO V18.2 Unified Decision Center',
  mode: 'UNIFIED_DECISION_CENTER_SHADOW',
  generatedUnifiedAt: new Date().toISOString(),
  featureManifest,
  topFiveNow: source.allCandidates.slice(0, 5),
  opportunityBuckets: {
    pilot,
    conditional,
    research,
    watch,
    nearTriggers: nearTriggers.map(x => x.ticker),
    blocked: blocked.map(x => ({ ticker: x.ticker, status: x.recommendationStatus, reasonsAr: x.missingRequirementsAr }))
  },
  universeScreener,
  engineAgreement,
  sourceStats,
  basketCenter,
  riskCenter: {
    ...policy.risk,
    portfolioPilotExposurePct: basketCenter.totalExposurePct,
    basketCashReservePct: basketCenter.cashReservePct,
    failedWeightStaysCash: basketCenter.failedWeightStaysCash,
    sizingFormula: 'quantity=floor((capital*riskPct)/abs(entry-stop))',
    automaticOrders: false
  },
  evidenceCenter,
  forwardLedger: {
    schemaVersion: ledger.schemaVersion || null,
    entries: Array.isArray(ledger.entries) ? ledger.entries : []
  },
  dataHealth: {
    status: criticalFailures.length ? 'FAIL' : 'PASS',
    canonicalUniverse: universeScreener.length,
    currentSession,
    currentSessionRows: currentSessionRows.length,
    currentSessionCoveragePct: round(universeScreener.length ? currentSessionRows.length / universeScreener.length * 100 : 0, 2),
    verifiedSymbols: verifiedRows.length,
    history35Plus: adequateRows.length,
    full52WeekCoverageCount: source.leadershipSummary?.full52WeekCoverageCount || 0,
    proxyHighCoverageCount: source.leadershipSummary?.proxyHighCoverageCount || 0,
    averageDataConfidence: round(avg(universeScreener.map(x => x.dataQuality.averageConfidence)), 1),
    lowConfidenceTickers: lowConfidenceRows.map(x => x.ticker),
    consistencyMismatchCount: consistencyMismatches.length,
    consistencyMismatches,
    integrityChecks,
    criticalFailureCount: criticalFailures.length
  },
  uiContract: {
    tabs: ['dashboard','opportunities','screener','stock','technical','leadership','agreement','basket-risk','strategy-matrix','evidence','forward-ledger','data-health'],
    exports: ['JSON','CSV','PRINT'],
    localPortfolioTracker: true,
    morningConfirmationTool: true,
    responsiveRtl: true
  }
};

fs.writeFileSync(sourceFile, `${JSON.stringify(unified, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  schemaVersion: unified.schemaVersion,
  sessionId: unified.sessionId,
  candidates: unified.allCandidates.length,
  canonicalUniverse: unified.universeScreener.length,
  buckets: { pilot: pilot.length, conditional: conditional.length, research: research.length, watch: watch.length, near: nearTriggers.length, blocked: blocked.length },
  basketExposurePct: basketCenter.totalExposurePct,
  forwardEntries: unified.forwardLedger.entries.length,
  dataHealth: unified.dataHealth.status,
  integrityChecks: integrityChecks.map(x => ({ id: x.id, passed: x.passed }))
}, null, 2));

if (criticalFailures.length) {
  throw new Error(`V18.2 integrity gate failed: ${criticalFailures.map(x => x.id).join(', ')}`);
}
