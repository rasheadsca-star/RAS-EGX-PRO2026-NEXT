'use strict';

const { finite } = require('./normalization.cjs');

const SECTOR_MODELS = Object.freeze({
  BANK: 'BANK',
  NON_BANK_FINANCIAL: 'NON_BANK_FINANCIAL',
  REAL_ESTATE: 'REAL_ESTATE',
  INDUSTRIAL: 'INDUSTRIAL',
  PETROCHEMICAL: 'PETROCHEMICAL',
  CONSUMER: 'CONSUMER',
  HEALTHCARE: 'HEALTHCARE',
  TECHNOLOGY_SERVICES: 'TECHNOLOGY_SERVICES',
  HOLDING: 'HOLDING',
  GENERAL_NON_FINANCIAL: 'GENERAL_NON_FINANCIAL',
});

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, Number(value)));
const ratio = (a, b) => finite(a) && finite(b) && Number(b) !== 0 ? Number(a) / Number(b) : null;
const pctChange = (current, previous) => finite(current) && finite(previous) && Number(previous) !== 0
  ? ((Number(current) - Number(previous)) / Math.abs(Number(previous))) * 100 : null;
const avg = values => {
  const clean = values.filter(finite).map(Number);
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
};
const scoreHigher = (value, poor, strong) => !finite(value) ? null : clamp((Number(value) - poor) / (strong - poor) * 100);
const scoreLower = (value, strong, poor) => !finite(value) ? null : clamp((poor - Number(value)) / (poor - strong) * 100);
const ratioPct = (a, b) => {
  const value = ratio(a, b);
  return finite(value) ? value * 100 : null;
};

function sectorModel(sector) {
  const text = String(sector || '').toLowerCase();
  if (/bank|بنك/.test(text)) return SECTOR_MODELS.BANK;
  if (/financial|financ|تأمين|تمويل|خدمات مالية/.test(text)) return SECTOR_MODELS.NON_BANK_FINANCIAL;
  if (/real estate|developer|عقار|إسكان/.test(text)) return SECTOR_MODELS.REAL_ESTATE;
  if (/petro|fertili|chemical|بترو|أسمد|كيما/.test(text)) return SECTOR_MODELS.PETROCHEMICAL;
  if (/health|pharma|دواء|رعاية صحية/.test(text)) return SECTOR_MODELS.HEALTHCARE;
  if (/technology|software|service|اتصالات|تكنولوجيا|خدمات/.test(text)) return SECTOR_MODELS.TECHNOLOGY_SERVICES;
  if (/consumer|food|retail|أغذية|تجزئة|استهلاك/.test(text)) return SECTOR_MODELS.CONSUMER;
  if (/holding|investment|قابضة|استثمار/.test(text)) return SECTOR_MODELS.HOLDING;
  if (/industrial|manufact|صناع|تصنيع/.test(text)) return SECTOR_MODELS.INDUSTRIAL;
  return SECTOR_MODELS.GENERAL_NON_FINANCIAL;
}

function reportingAgeMonths(periodEnd, asOf = new Date()) {
  const date = new Date(periodEnd);
  if (!Number.isFinite(date.getTime())) return Infinity;
  return Math.max(0, (asOf.getTime() - date.getTime()) / (30.4375 * 86400000));
}

