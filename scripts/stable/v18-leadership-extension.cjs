#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const POLICY_PATH = path.join(ROOT, 'data/v18-global-strategy-policy.json');
const STOCK_DIR = path.join(ROOT, 'data/quant/stocks');
const OUT_PATH = path.join(ROOT, 'data/stable/v18-global-strategy-ensemble.json');
const LEDGER_PATH = path.join(ROOT, 'data/stable/v18-forward-ledger.json');

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function round(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}
function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, num(value, 0)));
}
function safeTicker(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
}
function uniq(values) {
  return [...new Set((values || []).filter(Boolean))];
}
function avg(values) {
  const valid = (values || []).map(Number).filter(Number.isFinite);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}
function percentile(sorted, value) {
  if (!Number.isFinite(value) || !sorted.length) return null;
  if (sorted.length === 1) return 100;
  let lowerOrEqual = 0;
  for (const x of sorted) if (x <= value) lowerOrEqual += 1;
  return clamp(((lowerOrEqual - 1) / (sorted.length - 1)) * 100, 0, 100);
}
function maxSlice(values, start, end) {
  const xs = values.slice(start, end).map(Number).filter(Number.isFinite);
  return xs.length ? Math.max(...xs) : null;
}
function minSlice(values, start, end) {
  const xs = values.slice(start, end).map(Number).filter(Number.isFinite);
  return xs.length ? Math.min(...xs) : null;
}
function rangePct(highs, lows, start, end, close) {
  const hi = maxSlice(highs, start, end);
  const lo = minSlice(lows, start, end);
  return hi !== null && lo !== null && close > 0 ? ((hi - lo) / close) * 100 : null;
}
function loadStockDetails() {
  const map = new Map();
  if (!fs.existsSync(STOCK_DIR)) return map;
  for (const file of fs.readdirSync(STOCK_DIR).filter(name => name.endsWith('.json'))) {
    const detail = readJson(path.join(STOCK_DIR, file), null);
    const ticker = safeTicker(detail?.ticker || file.replace(/\.json$/i, ''));
    if (ticker && detail) map.set(ticker, detail);
  }
  return map;
}

const DEFAULT_MATRIX = {
  RISK_ON: { PORTFOLIO_BASKET: 1.00, BREAKOUT: 1.00, MOMENTUM: 0.95, TREND_CONTINUATION: 1.00, PULLBACK: 0.90, REVERSAL: 0.45, EMA_MACD: 0.95, LEADERSHIP: 1.00, VOLATILITY_CONTRACTION: 0.95, OTHER: 0.70 },
  NEUTRAL: { PORTFOLIO_BASKET: 0.75, BREAKOUT: 0.75, MOMENTUM: 0.65, TREND_CONTINUATION: 0.80, PULLBACK: 0.85, REVERSAL: 0.70, EMA_MACD: 0.80, LEADERSHIP: 0.80, VOLATILITY_CONTRACTION: 0.85, OTHER: 0.65 },
  RISK_OFF: { PORTFOLIO_BASKET: 0.30, BREAKOUT: 0.35, MOMENTUM: 0.25, TREND_CONTINUATION: 0.40, PULLBACK: 0.50, REVERSAL: 0.80, EMA_MACD: 0.40, LEADERSHIP: 0.45, VOLATILITY_CONTRACTION: 0.55, OTHER: 0.45 },
  HIGH_VOLATILITY: { PORTFOLIO_BASKET: 0.35, BREAKOUT: 0.50, MOMENTUM: 0.40, TREND_CONTINUATION: 0.45, PULLBACK: 0.55, REVERSAL: 0.60, EMA_MACD: 0.45, LEADERSHIP: 0.55, VOLATILITY_CONTRACTION: 0.65, OTHER: 0.45 }
};

