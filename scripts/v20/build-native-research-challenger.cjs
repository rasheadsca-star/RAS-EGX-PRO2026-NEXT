#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);

function read(rel, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; }
}
function write(rel, value) {
  const file = P(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function round(value, digits = 2) {
  const n = finite(value);
  if (n === null) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}
function clamp(value, min = 0, max = 100) {
  const n = finite(value);
  if (n === null) return null;
  return Math.max(min, Math.min(max, n));
}
function avg(values) {
  const clean = values.map(finite).filter(v => v !== null);
  return clean.length ? clean.reduce((sum, v) => sum + v, 0) / clean.length : null;
}
function piecewise(value, points) {
  const n = finite(value);
  if (n === null) return null;
  if (n <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    if (n <= x2) {
      const t = (n - x1) / (x2 - x1);
      return y1 + (y2 - y1) * t;
    }
  }
  return points[points.length - 1][1];
}
function symbol(value) {
  return String(value || '').trim().toUpperCase().replace(/\.CA$/, '').replace(/[^A-Z0-9.]/g, '');
}
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')); }
function component(name, weightPct, score, provenance, evidence = {}) {
  const normalized = score === null ? null : clamp(score);
  return {
    name,
    weightPct,
    available: normalized !== null,
    score: normalized === null ? null : round(normalized, 1),
    weightedPoints: normalized === null ? 0 : round(normalized * weightPct / 100, 3),
    provenance,
    evidence,
  };
}
function weightedSubscore(parts, weights) {
  let numerator = 0;
  let denominator = 0;
  for (const [key, weight] of Object.entries(weights || {})) {
    const score = finite(parts[key]);
    if (score === null) continue;
    numerator += score * Number(weight || 0);
    denominator += Number(weight || 0);
  }
  return {
    score: denominator > 0 ? numerator / denominator : null,
    evidenceCoveragePct: denominator,
  };
}
function ratio(a, b) {
  const x = finite(a), y = finite(b);
  return x !== null && y !== null && y > 0 ? x / y : null;
}
function relativeDiffPct(a, b) {
  const x = finite(a), y = finite(b);
  if (!(x > 0 && y > 0)) return null;
  return Math.abs(x - y) / ((x + y) / 2) * 100;
}
function median(values) {
  const clean = values.map(finite).filter(v => v !== null).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function completedLiquidityHistory(history, ticker, sessionDate) {
  const rows = Array.isArray(history?.sessionsBySymbol?.[ticker]) ? history.sessionsBySymbol[ticker] : [];
  return rows
    .filter(row => validDate(row?.date) && (!sessionDate || String(row.date) < sessionDate))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-20);
}

function buildLiquidity2(profile, history, policy) {
  const liq = profile.liquidity || {};
  if (liq.evidenceAvailable !== true || finite(liq.liquidityScore) === null) return {
    score: null, evidenceCoveragePct: 0, available: false,
    reason: 'V17_LIQUIDITY_EVIDENCE_UNAVAILABLE', subcomponents: {},
  };

  const turnoverRatio = ratio(liq.currentTurnover, liq.avg20Turnover);
  const volumeRatio = ratio(liq.currentVolume, liq.avg20Volume);
  const historyRows = completedLiquidityHistory(history, profile.ticker, profile.sessionDate);
  const continuityEligible = historyRows.filter(row => {
    const turnover = finite(row?.valueTraded ?? row?.turnover);
    const volume = finite(row?.volume);
    return turnover !== null && volume !== null;
  });
  const continuityPct = continuityEligible.length
    ? continuityEligible.filter(row => finite(row?.valueTraded ?? row?.turnover) >= policy.continuityMinimumTurnover && finite(row?.volume) > 0).length / continuityEligible.length * 100
    : null;

  const parts = {
    absoluteV17Score: clamp(liq.liquidityScore),
    turnoverVs20: piecewise(turnoverRatio, [[0,0],[0.25,20],[0.5,40],[0.8,65],[1,80],[1.5,95],[2,100]]),
    volumeVs20: piecewise(volumeRatio, [[0,0],[0.25,20],[0.5,40],[0.8,65],[1,80],[1.5,95],[2,100]]),
    tradeActivity: piecewise(liq.trades, [[0,0],[25,25],[50,50],[100,80],[200,100],[400,100]]),
    continuity20: continuityPct,
  };
  const weighted = weightedSubscore(parts, policy.subWeightsPct);
  let score = weighted.score;
  const caps = [];
  if (liq.sessionAligned !== true && score !== null) {
    score = Math.min(score, policy.misalignedSessionMaxScore);
    caps.push({ code: 'LIQUIDITY_SESSION_MISMATCH', maxScore: policy.misalignedSessionMaxScore });
  } else if (liq.executionEligible !== true && liq.conditionalEligible === true && score !== null) {
    score = Math.min(score, policy.conditionalMaxScore);
    caps.push({ code: 'V17_CONDITIONAL_LIQUIDITY_ONLY', maxScore: policy.conditionalMaxScore });
  } else if (liq.executionEligible !== true && score !== null) {
    const maxScore = String(liq.liquidityDecision || '').includes('BLOCKED') ? policy.blockedIlliquidMaxScore : policy.watchOnlyMaxScore;
    score = Math.min(score, maxScore);
    caps.push({ code: 'V17_LIQUIDITY_NOT_EXECUTION_ELIGIBLE', maxScore });
  }

  return {
    score: score === null ? null : round(score, 1),
    available: score !== null,
    evidenceCoveragePct: round(weighted.evidenceCoveragePct, 1),
    scoringContract: policy.scoringContract,
    subcomponents: Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, value === null ? null : round(value, 1)])),
    metrics: {
      currentTurnover: finite(liq.currentTurnover), avg20Turnover: finite(liq.avg20Turnover), turnoverVs20: round(turnoverRatio, 3),
      currentVolume: finite(liq.currentVolume), avg20Volume: finite(liq.avg20Volume), volumeVs20: round(volumeRatio, 3),
      trades: finite(liq.trades), continuity20Pct: round(continuityPct, 1), continuitySessionsUsed: continuityEligible.length,
      v17LiquidityScore: finite(liq.liquidityScore), v17Decision: liq.liquidityDecision || null,
      v17ExecutionEligible: liq.executionEligible === true, v17ConditionalEligible: liq.conditionalEligible === true,
      sessionAligned: liq.sessionAligned === true,
    },
    caps,
    provenance: {
      authority: 'data/v17/liquidity-gate.json', history: 'data/history.json',
      currentProfile: 'data/v20/stock-profiles.json',
    },
  };
}

