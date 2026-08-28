#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'gann-fusion-x', 'data');
const FORWARD = path.join(DATA, 'forward-shadow-ledger.json');
const LEDGER = path.join(DATA, 'champion-challenger-ledger.json');
const REPORT = path.join(DATA, 'champion-challenger-report.json');
const CHECKPOINTS = [20, 30, 60];
const ENGINE_SPECS = {
  V16_9_LIVE: { role: 'CHAMPION', evidenceClass: 'LIVE_PUBLISHED_EXACT_SOURCE', promotionEligible: true },
  GANN_FUSION_X_V1: { role: 'CHALLENGER', evidenceClass: 'READY_ONLY_V2', promotionEligible: true },
  SEPA_X_LIVE_SHADOW: { role: 'DIAGNOSTIC', evidenceClass: 'DERIVED_SHADOW_LEVELS', promotionEligible: false },
};
const POLICY = {
  schemaVersion: 'champion-challenger-policy-v1',
  champion: 'V16_9_LIVE',
  challenger: 'GANN_FUSION_X_V1',
  diagnostic: ['SEPA_X_LIVE_SHADOW'],
  commonDateHeadToHeadRequired: true,
  holdingSessions: 3,
  roundTripCostPct: 0.6,
  sameBarTargetStop: 'STOP_CONSERVATIVE',
  unfilledReturnPct: 0,
  basketWeighting: 'EQUAL_WEIGHT_PER_ENGINE_SESSION',
  checkpoints: CHECKPOINTS,
  promotion: {
    automatic: false,
    minimumCommonResolvedSessions: 20,
    minimumProfitFactor: 1.2,
    minimumWinningSessionPct: 45,
    maximumDrawdownFloorPct: -15,
    challengerAverageNetMustBeatChampion: true,
    challengerCompoundedNetMustBeatChampion: true,
  },
  retuningRule: 'NO_RETUNING_OF_SAME_VERSION_AFTER_OUTCOMES; MATERIAL_ALPHA_CHANGE_REQUIRES_NEW_VERSION',
  appendOnlyCompletedSessions: true,
};