function deriveMetrics(periods = []) {
  const ordered = periods.slice().sort((a, b) => String(a.periodEnd).localeCompare(String(b.periodEnd)));
  const latest = ordered.at(-1) || {};
  const previous = ordered.at(-2) || {};
  const profitable = ordered.filter(p => finite(p.netProfit) && Number(p.netProfit) > 0).length;
  const losses = ordered.filter(p => finite(p.netProfit) && Number(p.netProfit) < 0).length;
  const negativeCfo = ordered.filter(p => finite(p.operatingCashFlow) && Number(p.operatingCashFlow) < 0).length;
  const margins = ordered.map(p => ratio(p.netProfit, p.revenue)).filter(finite);
  const netDebt = finite(latest.totalDebt) && finite(latest.cash) ? Number(latest.totalDebt) - Number(latest.cash) : null;
  return {
    latest,
    previous,
    periodCount: ordered.length,
    revenueGrowthPct: pctChange(latest.revenue, previous.revenue),
    earningsGrowthPct: pctChange(latest.netProfit, previous.netProfit),
    epsGrowthPct: pctChange(latest.eps, previous.eps),
    grossMarginPct: finite(latest.grossMarginPct) ? Number(latest.grossMarginPct) : ratioPct(latest.grossProfit, latest.revenue),
    operatingMarginPct: finite(latest.operatingMarginPct) ? Number(latest.operatingMarginPct) : ratioPct(latest.operatingProfit, latest.revenue),
    netMarginPct: finite(latest.netMarginPct) ? Number(latest.netMarginPct) : ratioPct(latest.netProfit, latest.revenue),
    roePct: finite(latest.roePct) ? Number(latest.roePct) : ratioPct(latest.netProfit, latest.totalEquity),
    roaPct: finite(latest.roaPct) ? Number(latest.roaPct) : ratioPct(latest.netProfit, latest.totalAssets),
    debtToEquity: ratio(latest.totalDebt, latest.totalEquity),
    netDebt,
    currentRatio: ratio(latest.currentAssets, latest.currentLiabilities),
    interestCoverage: ratio(latest.operatingProfit, latest.interestExpense),
    cfoToNetIncome: ratio(latest.operatingCashFlow, latest.netProfit),
    freeCashFlow: finite(latest.operatingCashFlow) && finite(latest.capex)
      ? Number(latest.operatingCashFlow) - Math.abs(Number(latest.capex)) : null,
    equityGrowthPct: pctChange(latest.totalEquity, previous.totalEquity),
    debtGrowthPct: pctChange(latest.totalDebt, previous.totalDebt),
    profitablePeriods: profitable,
    lossPeriods: losses,
    negativeCfoPeriods: negativeCfo,
    earningsVolatility: margins.length >= 3 ? Math.sqrt(avg(margins.map(x => (x - avg(margins)) ** 2))) : null,
  };
}

function component(name, weight, metrics) {
  const clean = metrics.filter(m => finite(m.score));
  return {
    name,
    weight,
    score: clean.length ? Number(avg(clean.map(m => m.score)).toFixed(2)) : null,
    evidence: metrics.map(m => ({ metric: m.metric, value: finite(m.value) ? Number(m.value) : null, score: finite(m.score) ? Number(Number(m.score).toFixed(2)) : null })),
    sufficient: clean.length >= Math.ceil(metrics.length / 2),
  };
}