function trustedHistoryRows(technicalHistoryMap, ticker, sessionDate) {
  const item = technicalHistoryMap.get(ticker);
  if (!item || item.sessionAligned !== true || item.priceReconciled !== true) return [];
  return (Array.isArray(item.rows) ? item.rows : [])
    .filter(row => validDate(row?.date) && (!sessionDate || row.date <= sessionDate))
    .filter(row => [row.open, row.high, row.low, row.close].every(v => finite(v) > 0))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-60);
}

function detectSwingLevel(rows, currentPrice, atr, kind) {
  if (rows.length < 7 || !(currentPrice > 0)) return null;
  const candidates = [];
  for (let i = 2; i < rows.length - 2; i += 1) {
    const row = rows[i];
    if (kind === 'support') {
      const value = finite(row.low);
      if (value > 0 && value <= currentPrice && value <= finite(rows[i-1].low) && value <= finite(rows[i-2].low) && value <= finite(rows[i+1].low) && value <= finite(rows[i+2].low)) {
        candidates.push({ value, date: row.date, index: i });
      }
    } else {
      const value = finite(row.high);
      if (value > 0 && value >= currentPrice && value >= finite(rows[i-1].high) && value >= finite(rows[i-2].high) && value >= finite(rows[i+1].high) && value >= finite(rows[i+2].high)) {
        candidates.push({ value, date: row.date, index: i });
      }
    }
  }
  if (!candidates.length) return null;
  const tolerance = Math.max(currentPrice * 0.01, finite(atr) > 0 ? atr * 0.35 : 0);
  const enriched = candidates.map(candidate => {
    const touches = rows.filter(row => {
      const value = kind === 'support' ? finite(row.low) : finite(row.high);
      return value !== null && Math.abs(value - candidate.value) <= tolerance;
    }).length;
    const distancePct = Math.abs(candidate.value - currentPrice) / currentPrice * 100;
    const sessionsAgo = rows.length - 1 - candidate.index;
    const strength = touches * 18 + Math.max(0, 18 - sessionsAgo * 0.5) - Math.min(20, distancePct);
    return { ...candidate, touches, distancePct, sessionsAgo, strength };
  });
  enriched.sort((a, b) => b.strength - a.strength || b.touches - a.touches || a.distancePct - b.distancePct || b.date.localeCompare(a.date));
  const best = enriched[0];
  return {
    value: round(best.value, 4), date: best.date, touches: best.touches,
    distancePct: round(best.distancePct, 2), sessionsAgo: best.sessionsAgo,
    tolerance: round(tolerance, 4),
  };
}

