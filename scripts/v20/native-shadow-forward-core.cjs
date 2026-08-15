#!/usr/bin/env node
'use strict';
const { finite, round, buildConsensusCalendar, evaluateLongPlan } = require('./forward-evaluation-core.cjs');

function canonicalNativeCandidate(row) {
  return {
    rank: Number(row.rank),
    ticker: String(row.ticker || '').trim().toUpperCase(),
    nativeResearchScore: finite(row.nativeResearchScore),
    scoreBeforeRegimeAndCaps: finite(row.rankingTieBreaker?.scoreBeforeRegimeAndCaps),
    rankingContract: row.rankingTieBreaker?.contract || null,
    entryLow: finite(row.entryLow),
    entryHigh: finite(row.entryHigh),
    stop: finite(row.stop),
    target1: finite(row.target1),
    netRiskReward: finite(row.netRiskReward),
    alignmentState: row.alignmentState || null,
    wasInLegacySeedUniverse: row.wasInLegacySeedUniverse === true,
  };
}
function planFromCandidate(row) {
  return { entryLow: row.entryLow, entryHigh: row.entryHigh, stop: row.stop, target1: row.target1 };
}
function evaluateNativeBasket(candidates, historiesByTicker, marketSessions, horizonSessions, transactionCostPct) {
  const members = [];
  for (const row of candidates || []) {
    const history = historiesByTicker[row.ticker] || [];
    const outcome = evaluateLongPlan(planFromCandidate(row), history, marketSessions, horizonSessions, transactionCostPct);
    members.push({ ticker: row.ticker, rank: row.rank, nativeResearchScore: row.nativeResearchScore, outcome });
  }
  if (members.some(m => m.outcome?.resolved !== true)) {
    return { resolved: false, status: 'PENDING_NATIVE_MEMBER_OUTCOME', candidateCount: members.length, resolvedCount: members.filter(m=>m.outcome?.resolved===true).length, members };
  }
  const count = members.length;
  if (!count) return { resolved: true, status: 'NO_NATIVE_CANDIDATES', candidateCount: 0, enteredCount: 0, notEnteredCount: 0, ambiguousCount: 0, equalWeightGrossReturnPct: null, equalWeightNetReturnPct: null, enteredOnlyAverageNetReturnPct: null, members: [] };
  const entered = members.filter(m => m.outcome.entered === true);
  const gross = members.reduce((s,m)=>s+(finite(m.outcome.grossReturnPct)??0),0)/count;
  const net = members.reduce((s,m)=>s+(finite(m.outcome.netReturnPct)??0),0)/count;
  const enteredNet = entered.length ? entered.reduce((s,m)=>s+(finite(m.outcome.netReturnPct)??0),0)/entered.length : null;
  return {
    resolved: true,
    status: 'RESOLVED_NATIVE_SHADOW_RESEARCH',
    candidateCount: count,
    enteredCount: entered.length,
    notEnteredCount: members.filter(m=>m.outcome.entered===false).length,
    ambiguousCount: members.filter(m=>m.outcome.ambiguous===true).length,
    equalWeightGrossReturnPct: round(gross),
    equalWeightNetReturnPct: round(net),
    enteredOnlyAverageNetReturnPct: round(enteredNet),
    members,
  };
}
function summarizeByHorizon(evaluations, eligibleHashes) {
  const byHorizon = {};
  for (const horizon of [1,3,5,10,20]) {
    const rows=(evaluations||[]).filter(r=>Number(r.horizonSessions)===horizon&&eligibleHashes.has(r.nativeSignalHash)&&r.status==='RESOLVED');
    const values=rows.map(r=>finite(r.equalWeightNetReturnPct)).filter(v=>v!==null);
    const wins=values.filter(v=>v>0).length;
    const gains=values.filter(v=>v>0).reduce((s,v)=>s+v,0);
    const losses=Math.abs(values.filter(v=>v<0).reduce((s,v)=>s+v,0));
    byHorizon[horizon]={
      resolvedIndependentSessionCount: rows.length,
      averageNetReturnPct: values.length?round(values.reduce((s,v)=>s+v,0)/values.length):null,
      sessionWinRatePct: values.length?round(wins/values.length*100,2):null,
      profitFactor: values.length&&losses>0?round(gains/losses,4):(values.length&&gains>0?null:null),
      minimumIndependentSessionsForReview:30,
      reviewSampleReady:rows.length>=30,
    };
  }
  return byHorizon;
}
module.exports={finite,round,buildConsensusCalendar,canonicalNativeCandidate,evaluateNativeBasket,summarizeByHorizon};