function normalizeRegime(code) {
  const c = String(code || '').toUpperCase();
  if (c === 'BULLISH') return 'RISK_ON';
  if (c === 'BEARISH') return 'RISK_OFF';
  return DEFAULT_MATRIX[c] ? c : 'NEUTRAL';
}

function computeLeadership(detail, universes, cfg) {
  const i = detail?.indicators || {};
  const chart = detail?.chart || {};
  const closes = Array.isArray(chart.close) ? chart.close : [];
  const highs = Array.isArray(chart.high) ? chart.high : [];
  const lows = Array.isArray(chart.low) ? chart.low : [];
  const volumes = Array.isArray(chart.volume) ? chart.volume : [];
  const n = Math.min(closes.length, highs.length, lows.length, volumes.length || Infinity);
  const close = num(i.close, num(detail?.latest?.close));
  const r20 = num(i.return20Pct);
  const r50 = num(i.return50Pct);
  const rs20 = percentile(universes.r20, r20);
  const rs50 = percentile(universes.r50, r50);
  const rsComposite = rs20 !== null && rs50 !== null ? 0.65 * rs20 + 0.35 * rs50 : rs20 ?? rs50;

  const availableSessions = Math.min(252, n || closes.length || highs.length);
  const highWindowStart = Math.max(0, highs.length - availableSessions);
  const availableHigh = maxSlice(highs, highWindowStart, highs.length);
  const distanceFromAvailableHighPct = close > 0 && availableHigh > 0 ? (close / availableHigh - 1) * 100 : null;
  const nearHighMaxDistance = num(cfg.nearHighMaximumDistancePct, 8);
  const nearAvailableHigh = distanceFromAvailableHighPct !== null && distanceFromAvailableHighPct >= -nearHighMaxDistance;
  const full52WeekCoverage = availableSessions >= num(cfg.full52WeekMinimumSessions, 220);

  const last10Start = Math.max(0, highs.length - 10);
  const prior20Start = Math.max(0, highs.length - 30);
  const prior20End = Math.max(0, highs.length - 10);
  const recentRange10Pct = rangePct(highs, lows, last10Start, highs.length, close);
  const priorRange20Pct = rangePct(highs, lows, prior20Start, prior20End, close);
  const contractionRatio = recentRange10Pct !== null && priorRange20Pct > 0 ? recentRange10Pct / priorRange20Pct : null;
  const avgVol5 = avg(volumes.slice(-5));
  const avgVol20 = avg(volumes.slice(-20));
  const volumeDryUpRatio = avgVol5 !== null && avgVol20 > 0 ? avgVol5 / avgVol20 : null;
  const trendAligned = close > num(i.sma20, Infinity) && num(i.sma20, -Infinity) > num(i.sma50, Infinity);
  const vcpPassed = n >= num(cfg.minimumVcpHistorySessions, 35)
    && trendAligned
    && contractionRatio !== null && contractionRatio <= num(cfg.maximumVcpContractionRatio, 0.68)
    && volumeDryUpRatio !== null && volumeDryUpRatio <= num(cfg.maximumVcpVolumeDryUpRatio, 0.90)
    && distanceFromAvailableHighPct !== null && distanceFromAvailableHighPct >= -num(cfg.vcpMaximumDistanceFromHighPct, 12);

  const highProximityScore = distanceFromAvailableHighPct === null ? 0 : clamp(100 - Math.max(0, Math.abs(distanceFromAvailableHighPct)) * 7, 0, 100);
  const trendScore = trendAligned ? 100 : close > num(i.sma20, Infinity) ? 65 : 25;
  const leadershipScore = clamp((rsComposite ?? 0) * 0.68 + highProximityScore * 0.20 + trendScore * 0.12, 0, 100);
  const turnover = num(i.averageTurnover20Egp, 0);
  const liquidityEligible = turnover >= num(cfg.minimumAverageTurnover20Egp, 20000000);
  const researchSetupEligible = leadershipScore >= num(cfg.minimumLeadershipScore, 80)
    && (nearAvailableHigh || vcpPassed)
    && liquidityEligible;

  return {
    historyWindowSessions: availableSessions,
    full52WeekCoverage,
    highReferenceLabel: full52WeekCoverage ? '52_WEEK_HIGH' : 'AVAILABLE_HISTORY_HIGH_PROXY',
    availableHigh: round(availableHigh, 3),
    distanceFromAvailableHighPct: round(distanceFromAvailableHighPct, 2),
    nearAvailableHigh,
    return20Pct: round(r20, 2),
    return50Pct: round(r50, 2),
    relativeStrength20Percentile: round(rs20, 1),
    relativeStrength50Percentile: round(rs50, 1),
    relativeStrengthComposite: round(rsComposite, 1),
    leadershipScore: round(leadershipScore, 1),
    trendAligned,
    vcp: {
      passed: vcpPassed,
      recentRange10Pct: round(recentRange10Pct, 2),
      priorRange20Pct: round(priorRange20Pct, 2),
      contractionRatio: round(contractionRatio, 3),
      averageVolume5: round(avgVol5, 0),
      averageVolume20: round(avgVol20, 0),
      volumeDryUpRatio: round(volumeDryUpRatio, 3)
    },
    liquidityEligible,
    researchSetupEligible
  };
}

