import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const repoRoot = path.basename(cwd) === 'tfe-v20' ? path.resolve(cwd, '..') : cwd;
const auditPath = path.join(repoRoot, 'data/research/v16-v169-target-hit-audit.json');
const historyDir = path.join(repoRoot, 'data/history');
const outPath = path.join(repoRoot, 'tfe-v20/reports/v16-loss-anatomy-audit.json');

const MIN_HISTORY = 60;
const MIN_MARKET_UNIVERSE = 60;
const MIN_FEATURE_ROWS = 90;
const MIN_EXECUTABLE_ROWS = 60;
const MIN_EXTREME_EXECUTABLE = 20;
const MIN_FOLD_EXTREME_EXECUTABLE = 8;
const MATERIAL_EDGE_DIFF_PP = 10;
const MATERIAL_RETURN_DIFF_PP = 1.0;
const MIN_STABLE_FOLDS = 2;
const EDGE_NEAR_TIE_PP = 2;

const LOCKED_FAMILIES = new Set(['ENTRY_HEAT', 'MARKET_BREADTH', 'RAW_MOMENTUM', 'RAW_PULLBACK']);

const FEATURES = [
  { key: 'rsi14', family: 'ENTRY_HEAT' },
  { key: 'ema20ExtensionAtr', family: 'ENTRY_HEAT' },
  { key: 'distanceTo20dHighPct', family: 'RAW_PULLBACK' },
  { key: 'return5Pct', family: 'RAW_MOMENTUM' },
  { key: 'return20Pct', family: 'RAW_MOMENTUM' },
  { key: 'ema20Vs50Pct', family: 'RAW_MOMENTUM' },
  { key: 'atr14Pct', family: 'VOLATILITY' },
  { key: 'medianTurnover20', family: 'LIQUIDITY' },
  { key: 'volumeRatio20', family: 'LIQUIDITY' },
  { key: 'entryZoneWidthAtr', family: 'GEOMETRY' },
  { key: 'stopDistanceAtr', family: 'GEOMETRY' },
  { key: 'targetDistanceAtr', family: 'GEOMETRY' },
  { key: 'structuralRR', family: 'GEOMETRY' },
  { key: 'breadth20Pct', family: 'MARKET_BREADTH' },
  { key: 'breadth50Pct', family: 'MARKET_BREADTH' },
  { key: 'positive20Pct', family: 'MARKET_BREADTH' },
  { key: 'medianMarketReturn20Pct', family: 'MARKET_BREADTH' }
];

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function round(v, d = 3) { return Number.isFinite(v) ? Number(v.toFixed(d)) : null; }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  const w = pos - lo;
  return s[lo] * (1 - w) + s[hi] * w;
}
function pct(a, b) { return Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? (a / b - 1) * 100 : null; }
function finite(v) { return Number.isFinite(v); }
function dateOk(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }

