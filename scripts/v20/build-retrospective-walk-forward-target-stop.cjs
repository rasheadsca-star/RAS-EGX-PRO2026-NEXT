#!/usr/bin/env node
'use strict';

/**
 * V20 retrospective point-in-time reconstruction.
 *
 * IMPORTANT GOVERNANCE CONTRACT
 * - Diagnostic only: this file never mutates V20 live ranking or execution state.
 * - Every feature document is truncated at signalDate before V20 helpers are called.
 * - The outcome row is used only after the historical selection is frozen in memory.
 * - Results are NOT Fresh Independent Forward evidence and cannot promote/calibrate V20.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  liquidity,
  srScore,
  plan,
  technical,
  dataScore,
} = require('./build-full-market-native-selection.cjs');
const { evaluateDocument } = require('./build-full-market-native-technical.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(ROOT, rel);
const OUT = 'data/v20/retrospective-walk-forward-target-stop.json';

function read(rel, fallback = null) {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); }
  catch (error) { if (fallback !== null) return fallback; throw error; }
}
function write(rel, obj) {
  fs.mkdirSync(path.dirname(P(rel)), { recursive: true });
  fs.writeFileSync(P(rel), JSON.stringify(obj, null, 2) + '\n');
}
function n(value) { const x = Number(value); return Number.isFinite(x) ? x : null; }
function round(value, digits = 2) {
  const x = n(value); if (x === null) return null;
  const m = 10 ** digits; return Math.round(x * m) / m;
}
function sym(value) { return String(value || '').trim().toUpperCase(); }
function isoDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null; }
function clamp(value, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, Number(value))); }
function pw(value, points) {
  const x = n(value); if (x === null) return null;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1], [x2, y2] = points[i];
    if (x <= x2) return y1 + (y2 - y1) * (x - x1) / (x2 - x1);
  }
  return points[points.length - 1][1];
}
const rrScore = value => pw(value, [[0,0],[.25,20],[.5,35],[1,55],[1.5,70],[2,82],[3,95],[4,100]]);

function hashObject(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function loadHistoryDocuments() {
  const dir = P('data/history');
  const map = new Map();
  if (!fs.existsSync(dir)) throw new Error('data/history is missing; sync MAIN APP point-in-time OHLC first');
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    let doc;
    try { doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); }
    catch { continue; }
    const ticker = sym(doc.ticker || doc.symbol || path.basename(file, '.json'));
    const sessions = Array.isArray(doc.sessions) ? doc.sessions : [];
    if (!ticker || !sessions.length) continue;
    const clean = sessions
      .filter(r => isoDate(r.date) && n(r.open) > 0 && n(r.high) > 0 && n(r.low) > 0 && n(r.close) > 0 && n(r.volume) !== null)
      .map(r => ({ ...r, ticker, date: String(r.date) }))
      .sort((a,b) => a.date.localeCompare(b.date));
    if (!clean.length) continue;
    map.set(ticker, { ...doc, ticker, sessions: clean });
  }
  return map;
}

function buildComparableDates(audit) {
  const sessions = Array.isArray(audit?.sessions) ? audit.sessions : [];
  const rows = sessions
    .map(s => ({ signalDate: isoDate(s.signalDate), outcomeDate: isoDate(s.outcomeDate) }))
    .filter(s => s.signalDate && s.outcomeDate);
  if (rows.length >= 10) return rows;
  throw new Error('Comparable V16.9 audit dates unavailable; refuse to invent a retrospective window');
}

function replayHistoryForLiquidity(rows, signalDate) {
  return rows
    .filter(r => r.date < signalDate)
    .map(r => ({
      ...r,
      // Historical value-traded is not stored in the trusted OHLC documents.
      // close*volume is a deterministic point-in-time approximation, never future-derived.
      valueTraded: round(n(r.close) * n(r.volume), 4),
      turnover: round(n(r.close) * n(r.volume), 4),
    }));
}

function buildHistoricalTech(ticker, doc, signalRow, signalDate) {
  const scopedRows = doc.sessions.filter(r => r.date <= signalDate);
  const truncated = {
    ...doc,
    ticker,
    sessions: scopedRows,
    availableSessions: scopedRows.length,
    firstSession: scopedRows[0]?.date || null,
    lastSession: scopedRows.at(-1)?.date || null,
    // Preserve verified identity from the trusted history source only.
    symbolVerified: doc.symbolVerified === true,
  };
  const market = {
    ticker,
    price: n(signalRow.close),
    close: n(signalRow.close),
    open: n(signalRow.open),
    high: n(signalRow.high),
    low: n(signalRow.low),
    volume: n(signalRow.volume),
    sessionDate: signalDate,
  };
  return evaluateDocument(
    ticker,
    market,
    truncated,
    'CACHED_VERIFIED_HISTORY_DOCUMENT',
    [{ provider: doc.primarySource || 'trusted_history', state: 'RETROSPECTIVE_POINT_IN_TIME' }],
    'RETROSPECTIVE_REPLAY_ONLY',
    signalDate,
  );
}

function weightedScore(parts, weights) {
  let numerator = 0, denominator = 0;
  for (const [key, weight0] of Object.entries(weights || {})) {
    const weight = Number(weight0 || 0), score = n(parts[key]);
    if (!(weight > 0) || score === null) continue;
    numerator += score * weight;
    denominator += weight;
  }
  return { score: denominator ? numerator / denominator : null, availableWeightPct: denominator };
}

function tieMeta(candidate, policy) {
  const tp = candidate.tradePlan || {};
  const state = tp.alignment?.state || 'UNKNOWN';
  const priorities = policy.rankingDiscrimination?.alignmentPriority || {
    IN_ENTRY_RANGE: 0,
    BELOW_ENTRY_RANGE_WAITING: 1,
    ABOVE_ENTRY_RANGE_DO_NOT_CHASE: 2,
    UNKNOWN: 3,
  };
  const price = n(candidate.price), lo = n(tp.entryLow), hi = n(tp.entryHigh);
  let distance = null;
  if (state === 'IN_ENTRY_RANGE') distance = 0;
  else if (state === 'ABOVE_ENTRY_RANGE_DO_NOT_CHASE' && price !== null && hi > 0) distance = (price - hi) / hi * 100;
  else if (state === 'BELOW_ENTRY_RANGE_WAITING' && price !== null && lo > 0) distance = (lo - price) / lo * 100;
  return {
    alignmentSafetyPriority: Number(priorities[state] ?? priorities.UNKNOWN ?? 3),
    scoreBeforeRegimeAndCaps: n(candidate.scoreBeforeRegimeAndCaps),
    entryDistancePct: round(distance, 3),
    netRiskReward: n(tp.netRiskReward),
    liquidity2Score: n(candidate.liquidityScore),
    srConfluenceScore: n(candidate.srScore),
    technicalScore: n(candidate.technicalScore),
    discoveryScore: n(candidate.discoveryScore),
  };
}

function compareCandidates(a, b, policy) {
  let d = (n(b.score) ?? -1) - (n(a.score) ?? -1);
  if (d) return d;
  const x = tieMeta(a, policy), y = tieMeta(b, policy);
  d = x.alignmentSafetyPriority - y.alignmentSafetyPriority; if (d) return d;
  d = (n(y.scoreBeforeRegimeAndCaps) ?? -Infinity) - (n(x.scoreBeforeRegimeAndCaps) ?? -Infinity); if (d) return d;
  d = (n(x.entryDistancePct) ?? Infinity) - (n(y.entryDistancePct) ?? Infinity); if (d) return d;
  for (const key of ['netRiskReward','liquidity2Score','srConfluenceScore','technicalScore','discoveryScore']) {
    d = (n(y[key]) ?? -Infinity) - (n(x[key]) ?? -Infinity); if (d) return d;
  }
  return a.ticker.localeCompare(b.ticker);
}

function evaluateOutcome(candidate, outcomeRow) {
  const open = n(outcomeRow?.open), high = n(outcomeRow?.high), low = n(outcomeRow?.low), close = n(outcomeRow?.close);
  const entryLow = n(candidate.tradePlan?.entryLow), entryHigh = n(candidate.tradePlan?.entryHigh);
  const stop = n(candidate.tradePlan?.stop), target1 = n(candidate.tradePlan?.target1);
  if (!(open > 0 && high > 0 && low > 0 && close > 0 && entryLow > 0 && entryHigh >= entryLow && stop > 0 && target1 > entryHigh)) {
    return { outcomeAvailable: false, executableByOpenRule: false, targetTouched: false, stopTouched: false, ambiguousSameDay: false, conservativeTargetHit: false };
  }
  const executable = open <= entryHigh && open >= stop;
  const targetTouched = executable && high >= target1;
  const stopTouched = executable && low <= stop;
  const ambiguous = targetTouched && stopTouched;
  return {
    outcomeAvailable: true,
    nextOpen: round(open,4), nextHigh: round(high,4), nextLow: round(low,4), nextClose: round(close,4),
    executableByOpenRule: executable,
    targetTouched,
    stopTouched,
    ambiguousSameDay: ambiguous,
    conservativeTargetHit: targetTouched && !stopTouched,
    nextCloseReturnPct: executable ? round((close - entryHigh) / entryHigh * 100, 4) : null,
  };
}

function main() {
  const policyRoot = read('data/v20/decision-intelligence-policy.json');
  const p = policyRoot.fullMarketNativeSelection;
  const audit = read('data/research/v16-v169-target-hit-audit.json');
  const universe = read('data/v20/master-universe.json');
  const historyDocs = loadHistoryDocuments();
  const datePairs = buildComparableDates(audit);
  const universeTickers = (universe.rows || []).map(r => sym(r.ticker)).filter(Boolean);
  if (!p || p.engineId !== 'V20_FULL_MARKET_NATIVE_SELECTION_V1') throw new Error('Frozen V20 full-market native policy missing/drift');
  if (p.rankingDiscrimination?.contract !== 'V20_SAFETY_STRENGTH_LEXICOGRAPHIC_TIE_BREAK_V2') throw new Error('V20 ranking freeze contract drift');
  if (p.legacySeedDependency !== false || p.candidateUniverseIsFullMarketIndependent !== true) throw new Error('V20 full-market independence contract drift');

  const fw = policyRoot.componentWeightsPct;
  const finalWeights = {
    dataEvidence: Number(fw.dataEvidence || 0),
    liquidity: Number(fw.liquidity || 0),
    supportResistance: Number(fw.supportResistance || 0),
    netRiskReward: Number(fw.netRiskReward || 0),
    tradePlanAlignment: Number(fw.tradePlanAlignment || 0),
    currentTechnical: Number(fw.currentTechnical || 0),
  };
  const approvedNonLegacyWeightPct = Object.values(finalWeights).reduce((a,b) => a+b, 0);
  if (approvedNonLegacyWeightPct !== 90 || finalWeights.liquidity !== 30 || finalWeights.supportResistance !== 12) {
    throw new Error('Approved V20 non-legacy weights drift');
  }

  const sessions = [];
  let allMembers = [];

  for (const pair of datePairs) {
    const { signalDate, outcomeDate } = pair;
    const candidates = [];
    let pointInTimeTickerCount = 0;

    for (const ticker of universeTickers) {
      const doc = historyDocs.get(ticker);
      if (!doc || doc.symbolVerified !== true) continue;
      const signalRow = doc.sessions.find(r => r.date === signalDate);
      const outcomeRow = doc.sessions.find(r => r.date === outcomeDate);
      if (!signalRow || !outcomeRow) continue;
      pointInTimeTickerCount++;

      const price = n(signalRow.close), volume = n(signalRow.volume);
      if (!(price > 0 && volume > 0)) continue;
      const turnoverApprox = price * volume;
      const marketRow = {
        ticker,
        sessionDate: signalDate,
        price,
        volume,
        turnover: turnoverApprox,
        trades: 0, // unavailable historically; intentionally conservative and declared in fidelity block
        currentSessionAvailable: true,
        semanticCompleteness: true,
        criticalFieldCompletenessPct: 100,
        sourceConflict: false,
      };

      const techDoc = buildHistoricalTech(ticker, doc, signalRow, signalDate);
      const ta = technical(techDoc);
      const replayHistory = { sessionsBySymbol: { [ticker]: replayHistoryForLiquidity(doc.sessions, signalDate) } };
      const liq = liquidity(marketRow, replayHistory, signalDate, p.liquidity2);
      const data = dataScore(marketRow);
      // Deliberately do not import historical V17 pivots/external validation because no point-in-time archive is guaranteed.
      // srScore therefore uses only V20 trusted OHLC pivot + trusted swing + ATR, preventing future leakage.
      const sr = srScore(marketRow, techDoc, null, p.supportResistanceConfluence);
      const tp = plan(marketRow, sr, techDoc, p.tradePlan);
      const techScore = n(ta.score), rr = tp.valid ? n(tp.netRiskReward) : null;
      const parts = {
        dataEvidence: n(data.score),
        liquidity: n(liq.score),
        supportResistance: n(sr.score),
        netRiskReward: rr === null ? null : rrScore(rr),
        tradePlanAlignment: tp.available ? n(tp.alignment?.score) : null,
        currentTechnical: techScore,
      };
      const final = weightedScore(parts, finalWeights);
      const discovery = weightedScore({
        dataEvidence: parts.dataEvidence,
        liquidity: parts.liquidity,
        supportResistance: parts.supportResistance,
        currentTechnical: parts.currentTechnical,
      }, p.discoveryWeightsPct);

      let score = final.score === null ? null : round(final.score, 1);
      const scoreBeforeRegimeAndCaps = score;
      // Historical regime was not archived point-in-time. Use the frozen policy's UNVERIFIED regime = 0 only.
      const regimePoints = Number(p.regimeOverlay?.points?.UNVERIFIED_CURRENT_REGIME || 0);
      if (score !== null) score += regimePoints;
      const caps = [];
      if (tp.alignment?.state === 'ABOVE_ENTRY_RANGE_DO_NOT_CHASE') {
        const maxScore = Number(policyRoot.defensiveCaps?.aboveEntryRangeDoNotChaseMaxScore || 55);
        score = score === null ? null : Math.min(score, maxScore);
        caps.push({ code: 'ABOVE_ENTRY_RANGE_DO_NOT_CHASE', maxScore });
      }
      score = score === null ? null : round(clamp(score), 1);

      const preselectionEligible = data.available === true && n(data.score) >= Number(p.minimumDataEvidenceScore || 70) && liq.shortTermEligible === true;
      const structurallyReady = preselectionEligible && ta.available === true && sr.available === true && Number(sr.confluence?.methodCount || 0) >= Number(p.minimumSrMethodCount || 2);
      const recommendationEligible = structurallyReady && tp.valid === true && final.availableWeightPct === approvedNonLegacyWeightPct && score !== null && score >= Number(p.minimumFinalResearchScore || 50);
      if (!recommendationEligible) continue;

      const candidate = {
        ticker,
        signalDate,
        outcomeDate,
        price: round(price,4),
        score,
        scoreBeforeRegimeAndCaps,
        discoveryScore: round(discovery.score,1),
        liquidityScore: round(liq.score,1),
        srScore: round(sr.score,1),
        srMethodCount: Number(sr.confluence?.methodCount || 0),
        technicalScore: round(techScore,1),
        dataScore: round(data.score,1),
        tradePlan: {
          entryLow: n(tp.entryLow), entryHigh: n(tp.entryHigh), stop: n(tp.stop), target1: n(tp.target1), target2: n(tp.target2),
          netRiskReward: n(tp.netRiskReward), alignment: tp.alignment,
        },
        caps,
        reconstruction: {
          historyRowsVisibleAtSignal: doc.sessions.filter(r => r.date <= signalDate).length,
          latestFeatureDate: techDoc.asOfSession || null,
          futureFeatureRowsUsed: 0,
          historicalTurnoverApproximation: 'CLOSE_X_VOLUME',
          historicalTrades: 'UNAVAILABLE_SET_TO_ZERO_CONSERVATIVELY',
          historicalRegime: 'UNVERIFIED_ZERO_OVERLAY',
          historicalV17Pivot: 'NOT_USED_NO_GUARANTEED_POINT_IN_TIME_ARCHIVE',
        },
      };
      candidate.tieBreak = tieMeta(candidate, p);
      candidate.outcome = evaluateOutcome(candidate, outcomeRow);
      candidates.push(candidate);
    }

    candidates.sort((a,b) => compareCandidates(a,b,p));
    const selected = candidates.slice(0, 3).map((c, i) => ({ ...c, rank: i + 1 }));
    allMembers = allMembers.concat(selected);
    sessions.push({
      signalDate,
      outcomeDate,
      reconstructedUniverseTickerCount: pointInTimeTickerCount,
      eligibleCandidateCount: candidates.length,
      selectionCount: selected.length,
      tickers: selected.map(x => x.ticker),
      members: selected,
    });
  }

  const selections = allMembers.filter(m => m.outcome?.outcomeAvailable === true);
  const executable = selections.filter(m => m.outcome.executableByOpenRule === true);
  const noEntry = selections.filter(m => m.outcome.executableByOpenRule !== true);
  const rawTargets = executable.filter(m => m.outcome.targetTouched === true);
  const conservativeTargets = executable.filter(m => m.outcome.conservativeTargetHit === true);
  const stops = executable.filter(m => m.outcome.stopTouched === true);
  const ambiguous = executable.filter(m => m.outcome.ambiguousSameDay === true);
  const pct = (num, den) => den ? round(num / den * 100, 2) : null;
  const closeReturns = executable.map(m => n(m.outcome.nextCloseReturnPct)).filter(v => v !== null);

  const out = {
    schemaVersion: '20.0.0-retrospective-point-in-time-target-stop-1',
    engineId: p.engineId,
    rankingContract: p.rankingDiscrimination.contract,
    generatedAt: new Date().toISOString(),
    evidenceClass: 'RETROSPECTIVE_POINT_IN_TIME_RECONSTRUCTION',
    status: 'DIAGNOSTIC_ONLY_NOT_FRESH_FORWARD',
    retrospective: true,
    freshIndependentForward: false,
    changesRanking: false,
    changesExecutionPermission: false,
    changesProductionAllocation: false,
    changesProfessionalReadiness: false,
    usedForCalibrationClaim: false,
    productionPromotionEligible: false,
    method: 'Replay frozen V20 full-market native selection session-by-session using only trusted OHLC rows available at each signal date; freeze top 3; then audit next-session OHLC with the standardized conservative open/target/stop contract.',
    comparisonContract: {
      selectedPerSession: 3,
      horizonSessions: 1,
      entryRule: 'NEXT_OPEN_LE_ENTRY_HIGH_AND_GE_STOP',
      sameSessionTargetStopAmbiguity: 'COUNT_AS_STOP_NOT_CONSERVATIVE_TARGET',
      targetMetric: 'CONSERVATIVE_TARGET_HIT',
      rateDenominator: 'EXECUTABLE_BY_OPEN_RULE',
    },
    auditWindow: {
      requestedSessions: datePairs.length,
      completedSessions: sessions.filter(s => s.selectionCount > 0).length,
      fromSignalDate: datePairs[0]?.signalDate || null,
      toSignalDate: datePairs.at(-1)?.signalDate || null,
      lastOutcomeDate: datePairs.at(-1)?.outcomeDate || null,
    },
    summary: {
      selectionCount: selections.length,
      executableByOpenRuleCount: executable.length,
      notExecutableByOpenRuleCount: noEntry.length,
      notExecutableByOpenRulePct: pct(noEntry.length, selections.length),
      rawTargetTouchCount: rawTargets.length,
      rawTargetTouchRateOfExecutablePct: pct(rawTargets.length, executable.length),
      conservativeTargetHitCount: conservativeTargets.length,
      conservativeTargetHitRateOfExecutablePct: pct(conservativeTargets.length, executable.length),
      stopTouchedCount: stops.length,
      stopTouchRateOfExecutablePct: pct(stops.length, executable.length),
      ambiguousTargetAndStopSameDayCount: ambiguous.length,
      averageNextCloseReturnPct: closeReturns.length ? round(closeReturns.reduce((a,b)=>a+b,0) / closeReturns.length, 4) : null,
      positiveNextCloseReturnPct: closeReturns.length ? pct(closeReturns.filter(x=>x>0).length, closeReturns.length) : null,
    },
    fidelity: {
      grade: 'MEDIUM_RETROSPECTIVE_DIAGNOSTIC',
      historicalDataCutAtSignalDate: true,
      futureFeatureRowsUsed: 0,
      trustedPerSymbolOhlcUsed: true,
      frozenV20WeightsUsed: true,
      frozenV20RankingContractUsed: true,
      currentUniverseReconstructedHistorically: false,
      survivorshipBiasPossible: true,
      actualHistoricalValueTradedAvailable: false,
      turnoverApproximation: 'CLOSE_X_VOLUME',
      historicalTradeCountAvailable: false,
      tradeCountTreatment: 'ZERO_CONSERVATIVE',
      historicalMarketRegimeArchiveAvailable: false,
      regimeTreatment: 'UNVERIFIED_ZERO_OVERLAY',
      historicalV17PivotArchiveGuaranteed: false,
      v17PivotTreatment: 'NOT_USED_V20_TRUSTED_OHLC_PIVOT_FALLBACK_ONLY',
      historicalSemanticConflictArchiveGuaranteed: false,
      sourceConflictTreatment: 'TRUSTED_HISTORY_IDENTITY_ONLY_NO_RETROSPECTIVE_CONFLICT_PENALTY',
    },
    limitationsAr: [
      'هذه محاكاة Retrospective Point-in-Time وليست Fresh Forward؛ لا تُستخدم للترقية أو الادعاء بالمعايرة.',
      'عضوية السوق التاريخية الكاملة غير مؤرشفة؛ أُعيد البناء من Master Universe الحالي، لذلك يوجد احتمال Survivorship Bias.',
      'قيمة التداول التاريخية الدقيقة وعدد الصفقات غير محفوظين في ملفات OHLC؛ استُخدم Close×Volume لقيمة التداول وعدد الصفقات = 0 بشكل محافظ.',
      'لم يُستخدم Market Regime تاريخي أو V17 Pivot تاريخي لعدم ضمان Point-in-Time archive؛ استُخدم V20 trusted-OHLC fallback فقط لمنع Look-Ahead.',
      'Daily OHLC لا يحدد أيهما حدث أولًا إذا لمس الهدف والوقف في اليوم نفسه؛ الحالة المزدوجة تُحسب وقفًا في النتيجة المحافظة.',
    ],
    sourceHashes: {
      policy: hashObject(policyRoot),
      masterUniverse: hashObject(universe),
      comparableDateAudit: hashObject({ auditWindow: audit.auditWindow, sessions: datePairs }),
    },
    sessions,
  };

  write(OUT, out);
  console.log(JSON.stringify({
    status: out.status,
    window: out.auditWindow,
    summary: out.summary,
    fidelity: out.fidelity,
  }, null, 2));
  return out;
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.stack || error.message); process.exit(1); }
}
module.exports = { main, evaluateOutcome, compareCandidates, tieMeta };