function compatibilityFor(row, regimeCode, matrix) {
  const regime = normalizeRegime(regimeCode);
  const table = matrix[regime] || DEFAULT_MATRIX[regime] || DEFAULT_MATRIX.NEUTRAL;
  const families = uniq(row.strategyFamilies || []);
  if (!families.length) return { regime, score: table.OTHER || 0.65, families: [] };
  const scores = families.map(f => num(table[f], num(table.OTHER, 0.65)));
  return { regime, score: avg(scores), families: families.map((f, idx) => ({ family: f, compatibility: round(scores[idx], 2) })) };
}

function newResearchRow(ticker, detail, leadership) {
  const i = detail?.indicators || {};
  const sources = [];
  const strategies = [];
  const families = [];
  const evidence = [];
  if ((leadership.relativeStrengthComposite || 0) >= 80 && leadership.nearAvailableHigh) {
    sources.push('V18_RS_LEADERSHIP_SHADOW');
    strategies.push('RELATIVE_STRENGTH_HIGH_PROXIMITY');
    families.push('LEADERSHIP');
    evidence.push({ source: 'V18_RS_LEADERSHIP_SHADOW', sourceWeight: 18, strategyId: 'RELATIVE_STRENGTH_HIGH_PROXIMITY', strategyLabelAr: 'قيادة نسبية قرب القمة', status: 'RESEARCH_ONLY', score: leadership.leadershipScore, noteAr: leadership.full52WeekCoverage ? 'قوة نسبية مرتفعة مع قرب من قمة 52 أسبوع.' : 'قوة نسبية مرتفعة مع قرب من أعلى سعر متاح؛ لا تُسمى قمة 52 أسبوع لعدم اكتمال 220 جلسة.' });
  }
  if (leadership.vcp?.passed) {
    sources.push('V18_VCP_SHADOW');
    strategies.push('VOLATILITY_CONTRACTION_PATTERN');
    families.push('VOLATILITY_CONTRACTION');
    evidence.push({ source: 'V18_VCP_SHADOW', sourceWeight: 20, strategyId: 'VOLATILITY_CONTRACTION_PATTERN', strategyLabelAr: 'انكماش تذبذب مع جفاف حجم', status: 'RESEARCH_ONLY', score: leadership.leadershipScore, noteAr: 'النطاق الأخير انكمش مع جفاف نسبي في الحجم داخل اتجاه صاعد.' });
  }
  const baseScore = clamp(
    (num(detail?.technical?.score, 50) * 0.30)
      + ((leadership.leadershipScore || 0) * 0.42)
      + (leadership.vcp?.passed ? 7 : 0)
      + (leadership.nearAvailableHigh ? 4 : 0)
      + (leadership.liquidityEligible ? 7 : 0),
    0,
    100
  );
  return {
    rank: null,
    ticker,
    companyNameAr: detail.companyNameAr || ticker,
    sessionId: detail.sessionId || null,
    tier: 'TIER_C_RESEARCH_LEADERSHIP',
    decisionLabelAr: 'قيادة/انكماش بحثي — مراقبة حتى يثبت Forward evidence',
    decisionScore: round(baseScore, 1),
    baseDecisionScore: round(baseScore, 1),
    sources,
    strategyFamilies: uniq(families),
    strategies,
    technical: {
      score: round(detail?.technical?.score, 1),
      trendCode: detail?.technical?.trendCode || null,
      price: round(detail?.latest?.close, 3),
      rsi14: round(i.rsi14, 1),
      macd: round(i.macd, 3),
      macdSignal: round(i.macdSignal, 3),
      volumeRatio20: round(i.volumeRatio20, 2),
      averageTurnover20Egp: round(i.averageTurnover20Egp, 0),
      atrPct: round(i.atrPct, 2)
    },
    emaMacdContinuation: null,
    dataQuality: {
      sameSession: true,
      historyConfidence: round(detail?.dataQuality?.averageConfidence, 1),
      eligibilityStatus: detail?.dataQuality?.eligibilityStatus || null
    },
    execution: {
      automaticOrders: false,
      nextSessionOpenConfirmationRequired: true,
      preferredPlan: null,
      noteAr: 'Research-only setup. لا يتحول لأمر تنفيذ بدون تأكيد افتتاح ودليل Forward مستقل.'
    },
    evidence,
    leadership
  };
}