function externalValidationScore(srRow) {
  const states = [srRow?.externalValidation?.direct?.state, srRow?.externalValidation?.rendered?.state].filter(Boolean);
  if (!states.length || states.every(state => state === 'UNAVAILABLE')) return { score: null, state: 'UNAVAILABLE' };
  if (states.includes('CURRENT_CRITICAL_CONFLICT')) return { score: 0, state: 'CURRENT_CRITICAL_CONFLICT' };
  if (states.includes('CURRENT_MATCH')) return { score: 100, state: 'CURRENT_MATCH' };
  if (states.includes('CURRENT_DIVERGENCE')) return { score: 55, state: 'CURRENT_DIVERGENCE' };
  if (states.includes('STALE_REFERENCE_ONLY')) return { score: 35, state: 'STALE_REFERENCE_ONLY' };
  return { score: null, state: states[0] || 'UNAVAILABLE' };
}

function methodConfluenceScore(methods, price, atr, swing) {
  if (!methods.length) return { score: null, methodCount: 0, pairScores: [], tolerancePct: null, touchStrength: null };
  if (methods.length === 1) return { score: 45, methodCount: 1, pairScores: [], tolerancePct: null, touchStrength: null };
  const atrPct = price > 0 && finite(atr) > 0 ? atr / price * 100 : null;
  const tolerancePct = clamp(atrPct === null ? 1.5 : atrPct * 0.75, 1, 4);
  const pairScores = [];
  for (let i = 0; i < methods.length; i += 1) {
    for (let j = i + 1; j < methods.length; j += 1) {
      const supportDiff = relativeDiffPct(methods[i].support, methods[j].support);
      const resistanceDiff = relativeDiffPct(methods[i].resistance, methods[j].resistance);
      const meanDiff = avg([supportDiff, resistanceDiff]);
      if (meanDiff === null) continue;
      const multiple = meanDiff / tolerancePct;
      pairScores.push({
        methods: [methods[i].name, methods[j].name],
        meanDiffPct: round(meanDiff, 2),
        score: round(piecewise(multiple, [[0,100],[1,90],[2,65],[3,40],[4,15],[6,0]]), 1),
      });
    }
  }
  const pairAverage = avg(pairScores.map(row => row.score));
  const touchStrength = swing
    ? avg([
        piecewise(swing.support?.touches, [[0,0],[1,35],[2,60],[3,80],[4,95],[6,100]]),
        piecewise(swing.resistance?.touches, [[0,0],[1,35],[2,60],[3,80],[4,95],[6,100]]),
      ])
    : null;
  let score = avg([pairAverage, touchStrength]);
  if (score === null) score = pairAverage;
  if (methods.length === 2 && score !== null) score = Math.min(score, 90);
  return {
    score: score === null ? null : round(score, 1), methodCount: methods.length,
    pairScores, tolerancePct: round(tolerancePct, 2), touchStrength: touchStrength === null ? null : round(touchStrength, 1),
  };
}

