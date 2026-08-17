#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const OUT = 'data/v17/internal-ohlc-support-resistance.json';

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
function n(value) {
  if (value === null || value === undefined || value === '') return null;
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}
function round(value, digits = 4) {
  const x = n(value);
  if (x === null) return null;
  const m = 10 ** digits;
  return Math.round(x * m) / m;
}
function sym(value) {
  return String(value || '').trim().toUpperCase().replace(/\.CA$/, '').replace(/[^A-Z0-9.]/g, '');
}
function rowsOf(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['rows', 'items', 'data']) if (Array.isArray(value?.[key])) return value[key];
  return [];
}
function priceOf(row) { return n(row?.price ?? row?.lastPrice ?? row?.last ?? row?.close); }
function validDate(date) { return /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')); }
function isRegularTradingWeekday(date) {
  if (!validDate(date)) return false;
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day >= 0 && day <= 4;
}
function validOhlc(row) {
  const o = n(row?.open), h = n(row?.high), l = n(row?.low), c = n(row?.close ?? row?.price ?? row?.last);
  return [o, h, l, c].every(value => value !== null && value > 0) && h >= l && h >= Math.max(o, c) && l <= Math.min(o, c);
}
function validRange(row) { return validOhlc(row) && n(row.high) > n(row.low); }
function validSr(row) { return n(row?.support1) > 0 && n(row?.resistance1) > 0 && n(row.support1) < n(row.resistance1); }
function sourceQuality(row) { return String(row?.sourceQuality || row?.source || '').trim(); }
function trustedHistoricalSource(row) {
  if (!row) return false;
  if (row.officialVerified === true) return true;
  const q = sourceQuality(row).toLowerCase();
  if (q.includes('workflow-market-snapshot') || q.includes('workflow_market_snapshot')) return true;
  if (q.includes('public_automated_historical_backfill')) return true;
  if (q.includes('licensed') && q.includes('historical_backfill')) return true;
  return false;
}
function historyDates(history) {
  const dates = [];
  for (const rows of Object.values(history?.symbols || {})) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const date = String(row?.date || '');
      if (validDate(date) && isRegularTradingWeekday(date)) dates.push(date);
    }
  }
  return [...new Set(dates)].sort();
}
function latestHistorySession(history) { return historyDates(history).at(-1) || null; }
function cairoClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
function sessionCompletionConfirmed(date) {
  if (!date) return false;
  const now = cairoClock();
  if (date < now.date) return true;
  return date === now.date && now.hour >= 16; // deliberately conservative vs normal EGX close.
}
function latestCompletedSession(history, reference, complete) {
  if (!reference) return null;
  if (complete) return reference;
  return historyDates(history).filter(date => date < reference).at(-1) || null;
}
function parseRenderedDate(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  const iso = value.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  const months = {'يناير':1,'فبراير':2,'مارس':3,'أبريل':4,'ابريل':4,'مايو':5,'يونيو':6,'يوليو':7,'أغسطس':8,'اغسطس':8,'سبتمبر':9,'أكتوبر':10,'اكتوبر':10,'نوفمبر':11,'ديسمبر':12};
  const m = value.match(/(\d{1,2})\s+(يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)\s+(\d{4})/);
  return m ? `${m[3]}-${String(months[m[2]]).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}` : null;
}
function historyRows(history, symbol) {
  return (Array.isArray(history?.symbols?.[symbol]) ? history.symbols[symbol] : [])
    .filter(row => validDate(row?.date) && isRegularTradingWeekday(row.date) && validRange(row))
    .map(row => ({
      date: String(row.date),
      open: n(row.open), high: n(row.high), low: n(row.low), close: n(row.close),
      source: row.source || row.sourceQuality || 'history-50',
      sourceQuality: sourceQuality(row),
      trusted: trustedHistoricalSource(row),
      provenance: 'data/history-50.json',
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
function chooseBase(symbol, marketRow, history, levelSessionDate, completionConfirmed, referenceSessionDate, verifiedMarketSession) {
  const hist = historyRows(history, symbol);
  if (
    verifiedMarketSession && completionConfirmed && levelSessionDate === referenceSessionDate &&
    validRange(marketRow)
  ) {
    return {
      date: levelSessionDate,
      open: n(marketRow.open), high: n(marketRow.high), low: n(marketRow.low), close: priceOf(marketRow),
      source: marketRow.source || 'market-current-session',
      sourceQuality: 'VERIFIED_PRICE_SOURCE_SESSION',
      trusted: true,
      provenance: 'data/market.json',
      historySessions: hist.length,
      currentCompletedSession: true,
    };
  }
  const latest = hist.filter(row => !levelSessionDate || row.date <= levelSessionDate).at(-1);
  return latest ? {
    ...latest,
    historySessions: hist.length,
    currentCompletedSession: latest.date === levelSessionDate,
  } : null;
}
function confidenceFor(base) {
  const bonus = Math.min(0.06, Math.max(0, Number(base?.historySessions || 0)) * 0.002);
  const baseConfidence = base?.currentCompletedSession ? 0.80 : 0.64;
  const trustPenalty = base?.trusted ? 0 : 0.12;
  return round(Math.max(0, baseConfidence + bonus - trustPenalty), 3);
}
function derive(base) {
  const h = n(base?.high), l = n(base?.low), c = n(base?.close);
  if (!(h > l && l > 0 && c > 0)) return null;
  const pivot = (h + l + c) / 3;
  const support1 = 2 * pivot - h;
  const resistance1 = 2 * pivot - l;
  const support2 = pivot - (h - l);
  const resistance2 = pivot + (h - l);
  return support2 > 0 && support1 > 0 && resistance1 > support1 && resistance2 > resistance1
    ? { pivot, support1, support2, resistance1, resistance2 }
    : null;
}
function relativeDiff(a, b) {
  const x = n(a), y = n(b);
  return x > 0 && y > 0 ? Math.abs(x - y) / ((x + y) / 2) * 100 : null;
}
function validateExternal(levels, external, externalSessionDate, levelSessionDate, source) {
  if (!external || !validSr(external)) return { source, state: 'UNAVAILABLE', critical: false };
  if (!externalSessionDate || externalSessionDate !== levelSessionDate) {
    return { source, state: 'STALE_REFERENCE_ONLY', sourceSessionDate: externalSessionDate, levelSessionDate, critical: false };
  }
  const supportDiff = relativeDiff(levels.support1, external.support1);
  const resistanceDiff = relativeDiff(levels.resistance1, external.resistance1);
  const maxDiff = Math.max(supportDiff ?? 0, resistanceDiff ?? 0);
  if (maxDiff <= 4) return { source, state: 'CURRENT_MATCH', maxDiffPct: round(maxDiff, 2), critical: false };
  if (maxDiff <= 10) return { source, state: 'CURRENT_DIVERGENCE', maxDiffPct: round(maxDiff, 2), critical: false };
  return { source, state: 'CURRENT_CRITICAL_CONFLICT', maxDiffPct: round(maxDiff, 2), critical: true };
}
function average(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? round(clean.reduce((sum, value) => sum + value, 0) / clean.length, 3) : 0;
}

const market = read('data/market.json');
const history = read('data/history-50.json');
const direct = read('data/mubasher-support-resistance-direct.json');
const rendered = read('data/mubasher-support-resistance-rendered.json');
const ranking = read('data/final-opportunity-ranking.json');
const sessionTruth = read('data/v17/market-session-truth.json');

const marketRows = rowsOf(market);
const marketMap = new Map(marketRows.map(row => [sym(row.symbol), row]).filter(([symbol, row]) => symbol && priceOf(row) > 0));
const eligibleMarketSymbols = [...marketMap.keys()];
const rankedSymbols = [...new Set(rowsOf(ranking).map(row => sym(row.symbol || row.ticker || row.code)).filter(Boolean))].slice(0, 80);
const candidateSymbols = rankedSymbols.length ? rankedSymbols : eligibleMarketSymbols;
const candidateSet = new Set(candidateSymbols);
const universeSymbols = [...new Set([...eligibleMarketSymbols, ...candidateSymbols])];

const verifiedMarketSession = Boolean(
  sessionTruth.executionSafe === true &&
  validDate(sessionTruth.selectedSessionDate) &&
  market.sessionDate === sessionTruth.selectedSessionDate &&
  isRegularTradingWeekday(sessionTruth.selectedSessionDate)
);
const researchMarketSession = Boolean(
  sessionTruth.researchSessionVerified === true &&
  validDate(sessionTruth.selectedSessionDate) &&
  isRegularTradingWeekday(sessionTruth.selectedSessionDate)
);
const referenceSessionDate = (verifiedMarketSession || researchMarketSession)
  ? sessionTruth.selectedSessionDate
  : latestHistorySession(history) || (validDate(market.sessionDate) ? market.sessionDate : null);
const completionConfirmed = sessionCompletionConfirmed(referenceSessionDate);
const levelSessionDate = latestCompletedSession(history, referenceSessionDate, completionConfirmed);

const directMap = new Map(rowsOf(direct).filter(validSr).map(row => [sym(row.symbol), row]));
const renderedMap = new Map(rowsOf(rendered).filter(validSr).map(row => [sym(row.symbol), row]));
const rows = [];
const missing = [];
const allConflicts = [];
let directCurrent = 0, directStale = 0, renderedCurrent = 0, renderedStale = 0;

for (const symbol of universeSymbols) {
  const marketRow = marketMap.get(symbol) || null;
  const base = chooseBase(symbol, marketRow, history, levelSessionDate, completionConfirmed, referenceSessionDate, verifiedMarketSession);
  const levels = base ? derive(base) : null;
  if (!base || !levels) {
    missing.push(symbol);
    continue;
  }

  const confidence = confidenceFor(base);
  const directRow = directMap.get(symbol);
  const renderedRow = renderedMap.get(symbol);
  const directSession = directRow?.sourceSessionDate || null;
  const renderedSession = parseRenderedDate(renderedRow?.updatedAt);
  const directValidation = validateExternal(levels, directRow, directSession, levelSessionDate, 'MUBASHER_DIRECT');
  const renderedValidation = validateExternal(levels, renderedRow, renderedSession, levelSessionDate, 'MUBASHER_RENDERED');
  if (directValidation.state.startsWith('CURRENT_')) directCurrent += 1;
  if (directValidation.state === 'STALE_REFERENCE_ONLY') directStale += 1;
  if (renderedValidation.state.startsWith('CURRENT_')) renderedCurrent += 1;
  if (renderedValidation.state === 'STALE_REFERENCE_ONLY') renderedStale += 1;
  for (const validation of [directValidation, renderedValidation]) {
    if (validation.critical) allConflicts.push({ symbol, ...validation });
  }

  const freshness = base.date === levelSessionDate ? 'LATEST_COMPLETED_SESSION' : 'OLDER_COMPLETED_SESSION';
  const executionEligible = Boolean(
    verifiedMarketSession &&
    completionConfirmed &&
    levelSessionDate === referenceSessionDate &&
    base.date === levelSessionDate &&
    base.trusted === true &&
    confidence >= Number(process.env.EGX_INTERNAL_SR_MIN_CONFIDENCE || 0.80)
  );
  const level = (value, type) => ({
    value: round(value), type, source: 'INTERNAL_OHLC_PIVOT', provenance: base.provenance,
    sessionDate: base.date, freshness, confidence,
    methodology: 'CLASSIC_PIVOT_FROM_COMPLETED_SESSION_OHLC',
    externalValidationState: directValidation.state !== 'UNAVAILABLE' ? directValidation.state : renderedValidation.state,
  });

  rows.push({
    symbol,
    grade: executionEligible ? 'INTERNAL_EXECUTION_CANDIDATE' : 'RESEARCH_ONLY',
    source: 'INTERNAL_OHLC_PIVOT',
    sessionDate: base.date,
    researchSessionDate: referenceSessionDate,
    freshness,
    confidence,
    methodology: 'CLASSIC_PIVOT_FROM_COMPLETED_SESSION_OHLC',
    provenance: {
      input: base.provenance,
      inputSource: base.source,
      inputSourceQuality: base.sourceQuality || null,
      trustedForExecution: base.trusted === true,
      open: base.open, high: base.high, low: base.low, close: base.close,
      historySessions: base.historySessions,
    },
    externalValidation: { direct: directValidation, rendered: renderedValidation },
    pivot: round(levels.pivot),
    support1: round(levels.support1), support2: round(levels.support2),
    resistance1: round(levels.resistance1), resistance2: round(levels.resistance2),
    levels: {
      support1: level(levels.support1, 'SUPPORT_1'),
      support2: level(levels.support2, 'SUPPORT_2'),
      resistance1: level(levels.resistance1, 'RESISTANCE_1'),
      resistance2: level(levels.resistance2, 'RESISTANCE_2'),
    },
    executionEligible,
  });
}

const marketSet = new Set(eligibleMarketSymbols);
const marketDerivedRows = rows.filter(row => marketSet.has(row.symbol));
const marketFreshRows = marketDerivedRows.filter(row => row.sessionDate === levelSessionDate);
const candidateRows = rows.filter(row => candidateSet.has(row.symbol));
const candidateTrustedRows = candidateRows.filter(row => row.provenance?.trustedForExecution === true);
const candidateFreshRows = candidateRows.filter(row => row.sessionDate === levelSessionDate);
const candidateTrustedFreshRows = candidateFreshRows.filter(row => row.provenance?.trustedForExecution === true);
const candidateConflicts = allConflicts.filter(row => candidateSet.has(row.symbol));
const candidateMissing = candidateSymbols.filter(symbol => !candidateRows.some(row => row.symbol === symbol));
const candidateUntrusted = candidateSymbols.filter(symbol => candidateRows.some(row => row.symbol === symbol && row.provenance?.trustedForExecution !== true));

const researchCoveragePct = candidateSymbols.length ? round(candidateRows.length / candidateSymbols.length * 100, 2) : 0;
const researchFreshnessPct = candidateSymbols.length ? round(candidateFreshRows.length / candidateSymbols.length * 100, 2) : 0;
const coveragePct = candidateSymbols.length ? round(candidateTrustedRows.length / candidateSymbols.length * 100, 2) : 0;
const freshnessPct = candidateSymbols.length ? round(candidateTrustedFreshRows.length / candidateSymbols.length * 100, 2) : 0;
const marketCoveragePct = eligibleMarketSymbols.length ? round(marketDerivedRows.length / eligibleMarketSymbols.length * 100, 2) : 0;
const marketFreshnessPct = eligibleMarketSymbols.length ? round(marketFreshRows.length / eligibleMarketSymbols.length * 100, 2) : 0;
const averageFreshConfidence = average(candidateTrustedFreshRows.map(row => Number(row.confidence || 0)));

const minCoverage = Number(process.env.EGX_INTERNAL_SR_MIN_COVERAGE || 95);
const minFreshness = Number(process.env.EGX_INTERNAL_SR_MIN_FRESHNESS || 98);
const minConfidence = Number(process.env.EGX_INTERNAL_SR_MIN_CONFIDENCE || 0.80);
const researchMinCoverage = Number(process.env.EGX_INTERNAL_SR_RESEARCH_MIN_COVERAGE || 60);
const executionCandidateReady = Boolean(
  verifiedMarketSession &&
  completionConfirmed &&
  referenceSessionDate && levelSessionDate === referenceSessionDate &&
  coveragePct >= minCoverage &&
  freshnessPct >= minFreshness &&
  averageFreshConfidence >= minConfidence &&
  candidateConflicts.length === 0
);
const researchReady = Boolean(levelSessionDate && researchCoveragePct >= researchMinCoverage);

const output = {
  schemaVersion: '17.0.0-internal-ohlc-sr-4',
  generatedAt: new Date().toISOString(),
  ok: researchReady,
  researchReady,
  executionCandidateReady,
  referenceSessionDate,
  levelSessionDate,
  sessionCompletionConfirmed: completionConfirmed,
  sourceSessionVerified: verifiedMarketSession,
  researchSessionVerified: researchMarketSession,
  methodology: 'CLASSIC_PIVOT_FROM_COMPLETED_SESSION_OHLC',
  policy: {
    fabricatedPricesForbidden: true,
    lookAheadForbidden: true,
    priceSourceSessionTruthRequiredForExecution: true,
    currentSessionUsedOnlyWhenConservativelyConfirmedComplete: true,
    incompleteCurrentSessionExcludedFromCompletedOhlc: true,
    researchSessionMayReferenceCurrentIntradayWhileLevelsUsePriorCompletedSession: true,
    staleOrUntrustedOhlcAllowedForResearchOnly: true,
    candidateUniverseMayUseTrustedHistoryEvenWhenCurrentMarketRowMissing: true,
    fridaySaturdayExcludedFromHistorySessions: true,
    mubasherRole: 'VALIDATION_COMPARISON_NOT_HARD_DEPENDENCY',
  },
  eligibleCount: eligibleMarketSymbols.length,
  candidateUniverseCount: candidateSymbols.length,
  candidateSymbols,
  count: rows.length,
  freshCount: rows.filter(row => row.sessionDate === levelSessionDate).length,
  candidateCount: candidateRows.length,
  candidateTrustedCount: candidateTrustedRows.length,
  candidateFreshCount: candidateFreshRows.length,
  candidateTrustedFreshCount: candidateTrustedFreshRows.length,
  marketCoveragePct,
  marketFreshnessPct,
  researchCoveragePct,
  researchFreshnessPct,
  coveragePct,
  freshnessPct,
  criticalFieldsPct: coveragePct,
  averageConfidence: average(candidateTrustedRows.map(row => Number(row.confidence || 0))),
  averageFreshConfidence,
  thresholds: {
    minimumCoveragePct: minCoverage,
    minimumFreshnessPct: minFreshness,
    minimumConfidence: minConfidence,
    researchMinimumCoveragePct: researchMinCoverage,
  },
  externalValidationSummary: {
    directCurrent, directStale, renderedCurrent, renderedStale,
    criticalConflicts: allConflicts.length,
  },
  sourceConflicts: candidateConflicts,
  allSourceConflicts: allConflicts,
  missingSymbols: candidateMissing,
  untrustedSymbols: candidateUntrusted,
  allMissingSymbols: missing,
  rows,
};

write(OUT, output);
console.log(JSON.stringify({
  referenceSessionDate,
  levelSessionDate,
  sourceSessionVerified: verifiedMarketSession,
  researchSessionVerified: researchMarketSession,
  sessionCompletionConfirmed: completionConfirmed,
  eligible: eligibleMarketSymbols.length,
  derived: rows.length,
  candidateUniverse: candidateSymbols.length,
  candidateDerived: candidateRows.length,
  candidateTrusted: candidateTrustedRows.length,
  candidateFresh: candidateFreshRows.length,
  candidateTrustedFresh: candidateTrustedFreshRows.length,
  researchCoveragePct,
  researchFreshnessPct,
  coveragePct,
  freshnessPct,
  averageFreshConfidence,
  criticalConflicts: candidateConflicts.length,
  researchReady,
  executionCandidateReady,
}, null, 2));
if (!researchReady) process.exitCode = 2;