function enhanceRow(row, detail, leadership, regimeCode, policy) {
  const next = JSON.parse(JSON.stringify(row));
  next.baseDecisionScore = round(num(row.decisionScore, 0), 1);
  next.leadership = leadership;
  next.sources = uniq(next.sources || []);
  next.strategies = uniq(next.strategies || []);
  next.strategyFamilies = uniq(next.strategyFamilies || []);
  next.evidence = Array.isArray(next.evidence) ? next.evidence : [];

  if ((leadership.relativeStrengthComposite || 0) >= 80 && leadership.nearAvailableHigh) {
    next.sources.push('V18_RS_LEADERSHIP_SHADOW');
    next.strategies.push('RELATIVE_STRENGTH_HIGH_PROXIMITY');
    next.strategyFamilies.push('LEADERSHIP');
    next.evidence.push({ source: 'V18_RS_LEADERSHIP_SHADOW', sourceWeight: 18, strategyId: 'RELATIVE_STRENGTH_HIGH_PROXIMITY', strategyLabelAr: 'قيادة نسبية قرب القمة', status: 'RESEARCH_ONLY', score: leadership.leadershipScore, noteAr: leadership.full52WeekCoverage ? 'تأكيد قيادة نسبية قرب قمة 52 أسبوع.' : 'تأكيد قيادة نسبية قرب أعلى تاريخ متاح؛ 52-week proxy فقط.' });
  }
  if (leadership.vcp?.passed) {
    next.sources.push('V18_VCP_SHADOW');
    next.strategies.push('VOLATILITY_CONTRACTION_PATTERN');
    next.strategyFamilies.push('VOLATILITY_CONTRACTION');
    next.evidence.push({ source: 'V18_VCP_SHADOW', sourceWeight: 20, strategyId: 'VOLATILITY_CONTRACTION_PATTERN', strategyLabelAr: 'انكماش تذبذب', status: 'RESEARCH_ONLY', score: leadership.leadershipScore, noteAr: 'تأكيد انكماش نطاق مع جفاف حجم داخل اتجاه صاعد.' });
  }
  next.sources = uniq(next.sources);
  next.strategies = uniq(next.strategies);
  next.strategyFamilies = uniq(next.strategyFamilies);

  const matrix = policy.strategyRegimeMatrix || DEFAULT_MATRIX;
  const compat = compatibilityFor(next, regimeCode, matrix);
  next.regimeCompatibility = { regime: compat.regime, score: round(compat.score, 2), families: compat.families };

  const leadAdj = leadership.leadershipScore >= 90 ? 5 : leadership.leadershipScore >= 80 ? 3 : leadership.leadershipScore >= 70 ? 1 : 0;
  const vcpAdj = leadership.vcp?.passed ? 3 : 0;
  const highAdj = leadership.nearAvailableHigh ? 1 : 0;
  const regimeAdj = clamp((num(compat.score, 0.65) - 0.70) * 10, -5, 4);
  const totalAdj = clamp(leadAdj + vcpAdj + highAdj + regimeAdj, -6, 8);
  next.scoreAdjustments = { leadership: leadAdj, vcp: vcpAdj, highProximity: highAdj, regimeCompatibility: round(regimeAdj, 1), total: round(totalAdj, 1) };
  next.decisionScore = round(clamp(num(next.baseDecisionScore, 0) + totalAdj, 0, 100), 1);

  const cfg = policy.leadership || {};
  const isBaseTierA = String(row.tier || '').includes('TIER_A');
  const isBaseTierB = String(row.tier || '').includes('TIER_B');
  const researchPromotion = !isBaseTierA && !isBaseTierB
    && leadership.researchSetupEligible
    && next.decisionScore >= num(cfg.researchTierBMinimumScore, 68)
    && num(compat.score, 0) >= num(cfg.minimumRegimeCompatibilityForResearchTierB, 0.75)
    && ['RISK_ON', 'NEUTRAL'].includes(compat.regime);

  if (researchPromotion) {
    next.tier = 'TIER_B_RESEARCH_LEADERSHIP';
    next.decisionLabelAr = 'مرشح Leadership/VCP بحثي للجلسة التالية — ليس Pilot مثبتًا';
  }
  return next;
}