function buildSrConfluence(profile, srRow, technicalHistoryMap, policy) {
  if (!srRow || !(finite(srRow.support1) > 0) || !(finite(srRow.resistance1) > 0)) return {
    score: null, available: false, evidenceCoveragePct: 0, reason: 'V17_INTERNAL_SR_UNAVAILABLE', methods: [], subcomponents: {},
  };
  const price = finite(profile.price);
  if (!(price > 0)) return { score: null, available: false, evidenceCoveragePct: 0, reason: 'CURRENT_PRICE_UNAVAILABLE', methods: [], subcomponents: {} };

  const technicalRows = trustedHistoryRows(technicalHistoryMap, profile.ticker, profile.sessionDate);
  const atr = finite(profile.technicalAnalysis?.atr14);
  const pivotMethod = {
    name: 'V17_CLASSIC_PIVOT', support: finite(srRow.support1), resistance: finite(srRow.resistance1),
    support2: finite(srRow.support2), resistance2: finite(srRow.resistance2), pivot: finite(srRow.pivot),
  };
  const swingSupport = detectSwingLevel(technicalRows, price, atr, 'support');
  const swingResistance = detectSwingLevel(technicalRows, price, atr, 'resistance');
  const swing = swingSupport && swingResistance ? { support: swingSupport, resistance: swingResistance } : null;
  const swingMethod = swing ? { name: 'TRUSTED_SWING_TOUCH_STRUCTURE', support: swing.support.value, resistance: swing.resistance.value } : null;
  const atrMethod = technicalRows.length && atr > 0 && price - atr > 0
    ? { name: 'ATR_VOLATILITY_STRUCTURE', support: round(price - atr, 4), resistance: round(price + atr, 4) }
    : null;
  const methods = [pivotMethod, swingMethod, atrMethod].filter(method => method && method.support > 0 && method.resistance > method.support);
  const confluence = methodConfluenceScore(methods, price, atr, swing);

  const confRaw = finite(srRow.confidence);
  const confidence = confRaw === null ? null : clamp(confRaw <= 1 ? confRaw * 100 : confRaw);
  const sessionFreshness = profile.supportResistance?.sessionAligned === true && srRow.freshness === 'LATEST_COMPLETED_SESSION'
    ? 100 : profile.supportResistance?.sessionAligned === true ? 70 : srRow.freshness === 'LATEST_COMPLETED_SESSION' ? 45 : 20;
  const trustedPivotSource = srRow?.provenance?.trustedForExecution === true;
  const historyDepth = Math.max(Number(srRow?.provenance?.historySessions || 0), technicalRows.length);
  let sourceHistoryQuality = trustedPivotSource ? 65 : 30;
  if (trustedPivotSource && historyDepth >= 50) sourceHistoryQuality = 100;
  else if (trustedPivotSource && historyDepth >= 30) sourceHistoryQuality = 90;
  else if (trustedPivotSource && historyDepth >= 20) sourceHistoryQuality = 80;
  else if (technicalRows.length >= 50) sourceHistoryQuality = 90;
  else if (technicalRows.length >= 30) sourceHistoryQuality = 80;
  else if (technicalRows.length >= 20) sourceHistoryQuality = 70;

  const support = finite(srRow.support1), resistance = finite(srRow.resistance1);
  const supportDistancePct = support > 0 ? (price - support) / price * 100 : null;
  const resistanceDistancePct = resistance > 0 ? (resistance - price) / price * 100 : null;
  let priceGeometry = 0;
  if (support < price && resistance > price) {
    const maxDistance = Math.max(supportDistancePct, resistanceDistancePct);
    priceGeometry = maxDistance <= 20 ? 100 : maxDistance <= 35 ? 80 : maxDistance <= 50 ? 60 : 40;
  }
  const external = externalValidationScore(srRow);

  const parts = {
    confidence,
    sessionFreshness,
    sourceHistoryQuality,
    priceGeometry,
    methodConfluence: confluence.score,
    externalValidation: external.score,
  };
  const weighted = weightedSubscore(parts, policy.subWeightsPct);
  let score = weighted.score;
  const caps = [];
  if (confluence.methodCount < 2 && score !== null) {
    score = Math.min(score, policy.singleMethodMaximumScore);
    caps.push({ code: 'SINGLE_METHOD_ONLY', maxScore: policy.singleMethodMaximumScore });
  }

  return {
    score: score === null ? null : round(score, 1), available: score !== null,
    evidenceCoveragePct: round(weighted.evidenceCoveragePct, 1), scoringContract: policy.scoringContract,
    subcomponents: Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, value === null ? null : round(value, 1)])),
    methods: methods.map(method => ({ ...method })),
    confluence,
    swing,
    metrics: {
      currentPrice: price, atr14: atr, trustedHistoryRows: technicalRows.length,
      support1: support, resistance1: resistance,
      supportDistancePct: round(supportDistancePct, 2), resistanceDistancePct: round(resistanceDistancePct, 2),
      v17Confidence: confRaw, v17ExecutionEligible: srRow.executionEligible === true,
      sessionAligned: profile.supportResistance?.sessionAligned === true,
      freshness: srRow.freshness || null, methodology: srRow.methodology || null,
      externalValidationState: external.state,
    },
    caps,
    provenance: {
      pivotAuthority: 'data/v17/internal-ohlc-support-resistance.json',
      trustedHistory: 'data/v20/technical-history.json',
      currentProfile: 'data/v20/stock-profiles.json',
    },
  };
}