function scoreFundamentals(company, options = {}) {
  const periods = Array.isArray(company?.periods) ? company.periods : [];
  const model = company?.sectorModel || sectorModel(company?.sector);
  if (!periods.length) return unavailableFundamentals(company, model, 'NO_VERIFIED_FINANCIAL_PERIODS');
  if (!Array.isArray(company?.provenance) || !company.provenance.length) return unavailableFundamentals(company, model, 'SOURCE_PROVENANCE_REQUIRED');
  const currencies = new Set(periods.map(period => period.currency || company.currency).filter(Boolean).map(value => String(value).toUpperCase()));
  if (currencies.size !== 1) return unavailableFundamentals(company, model, 'MIXED_OR_MISSING_CURRENCY');
  const m = deriveMetrics(periods);
  const bank = model === SECTOR_MODELS.BANK;
  const profitability = component('PROFITABILITY', 25, bank ? [
    { metric: 'ROE_PCT', value: m.roePct, score: scoreHigher(m.roePct, 3, 22) },
    { metric: 'ROA_PCT', value: m.roaPct, score: scoreHigher(m.roaPct, 0.3, 3) },
    { metric: 'NET_MARGIN_PCT', value: m.netMarginPct, score: scoreHigher(m.netMarginPct, 3, 35) },
  ] : [
    { metric: 'OPERATING_MARGIN_PCT', value: m.operatingMarginPct, score: scoreHigher(m.operatingMarginPct, 0, 25) },
    { metric: 'NET_MARGIN_PCT', value: m.netMarginPct, score: scoreHigher(m.netMarginPct, 0, 20) },
    { metric: 'ROE_PCT', value: m.roePct, score: scoreHigher(m.roePct, 0, 25) },
    { metric: 'ROA_PCT', value: m.roaPct, score: scoreHigher(m.roaPct, 0, 12) },
  ]);
  const growth = component('GROWTH', 20, [
    { metric: 'REVENUE_GROWTH_PCT', value: m.revenueGrowthPct, score: scoreHigher(m.revenueGrowthPct, -15, 30) },
    { metric: 'EARNINGS_GROWTH_PCT', value: m.earningsGrowthPct, score: scoreHigher(m.earningsGrowthPct, -25, 40) },
    { metric: 'EPS_GROWTH_PCT', value: m.epsGrowthPct, score: scoreHigher(m.epsGrowthPct, -25, 40) },
  ]);
  const balance = component('BALANCE_SHEET', 20, bank ? [
    { metric: 'EQUITY_GROWTH_PCT', value: m.equityGrowthPct, score: scoreHigher(m.equityGrowthPct, -10, 25) },
    { metric: 'CAPITAL_ADEQUACY_PCT', value: m.latest.capitalAdequacyPct, score: scoreHigher(m.latest.capitalAdequacyPct, 10, 25) },
    { metric: 'NON_PERFORMING_LOANS_PCT', value: m.latest.nonPerformingLoansPct, score: scoreLower(m.latest.nonPerformingLoansPct, 2, 12) },
  ] : [
    { metric: 'DEBT_TO_EQUITY', value: m.debtToEquity, score: scoreLower(m.debtToEquity, 0.15, 2.5) },
    { metric: 'CURRENT_RATIO', value: m.currentRatio, score: scoreHigher(m.currentRatio, 0.7, 2.2) },
    { metric: 'INTEREST_COVERAGE', value: m.interestCoverage, score: scoreHigher(m.interestCoverage, 0.5, 8) },
    { metric: 'EQUITY_GROWTH_PCT', value: m.equityGrowthPct, score: scoreHigher(m.equityGrowthPct, -15, 25) },
  ]);
  const cashFlow = component('CASH_FLOW', 20, bank ? [
    { metric: 'PROFITABLE_PERIOD_RATIO', value: m.periodCount ? m.profitablePeriods / m.periodCount : null, score: scoreHigher(m.periodCount ? m.profitablePeriods / m.periodCount : null, 0.4, 1) },
    { metric: 'EQUITY_GROWTH_PCT', value: m.equityGrowthPct, score: scoreHigher(m.equityGrowthPct, -10, 25) },
  ] : [
    { metric: 'OPERATING_CASH_FLOW', value: m.latest.operatingCashFlow, score: !finite(m.latest.operatingCashFlow) ? null : Number(m.latest.operatingCashFlow) > 0 ? 100 : 0 },
    { metric: 'FREE_CASH_FLOW', value: m.freeCashFlow, score: !finite(m.freeCashFlow) ? null : m.freeCashFlow > 0 ? 100 : 0 },
    { metric: 'CFO_TO_NET_INCOME', value: m.cfoToNetIncome, score: scoreHigher(m.cfoToNetIncome, 0, 1.3) },
    { metric: 'NEGATIVE_CFO_PERIODS', value: m.negativeCfoPeriods, score: scoreLower(m.negativeCfoPeriods, 0, Math.max(2, m.periodCount)) },
  ]);
  const stability = component('EARNINGS_STABILITY', 15, [
    { metric: 'PROFITABLE_PERIOD_RATIO', value: m.periodCount ? m.profitablePeriods / m.periodCount : null, score: scoreHigher(m.periodCount ? m.profitablePeriods / m.periodCount : null, 0.4, 1) },
    { metric: 'LOSS_PERIODS', value: m.lossPeriods, score: scoreLower(m.lossPeriods, 0, Math.max(2, m.periodCount)) },
    { metric: 'EARNINGS_VOLATILITY', value: m.earningsVolatility, score: scoreLower(m.earningsVolatility, 3, 25) },
  ]);
  const components = { profitability, growth, balanceSheet: balance, cashFlow, earningsStability: stability };
  const sufficient = Object.values(components).filter(x => x.sufficient && finite(x.score));
  const qualityScore = sufficient.length >= 4
    ? Number((sufficient.reduce((sum, x) => sum + x.score * x.weight, 0) / sufficient.reduce((sum, x) => sum + x.weight, 0)).toFixed(2)) : null;
  const ageMonths = reportingAgeMonths(m.latest.periodEnd, options.asOf || new Date());
  const sourceConfidence = String(company.sourceConfidence || 'LOW').toUpperCase();
  const dataConfidence = ageMonths > 18 || periods.length < 2 ? 'LOW'
    : sourceConfidence === 'HIGH' && sufficient.length === 5 ? 'HIGH'
      : sourceConfidence === 'HIGH' || sourceConfidence === 'MEDIUM' ? 'MEDIUM' : 'LOW';
  const risk = scoreFinancialRisk(m, dataConfidence, ageMonths, bank);
  const valuation = scoreValuation(company.valuation || {}, model);
  const valueTrap = scoreValueTrap(m, qualityScore, risk, valuation, company.materialNegativeEvent);
  return {
    ticker: company.ticker,
    sectorModel: model,
    latestReportingPeriod: m.latest.periodEnd || null,
    publicationDate: m.latest.publicationDate || null,
    currency: company.currency || m.latest.currency || null,
    fundamentalDataConfidence: dataConfidence,
    fundamentalQualityScore: qualityScore,
    components,
    financialRisk: risk,
    valuation,
    valueTrapRisk: valueTrap,
    metrics: m,
    provenance: company.provenance || [],
    missingFields: company.missingFields || [],
    staleFinancialStatements: ageMonths > 18,
    reportingAgeMonths: Number.isFinite(ageMonths) ? Number(ageMonths.toFixed(1)) : null,
  };
}