function updateLedger(output, stocks) {
  const ledger = readJson(LEDGER_PATH, { schemaVersion: '18.1.0-shadow-forward', createdAt: new Date().toISOString(), entries: [] }) || { schemaVersion: '18.1.0-shadow-forward', entries: [] };
  ledger.schemaVersion = '18.1.0-shadow-forward';
  ledger.updatedAt = new Date().toISOString();
  ledger.entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  const byKey = new Map(ledger.entries.map(x => [`${x.issued?.sessionId}:${x.issued?.ticker}`, x]));

  for (const row of output.actionable || []) {
    const key = `${output.sessionId}:${row.ticker}`;
    if (byKey.has(key)) continue;
    const entry = {
      id: key,
      issued: {
        sessionId: output.sessionId,
        ticker: row.ticker,
        rank: row.rank,
        tier: row.tier,
        decisionScore: row.decisionScore,
        referenceClose: row.technical?.price ?? null,
        sources: row.sources || [],
        strategyFamilies: row.strategyFamilies || [],
        preferredPlan: row.execution?.preferredPlan || null,
        leadership: row.leadership ? {
          score: row.leadership.leadershipScore,
          relativeStrengthComposite: row.leadership.relativeStrengthComposite,
          highReferenceLabel: row.leadership.highReferenceLabel,
          distanceFromAvailableHighPct: row.leadership.distanceFromAvailableHighPct,
          vcpPassed: Boolean(row.leadership.vcp?.passed)
        } : null
      },
      evaluation: {
        status: 'PENDING_NEXT_SESSION',
        mode: 'REFERENCE_FORWARD_ONLY_NO_OPEN_CONFIRMATION',
        sessionsObserved: 0,
        closeToCloseReturn1Pct: null,
        closeToCloseReturn3Pct: null,
        closeToCloseReturn5Pct: null,
        noteAr: 'لا يتم احتساب Win/Loss من OHLC وحدها لأن تأكيد الافتتاح شرط إلزامي ولم يُسجل بعد.'
      }
    };
    ledger.entries.push(entry);
    byKey.set(key, entry);
  }

  for (const entry of ledger.entries) {
    const issued = entry.issued || {};
    const detail = stocks.get(safeTicker(issued.ticker));
    const chart = detail?.chart || {};
    const dates = Array.isArray(chart.dates) ? chart.dates : [];
    const closes = Array.isArray(chart.close) ? chart.close : [];
    const signalIdx = dates.indexOf(issued.sessionId);
    if (signalIdx < 0 || signalIdx >= closes.length) continue;
    const future = closes.slice(signalIdx + 1).map(Number).filter(Number.isFinite);
    const ref = num(issued.referenceClose, num(closes[signalIdx]));
    const ret = n => future.length >= n && ref > 0 ? ((future[n - 1] / ref) - 1) * 100 : null;
    entry.evaluation = {
      status: future.length ? 'OBSERVING' : 'PENDING_NEXT_SESSION',
      mode: 'REFERENCE_FORWARD_ONLY_NO_OPEN_CONFIRMATION',
      sessionsObserved: future.length,
      closeToCloseReturn1Pct: round(ret(1), 2),
      closeToCloseReturn3Pct: round(ret(3), 2),
      closeToCloseReturn5Pct: round(ret(5), 2),
      noteAr: 'Reference returns فقط. لا يتم تحويلها إلى نتيجة صفقة قبل تسجيل تأكيد الافتتاح والتنفيذ الفعلي.'
    };
  }

  ledger.summary = {
    totalIssued: ledger.entries.length,
    pendingNextSession: ledger.entries.filter(x => x.evaluation?.status === 'PENDING_NEXT_SESSION').length,
    observing: ledger.entries.filter(x => x.evaluation?.status === 'OBSERVING').length,
    immutableIssueSnapshots: true
  };
  writeJson(LEDGER_PATH, ledger);
  return ledger;
}