function tier(score, coveragePct, policy) {
  if (finite(score) === null || finite(coveragePct) === null || coveragePct < policy.minimumEvidenceCoverageForTierPct) return 'UNRATED_INSUFFICIENT_EVIDENCE';
  if (score >= policy.tierThresholds.RESEARCH_A) return 'RESEARCH_A';
  if (score >= policy.tierThresholds.RESEARCH_B) return 'RESEARCH_B';
  if (score >= policy.tierThresholds.RESEARCH_C) return 'RESEARCH_C';
  return 'RESEARCH_D';
}

function main() {
  const profiles = read('data/v20/stock-profiles.json', null);
  const current = read('data/v20/current.json', {});
  const decisionPolicy = read('data/v20/decision-intelligence-policy.json', {});
  const liquidityHistory = read('data/history.json', { sessionsBySymbol: {} });
  const internalSr = read('data/v17/internal-ohlc-support-resistance.json', { rows: [] });
  const technicalHistory = read('data/v20/technical-history.json', { symbols: [] });
  const marketRegime = read('data/v20/market-regime.json', {});
  const challengerGate = read('data/v17/challenger-status.json', {});

  if (!profiles || !Array.isArray(profiles.profiles)) throw new Error('V20 stock profiles missing for native challenger');
  const nativePolicy = decisionPolicy.nativeChallenger;
  if (!nativePolicy || nativePolicy.status !== 'SHADOW_RESEARCH_ONLY_UNCALIBRATED') throw new Error('V20 native challenger policy missing');
  const weights = decisionPolicy.componentWeightsPct || {};
  if (Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0) !== 100) throw new Error('V20 native challenger component weights must sum to 100');
  if (Object.values(nativePolicy.liquidity2?.subWeightsPct || {}).reduce((sum, value) => sum + Number(value || 0), 0) !== 100) throw new Error('Liquidity 2.0 subweights must sum to 100');
  if (Object.values(nativePolicy.supportResistanceConfluence?.subWeightsPct || {}).reduce((sum, value) => sum + Number(value || 0), 0) !== 100) throw new Error('S/R confluence subweights must sum to 100');

  const srMap = new Map((internalSr.rows || []).map(row => [symbol(row.symbol), row]));
  const techMap = new Map((technicalHistory.symbols || []).map(row => [symbol(row.ticker), row]));
  const baselineRank = new Map((profiles.researchDecisionRanking || []).map(row => [symbol(row.ticker), Number(row.rank)]));
  const profileResults = [];

  for (const profile of profiles.profiles) {
    const ticker = symbol(profile.ticker);
    const baseline = profile.decisionIntelligence || {};
    const baselineComponents = baseline.components || {};
    const liquidity2 = buildLiquidity2(profile, liquidityHistory, nativePolicy.liquidity2);
    const srConfluence = buildSrConfluence(profile, srMap.get(ticker), techMap, nativePolicy.supportResistanceConfluence);
    const components = {
      legacyOpportunity: { ...baselineComponents.legacyOpportunity },
      dataEvidence: { ...baselineComponents.dataEvidence },
      liquidity: component('V20_LIQUIDITY_2_0', weights.liquidity, liquidity2.score, 'data/v17/liquidity-gate.json + data/history.json', liquidity2),
      supportResistance: component('V20_SR_CONFLUENCE', weights.supportResistance, srConfluence.score, 'data/v17/internal-ohlc-support-resistance.json + data/v20/technical-history.json', srConfluence),
      netRiskReward: { ...baselineComponents.netRiskReward },
      tradePlanAlignment: { ...baselineComponents.tradePlanAlignment },
      currentTechnical: { ...baselineComponents.currentTechnical },
    };
    const available = Object.values(components).filter(item => item?.available === true && finite(item.score) !== null);
    const availableWeight = available.reduce((sum, item) => sum + Number(item.weightPct || 0), 0);
    const weightedPoints = available.reduce((sum, item) => sum + Number(item.weightedPoints || 0), 0);
    let baseScore = availableWeight > 0 ? weightedPoints / availableWeight * 100 : null;
    const regime = marketRegime.verified === true && marketRegime.asOfSessionDate === profiles.sessionDate ? marketRegime.regime : 'UNVERIFIED_CURRENT_REGIME';
    const regimePoints = Number(nativePolicy.regimeOverlay?.points?.[regime] || 0);
    let score = baseScore === null ? null : baseScore + regimePoints;
    const scoreAfterRegimeBeforeCaps = score === null ? null : round(clamp(score), 1);
    const caps = Array.isArray(baseline.scoreCaps) ? baseline.scoreCaps.map(row => ({ ...row })) : [];
    for (const cap of caps) if (score !== null && finite(cap.maxScore) !== null) score = Math.min(score, Number(cap.maxScore));
    score = score === null ? null : round(clamp(score), 1);
    const coveragePct = round(availableWeight, 1);
    const baselineScore = finite(baseline.researchDecisionScore);
    const legacyPoints = components.legacyOpportunity?.available ? Number(components.legacyOpportunity.weightedPoints || 0) : 0;
    const legacyContributionPct = weightedPoints > 0 ? round(legacyPoints / weightedPoints * 100, 1) : null;

    const result = {
      engineId: nativePolicy.engineId,
      status: nativePolicy.status,
      nativeResearchScore: score,
      nativeResearchScoreBeforeRegimeAndCaps: baseScore === null ? null : round(baseScore, 1),
      nativeResearchScoreAfterRegimeBeforeCaps: scoreAfterRegimeBeforeCaps,
      nativeResearchTier: tier(score, coveragePct, decisionPolicy),
      scoreIsConfidence: false,
      scoreEvidenceCoveragePct: coveragePct,
      legacyContributionPctOfWeightedPoints: legacyContributionPct,
      baselineResearchScore: baselineScore,
      scoreDeltaVsBaseline: baselineScore === null || score === null ? null : round(score - baselineScore, 1),
      components,
      upgradedEvidence: { liquidity2, supportResistanceConfluence: srConfluence },
      regimeOverlay: {
        regime,
        verified: marketRegime.verified === true && marketRegime.asOfSessionDate === profiles.sessionDate,
        points: regimePoints,
        canOpenExecutionGate: false,
      },
      scoreCaps: caps,
      governance: {
        researchOnly: true,
        executionPermission: false,
        productionAllocation: false,
        automaticPromotion: false,
        canChangeChampion: false,
        activeProductionChampion: current?.governance?.activeChampion || null,
        permissionSource: 'data/v17/resilient-session-status.json',
        issuedStatusUnchanged: profile.status,
      },
      provenance: {
        policy: 'data/v20/decision-intelligence-policy.json',
        baseline: 'data/v20/stock-profiles.json#decisionIntelligence',
        liquidityAuthority: 'data/v17/liquidity-gate.json',
        srAuthority: 'data/v17/internal-ohlc-support-resistance.json',
        trustedHistory: 'data/v20/technical-history.json',
        regime: 'data/v20/market-regime.json',
      },
    };
    profile.nativeChallenger = result;
    profileResults.push({ ticker, profile, result });
  }

  const ranking = [...profileResults]
    .sort((a, b) => (finite(b.result.nativeResearchScore) ?? -1) - (finite(a.result.nativeResearchScore) ?? -1) || a.profile.rank - b.profile.rank)
    .map((row, index) => {
      const oldRank = baselineRank.get(row.ticker) || null;
      const rank = index + 1;
      return {
        rank,
        ticker: row.ticker,
        baselineResearchRank: oldRank,
        rankDeltaVsBaseline: oldRank === null ? null : oldRank - rank,
        legacyRank: row.profile.rank,
        nativeResearchScore: row.result.nativeResearchScore,
        baselineResearchScore: row.result.baselineResearchScore,
        scoreDeltaVsBaseline: row.result.scoreDeltaVsBaseline,
        nativeResearchTier: row.result.nativeResearchTier,
        issuedStatus: row.profile.status,
        liquidity2Score: row.result.upgradedEvidence.liquidity2.score,
        supportResistanceConfluenceScore: row.result.upgradedEvidence.supportResistanceConfluence.score,
        srMethodCount: row.result.upgradedEvidence.supportResistanceConfluence.confluence?.methodCount || 0,
      };
    });
  const newRankMap = new Map(ranking.map(row => [row.ticker, row.rank]));
  for (const row of profileResults) {
    const newRank = newRankMap.get(row.ticker) || null;
    const oldRank = baselineRank.get(row.ticker) || null;
    row.result.nativeRank = newRank;
    row.result.baselineResearchRank = oldRank;
    row.result.rankDeltaVsBaseline = oldRank === null || newRank === null ? null : oldRank - newRank;
  }

  const top5 = ranking.slice(0, 5);
  const baselineTop5 = (profiles.researchDecisionRanking || []).slice(0, 5).map(row => symbol(row.ticker));
  const overlapTop5 = top5.filter(row => baselineTop5.includes(row.ticker)).length;
  const risers = [...ranking].filter(row => finite(row.rankDeltaVsBaseline) > 0).sort((a, b) => b.rankDeltaVsBaseline - a.rankDeltaVsBaseline).slice(0, 5);
  const fallers = [...ranking].filter(row => finite(row.rankDeltaVsBaseline) < 0).sort((a, b) => a.rankDeltaVsBaseline - b.rankDeltaVsBaseline).slice(0, 5);
  const scoreDeltas = ranking.map(row => row.scoreDeltaVsBaseline).filter(v => finite(v) !== null);

  const regressionChecks = {
    componentWeightsSum100: Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0) === 100,
    liquidityWeight30: Number(weights.liquidity) === 30,
    supportResistanceWeight12: Number(weights.supportResistance) === 12,
    legacyWeight10: Number(weights.legacyOpportunity) === 10,
    candidateCountPreserved: ranking.length === profiles.profileCount,
    allScoresBounded: ranking.every(row => finite(row.nativeResearchScore) === null || (row.nativeResearchScore >= 0 && row.nativeResearchScore <= 100)),
    allRanksUnique: new Set(ranking.map(row => row.rank)).size === ranking.length,
    activeChampionProtected: (current?.governance?.activeChampion || null) === 'V16_9_EQUAL_WEIGHT_BASKET',
    automaticPromotionDisabled: nativePolicy.governance?.automaticPromotion === false && current?.governance?.automaticPromotion === false,
    productionAllocationDisabled: nativePolicy.governance?.productionAllocation === false,
    executionPermissionDisabled: nativePolicy.governance?.executionPermission === false,
    baselineRankingPreserved: Array.isArray(profiles.researchDecisionRanking) && profiles.researchDecisionRanking.length === profiles.profileCount,
    universeDependencyDisclosed: nativePolicy.candidateUniverseIsFullMarketIndependent === false && nativePolicy.legacySeedDependencyExplicit === true,
    liquiditySessionMismatchCapped: profileResults.every(({ result }) => result.upgradedEvidence.liquidity2.metrics?.sessionAligned !== false || finite(result.upgradedEvidence.liquidity2.score) === null || result.upgradedEvidence.liquidity2.score <= nativePolicy.liquidity2.misalignedSessionMaxScore),
    baselineDefensiveCapsPreserved: profileResults.every(({ result }) => !result.scoreCaps.length || finite(result.nativeResearchScore) === null || result.scoreCaps.every(cap => finite(cap.maxScore) === null || result.nativeResearchScore <= Number(cap.maxScore))),
    issuedStatusesUntouched: profileResults.every(({ profile, result }) => result.governance.issuedStatusUnchanged === profile.status),
    scoreConfidenceSeparated: profileResults.every(({ result }) => result.scoreIsConfidence === false),
  };
  const failedChecks = Object.entries(regressionChecks).filter(([, passed]) => passed !== true).map(([name]) => name);

  profiles.nativeChallenger = {
    schemaVersion: '20.0.0-native-challenger-1',
    generatedAt: new Date().toISOString(),
    sessionDate: profiles.sessionDate,
    engineId: nativePolicy.engineId,
    status: nativePolicy.status,
    decisionSupportOnly: true,
    candidateUniverse: nativePolicy.candidateUniverse,
    candidateUniverseIsFullMarketIndependent: false,
    legacySeedDependencyExplicit: true,
    activeProductionChampion: current?.governance?.activeChampion || null,
    automaticPromotion: false,
    productionAllocation: false,
    executionPermission: false,
    calibrationStatus: 'FORWARD_AND_INDEPENDENT_HOLDOUT_REQUIRED_BEFORE_PRODUCTION_USE',
    promotionGateReference: {
      source: 'data/v17/challenger-status.json',
      methodology: challengerGate?.criteria?.methodology || 'BLOCKED_WALK_FORWARD_WITH_INDEPENDENT_HOLDOUT',
      minimumSessions: finite(challengerGate?.criteria?.minimumSessions),
      minimumIndependentHoldoutSessions: finite(challengerGate?.criteria?.minimumIndependentHoldoutSessions),
      automaticPromotionForbidden: true,
    },
    scoring: {
      componentWeightsPct: weights,
      liquidity2Contract: nativePolicy.liquidity2.scoringContract,
      supportResistanceConfluenceContract: nativePolicy.supportResistanceConfluence.scoringContract,
      regimeOverlay: nativePolicy.regimeOverlay,
    },
    summary: {
      candidates: ranking.length,
      medianNativeResearchScore: round(median(ranking.map(row => row.nativeResearchScore)), 1),
      medianScoreDeltaVsBaseline: round(median(scoreDeltas), 1),
      top5OverlapWithBaseline: overlapTop5,
      liquidity2AvailableCount: profileResults.filter(row => row.result.upgradedEvidence.liquidity2.available).length,
      srConfluenceAvailableCount: profileResults.filter(row => row.result.upgradedEvidence.supportResistanceConfluence.available).length,
      srMultiMethodCount: profileResults.filter(row => (row.result.upgradedEvidence.supportResistanceConfluence.confluence?.methodCount || 0) >= 2).length,
      srThreeMethodCount: profileResults.filter(row => (row.result.upgradedEvidence.supportResistanceConfluence.confluence?.methodCount || 0) >= 3).length,
    },
    top5,
    biggestRisers: risers,
    biggestFallers: fallers,
    ranking,
    regression: {
      ok: failedChecks.length === 0,
      failedCount: failedChecks.length,
      failedChecks,
      checks: regressionChecks,
    },
    note: 'This challenger does not replace the baseline research ranking or the V16.9 production Champion. It upgrades liquidity and S/R evidence side-by-side for forward and independent holdout evaluation.',
  };

  write('data/v20/stock-profiles.json', profiles);
  console.log(JSON.stringify({
    engineId: profiles.nativeChallenger.engineId,
    sessionDate: profiles.sessionDate,
    summary: profiles.nativeChallenger.summary,
    top5: profiles.nativeChallenger.top5,
    regression: profiles.nativeChallenger.regression,
  }, null, 2));
  if (failedChecks.length) throw new Error(`V20 native challenger regression failed: ${failedChecks.join(', ')}`);
  return profiles.nativeChallenger;
}

if (require.main === module) main();
module.exports = { main, buildLiquidity2, buildSrConfluence, detectSwingLevel, methodConfluenceScore };