function scoreFinancialRisk(m, dataConfidence, ageMonths, bank = false) {
  const evidence = [];
  let points = 0;
  const add = (condition, amount, code, explanationAr) => { if (condition) { points += amount; evidence.push({ code, explanationAr, points: amount }); } };
  add(m.lossPeriods >= 2, 25, 'RECURRING_LOSSES', 'تكررت الخسائر خلال الفترات المالية المتاحة.');
  add(m.negativeCfoPeriods >= 2 && !bank, 20, 'PERSISTENT_NEGATIVE_CFO', 'تكرر التدفق النقدي التشغيلي السلبي.');
  add(!bank && finite(m.debtToEquity) && m.debtToEquity > 2, 35, 'EXCESSIVE_LEVERAGE', 'المديونية مرتفعة مقارنة بحقوق الملكية.');
  add(!bank && finite(m.currentRatio) && m.currentRatio < 0.8, 15, 'POOR_LIQUIDITY', 'السيولة الجارية ضعيفة نسبيًا.');
  add(finite(m.equityGrowthPct) && m.equityGrowthPct < -15, 20, 'DETERIORATING_EQUITY', 'حقوق الملكية تتراجع بصورة جوهرية.');
  add(!bank && finite(m.interestCoverage) && m.interestCoverage < 1.2, 15, 'INTEREST_BURDEN', 'تغطية أعباء الفائدة ضعيفة.');
  add(ageMonths > 18, 15, 'STALE_FINANCIAL_STATEMENTS', 'القوائم المالية المتاحة قديمة.');
  add(dataConfidence === 'LOW', 10, 'LOW_FUNDAMENTAL_CONFIDENCE', 'الثقة في البيانات المالية منخفضة.');
  const score = clamp(points);
  const classification = score >= 75 ? 'VERY_HIGH' : score >= 50 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'RELATIVELY_LOW';
  const labelsAr = { RELATIVELY_LOW: 'منخفض نسبيًا', MEDIUM: 'متوسط', HIGH: 'مرتفع', VERY_HIGH: 'مرتفع جدًا' };
  return { score, classification, labelAr: labelsAr[classification], evidence };
}

function scoreValuation(valuation, model) {
  const metrics = [];
  if (model === SECTOR_MODELS.BANK || model === SECTOR_MODELS.NON_BANK_FINANCIAL) {
    metrics.push({ metric: 'P_B', value: valuation.priceToBook, score: scoreLower(valuation.priceToBook, 0.6, 3.5) });
    metrics.push({ metric: 'P_E', value: valuation.priceToEarnings, score: scoreLower(valuation.priceToEarnings, 5, 25) });
    metrics.push({ metric: 'DIVIDEND_YIELD_PCT', value: valuation.dividendYieldPct, score: scoreHigher(valuation.dividendYieldPct, 0, 10) });
  } else {
    metrics.push({ metric: 'P_E', value: valuation.priceToEarnings, score: scoreLower(valuation.priceToEarnings, 5, 30) });
    metrics.push({ metric: 'EV_EBITDA', value: valuation.evToEbitda, score: scoreLower(valuation.evToEbitda, 3, 18) });
    metrics.push({ metric: 'P_B', value: valuation.priceToBook, score: scoreLower(valuation.priceToBook, 0.7, 5) });
    metrics.push({ metric: 'DIVIDEND_YIELD_PCT', value: valuation.dividendYieldPct, score: scoreHigher(valuation.dividendYieldPct, 0, 10) });
  }
  const available = metrics.filter(x => finite(x.score));
  if (available.length < 2) return { status: 'VALUATION_DATA_INSUFFICIENT', score: null, metrics, sectorModel: model };
  return { status: 'AVAILABLE', score: Number(avg(available.map(x => x.score)).toFixed(2)), metrics, sectorModel: model };
}

