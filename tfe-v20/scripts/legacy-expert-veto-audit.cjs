#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const HIST = path.join(ROOT, 'data', 'history');
const V16 = path.join(ROOT, 'data', 'stable', 'v16-v169-live-evaluation.json');
const Fusion = require(path.join(ROOT, 'gann-fusion-x', 'engine', 'fusion.js'));
const Planner = require(path.join(ROOT, 'gann-fusion-x', 'engine', 'planner.js'));
const I = require(path.join(ROOT, 'gann-fusion-x', 'engine', 'indicators.js'));

const HOLD = 3;
const COST = 0.6;
const MIN_GROUP_FOR_DIRECTIONAL_CLAIM = 12;

function read(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function round(n, d = 4) { return Number.isFinite(Number(n)) ? Number(Number(n).toFixed(d)) : null; }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function rawBars(doc) {
  return (doc?.sessions || []).map(x => ({
    date: x.date, open: Number(x.open), high: Number(x.high), low: Number(x.low), close: Number(x.close), volume: Number(x.volume || 0)
  })).filter(x => x.close > 0 && x.high > 0 && x.low > 0).sort((a, b) => a.date.localeCompare(b.date));
}
function adjustedBars(doc) {
  return (doc?.sessions || []).map(x => {
    const close = Number(x.close), adj = Number(x.adjustedClose ?? x.close), f = close ? adj / close : 1;
    return { date: x.date, open: Number(x.open) * f, high: Number(x.high) * f, low: Number(x.low) * f, close: adj, volume: Number(x.volume || 0) };
  }).filter(x => x.close > 0 && x.high > 0 && x.low > 0).sort((a, b) => a.date.localeCompare(b.date));
}
function toDate(bs, date) { return bs.filter(x => x.date <= date); }
function future(bs, date, n = HOLD) { return bs.filter(x => x.date > date).slice(0, n); }
function pct(a, b) { return b ? ((a / b) - 1) * 100 : 0; }

const docs = fs.readdirSync(HIST).filter(x => x.endsWith('.json')).map(file => read(path.join(HIST, file))).filter(Boolean);
const universe = docs.map(doc => ({ ticker: String(doc.ticker || '').toUpperCase(), raw: rawBars(doc), adj: adjustedBars(doc) })).filter(x => x.ticker && x.adj.length >= 55);
const byTicker = new Map(universe.map(x => [x.ticker, x]));

function buildBenchmark(date) {
  const map = new Map();
  for (const u of universe) {
    const bs = toDate(u.adj, date);
    if (bs.length < 30 || bs.at(-1)?.date !== date) continue;
    const base = bs[0].close;
    if (!base) continue;
    for (const b of bs) {
      if (!map.has(b.date)) map.set(b.date, []);
      map.get(b.date).push(b.close / base * 100);
    }
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => {
    const c = mean(v);
    return { date: d, open: c, high: c, low: c, close: c, volume: 1 };
  });
}

function evaluateV16(u, date, m) {
  const win = future(u.raw, date, HOLD);
  if (win.length < HOLD) return null;
  const l = { entryLow: Number(m.entryLow), entryHigh: Number(m.entryHigh), stopLoss: Number(m.stopLoss), target1: Number(m.target1) };
  if (!(l.entryLow > 0 && l.entryHigh > 0 && l.stopLoss > 0 && l.target1 > 0)) return null;
  let entered = false, entry = null, status = 'UNFILLED', exit = null;
  for (const b of win) {
    if (!entered) {
      if (b.open >= l.entryLow && b.open <= l.entryHigh) { entry = b.open; entered = true; }
      else if (b.low <= l.entryHigh && b.high >= l.entryLow) {
        entry = b.open > l.entryHigh ? l.entryHigh : b.open < l.entryLow ? l.entryLow : l.entryHigh;
        entered = true;
      } else continue;
    }
    const stop = b.low <= l.stopLoss, target = b.high >= l.target1;
    if (stop && target) { status = 'STOP_SAME_BAR'; exit = l.stopLoss; break; }
    if (stop) { status = 'STOP_HIT'; exit = l.stopLoss; break; }
    if (target) { status = 'TARGET_HIT'; exit = l.target1; break; }
  }
  if (!entered) return { status: 'UNFILLED', netReturnPct: 0 };
  if (exit == null) { status = 'TIME_EXIT'; exit = win.at(-1).close; }
  return { status, netReturnPct: round(pct(exit, entry) - COST, 3) };
}

function legacyDiagnostics(u, date, market) {
  const bs = toDate(u.adj, date);
  if (bs.length < 50 || bs.at(-1)?.date !== date) return null;
  const g = Fusion.analyze({ ticker: u.ticker, bars: bs, marketBars: market, fundamentals: { score: 50, verified: false }, dataQuality: { fresh: true, conflict: false } });
  const gp = g.valid ? Planner.buildPlan(g, 'speculative', { portfolioValue: 100000, riskPct: .5, verifiedFundamentals: false }) : null;

  const trend = I.trend(bs), rs = I.rs(bs, market), mom = I.momentum(bs), vol = I.volume(bs), bo = I.breakout(bs);
  const rp = Fusion.risk(bs, { nextAbove: 0 }, bo);
  const entry = bo.confirmed ? 90 : bo.near ? 78 : Math.max(25, bo.score);
  const sepaScore = round(trend.score * .20 + rs.score * .15 + mom.score * .10 + vol.score * .15 + entry * .15 + rp.score * .15 + 50 * .10, 1);
  const sepaAvoid = trend.score < 60 || rs.score < 20 || mom.overheated;
  const sepaActionable = !sepaAvoid && entry >= 75 && trend.score >= 85 && rs.score >= 70 && rp.rr >= 2 && ((rp.entryHigh - rp.stopLoss) / Math.max(.0001, rp.entryHigh) * 100) <= 8;
  const sepaRecommendation = !sepaAvoid && (sepaActionable || bo.near || bo.confirmed || sepaScore >= 72);
  const gannCode = g?.classification?.code || 'INVALID';
  const gannSupportive = ['STRONG_RESEARCH', 'BREAKOUT_WATCH', 'ACCUMULATION_WATCH'].includes(gannCode);
  const gannDanger = ['COOL_OFF', 'AVOID', 'DATA_BLOCKED', 'WAIT_DATA'].includes(gannCode);

  return {
    gann: {
      valid: Boolean(g?.valid), score: g?.score ?? null, classification: gannCode, supportive: gannSupportive, danger: gannDanger,
      overheated: Boolean(g?.parts?.momentum?.overheated), breakoutConfirmed: Boolean(g?.parts?.breakout?.confirmed), volumeConfirmed: Boolean(g?.parts?.volume?.confirmed),
      plannerEligible: Boolean(gp?.eligible), plannerScore: gp?.score ?? null, rr: g?.parts?.riskReward?.rr ?? null
    },
    sepa: {
      score: sepaScore, actionable: sepaActionable, recommendation: sepaRecommendation, avoid: sepaAvoid,
      overheated: Boolean(mom.overheated), trendScore: trend.score, rsScore: rs.score, volumeScore: vol.score, entryScore: entry, rr: rp.rr
    }
  };
}

function summarize(rows) {
  const filled = rows.filter(x => x.outcome.status !== 'UNFILLED');
  const nets = filled.map(x => Number(x.outcome.netReturnPct)).filter(Number.isFinite);
  const targets = filled.filter(x => x.outcome.status === 'TARGET_HIT').length;
  const stops = filled.filter(x => String(x.outcome.status).startsWith('STOP')).length;
  const positive = nets.filter(x => x > 0).length;
  const gains = nets.filter(x => x > 0).reduce((a, b) => a + b, 0);
  const losses = Math.abs(nets.filter(x => x < 0).reduce((a, b) => a + b, 0));
  return {
    selectionCount: rows.length,
    filledCount: filled.length,
    targetHitPct: round(filled.length ? targets / filled.length * 100 : 0, 1),
    stopHitPct: round(filled.length ? stops / filled.length * 100 : 0, 1),
    targetMinusStopEdgePct: round(filled.length ? (targets - stops) / filled.length * 100 : 0, 1),
    positiveTradeRatePct: round(nets.length ? positive / nets.length * 100 : 0, 1),
    averageNetPct: round(mean(nets), 3),
    medianNetPct: round(median(nets), 3),
    profitFactor: losses > 0 ? round(gains / losses, 2) : gains > 0 ? null : 0,
    directionalClaimEligible: filled.length >= MIN_GROUP_FOR_DIRECTIONAL_CLAIM
  };
}

const live = read(V16, { sessions: [] });
const marketCache = new Map();
const rows = [];
for (const s of live.sessions || []) {
  if (!s.signalDate || !Array.isArray(s.members)) continue;
  if (!marketCache.has(s.signalDate)) marketCache.set(s.signalDate, buildBenchmark(s.signalDate));
  const market = marketCache.get(s.signalDate);
  for (const m of s.members) {
    const ticker = String(m.ticker || '').toUpperCase(), u = byTicker.get(ticker);
    if (!u) continue;
    const outcome = evaluateV16(u, s.signalDate, m);
    if (!outcome) continue;
    const diagnostics = legacyDiagnostics(u, s.signalDate, market);
    if (!diagnostics) continue;
    rows.push({ signalDate: s.signalDate, ticker, outcome, ...diagnostics });
  }
}

const groups = {
  ALL: rows,
  GANN_SUPPORTIVE: rows.filter(x => x.gann.supportive),
  GANN_NON_SUPPORTIVE: rows.filter(x => !x.gann.supportive),
  GANN_DANGER: rows.filter(x => x.gann.danger),
  GANN_OVERHEATED: rows.filter(x => x.gann.overheated),
  GANN_NOT_OVERHEATED: rows.filter(x => !x.gann.overheated),
  SEPA_ACTIONABLE: rows.filter(x => x.sepa.actionable),
  SEPA_RECOMMENDATION: rows.filter(x => x.sepa.recommendation),
  SEPA_AVOID: rows.filter(x => x.sepa.avoid),
  SEPA_OVERHEATED: rows.filter(x => x.sepa.overheated),
  SEPA_NOT_OVERHEATED: rows.filter(x => !x.sepa.overheated),
  DUAL_SUPPORTIVE: rows.filter(x => x.gann.supportive && x.sepa.recommendation),
  ANY_OVERHEATED: rows.filter(x => x.gann.overheated || x.sepa.overheated)
};

const report = {
  schemaVersion: 'legacy-expert-fixed-veto-audit-1',
  generatedAt: new Date().toISOString(),
  status: 'DIAGNOSTIC_ONLY_NO_THRESHOLD_TUNING',
  evidenceClass: 'RETROSPECTIVE_POINT_IN_TIME_PROXY_FEATURES_ON_EXACT_V16_SIGNALS',
  method: {
    v16Signals: 'exact logged V16 recommendations',
    outcome: 're-evaluated next-session zone touch, 3 sessions, 0.60% round-trip cost, STOP_FIRST',
    legacyFeatures: 'computed using only OHLC rows <= signalDate; fundamentals fixed neutral at 50',
    thresholds: 'fixed from existing Gann Fusion / SEPA proxy published code, not fit to these outcomes',
    minimumFilledForDirectionalClaim: MIN_GROUP_FOR_DIRECTIONAL_CLAIM
  },
  limitations: [
    'Gann and SEPA features are retrospective reconstructions, not immutable historical ledgers.',
    'Current pinned history universe can retain survivorship/coverage bias.',
    'Adjusted historical prices can reflect later corporate-action adjustments; findings are diagnostic and cannot promote production.',
    'Small subgroups are reported but explicitly ineligible for directional claims.'
  ],
  sample: { rows: rows.length, sessions: new Set(rows.map(x => x.signalDate)).size },
  groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, summarize(v)])),
  rows,
  promotionEligible: false
};

const outDir = path.join(ROOT, 'tfe-v20', 'reports');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'legacy-expert-veto-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ sample: report.sample, groups: report.groups }, null, 2));