function adjustedBars(doc) {
  return (doc?.sessions || []).map(x => {
    const close = Number(x.close), adj = Number(x.adjustedClose ?? x.close);
    const factor = close > 0 && adj > 0 ? adj / close : 1;
    return {
      date: String(x.date || ''),
      open: Number(x.open) * factor,
      high: Number(x.high) * factor,
      low: Number(x.low) * factor,
      close: adj,
      volume: Math.max(0, Number(x.volume || 0))
    };
  }).filter(x => dateOk(x.date) && x.open > 0 && x.high > 0 && x.low > 0 && x.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = mean(values.slice(0, period));
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi14(bars) {
  const p = 14;
  if (bars.length < p + 1) return null;
  const deltas = [];
  for (let i = 1; i < bars.length; i++) deltas.push(bars[i].close - bars[i - 1].close);
  let gain = mean(deltas.slice(0, p).map(v => Math.max(0, v)));
  let loss = mean(deltas.slice(0, p).map(v => Math.max(0, -v)));
  for (let i = p; i < deltas.length; i++) {
    gain = (gain * (p - 1) + Math.max(0, deltas[i])) / p;
    loss = (loss * (p - 1) + Math.max(0, -deltas[i])) / p;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function atr14(bars) {
  const p = 14;
  if (bars.length < p + 1) return null;
  const tr = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], prev = bars[i - 1].close;
    tr.push(Math.max(b.high - b.low, Math.abs(b.high - prev), Math.abs(b.low - prev)));
  }
  let a = mean(tr.slice(0, p));
  for (let i = p; i < tr.length; i++) a = (a * (p - 1) + tr[i]) / p;
  return a;
}

function featureSlice(bars, signalDate) {
  const slice = bars.filter(b => b.date <= signalDate);
  if (slice.length < MIN_HISTORY || slice.at(-1)?.date !== signalDate) return null;
  if (slice.some(b => b.date > signalDate)) throw new Error(`LOOKAHEAD_FEATURE_SLICE:${signalDate}`);
  const close = slice.at(-1).close;
  const closes = slice.map(b => b.close);
  const e20 = ema(closes, 20), e50 = ema(closes, 50), atr = atr14(slice), rsi = rsi14(slice);
  if (![close, e20, e50, atr, rsi].every(finite) || atr <= 0) return null;
  const last20 = slice.slice(-20), prior20 = slice.slice(-21, -1);
  const high20 = Math.max(...last20.map(b => b.high));
  const turnover = last20.map(b => b.close * b.volume).filter(finite);
  const priorVolumes = prior20.map(b => b.volume).filter(v => finite(v) && v > 0);
  const priorMedianVolume = median(priorVolumes);
  return {
    signalClose: close,
    rsi14: rsi,
    ema20ExtensionAtr: (close - e20) / atr,
    distanceTo20dHighPct: pct(close, high20),
    return5Pct: slice.length >= 6 ? pct(close, slice.at(-6).close) : null,
    return20Pct: slice.length >= 21 ? pct(close, slice.at(-21).close) : null,
    ema20Vs50Pct: pct(e20, e50),
    atr14: atr,
    atr14Pct: atr / close * 100,
    medianTurnover20: median(turnover),
    volumeRatio20: priorMedianVolume && priorMedianVolume > 0 ? slice.at(-1).volume / priorMedianVolume : null,
    aboveEma20: close > e20,
    aboveEma50: close > e50,
    positive20: slice.length >= 21 ? close > slice.at(-21).close : null,
    featureDate: slice.at(-1).date
  };
}

function geometry(member, signalClose, atr) {
  const entryLow = Number(member.entryLow), entryHigh = Number(member.entryHigh);
  const stop = Number(member.stopLoss), target = Number(member.target1);
  if (![entryLow, entryHigh, stop, target, signalClose, atr].every(v => finite(v) && v > 0)) {
    throw new Error(`MALFORMED_RECOMMENDATION_LEVELS:${member.ticker || 'UNKNOWN'}`);
  }
  const mid = (entryLow + entryHigh) / 2;
  const risk = mid - stop, reward = target - mid;
  return {
    entryZoneWidthAtr: (entryHigh - entryLow) / atr,
    stopDistanceAtr: (signalClose - stop) / atr,
    targetDistanceAtr: (target - signalClose) / atr,
    structuralRR: risk > 0 ? reward / risk : null
  };
}

function outcomeLabel(member) {
  if (!member.executableByOpenRule) return 'NO_ENTRY';
  if (member.stopTouched) return 'STOP';
  if (member.conservativeTargetHit) return 'TARGET';
  return 'OTHER';
}

function marketBreadth(docs, signalDate, cache) {
  if (cache.has(signalDate)) return cache.get(signalDate);
  const features = [];
  for (const { bars } of docs.values()) {
    const f = featureSlice(bars, signalDate);
    if (f) features.push(f);
  }
  const validReturns = features.map(f => f.return20Pct).filter(finite);
  const result = features.length >= MIN_MARKET_UNIVERSE ? {
    featureReadySymbols: features.length,
    breadth20Pct: features.filter(f => f.aboveEma20).length / features.length * 100,
    breadth50Pct: features.filter(f => f.aboveEma50).length / features.length * 100,
    positive20Pct: features.filter(f => f.positive20).length / features.length * 100,
    medianMarketReturn20Pct: median(validReturns)
  } : null;
  cache.set(signalDate, result);
  return result;
}

function summarizeOutcome(rows) {
  const executable = rows.filter(r => r.executable);
  const targets = executable.filter(r => r.outcome === 'TARGET').length;
  const stops = executable.filter(r => r.outcome === 'STOP').length;
  const closes = executable.map(r => r.nextCloseReturnPct).filter(finite);
  const positives = closes.filter(v => v > 0).length;
  return {
    rows: rows.length,
    executable: executable.length,
    noEntry: rows.filter(r => r.outcome === 'NO_ENTRY').length,
    targetRatePct: round(executable.length ? targets / executable.length * 100 : 0, 2),
    stopRatePct: round(executable.length ? stops / executable.length * 100 : 0, 2),
    targetMinusStopEdgePct: round(executable.length ? (targets - stops) / executable.length * 100 : 0, 2),
    positiveNextClosePct: round(closes.length ? positives / closes.length * 100 : 0, 2),
    averageNextCloseReturnPct: round(mean(closes), 4)
  };
}

function binFor(value, q1, q2) {
  if (!finite(value)) return null;
  if (value <= q1) return 'LOW';
  if (value > q2) return 'HIGH';
  return 'MID';
}

function compareExtreme(low, high) {
  const edgeDiff = (high.targetMinusStopEdgePct ?? 0) - (low.targetMinusStopEdgePct ?? 0);
  const returnDiff = (high.averageNextCloseReturnPct ?? 0) - (low.averageNextCloseReturnPct ?? 0);
  let higherQuality;
  if (Math.abs(edgeDiff) >= EDGE_NEAR_TIE_PP) higherQuality = edgeDiff > 0 ? 'HIGH' : edgeDiff < 0 ? 'LOW' : 'TIE';
  else higherQuality = returnDiff > 0 ? 'HIGH' : returnDiff < 0 ? 'LOW' : 'TIE';
  return { edgeDiffPp: round(edgeDiff, 2), averageNextCloseDiffPp: round(returnDiff, 4), higherQuality };
}

function splitDates(dates) {
  const folds = [];
  for (let i = 0; i < 3; i++) {
    const start = Math.floor(i * dates.length / 3);
    const end = Math.floor((i + 1) * dates.length / 3);
    folds.push(dates.slice(start, end));
  }
  return folds;
}

const audit = readJson(auditPath);
const docs = new Map();
for (const file of fs.readdirSync(historyDir).filter(f => f.endsWith('.json'))) {
  const doc = readJson(path.join(historyDir, file));
  const ticker = String(doc.ticker || file.replace(/\.json$/i, '')).toUpperCase();
  docs.set(ticker, { bars: adjustedBars(doc) });
}

const sessions = (audit.sessions || []).slice().sort((a, b) => String(a.signalDate).localeCompare(String(b.signalDate)));
if (!sessions.length) throw new Error('NO_V16_AUDIT_SESSIONS');
const dates = [...new Set(sessions.map(s => String(s.signalDate)))].sort();
for (const d of dates) if (!dateOk(d)) throw new Error(`MALFORMED_SIGNAL_DATE:${d}`);
const folds = splitDates(dates);
const breadthCache = new Map();
const rows = [];
let missingHistory = 0, missingExactSignalDate = 0;

for (const session of sessions) {
  const signalDate = String(session.signalDate);
  const market = marketBreadth(docs, signalDate, breadthCache);
  for (const member of session.members || []) {
    const ticker = String(member.ticker || '').toUpperCase();
    const doc = docs.get(ticker);
    if (!doc) { missingHistory++; continue; }
    const f = featureSlice(doc.bars, signalDate);
    if (!f) { missingExactSignalDate++; continue; }
    if (f.featureDate !== signalDate || f.featureDate > signalDate) throw new Error(`LOOKAHEAD_OR_STALE_FEATURE:${ticker}:${signalDate}:${f.featureDate}`);
    const g = geometry(member, f.signalClose, f.atr14);
    const outcome = outcomeLabel(member);
    const nextOpen = Number(member.nextOpen);
    let nextOpenLocation = null;
    if (finite(nextOpen) && nextOpen > 0) {
      if (nextOpen > Number(member.entryHigh)) nextOpenLocation = 'ABOVE_ENTRY_ZONE';
      else if (nextOpen < Number(member.entryLow)) nextOpenLocation = 'BELOW_ENTRY_ZONE';
      else nextOpenLocation = 'INSIDE_ENTRY_ZONE';
    }
    rows.push({
      signalDate,
      ticker,
      executable: Boolean(member.executableByOpenRule),
      outcome,
      nextCloseReturnPct: Number(member.nextCloseReturnPct),
      ...Object.fromEntries(Object.entries(f).filter(([k]) => !['atr14','featureDate','aboveEma20','aboveEma50','positive20'].includes(k))),
      ...g,
      ...(market || {}),
      exPost: {
        nextOpenGapPct: finite(nextOpen) ? pct(nextOpen, f.signalClose) : null,
        nextOpenLocation,
        targetTouched: Boolean(member.targetTouched),
        stopTouched: Boolean(member.stopTouched),
        ambiguousSameDay: Boolean(member.ambiguousSameDay)
      }
    });
  }
}

const featureDiagnostics = [];
for (const def of FEATURES) {
  const usable = rows.filter(r => finite(r[def.key]));
  const values = usable.map(r => r[def.key]);
  if (!values.length) continue;
  const q1 = quantile(values, 1 / 3), q2 = quantile(values, 2 / 3);
  const binned = { LOW: [], MID: [], HIGH: [] };
  for (const row of usable) binned[binFor(row[def.key], q1, q2)].push(row);
  const groups = Object.fromEntries(Object.entries(binned).map(([k, v]) => [k, summarizeOutcome(v)]));
  const fullCompare = compareExtreme(groups.LOW, groups.HIGH);
  const foldResults = folds.map((foldDates, idx) => {
    const set = new Set(foldDates);
    const foldBins = { LOW: [], MID: [], HIGH: [] };
    for (const row of usable) if (set.has(row.signalDate)) foldBins[binFor(row[def.key], q1, q2)].push(row);
    const fg = Object.fromEntries(Object.entries(foldBins).map(([k, v]) => [k, summarizeOutcome(v)]));
    const cmp = compareExtreme(fg.LOW, fg.HIGH);
    const sampleEligible = fg.LOW.executable >= MIN_FOLD_EXTREME_EXECUTABLE && fg.HIGH.executable >= MIN_FOLD_EXTREME_EXECUTABLE;
    const directionConsistent = sampleEligible && fullCompare.higherQuality !== 'TIE' && cmp.higherQuality === fullCompare.higherQuality;
    return {
      fold: idx + 1,
      from: foldDates[0] || null,
      to: foldDates.at(-1) || null,
      LOW: fg.LOW,
      HIGH: fg.HIGH,
      comparison: cmp,
      sampleEligible,
      directionConsistent
    };
  });
  const stableFolds = foldResults.filter(f => f.directionConsistent).length;
  const extremeMaterial = Math.abs(fullCompare.edgeDiffPp || 0) >= MATERIAL_EDGE_DIFF_PP || Math.abs(fullCompare.averageNextCloseDiffPp || 0) >= MATERIAL_RETURN_DIFF_PP;
  const checks = {
    featureReadyRowsAtLeast90: usable.length >= MIN_FEATURE_ROWS,
    executableRowsAtLeast60: usable.filter(r => r.executable).length >= MIN_EXECUTABLE_ROWS,
    lowExtremeExecutableAtLeast20: groups.LOW.executable >= MIN_EXTREME_EXECUTABLE,
    highExtremeExecutableAtLeast20: groups.HIGH.executable >= MIN_EXTREME_EXECUTABLE,
    materialExtremeSeparation: extremeMaterial,
    consistentDirectionAtLeast2Of3Folds: stableFolds >= MIN_STABLE_FOLDS
  };
  const stable = Object.values(checks).every(Boolean);
  const effectScore = Math.max(Math.abs(fullCompare.edgeDiffPp || 0) / MATERIAL_EDGE_DIFF_PP, Math.abs(fullCompare.averageNextCloseDiffPp || 0) / MATERIAL_RETURN_DIFF_PP);
  featureDiagnostics.push({
    feature: def.key,
    family: def.family,
    familyLockedByPriorRejectedExperiment: LOCKED_FAMILIES.has(def.family),
    boundaries: { q33: round(q1, 6), q67: round(q2, 6) },
    coverage: { featureReadyRows: usable.length, executableRows: usable.filter(r => r.executable).length },
    tertiles: groups,
    extremeComparison: fullCompare,
    foldResults,
    stableFolds,
    checks,
    status: stable ? 'STABLE_DIAGNOSTIC_PATTERN' : 'DESCRIPTIVE_ONLY',
    effectScore: round(effectScore, 4)
  });
}

featureDiagnostics.sort((a, b) => (b.effectScore || 0) - (a.effectScore || 0) || a.feature.localeCompare(b.feature));
const stablePatterns = featureDiagnostics.filter(f => f.status === 'STABLE_DIAGNOSTIC_PATTERN');
const unlockedStable = stablePatterns.filter(f => !f.familyLockedByPriorRejectedExperiment);
const byFamily = new Map();
for (const f of unlockedStable) {
  const existing = byFamily.get(f.family);
  if (!existing || (f.effectScore || 0) > (existing.effectScore || 0)) byFamily.set(f.family, f);
}
const familyCandidates = [...byFamily.entries()].map(([family, feature]) => ({
  family,
  strongestFeature: feature.feature,
  effectScore: feature.effectScore,
  betterExtreme: feature.extremeComparison.higherQuality,
  edgeDiffHighMinusLowPp: feature.extremeComparison.edgeDiffPp,
  averageNextCloseDiffHighMinusLowPp: feature.extremeComparison.averageNextCloseDiffPp,
  stableFolds: feature.stableFolds
})).sort((a, b) => (b.effectScore || 0) - (a.effectScore || 0));
const recommended = familyCandidates[0] || null;

const executionGroups = {};
for (const label of ['ABOVE_ENTRY_ZONE', 'INSIDE_ENTRY_ZONE', 'BELOW_ENTRY_ZONE', 'UNKNOWN']) {
  const rr = rows.filter(r => (r.exPost.nextOpenLocation || 'UNKNOWN') === label);
  executionGroups[label] = summarizeOutcome(rr);
}
const gapValues = rows.map(r => r.exPost.nextOpenGapPct).filter(finite);

const report = {
  schemaVersion: 'v16-loss-anatomy-audit-v1',
  generatedAt: new Date().toISOString(),
  evidenceClass: 'POSTHOC_DIAGNOSTIC_POINT_IN_TIME_FEATURE_ANATOMY',
  governance: {
    diagnosticOnly: true,
    thresholdsOutcomeOptimized: false,
    featureTertilesUseOutcomes: false,
    historicalWindowAlreadyObservedByResearchProgram: true,
    automaticPromotion: false,
    lockedRejectedFamilies: [...LOCKED_FAMILIES]
  },
  source: {
    v16Sessions: sessions.length,
    fromSignalDate: dates[0],
    toSignalDate: dates.at(-1),
    historyDocuments: docs.size
  },
  coverage: {
    joinedRows: rows.length,
    executableRows: rows.filter(r => r.executable).length,
    missingHistory,
    missingExactSignalDate
  },
  outcomeAnatomy: {
    allJoined: summarizeOutcome(rows),
    counts: Object.fromEntries(['NO_ENTRY','STOP','TARGET','OTHER'].map(label => [label, rows.filter(r => r.outcome === label).length]))
  },
  exPostExecutionAnatomy: {
    warning: 'Outcome-session fields are diagnostic only and are forbidden as signal-date candidate inputs.',
    nextOpenLocationGroups: executionGroups,
    nextOpenGapPct: {
      observations: gapValues.length,
      median: round(median(gapValues), 4),
      q10: round(quantile(gapValues, 0.10), 4),
      q90: round(quantile(gapValues, 0.90), 4)
    }
  },
  stabilityPolicy: {
    minimumFeatureRows: MIN_FEATURE_ROWS,
    minimumExecutableRows: MIN_EXECUTABLE_ROWS,
    minimumExtremeExecutable: MIN_EXTREME_EXECUTABLE,
    minimumFoldExtremeExecutable: MIN_FOLD_EXTREME_EXECUTABLE,
    materialEdgeDifferencePp: MATERIAL_EDGE_DIFF_PP,
    materialAverageNextCloseDifferencePp: MATERIAL_RETURN_DIFF_PP,
    minimumStableFolds: MIN_STABLE_FOLDS,
    edgeNearTiePp: EDGE_NEAR_TIE_PP
  },
  featureDiagnostics,
  stablePatterns: stablePatterns.map(f => ({
    feature: f.feature,
    family: f.family,
    locked: f.familyLockedByPriorRejectedExperiment,
    betterExtreme: f.extremeComparison.higherQuality,
    edgeDiffHighMinusLowPp: f.extremeComparison.edgeDiffPp,
    averageNextCloseDiffHighMinusLowPp: f.extremeComparison.averageNextCloseDiffPp,
    stableFolds: f.stableFolds,
    effectScore: f.effectScore
  })),
  unlockedFamilyCandidates: familyCandidates,
  newCandidateRecommendation: recommended ? {
    recommended: true,
    ...recommended,
    authority: 'PREREGISTER_NEXT_EXPERIMENT_ONLY_ZERO_ALPHA_ZERO_PRODUCTION_AUTHORITY'
  } : {
    recommended: false,
    family: null,
    reason: 'No unlocked family meets the frozen stable diagnostic pattern criteria.'
  },
  disposition: recommended ? 'ONE_NEW_FAMILY_MAY_BE_PREREGISTERED_BEFORE_FIRST_OUTCOME_RUN' : 'NO_NEW_RETROSPECTIVE_RULE_MOVE_TO_FRESH_FORWARD_EVIDENCE',
  dataIntegrity: {
    pass: true,
    futureRowsUsedForFeatures: false,
    exactSignalDateRequired: true,
    malformedRecommendationLevels: 0
  },
  limitations: [
    'This is post-hoc diagnostic evidence from a research window already observed elsewhere; it is not a fresh holdout.',
    'Member target/stop labels come from the recorded conservative target-hit audit and are not a complete three-session realized-return ledger.',
    'Next-session open/gap fields are ex-post execution anatomy only and cannot be used to generate a signal-date rule.',
    'Stable association does not establish causality or production value.'
  ]
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  schemaVersion: report.schemaVersion,
  coverage: report.coverage,
  outcomeAnatomy: report.outcomeAnatomy,
  stablePatterns: report.stablePatterns,
  unlockedFamilyCandidates: report.unlockedFamilyCandidates,
  newCandidateRecommendation: report.newCandidateRecommendation,
  disposition: report.disposition,
  dataIntegrity: report.dataIntegrity
}, null, 2));