function scoreValueTrap(m, qualityScore, risk, valuation, materialNegativeEvent = false) {
  const reasons = [];
  const add = (condition, code, explanationAr, weight) => { if (condition) reasons.push({ code, explanationAr, weight }); };
  add(finite(m.revenueGrowthPct) && m.revenueGrowthPct < -15, 'DECLINING_REVENUE', 'الإيرادات تتراجع بصورة جوهرية.', 20);
  add(m.lossPeriods >= 2, 'RECURRING_LOSSES', 'الخسائر متكررة.', 25);
  add(m.negativeCfoPeriods >= 2, 'PERSISTENT_NEGATIVE_CFO', 'التدفق النقدي التشغيلي سلبي بصورة متكررة.', 20);
  add(finite(m.debtGrowthPct) && m.debtGrowthPct > 25, 'RISING_DEBT', 'المديونية ترتفع بسرعة.', 15);
  add(finite(m.equityGrowthPct) && m.equityGrowthPct < -15, 'DETERIORATING_EQUITY', 'حقوق الملكية تتدهور.', 20);
  add(finite(qualityScore) && qualityScore < 35 && valuation.status === 'AVAILABLE' && valuation.score >= 65, 'CHEAP_FOR_WEAK_QUALITY', 'انخفاض التقييم السعري يتزامن مع جودة مالية ضعيفة.', 25);
  add(['HIGH', 'VERY_HIGH'].includes(risk.classification), 'SEVERE_FINANCIAL_RISK', 'المخاطر المالية مرتفعة.', 20);
  add(materialNegativeEvent === true, 'UNRESOLVED_NEGATIVE_EVENT', 'يوجد حدث سلبي جوهري لم يُحسم أثره.', 20);
  const score = clamp(reasons.reduce((sum, x) => sum + x.weight, 0));
  const classification = score >= 65 ? 'HIGH' : score >= 35 ? 'MEDIUM' : 'LOW';
  return { score, classification, labelAr: classification === 'HIGH' ? 'مرتفع' : classification === 'MEDIUM' ? 'متوسط' : 'منخفض', reasons };
}

function unavailableFundamentals(company = {}, model = sectorModel(company.sector), reason = 'UNAVAILABLE') {
  return {
    ticker: company.ticker || null,
    sectorModel: model,
    latestReportingPeriod: null,
    publicationDate: null,
    currency: null,
    fundamentalDataConfidence: 'UNAVAILABLE',
    fundamentalQualityScore: null,
    components: {
      profitability: { score: null, sufficient: false, evidence: [] },
      growth: { score: null, sufficient: false, evidence: [] },
      balanceSheet: { score: null, sufficient: false, evidence: [] },
      cashFlow: { score: null, sufficient: false, evidence: [] },
      earningsStability: { score: null, sufficient: false, evidence: [] },
    },
    financialRisk: { score: null, classification: 'UNAVAILABLE', labelAr: 'غير متاح', evidence: [] },
    valuation: { status: 'VALUATION_DATA_INSUFFICIENT', score: null, metrics: [], sectorModel: model },
    valueTrapRisk: { score: null, classification: 'UNAVAILABLE', labelAr: 'غير متاح', reasons: [] },
    metrics: null,
    provenance: company.provenance || [],
    missingFields: company.missingFields || ['ALL_REQUIRED_FINANCIAL_FIELDS'],
    staleFinancialStatements: null,
    reportingAgeMonths: null,
    unavailableReason: reason,
  };
}

module.exports = {
  SECTOR_MODELS,
  clamp,
  sectorModel,
  deriveMetrics,
  scoreFundamentals,
  scoreFinancialRisk,
  scoreValuation,
  scoreValueTrap,
  unavailableFundamentals,
};
