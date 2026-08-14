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
  return String(value || '').toUpperCase().replace(/\.CA$/, '').replace(/[^A-Z0-9.]/g, '');
}
function rowsOf(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['rows', 'items', 'data']) if (Array.isArray(value?.[key])) return value[key];
  return [];
}
function priceOf(row) { return n(row?.price ?? row?.lastPrice ?? row?.last ?? row?.close); }
function validOhlc(row) {
  const h = n(row?.high), l = n(row?.low), c = n(row?.close ?? row?.price ?? row?.last);
  return h !== null && l !== null && c !== null && h > 0 && l > 0 && c > 0 && h >= l;
}
function validRange(row) { return validOhlc(row) && n(row.high) > n(row.low); }
function validSr(row) {
  return n(row?.support1) > 0 && n(row?.resistance1) > 0 && n(row.support1) < n(row.resistance1);
}
function latestHistorySession(history) {
  const dates = [];
  for (const rows of Object.values(history?.symbols || {})) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const date = String(row?.date || '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dates.push(date);
    }
  }
  return dates.sort().at(-1) || null;
}
function cairoClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
function sessionCompletionConfirmed(referenceSessionDate) {
  if (!referenceSessionDate) return false;
  const clock = cairoClock();
  if (referenceSessionDate < clock.date) return true;
  return referenceSessionDate === clock.date && clock.hour >= 16;
}
function parseRenderedDate(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  const months = {
    'يناير': 1, 'فبراير': 2, 'مارس': 3, 'أبريل': 4, 'ابريل': 4, 'مايو': 5, 'يونيو': 6,
    'يوليو': 7, 'أغسطس': 8, 'اغسطس': 8, 'سبتمبر': 9, 'أكتوبر': 10, 'اكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12,
  };
  const m = value.match(/(\d{1,2})\s+(يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)\s+(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${String(months[m[2]]).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
}
function historyRows(history, symbol) {
  return (Array.isArray(history?.symbols?.[symbol]) ? history.symbols[symbol] : [])
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || '')) && validRange(row))
    .map(row => ({
      date: String(row.date), open: n(row.open), high: n(row.high), low: n(row.low), close: n(row.close),
      source: row.source || 'history-50', provenance: 'data/history-50.json'
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
function chooseBase(symbol, marketRow, history, referenceSessionDate, completionConfirmed) {
  const hist = historyRows(history, symbol);
  if (completionConfirmed && validRange(marketRow)) {
    return {
      date: referenceSessionDate, open: n(marketRow.open), high: n(marketRow.high), low: n(marketRow.low), close: priceOf(marketRow),
      source: marketRow.source || 'market-current-session', provenance: 'data/market.json',
      historySessions: hist.length, currentSession: true,
    };
  }
  const latest = hist.filter(row => !referenceSessionDate || row.date <= referenceSessionDate).at(-1);
  return latest ? { ...latest, historySessions: hist.length, currentSession: latest.date === referenceSessionDate } : null;
}
function confidenceFor(base) {
  const depthBonus = Math.min(0.06, Math.max(0, Number(base?.historySessions || 0)) * 0.002);
  return round((base?.currentSession ? 0.80 : 0.64) + depthBonus, 3);
}
function derive(base) {
  const h = n(base.high), l = n(base.low), c = n(base.close);
  if (!(h > l && l > 0 && c > 0)) return null;
  const pivot = (h + l + c) / 3;
  const support1 = 2 * pivot - h;
  const resistance1 = 2 * pivot - l;
  const support2 = pivot - (h - l);
  const resistance2 = pivot + (h - l);
  if (!(support2 > 0 && support1 > 0 && resistance1 > support1 && resistance2 > resistance1)) return null;
  return { pivot, support1, support2, resistance1, resistance2 };
}
function relativeDiff(a, b) {
  const x = n(a), y = n(b);
  if (!(x > 0 && y > 0)) return null;
  return Math.abs(x - y) / ((x + y) / 2) * 100;
}
function validateExternal(levels, external, externalSessionDate, referenceSessionDate, source) {
  if (!external || !validSr(external)) return { source, state: 'UNAVAILABLE', critical: false };
  if (!externalSessionDate || externalSessionDate !== referenceSessionDate) {
    return { source, state: 'STALE_REFERENCE_ONLY', sourceSessionDate: externalSessionDate, critical: false };
  }
  const s1 = relativeDiff(levels.support1, external.support1);
  const r1 = relativeDiff(levels.resistance1, external.resistance1);
  const maxDiffPct = Math.max(s1 ?? 0, r1 ?? 0);
  if (maxDiffPct <= 4) return { source, state: 'CURRENT_MATCH', maxDiffPct: round(maxDiffPct, 2), critical: false };
  if (maxDiffPct <= 10) return { source, state: 'CURRENT_DIVERGENCE', maxDiffPct: round(maxDiffPct, 2), critical: false };
  return { source, state: 'CURRENT_CRITICAL_CONFLICT', maxDiffPct: round(maxDiffPct, 2), critical: true };
}

const market = read('data/market.json');
const history = read('data/history-50.json');
const direct = read('data/mubasher-support-resistance-direct.json');
const rendered = read('data/mubasher-support-resistance-rendered.json');
const ranking = read('data/final-opportunity-ranking.json');
const marketRows = rowsOf(market);
const eligible = marketRows.filter(row => sym(row.symbol) && priceOf(row) > 0);
const rankedSymbols = [...new Set(rowsOf(ranking).filter(row => sym(row.symbol) && priceOf(row) > 0).map(row => sym(row.symbol)))].slice(0, 80);
const candidateSymbols = rankedSymbols.length ? rankedSymbols : eligible.map(row => sym(row.symbol));
const candidateSet = new Set(candidateSymbols);
const referenceSessionDate = latestHistorySession(history) || market.sessionDate || market.lastSession || null;
const completionConfirmed = sessionCompletionConfirmed(referenceSessionDate);
const directMap = new Map(rowsOf(direct).filter(validSr).map(row => [sym(row.symbol), row]));
const renderedMap = new Map(rowsOf(rendered).filter(validSr).map(row => [sym(row.symbol), row]));
const rows = [];
const missing = [];
const allConflicts = [];
let directCurrent = 0, directStale = 0, renderedCurrent = 0, renderedStale = 0;

for (const marketRow of eligible) {
  const symbol = sym(marketRow.symbol);
  const base = chooseBase(symbol, marketRow, history, referenceSessionDate, completionConfirmed);
  const levels = base ? derive(base) : null;
  if (!base || !levels) { missing.push(symbol); continue; }
  const confidence = confidenceFor(base);
  const directRow = directMap.get(symbol);
  const renderedRow = renderedMap.get(symbol);
  const directSession = directRow?.sourceSessionDate || null;
  const renderedSession = parseRenderedDate(renderedRow?.updatedAt);
  const directValidation = validateExternal(levels, directRow, directSession, referenceSessionDate, 'MUBASHER_DIRECT');
  const renderedValidation = validateExternal(levels, renderedRow, renderedSession, referenceSessionDate, 'MUBASHER_RENDERED');
  if (directValidation.state.startsWith('CURRENT_')) directCurrent += 1;
  if (directValidation.state === 'STALE_REFERENCE_ONLY') directStale += 1;
  if (renderedValidation.state.startsWith('CURRENT_')) renderedCurrent += 1;
  if (renderedValidation.state === 'STALE_REFERENCE_ONLY') renderedStale += 1;
  for (const validation of [directValidation, renderedValidation]) {
    if (validation.critical) allConflicts.push({ symbol, ...validation });
  }
  const freshness = base.date === referenceSessionDate ? 'CURRENT_COMPLETED_SESSION' : 'LATEST_AVAILABLE_COMPLETED_SESSION';
  const executionEligible = Boolean(
    completionConfirmed && base.date === referenceSessionDate && confidence >= Number(process.env.EGX_INTERNAL_SR_MIN_CONFIDENCE || 0.80)
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
    source: 'INTERNAL_OHLC_PIVOT', sessionDate: base.date, freshness, confidence,
    methodology: 'CLASSIC_PIVOT_FROM_COMPLETED_SESSION_OHLC',
    provenance: {
      input: base.provenance, inputSource: base.source, open: base.open, high: base.high, low: base.low, close: base.close,
      historySessions: base.historySessions,
    },
    externalValidation: { direct: directValidation, rendered: renderedValidation },
    pivot: round(levels.pivot),
    support1: round(levels.support1), support2: round(levels.support2),
    resistance1: round(levels.resistance1), resistance2: round(levels.resistance2),
    levels: {
      support1: level(levels.support1, 'SUPPORT_1'), support2: level(levels.support2, 'SUPPORT_2'),
      resistance1: level(levels.resistance1, 'RESISTANCE_1'), resistance2: level(levels.resistance2, 'RESISTANCE_2'),
    },
    executionEligible,
  });
}

const freshRows = rows.filter(row => row.sessionDate === referenceSessionDate);
const candidateRows = rows.filter(row => candidateSet.has(row.symbol));
const candidateFreshRows = candidateRows.filter(row => row.sessionDate === referenceSessionDate);
const candidateConflicts = allConflicts.filter(item => candidateSet.has(item.symbol));
const candidateMissing = candidateSymbols.filter(symbol => !candidateRows.some(row => row.symbol === symbol));
const avg = values => values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 3) : 0;
const coveragePct = candidateSymbols.length ? round(candidateRows.length / candidateSymbols.length * 100, 2) : 0;
const freshnessPct = candidateSymbols.length ? round(candidateFreshRows.length / candidateSymbols.length * 100, 2) : 0;
const marketCoveragePct = eligible.length ? round(rows.length / eligible.length * 100, 2) : 0;
const marketFreshnessPct = eligible.length ? round(freshRows.length / eligible.length * 100, 2) : 0;
const averageFreshConfidence = avg(candidateFreshRows.map(row => Number(row.confidence || 0)));
const minCoverage = Number(process.env.EGX_INTERNAL_SR_MIN_COVERAGE || 95);
const minFreshness = Number(process.env.EGX_INTERNAL_SR_MIN_FRESHNESS || 98);
const minConfidence = Number(process.env.EGX_INTERNAL_SR_MIN_CONFIDENCE || 0.80);
const researchMinCoverage = Number(process.env.EGX_INTERNAL_SR_RESEARCH_MIN_COVERAGE || 60);
const executionCandidateReady = Boolean(
  completionConfirmed && referenceSessionDate && coveragePct >= minCoverage && freshnessPct >= minFreshness &&
  averageFreshConfidence >= minConfidence && candidateConflicts.length === 0
);
const researchReady = Boolean(referenceSessionDate && coveragePct >= researchMinCoverage);

const output = {
  schemaVersion: '17.0.0-internal-ohlc-sr-1',
  generatedAt: new Date().toISOString(),
  ok: researchReady,
  researchReady,
  executionCandidateReady,
  referenceSessionDate,
  sessionCompletionConfirmed: completionConfirmed,
  methodology: 'CLASSIC_PIVOT_FROM_COMPLETED_SESSION_OHLC',
  policy: {
    fabricatedPricesForbidden: true,
    lookAheadForbidden: true,
    currentSessionUsedOnlyWhenConservativelyConfirmedComplete: true,
    staleOhlcAllowedForResearchOnly: true,
    mubasherRole: 'VALIDATION_COMPARISON_NOT_HARD_DEPENDENCY',
  },
  eligibleCount: eligible.length,
  candidateUniverseCount: candidateSymbols.length,
  candidateSymbols,
  count: rows.length,
  freshCount: freshRows.length,
  candidateCount: candidateRows.length,
  candidateFreshCount: candidateFreshRows.length,
  marketCoveragePct,
  marketFreshnessPct,
  coveragePct,
  freshnessPct,
  criticalFieldsPct: coveragePct,
  averageConfidence: avg(candidateRows.map(row => Number(row.confidence || 0))),
  averageFreshConfidence,
  thresholds: {
    minimumCoveragePct: minCoverage,
    minimumFreshnessPct: minFreshness,
    minimumConfidence: minConfidence,
    researchMinimumCoveragePct: researchMinCoverage,
  },
  externalValidationSummary: {
    directCurrent, directStale, renderedCurrent, renderedStale, criticalConflicts: allConflicts.length,
  },
  sourceConflicts: candidateConflicts,
  allSourceConflicts: allConflicts,
  missingSymbols: candidateMissing,
  allMissingSymbols: missing,
  rows,
};

write(OUT, output);
console.log(JSON.stringify({
  referenceSessionDate, sessionCompletionConfirmed: completionConfirmed,
  eligible: eligible.length, derived: rows.length,
  candidateUniverse: candidateSymbols.length, candidateDerived: candidateRows.length, candidateFresh: candidateFreshRows.length,
  marketCoveragePct, marketFreshnessPct, coveragePct, freshnessPct, averageFreshConfidence,
  criticalConflicts: candidateConflicts.length, researchReady, executionCandidateReady,
}, null, 2));
if (!researchReady) process.exitCode = 2;
