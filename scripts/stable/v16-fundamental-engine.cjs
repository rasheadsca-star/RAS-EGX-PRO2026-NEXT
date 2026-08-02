#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const RAW_PATH = path.join(ROOT, 'data/fundamentals/v16-fundamental-raw.json');
const DECISION_PATH = path.join(ROOT, 'data/stable/v15-practical-decision.json');
const MARKET_INDEX_PATH = path.join(ROOT, 'data/quant/market-search-index-v13-17.json');
const HISTORY_DIR = path.join(ROOT, 'data/history');
const OUT_PATH = path.join(ROOT, 'data/stable/v16-fundamental-analysis.json');

const num = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function median(values) {
  const rows = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return null;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
}
function percentile(value, values, lowerIsBetter = false) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!Number.isFinite(value) || clean.length < 3) return null;
  const below = clean.filter(item => item <= value).length / clean.length * 100;
  return round(lowerIsBetter ? 100 - below : below, 1);
}
function ageDays(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? Math.max(0, (Date.now() - time) / 86400000) : null;
}
function latestTrustedPrice(ticker, fallback = null) {
  const document = readJson(path.join(HISTORY_DIR, `${ticker}.json`), {});
  const rows = (Array.isArray(document.sessions) ? document.sessions : Array.isArray(document) ? document : [])
    .filter(row => num(row.close) > 0)
    .sort((a, b) => String(a.date || a.sessionDate || '').localeCompare(String(b.date || b.sessionDate || '')));
  return round(rows.at(-1)?.close, 4) ?? num(fallback);
}
function peerKey(record) {
  const template = record.classification?.template || 'GENERAL';
  const sector = String(record.classification?.sector || '').trim();
  return sector ? `${template}|${sector.toLowerCase()}` : template;
}
const validPositive = (value, max = Infinity) => Number.isFinite(value) && value > 0 && value <= max;
function pointsByBands(value, bands, fallback = 0) {
  if (!Number.isFinite(value)) return fallback;
  for (const [threshold, points] of bands) if (value >= threshold) return points;
  return fallback;
}
function inversePoints(value, bands, fallback = 0) {
  if (!Number.isFinite(value)) return fallback;
  for (const [threshold, points] of bands) if (value <= threshold) return points;
  return fallback;
}
function completeness(record) {
  const latest = record.latest || {}, calculated = record.calculated || {};
  const template = record.classification?.template || 'GENERAL';
  const common = [latest.revenue, latest.netIncome, latest.eps, latest.netMarginPct, latest.peRatio, latest.priceToSales, calculated.revenueGrowthPct, calculated.netIncomeGrowthPct];
  const general = [latest.operatingIncome, latest.operatingCashFlow, latest.freeCashFlow, latest.cashAndInvestments, latest.totalDebt, latest.operatingMarginPct, latest.freeCashFlowMarginPct, latest.returnOnEquityPct, latest.debtToEquity];
  const fields = ['BANK', 'INSURANCE', 'FINANCIAL_SERVICES'].includes(template) ? common : [...common, ...general];
  const available = fields.filter(value => Number.isFinite(value)).length;
  return { available, total: fields.length, pct: round(available / fields.length * 100, 1) };
}
function buildPeerStats(records) {
  const groups = new Map();
  for (const record of records) {
    const keys = [peerKey(record), record.classification?.template || 'GENERAL', 'MARKET'];
    for (const key of keys) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    }
  }
  const metricNames = ['peRatio', 'priceToSales', 'priceToFreeCashFlow', 'priceToBook', 'netMarginPct', 'returnOnEquityPct', 'debtToEquity'];
  const result = {};
  for (const [key, rows] of groups.entries()) {
    result[key] = { count: rows.length };
    for (const metric of metricNames) {
      const values = rows.map(row => num(row.latest?.[metric])).filter(value => Number.isFinite(value) && (metric.includes('price') || metric === 'peRatio' ? value > 0 : true));
      result[key][metric] = round(median(values), 3);
    }
  }
  return result;
}
function choosePeer(record, stats) {
  const exact = stats[peerKey(record)];
  if (exact?.count >= 5) return { key: peerKey(record), ...exact };
  const template = record.classification?.template || 'GENERAL';
  if (stats[template]?.count >= 5) return { key: template, ...stats[template] };
  return { key: 'MARKET', ...(stats.MARKET || {}) };
}
function relativeValuation(record, peer, currentPrice) {
  const latest = record.latest || {}, methods = [];
  function add(name, currentMultiple, peerMultiple, weight) {
    if (!validPositive(currentPrice) || !validPositive(currentMultiple, 1000) || !validPositive(peerMultiple, 1000)) return;
    const factor = clamp(peerMultiple / currentMultiple, 0.45, 2.25);
    methods.push({ name, currentMultiple: round(currentMultiple, 2), peerMultiple: round(peerMultiple, 2), impliedValue: round(currentPrice * factor, 3), weight });
  }
  add('P/E نسبي', latest.peRatio, peer.peRatio, 0.45);
  add('P/FCF نسبي', latest.priceToFreeCashFlow, peer.priceToFreeCashFlow, 0.3);
  add('P/S نسبي', latest.priceToSales, peer.priceToSales, 0.15);
  add('P/B نسبي', latest.priceToBook, peer.priceToBook, 0.1);
  if (!methods.length) return { methods: [], fairValue: null, low: null, high: null, marginOfSafetyPct: null, confidence: 'NONE' };
  const weightTotal = methods.reduce((sum, method) => sum + method.weight, 0);
  const fairValue = methods.reduce((sum, method) => sum + method.impliedValue * method.weight, 0) / weightTotal;
  const values = methods.map(method => method.impliedValue).sort((a, b) => a - b);
  return {
    methods,
    fairValue: round(fairValue, 3),
    low: round(values[0] * 0.9, 3),
    high: round(values.at(-1) * 1.1, 3),
    marginOfSafetyPct: round((fairValue / currentPrice - 1) * 100, 1),
    confidence: methods.length >= 3 ? 'MEDIUM' : methods.length === 2 ? 'LOW_MEDIUM' : 'LOW',
    methodology: 'Relative valuation against available EGX peers; not a DCF or guaranteed intrinsic value.'
  };
}
function scoreGeneral(record, peer) {
  const l = record.latest || {}, c = record.calculated || {};
  const breakdown = { profitability: 0, growth: 0, balanceSheet: 0, cashFlow: 0, valuation: 0, disclosure: 0 };
  breakdown.profitability += pointsByBands(num(l.netMarginPct), [[15, 9], [8, 7], [3, 5], [0, 2]], 0);
  breakdown.profitability += pointsByBands(num(l.operatingMarginPct), [[18, 8], [10, 6], [4, 4], [0, 1]], 0);
  breakdown.profitability += pointsByBands(num(l.returnOnEquityPct), [[22, 8], [15, 6], [8, 4], [0, 1]], 0);
  breakdown.growth += pointsByBands(num(c.revenueGrowthPct), [[25, 8], [12, 6], [5, 4], [0, 2], [-10, 1]], 0);
  const annualCurrent = num(record.annual?.current?.netIncome), annualPrior = num(record.annual?.prior?.netIncome);
  if (annualCurrent > 0 && annualPrior <= 0) breakdown.growth += 10;
  else breakdown.growth += pointsByBands(num(c.netIncomeGrowthPct), [[30, 10], [15, 8], [5, 5], [0, 2], [-15, 1]], 0);
  breakdown.balanceSheet += pointsByBands(num(c.cashToDebt), [[2, 7], [1, 6], [0.5, 4], [0.25, 2]], 0);
  breakdown.balanceSheet += inversePoints(num(l.debtToEquity), [[0.3, 7], [0.7, 5], [1.2, 3], [2, 1]], 0);
  breakdown.balanceSheet += num(l.netCashDebt) > 0 ? 6 : num(l.netCashDebt) === 0 ? 3 : 0;
  breakdown.cashFlow += num(l.operatingCashFlow) > 0 ? 6 : 0;
  breakdown.cashFlow += num(l.freeCashFlow) > 0 ? 5 : 0;
  breakdown.cashFlow += pointsByBands(num(c.operatingCashFlowToNetIncome), [[1.2, 4], [0.8, 3], [0.5, 1]], 0);
  const peDiscount = validPositive(l.peRatio) && validPositive(peer.peRatio) ? (peer.peRatio / l.peRatio - 1) * 100 : null;
  const psDiscount = validPositive(l.priceToSales) && validPositive(peer.priceToSales) ? (peer.priceToSales / l.priceToSales - 1) * 100 : null;
  breakdown.valuation += pointsByBands(peDiscount, [[35, 9], [15, 7], [0, 5], [-20, 2]], 0);
  breakdown.valuation += pointsByBands(psDiscount, [[35, 6], [15, 5], [0, 3], [-20, 1]], 0);
  return breakdown;
}
function scoreFinancial(record, peer) {
  const l = record.latest || {}, c = record.calculated || {};
  const breakdown = { profitability: 0, growth: 0, balanceSheet: 0, cashFlow: 0, valuation: 0, disclosure: 0 };
  breakdown.profitability += pointsByBands(num(l.returnOnEquityPct), [[25, 17], [18, 14], [12, 10], [6, 5], [0, 2]], 0);
  breakdown.profitability += pointsByBands(num(l.returnOnAssetsPct), [[4, 8], [2, 6], [1, 3], [0, 1]], 0);
  breakdown.profitability += pointsByBands(num(l.netMarginPct), [[25, 10], [15, 8], [7, 5], [0, 2]], 0);
  breakdown.growth += pointsByBands(num(c.revenueGrowthPct), [[25, 12], [12, 9], [5, 6], [0, 3]], 0);
  breakdown.growth += pointsByBands(num(c.netIncomeGrowthPct), [[30, 13], [15, 10], [5, 6], [0, 3]], 0);
  breakdown.balanceSheet = 10;
  breakdown.cashFlow = num(l.netIncome) > 0 ? 10 : 0;
  const peDiscount = validPositive(l.peRatio) && validPositive(peer.peRatio) ? (peer.peRatio / l.peRatio - 1) * 100 : null;
  const pbDiscount = validPositive(l.priceToBook) && validPositive(peer.priceToBook) ? (peer.priceToBook / l.priceToBook - 1) * 100 : null;
  breakdown.valuation += pointsByBands(peDiscount, [[30, 10], [10, 8], [0, 5], [-20, 2]], 0);
  breakdown.valuation += pointsByBands(pbDiscount, [[30, 5], [10, 4], [0, 3], [-20, 1]], 0);
  return breakdown;
}
function disclosurePoints(record) {
  const statementAge = ageDays(record.source?.officialPeriodEnd || record.sourceAsOf);
  let score = record.source?.officialDisclosureVerified ? 3 : 1;
  if (record.source?.audited === true) score += 1;
  if (statementAge !== null && statementAge <= 210) score += 1;
  return clamp(score, 0, 5);
}
function redFlags(record, peer) {
  const l = record.latest || {}, c = record.calculated || {}, flags = [];
  const add = (severity, code, text) => flags.push({ severity, code, text });
  if (num(l.netIncome) < 0) add('HIGH', 'NET_LOSS', 'صافي الربح سلبي في أحدث فترة.');
  if (num(l.operatingCashFlow) < 0) add('HIGH', 'NEGATIVE_OCF', 'التدفق النقدي التشغيلي سلبي.');
  if (num(l.freeCashFlow) < 0) add('MEDIUM', 'NEGATIVE_FCF', 'التدفق النقدي الحر سلبي.');
  if (num(l.netIncome) < 0 && num(l.operatingCashFlow) < 0) add('CRITICAL', 'LOSS_AND_CASH_BURN', 'خسائر محاسبية مع حرق نقد تشغيلي.');
  if (num(l.debtToEquity) > 2 && !['BANK', 'INSURANCE', 'FINANCIAL_SERVICES'].includes(record.classification?.template)) add('HIGH', 'HIGH_LEVERAGE', 'المديونية إلى حقوق الملكية أعلى من 2 مرة.');
  if (num(c.cashToDebt) !== null && num(c.cashToDebt) < 0.2) add('MEDIUM', 'LOW_CASH_COVER', 'النقدية تغطي أقل من 20% من الدين.');
  if (num(c.operatingCashFlowToNetIncome) !== null && num(c.operatingCashFlowToNetIncome) < 0.5 && num(l.netIncome) > 0) add('MEDIUM', 'LOW_EARNINGS_CASH_CONVERSION', 'تحويل الأرباح إلى تدفق نقدي ضعيف.');
  if (num(c.revenueGrowthPct) < -15) add('MEDIUM', 'REVENUE_CONTRACTION', 'انكماش الإيرادات بأكثر من 15%.');
  if (num(c.netIncomeGrowthPct) < -30) add('HIGH', 'PROFIT_CONTRACTION', 'تراجع الأرباح بأكثر من 30%.');
  if (validPositive(l.peRatio) && validPositive(peer.peRatio) && l.peRatio > peer.peRatio * 1.8) add('MEDIUM', 'EXPENSIVE_PE', 'مضاعف الربحية أعلى كثيرًا من مجموعة المقارنة.');
  if (validPositive(l.priceToSales) && validPositive(peer.priceToSales) && l.priceToSales > peer.priceToSales * 2) add('MEDIUM', 'EXPENSIVE_PS', 'مضاعف المبيعات أعلى من ضعفي مجموعة المقارنة.');
  const statementAge = ageDays(record.source?.officialPeriodEnd || record.sourceAsOf);
  if (statementAge === null || statementAge > 365) add('HIGH', 'STALE_STATEMENTS', 'الفترة المالية المتاحة قديمة أو تاريخها غير معروف.');
  return flags;
}
function buildRecord(raw, peerStats, marketRow, recommendation) {
  const currentPrice = latestTrustedPrice(raw.ticker, marketRow?.price || recommendation?.close);
  const peer = choosePeer(raw, peerStats), complete = completeness(raw), template = raw.classification?.template || 'GENERAL';
  const minCompleteness = ['BANK', 'INSURANCE', 'FINANCIAL_SERVICES'].includes(template) ? 45 : 50;
  const breakdown = ['BANK', 'INSURANCE', 'FINANCIAL_SERVICES'].includes(template) ? scoreFinancial(raw, peer) : scoreGeneral(raw, peer);
  breakdown.disclosure = disclosurePoints(raw);
  const rawScore = Object.values(breakdown).reduce((sum, value) => sum + num(value, 0), 0);
  const score = complete.pct >= minCompleteness ? clamp(round(rawScore, 0), 0, 100) : null;
  const flags = redFlags(raw, peer), critical = flags.some(flag => ['CRITICAL', 'HIGH'].includes(flag.severity));
  const valuation = relativeValuation(raw, peer, currentPrice);
  let verdict = 'DATA_INSUFFICIENT', verdictAr = 'البيانات غير كافية للحكم المالي';
  if (score !== null) {
    if (critical || score < 35) { verdict = 'AVOID_INVESTMENT_REVIEW'; verdictAr = 'مخاطر مالية مرتفعة — لا يصلح كاستثمار قبل معالجة الأسباب'; }
    else if (score >= 70 && num(valuation.marginOfSafetyPct, -999) >= 10) { verdict = 'INVESTMENT_REVIEW'; verdictAr = 'مرشح لمراجعة استثمارية متعمقة'; }
    else if (score >= 55) { verdict = 'WATCH'; verdictAr = 'مقبول ماليًا للمراقبة مع مراجعة الإفصاحات'; }
    else { verdict = 'WEAK'; verdictAr = 'جودة مالية أو تقييم غير كافيين'; }
  }
  const grade = score === null ? 'N/A' : score >= 80 ? 'A' : score >= 70 ? 'B+' : score >= 60 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'E';
  const peerRows = Object.values(peerStats.__records || {}).filter(row => choosePeer(row, peerStats).key === peer.key), l = raw.latest || {};
  return {
    ticker: raw.ticker, companyNameAr: raw.companyNameAr, classification: raw.classification, currentPrice,
    financialPeriodEnd: raw.source?.officialPeriodEnd || raw.sourceAsOf || null,
    statementAgeDays: round(ageDays(raw.source?.officialPeriodEnd || raw.sourceAsOf), 0), fetchedAt: raw.fetchedAt, source: raw.source,
    dataQuality: { completenessPct: complete.pct, availableMetrics: complete.available, totalMetrics: complete.total, officialVerified: raw.source?.officialDisclosureVerified === true, audited: raw.source?.audited === true, sourceTier: raw.source?.providerTier || 'UNKNOWN', scoreEligible: complete.pct >= minCompleteness },
    score, grade, verdict, verdictAr, breakdown, latest: raw.latest, annual: raw.annual, calculated: raw.calculated,
    peerComparison: {
      peerKey: peer.key, peerCount: peer.count || 0,
      medians: { peRatio: peer.peRatio ?? null, priceToSales: peer.priceToSales ?? null, priceToFreeCashFlow: peer.priceToFreeCashFlow ?? null, priceToBook: peer.priceToBook ?? null, netMarginPct: peer.netMarginPct ?? null, returnOnEquityPct: peer.returnOnEquityPct ?? null, debtToEquity: peer.debtToEquity ?? null },
      percentiles: { netMargin: percentile(num(l.netMarginPct), peerRows.map(row => num(row.latest?.netMarginPct))), roe: percentile(num(l.returnOnEquityPct), peerRows.map(row => num(row.latest?.returnOnEquityPct))), peAttractiveness: percentile(num(l.peRatio), peerRows.map(row => num(row.latest?.peRatio)), true), debtSafety: percentile(num(l.debtToEquity), peerRows.map(row => num(row.latest?.debtToEquity)), true) }
    },
    relativeFairValue: valuation, redFlags: flags,
    recommendationContext: recommendation ? { isCurrentRecommendation: true, technicalRank: recommendation.rank, strategyId: recommendation.strategyId, riskReward: recommendation.riskReward, evidenceTier: recommendation.modelEvidenceTier || null, tradeCompatibility: critical ? 'TECHNICAL_ONLY_HIGH_FINANCIAL_RISK' : score === null ? 'FINANCIAL_DATA_REQUIRED' : score >= 55 ? 'FINANCIALLY_SUPPORTIVE' : 'FINANCIALLY_WEAK' } : { isCurrentRecommendation: false }
  };
}
function main() {
  const rawDoc = readJson(RAW_PATH, { records: {} }), decision = readJson(DECISION_PATH, { recommendations: [] }), marketIndex = readJson(MARKET_INDEX_PATH, { stocks: [] });
  const rawRecords = Object.values(rawDoc.records || {}).filter(record => record?.parseDiagnostics?.parseAccepted !== false);
  const stats = buildPeerStats(rawRecords); stats.__records = Object.fromEntries(rawRecords.map(record => [record.ticker, record]));
  const recommendationMap = new Map((decision.recommendations || []).map(item => [item.ticker, item])), marketMap = new Map((marketIndex.stocks || []).map(item => [item.ticker, item]));
  const records = rawRecords.map(record => buildRecord(record, stats, marketMap.get(record.ticker), recommendationMap.get(record.ticker))).sort((a, b) => num(b.score, -1) - num(a.score, -1) || a.ticker.localeCompare(b.ticker));
  const recommendationAnalysis = (decision.recommendations || []).map(item => records.find(record => record.ticker === item.ticker) || { ticker: item.ticker, companyNameAr: item.companyNameAr, currentPrice: item.close, score: null, grade: 'N/A', verdict: 'DATA_UNAVAILABLE', verdictAr: 'لم تُجمع البيانات المالية لهذا السهم بعد', dataQuality: { completenessPct: 0, officialVerified: false, audited: false, scoreEligible: false }, redFlags: [{ severity: 'MEDIUM', code: 'NO_FINANCIAL_DATA', text: 'البيانات المالية لم تُجمع بعد.' }], recommendationContext: { isCurrentRecommendation: true, technicalRank: item.rank, strategyId: item.strategyId, riskReward: item.riskReward, tradeCompatibility: 'FINANCIAL_DATA_REQUIRED' } });
  const scored = records.filter(record => record.score !== null), fresh = records.filter(record => num(record.statementAgeDays, 9999) <= 240), official = records.filter(record => record.dataQuality.officialVerified);
  const byVerdict = records.reduce((acc, record) => { acc[record.verdict] = (acc[record.verdict] || 0) + 1; return acc; }, {});
  const output = {
    schemaVersion: '16.1.0', generatedAt: new Date().toISOString(),
    methodology: { name: 'EGX_PRO_FUNDAMENTAL_MULTI_PILLAR_1.0', principles: ['No financial metric is invented or inferred when the source does not provide it.', 'Secondary standardized data is clearly separated from official audited disclosures.', 'Banks, insurers and financial services use a different balance-sheet treatment.', 'Fair value is relative peer valuation, not a DCF or guaranteed intrinsic value.', 'Insufficient or stale data produces DATA_INSUFFICIENT instead of a score.'], weights: { profitability: 25, growth: 20, balanceSheet: 20, cashFlow: 15, valuation: 15, disclosure: 5 }, statementFreshDays: 240, severeStaleDays: 365 },
    summary: { marketUniverse: rawDoc.universeCount || marketIndex.stocks?.length || 0, rawCoverage: rawDoc.coverageCount || rawRecords.length, scoredCompanies: scored.length, freshStatements: fresh.length, officialVerifiedCompanies: official.length, auditedCompanies: records.filter(record => record.dataQuality.audited).length, currentRecommendationCount: decision.recommendations?.length || 0, currentRecommendationFinancialCoverage: recommendationAnalysis.filter(record => record.score !== null).length, byVerdict },
    recommendationAnalysis, records, peerStats: Object.fromEntries(Object.entries(stats).filter(([key]) => key !== '__records')),
    sourceHealth: { provider: rawDoc.provider || null, lastCollectorRun: rawDoc.generatedAt || null, attemptedLastRun: rawDoc.attemptedThisRun || 0, succeededLastRun: rawDoc.succeededThisRun || 0, failedLastRun: rawDoc.failedThisRun || 0, unresolvedFailures: Object.keys(rawDoc.failures || {}).length }
  };
  writeJson(OUT_PATH, output);
  console.log(JSON.stringify({ summary: output.summary, recommendationAnalysis: recommendationAnalysis.map(record => ({ ticker: record.ticker, score: record.score, grade: record.grade, verdict: record.verdict })) }, null, 2));
}
main();