function main() {
  const policy = readJson(POLICY_PATH, {});
  const base = readJson(OUT_PATH, null);
  if (!base) throw new Error('V18 base output missing. Run v18-global-strategy-ensemble.cjs first.');
  const stocks = loadStockDetails();
  if (stocks.size < 100) throw new Error(`Canonical stock coverage too low: ${stocks.size}`);

  const cfg = policy.leadership || {};
  const r20 = [...stocks.values()].map(x => num(x?.indicators?.return20Pct)).filter(Number.isFinite).sort((a, b) => a - b);
  const r50 = [...stocks.values()].map(x => num(x?.indicators?.return50Pct)).filter(Number.isFinite).sort((a, b) => a - b);
  const universes = { r20, r50 };
  const leadershipByTicker = new Map();
  for (const [ticker, detail] of stocks.entries()) leadershipByTicker.set(ticker, computeLeadership(detail, universes, cfg));

  const regimeCode = base.marketRegime?.code || 'NEUTRAL';
  const merged = new Map();
  for (const row of [...(base.actionable || []), ...(base.watch || [])]) merged.set(row.ticker, enhanceRow(row, stocks.get(row.ticker) || {}, leadershipByTicker.get(row.ticker) || {}, regimeCode, policy));

  for (const [ticker, detail] of stocks.entries()) {
    if (merged.has(ticker)) continue;
    const leadership = leadershipByTicker.get(ticker);
    if (!leadership?.researchSetupEligible) continue;
    const row = newResearchRow(ticker, detail, leadership);
    const enhanced = enhanceRow(row, detail, leadership, regimeCode, policy);
    merged.set(ticker, enhanced);
  }

  const results = [...merged.values()]
    .sort((a, b) => num(b.decisionScore, 0) - num(a.decisionScore, 0) || (b.sources?.length || 0) - (a.sources?.length || 0) || a.ticker.localeCompare(b.ticker));
  results.forEach((row, idx) => { row.rank = idx + 1; });
  const publishLimit = num(policy.decision?.maximumPublishedCandidates, 25);
  const actionableFull = results.filter(row => !String(row.tier || '').includes('TIER_C'));
  const watchFull = results.filter(row => String(row.tier || '').includes('TIER_C'));

  base.schemaVersion = '18.1.0-shadow';
  base.mode = 'GLOBAL_STRATEGY_ENSEMBLE_SHADOW_WITH_LEADERSHIP';
  base.generatedAt = new Date().toISOString();
  base.architecture = {
    ...(base.architecture || {}),
    activeFamilies: uniq(results.flatMap(row => row.strategyFamilies || [])),
    independentSources: uniq(results.flatMap(row => row.sources || [])),
    leadershipLayer: 'cross-sectional RS + available-history high proxy + VCP + regime compatibility',
    highLabelIntegrity: '52_WEEK_HIGH is used only when >=220 sessions are available; otherwise AVAILABLE_HISTORY_HIGH_PROXY is explicit.'
  };
  const leadershipEligible = [...leadershipByTicker.values()].filter(x => x.researchSetupEligible).length;
  const vcpEligible = [...leadershipByTicker.values()].filter(x => x.vcp?.passed).length;
  const nearHighLeaders = [...leadershipByTicker.values()].filter(x => (x.relativeStrengthComposite || 0) >= 80 && x.nearAvailableHigh).length;
  base.counts = {
    ...(base.counts || {}),
    candidatesMergedBeforePublishLimit: results.length,
    actionableOrConditional: actionableFull.length,
    watchOnly: watchFull.length,
    leadershipResearchEligible: leadershipEligible,
    vcpEligible,
    relativeStrengthNearHighLeaders: nearHighLeaders
  };
  base.leadershipSummary = {
    crossSectionalUniverse: stocks.size,
    return20Universe: r20.length,
    return50Universe: r50.length,
    leadershipResearchEligible: leadershipEligible,
    vcpEligible,
    relativeStrengthNearHighLeaders: nearHighLeaders,
    full52WeekCoverageCount: [...leadershipByTicker.values()].filter(x => x.full52WeekCoverage).length,
    proxyHighCoverageCount: [...leadershipByTicker.values()].filter(x => !x.full52WeekCoverage).length
  };
  base.strategyRegimeMatrix = policy.strategyRegimeMatrix || DEFAULT_MATRIX;
  base.actionable = actionableFull.slice(0, publishLimit);
  base.watch = watchFull.slice(0, publishLimit);
  base.allCandidates = results.slice(0, publishLimit);

  const ledger = updateLedger(base, stocks);
  base.forwardLedgerSummary = ledger.summary;
  base.diagnostics = {
    ...(base.diagnostics || {}),
    forwardLedgerPolicy: 'Issue snapshots are immutable. Until morning confirmation is captured, only reference close-to-close forward returns are calculated.',
    leadershipEvidencePolicy: 'RS/high-proximity/VCP are research features. They may promote to Tier B Research but can never create Tier A by themselves.'
  };

  writeJson(OUT_PATH, base);
  console.log(JSON.stringify({
    schemaVersion: base.schemaVersion,
    sessionId: base.sessionId,
    regime: base.marketRegime,
    counts: base.counts,
    leadershipSummary: base.leadershipSummary,
    forwardLedgerSummary: base.forwardLedgerSummary,
    top: base.allCandidates.slice(0, 10).map(x => ({ ticker: x.ticker, tier: x.tier, score: x.decisionScore, rs: x.leadership?.relativeStrengthComposite, vcp: x.leadership?.vcp?.passed, highDist: x.leadership?.distanceFromAvailableHighPct, compatibility: x.regimeCompatibility?.score }))
  }, null, 2));
}

main();