function read(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function finite(v) { return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)); }
function round(v, d = 3) { return finite(v) ? Number(Number(v).toFixed(d)) : null; }
function mean(a) { return a.length ? a.reduce((s, v) => s + Number(v), 0) / a.length : null; }
function median(a) { if (!a.length) return null; const x = [...a].sort((a,b)=>a-b), m = Math.floor(x.length/2); return x.length % 2 ? x[m] : (x[m-1]+x[m])/2; }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function strictGannSignal(s) {
  return s?.engine === 'GANN_FUSION_X_V1' && s?.forwardEligibilitySchema === 'v2-ready-only' &&
    s?.dataReadiness?.status === 'READY' && s?.dataReadiness?.decisionDate === s?.signalSession &&
    Array.isArray(s?.dataReadiness?.missing) && s.dataReadiness.missing.length === 0 &&
    s?.action === 'ACTIONABLE' && Number(s?.portfolioPct) > 0;
}
function selectedSignals(ledger, engine) {
  const all = (ledger.signals || []).filter(s => s.engine === engine);
  return engine === 'GANN_FUSION_X_V1' ? all.filter(strictGannSignal) : all;
}
function maxDrawdown(returns) {
  let equity = 1, peak = 1, mdd = 0;
  for (const r of returns) { equity *= 1 + Number(r)/100; peak = Math.max(peak, equity); mdd = Math.min(mdd, (equity/peak - 1)*100); }
  return round(mdd, 3);
}
function metrics(sessions) {
  const returns = sessions.map(s => Number(s.basketNetPct));
  const pos = returns.filter(r => r > 0), neg = returns.filter(r => r < 0);
  let equity = 1; for (const r of returns) equity *= 1 + r/100;
  const pf = neg.length ? pos.reduce((a,b)=>a+b,0) / Math.abs(neg.reduce((a,b)=>a+b,0)) : (pos.length ? null : null);
  return {
    resolvedSessions: sessions.length,
    winningSessions: pos.length,
    losingSessions: neg.length,
    flatSessions: returns.filter(r => r === 0).length,
    winningSessionPct: sessions.length ? round(pos.length/sessions.length*100, 2) : null,
    averageNetPct: sessions.length ? round(mean(returns), 4) : null,
    medianNetPct: sessions.length ? round(median(returns), 4) : null,
    compoundedNetPct: sessions.length ? round((equity-1)*100, 4) : null,
    profitFactor: pf === null ? null : round(pf, 3),
    profitFactorInfinite: neg.length === 0 && pos.length > 0,
    maximumDrawdownPct: sessions.length ? maxDrawdown(returns) : null,
  };
}
function buildCompletedSessions(forward) {
  const outcomeByKey = new Map((forward.outcomes || []).map(o => [o.signalKey, o]));
  const completed = [];
  for (const [engine, spec] of Object.entries(ENGINE_SPECS)) {
    const signals = selectedSignals(forward, engine);
    const bySession = new Map();
    for (const s of signals) { if (!bySession.has(s.signalSession)) bySession.set(s.signalSession, []); bySession.get(s.signalSession).push(s); }
    for (const [signalSession, rows] of bySession) {
      const sortedSignals = [...rows].sort((a,b)=>(a.rank??999)-(b.rank??999)||String(a.ticker).localeCompare(String(b.ticker)));
      const outcomes = sortedSignals.map(s => outcomeByKey.get(s.key)).filter(Boolean);
      if (outcomes.length !== sortedSignals.length) continue;
      const legs = sortedSignals.map(s => {
        const o = outcomeByKey.get(s.key);
        const net = o.status === 'UNFILLED' ? POLICY.unfilledReturnPct : (finite(o.netReturnPct) ? Number(o.netReturnPct) : null);
        if (net === null) throw new Error(`NON_TERMINAL_OUTCOME_IN_COMPLETED_SESSION ${engine} ${signalSession} ${s.ticker}`);
        return { signalKey: s.key, ticker: s.ticker, rank: s.rank ?? null, status: o.status, netReturnPct: round(net, 3) };
      });
      const immutable = { engine, role: spec.role, signalSession, legs, basketNetPct: round(mean(legs.map(x=>x.netReturnPct)), 4) };
      completed.push({ key: `${engine}|${signalSession}`, ...immutable, fingerprint: hash(immutable) });
    }
  }
  return completed.sort((a,b)=>a.signalSession.localeCompare(b.signalSession)||a.engine.localeCompare(b.engine));
}
function commonPairSessions(completed, a, b) {
  const ma = new Map(completed.filter(x=>x.engine===a).map(x=>[x.signalSession,x]));
  const mb = new Map(completed.filter(x=>x.engine===b).map(x=>[x.signalSession,x]));
  return [...ma.keys()].filter(d=>mb.has(d)).sort().map(d=>({date:d,a:ma.get(d),b:mb.get(d)}));
}
function nextCheckpoint(n) { return CHECKPOINTS.find(x => n < x) || null; }
function promotionReview(common) {
  const champSessions = common.map(x=>x.a), challSessions = common.map(x=>x.b);
  const champion = metrics(champSessions), challenger = metrics(challSessions);
  const g = POLICY.promotion;
  const gates = {
    minimumCommonResolvedSessions: common.length >= g.minimumCommonResolvedSessions,
    minimumProfitFactor: challenger.profitFactorInfinite || finite(challenger.profitFactor) && challenger.profitFactor >= g.minimumProfitFactor,
    minimumWinningSessionPct: finite(challenger.winningSessionPct) && challenger.winningSessionPct >= g.minimumWinningSessionPct,
    maximumDrawdown: finite(challenger.maximumDrawdownPct) && challenger.maximumDrawdownPct >= g.maximumDrawdownFloorPct,
    averageNetBeatsChampion: finite(challenger.averageNetPct) && finite(champion.averageNetPct) && challenger.averageNetPct > champion.averageNetPct,
    compoundedNetBeatsChampion: finite(challenger.compoundedNetPct) && finite(champion.compoundedNetPct) && challenger.compoundedNetPct > champion.compoundedNetPct,
  };
  const all = Object.values(gates).every(Boolean);
  return {
    status: common.length < g.minimumCommonResolvedSessions ? 'COLLECTION_PENDING' : all ? 'ELIGIBLE_FOR_HUMAN_REVIEW' : 'CHALLENGER_NOT_PROMOTABLE_AT_CURRENT_CHECKPOINT',
    automaticPromotion: false,
    commonResolvedSessions: common.length,
    nextCheckpoint: nextCheckpoint(common.length),
    gates,
    commonDateMetrics: { champion, challenger },
  };
}
function main() {
  const forward = read(FORWARD, null); if (!forward) throw new Error('Missing forward-shadow-ledger.json');
  const policyHash = hash(POLICY);
  const ledger = read(LEDGER, { schemaVersion:'champion-challenger-ledger-v1', createdAt:new Date().toISOString(), policy:POLICY, policyHash, completedSessions:[] });
  if (ledger.policyHash && ledger.policyHash !== policyHash) throw new Error('TOURNAMENT_POLICY_LOCK_CHANGED');
  ledger.policy = POLICY; ledger.policyHash = policyHash; ledger.completedSessions = Array.isArray(ledger.completedSessions) ? ledger.completedSessions : [];
  const existing = new Map(ledger.completedSessions.map(x=>[x.key,x]));
  const current = buildCompletedSessions(forward); let appended = 0;
  for (const row of current) {
    const prev = existing.get(row.key);
    if (prev) { if (prev.fingerprint !== row.fingerprint) throw new Error(`IMMUTABLE_TOURNAMENT_SESSION_CHANGED ${row.key}`); continue; }
    ledger.completedSessions.push({ ...row, sealedAt:new Date().toISOString() }); existing.set(row.key,row); appended++;
  }
  ledger.completedSessions.sort((a,b)=>a.signalSession.localeCompare(b.signalSession)||a.engine.localeCompare(b.engine));
  const byEngine = {};
  for (const [engine, spec] of Object.entries(ENGINE_SPECS)) {
    const rows = ledger.completedSessions.filter(x=>x.engine===engine);
    const signals = selectedSignals(forward, engine);
    const outKeys = new Set((forward.outcomes||[]).map(o=>o.signalKey));
    byEngine[engine] = { ...spec, signalsIssued:signals.length, signalsEvaluated:signals.filter(s=>outKeys.has(s.key)).length, ...metrics(rows) };
  }
  const common = commonPairSessions(ledger.completedSessions, POLICY.champion, POLICY.challenger);
  const review = promotionReview(common);
  const overlapByDate = {};
  for (const s of forward.signals || []) {
    if (!Object.hasOwn(ENGINE_SPECS,s.engine)) continue;
    if (s.engine==='GANN_FUSION_X_V1' && !strictGannSignal(s)) continue;
    const d=s.signalSession; overlapByDate[d] ||= {}; overlapByDate[d][s.engine] ||= new Set(); overlapByDate[d][s.engine].add(s.ticker);
  }
  const overlaps = Object.entries(overlapByDate).sort().map(([date,e])=>{
    const a=[...(e[POLICY.champion]||[])], b=[...(e[POLICY.challenger]||[])];
    const intersection=a.filter(x=>b.includes(x)); const union=new Set([...a,...b]);
    return {date, championCount:a.length, challengerCount:b.length, overlapTickers:intersection, overlapCount:intersection.length, jaccardPct:union.size?round(intersection.length/union.size*100,1):null};
  });
  ledger.lastUpdatedAt = new Date().toISOString();
  ledger.lastAppendCount = appended;
  ledger.head = { byEngine, commonHeadToHeadSessions:common.length, promotionReview:review, overlap:overlaps };
  write(LEDGER, ledger);
  write(REPORT, {
    schemaVersion:'champion-challenger-report-v1', generatedAt:ledger.lastUpdatedAt, policyHash,
    champion:POLICY.champion, challenger:POLICY.challenger, diagnostics:POLICY.diagnostic,
    byEngine, commonDateHeadToHead:{sessions:common.map(x=>x.date), count:common.length, champion:metrics(common.map(x=>x.a)), challenger:metrics(common.map(x=>x.b))},
    promotionReview:review, overlap:overlaps,
    notes:[
      'Only completed engine-sessions are sealed into the tournament ledger.',
      'GANN evidence is restricted to READY-only v2 ACTIONABLE signals with positive allocation.',
      'UNFILLED signals are treated as cash with 0% return for basket-level fairness.',
      'SEPA-X is diagnostic only because its execution levels are reconstructed shadow levels.',
      'No automatic promotion is permitted; checkpoints trigger human review only.'
    ]
  });
  console.log(JSON.stringify({appended,byEngine,common:common.length,promotionReview:review},null,2));
}
main();
