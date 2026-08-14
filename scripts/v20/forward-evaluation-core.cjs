#!/usr/bin/env node
'use strict';

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function round(value, digits = 4) {
  const n = finite(value);
  if (n === null) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')); }
function validOhlc(row) {
  const o = finite(row?.open), h = finite(row?.high), l = finite(row?.low), c = finite(row?.close);
  return [o,h,l,c].every(v => v !== null && v > 0) && h >= Math.max(o,c,l) && l <= Math.min(o,c,h);
}
function planRelationValid(plan) {
  const entryLow = finite(plan?.entryLow);
  const entryHigh = finite(plan?.entryHigh);
  const stop = finite(plan?.stop);
  const target1 = finite(plan?.target1);
  return [entryLow, entryHigh, stop, target1].every(v => v !== null && v > 0)
    && stop < entryLow && entryLow <= entryHigh && entryHigh < target1;
}
function researchPlanEligibility(coreRow, issuedRow = null) {
  const status = String(issuedRow?.status || coreRow?.status || '').toUpperCase();
  const plan = issuedRow?.tradePlan || coreRow || {};
  const alignment = issuedRow?.tradePlan?.alignment || null;
  const reasons = [];
  if (status === 'AVOID') reasons.push('ISSUED_STATUS_AVOID');
  if (!planRelationValid(plan)) reasons.push('INVALID_LONG_PLAN_RELATION');
  if (alignment?.hardReviewRequired === true) reasons.push('ISSUED_HARD_REVIEW_REQUIRED');
  if (alignment?.relationshipValid === false) reasons.push('ISSUED_ALIGNMENT_RELATION_INVALID');
  if (['REBUILD_REQUIRED_PRICE_SCALE_OR_STALENESS_UNVERIFIED','REBUILD_REQUIRED','INVALID_PLAN_RELATION'].includes(String(alignment?.state || ''))) {
    reasons.push('ISSUED_PLAN_REBUILD_OR_INVALID');
  }
  return { eligible: reasons.length === 0, reasons, status, plan, alignment };
}

function buildConsensusCalendar(histories, signalDate, asOfDate, options = {}) {
  const consensusPct = finite(options.consensusPct) ?? 50;
  const minimumVotes = Math.max(1, Math.trunc(finite(options.minimumVotes) ?? 5));
  const usable = Object.entries(histories || {}).filter(([, rows]) => Array.isArray(rows) && rows.some(r => validDate(r.date)));
  const historyCount = usable.length;
  const requiredVotes = historyCount ? Math.max(minimumVotes, Math.ceil(historyCount * consensusPct / 100)) : minimumVotes;
  const votes = new Map();
  for (const [ticker, rows] of usable) {
    const dates = new Set(rows
      .map(row => String(row.date || ''))
      .filter(date => validDate(date) && date > signalDate && date <= asOfDate));
    for (const date of dates) {
      if (!votes.has(date)) votes.set(date, new Set());
      votes.get(date).add(ticker);
    }
  }
  const candidates = [...votes.entries()]
    .map(([date, tickers]) => ({ date, voteCount: tickers.size, votePct: historyCount ? round(tickers.size / historyCount * 100, 2) : 0 }))
    .sort((a,b) => a.date.localeCompare(b.date));
  const acceptedSessions = candidates.filter(row => row.voteCount >= requiredVotes).map(row => row.date);
  return { signalDate, asOfDate, consensusPct, minimumVotes, historyCount, requiredVotes, candidates, acceptedSessions };
}

function outcomeReturn(entryPrice, exitPrice, transactionCostPct) {
  const gross = ((exitPrice / entryPrice) - 1) * 100;
  return { grossReturnPct: round(gross), netReturnPct: round(gross - transactionCostPct) };
}

function evaluateLongPlan(plan, rows, marketSessions, horizonSessions, transactionCostPct = 0.6) {
  if (!planRelationValid(plan)) return { resolved: true, entered: false, state: 'EXCLUDED_INVALID_PLAN_RELATION', grossReturnPct: null, netReturnPct: null, ambiguous: false };
  if (!Array.isArray(marketSessions) || marketSessions.length < horizonSessions) return { resolved: false, state: 'PENDING_HORIZON_SESSION_NOT_AVAILABLE' };
  const horizonDates = marketSessions.slice(0, horizonSessions);
  const byDate = new Map((rows || []).filter(row => validDate(row.date)).map(row => [row.date, row]));
  const entryDate = horizonDates[0];
  const entryRow = byDate.get(entryDate);
  if (!entryRow || !validOhlc(entryRow)) return { resolved: false, state: 'PENDING_ENTRY_SESSION_OHLC_MISSING', missingDate: entryDate };

  const entryLow = finite(plan.entryLow), entryHigh = finite(plan.entryHigh), stop = finite(plan.stop), target1 = finite(plan.target1);
  const entryPrice = finite(entryRow.open);
  if (!(entryPrice >= entryLow && entryPrice <= entryHigh)) {
    return {
      resolved: true, entered: false, executable: false,
      state: 'NOT_ENTERED_FIRST_SESSION_OPEN_OUTSIDE_RANGE',
      entryDate, entryPrice, entryLow, entryHigh,
      grossReturnPct: 0, netReturnPct: 0, transactionCostPctApplied: 0,
      ambiguous: false,
    };
  }

  for (let i = 0; i < horizonDates.length; i += 1) {
    const date = horizonDates[i];
    const row = byDate.get(date);
    if (!row || !validOhlc(row)) return { resolved: false, entered: true, state: 'PENDING_PATH_OHLC_MISSING', entryDate, entryPrice, missingDate: date };
    const open = finite(row.open), high = finite(row.high), low = finite(row.low), close = finite(row.close);

    if (i > 0 && open <= stop) {
      return { resolved: true, entered: true, executable: true, state: 'GAP_BELOW_STOP_EXIT_AT_OPEN', entryDate, entryPrice, exitDate: date, exitPrice: open, targetTouched: false, stopTouched: true, ambiguous: false, transactionCostPctApplied: transactionCostPct, ...outcomeReturn(entryPrice, open, transactionCostPct) };
    }
    if (i > 0 && open >= target1) {
      return { resolved: true, entered: true, executable: true, state: 'GAP_ABOVE_TARGET_CREDIT_CAPPED_AT_TARGET', entryDate, entryPrice, exitDate: date, exitPrice: target1, targetTouched: true, stopTouched: false, ambiguous: false, transactionCostPctApplied: transactionCostPct, ...outcomeReturn(entryPrice, target1, transactionCostPct) };
    }

    const targetTouched = high >= target1;
    const stopTouched = low <= stop;
    const ambiguous = targetTouched && stopTouched;
    if (ambiguous || stopTouched) {
      return { resolved: true, entered: true, executable: true, state: ambiguous ? 'AMBIGUOUS_TARGET_STOP_TREATED_AS_STOP' : 'STOP_TOUCHED', entryDate, entryPrice, exitDate: date, exitPrice: stop, targetTouched, stopTouched, ambiguous, transactionCostPctApplied: transactionCostPct, ...outcomeReturn(entryPrice, stop, transactionCostPct) };
    }
    if (targetTouched) {
      return { resolved: true, entered: true, executable: true, state: 'TARGET1_TOUCHED', entryDate, entryPrice, exitDate: date, exitPrice: target1, targetTouched: true, stopTouched: false, ambiguous: false, transactionCostPctApplied: transactionCostPct, ...outcomeReturn(entryPrice, target1, transactionCostPct) };
    }
    if (i === horizonDates.length - 1) {
      return { resolved: true, entered: true, executable: true, state: 'CLOSED_AT_HORIZON_CLOSE', entryDate, entryPrice, exitDate: date, exitPrice: close, targetTouched: false, stopTouched: false, ambiguous: false, transactionCostPctApplied: transactionCostPct, ...outcomeReturn(entryPrice, close, transactionCostPct) };
    }
  }
  return { resolved: false, state: 'UNEXPECTED_UNRESOLVED_PATH' };
}

function aggregateAppliedPortfolio(core, memberOutcomes) {
  const exposurePct = finite(core?.portfolio?.recommendedExposurePct) ?? 0;
  const opportunities = Array.isArray(core?.opportunities) ? core.opportunities : [];
  const applied = opportunities.filter(row => (finite(row.positionWeightPct) ?? 0) > 0);
  if (exposurePct <= 0 || applied.length === 0) {
    return { resolved: true, status: 'CASH_NO_APPLIED_EXPOSURE', appliedExposurePct: 0, cashPct: 100, grossReturnPct: 0, netReturnPct: 0, appliedPositionCount: 0, note: 'Issued production exposure was zero; research opportunity outcomes are not treated as applied portfolio performance.' };
  }
  const byTicker = new Map(memberOutcomes.map(row => [row.ticker, row]));
  if (applied.some(row => !byTicker.get(row.ticker)?.outcome?.resolved)) return { resolved: false, status: 'PENDING_APPLIED_MEMBER_OUTCOME', appliedExposurePct: exposurePct, grossReturnPct: null, netReturnPct: null };
  let gross = 0, net = 0;
  const members = [];
  for (const row of applied) {
    const weightPct = finite(row.positionWeightPct) ?? 0;
    const outcome = byTicker.get(row.ticker).outcome;
    gross += weightPct / 100 * (finite(outcome.grossReturnPct) ?? 0);
    net += weightPct / 100 * (finite(outcome.netReturnPct) ?? 0);
    members.push({ ticker: row.ticker, weightPct, state: outcome.state, grossReturnPct: outcome.grossReturnPct, netReturnPct: outcome.netReturnPct });
  }
  return { resolved: true, status: 'RESOLVED_APPLIED_PORTFOLIO', appliedExposurePct: exposurePct, cashPct: round(100 - exposurePct, 4), grossReturnPct: round(gross), netReturnPct: round(net), appliedPositionCount: applied.length, members };
}

function aggregateResearch(memberOutcomes, candidateCount) {
  const resolvedRows = memberOutcomes.filter(row => row.outcome?.resolved === true && row.researchEligible === true);
  if (resolvedRows.length !== candidateCount) return { resolved: false, status: 'PENDING_RESEARCH_MEMBER_OUTCOME', candidateCount, resolvedCount: resolvedRows.length };
  if (!candidateCount) return { resolved: true, status: 'NO_ELIGIBLE_RESEARCH_PLANS', candidateCount: 0, enteredCount: 0, notEnteredCount: 0, ambiguousCount: 0, equalWeightIssuedGrossReturnPct: null, equalWeightIssuedNetReturnPct: null, enteredOnlyAverageNetReturnPct: null };
  const entered = resolvedRows.filter(row => row.outcome.entered === true);
  const gross = resolvedRows.reduce((s,row) => s + (finite(row.outcome.grossReturnPct) ?? 0), 0) / candidateCount;
  const net = resolvedRows.reduce((s,row) => s + (finite(row.outcome.netReturnPct) ?? 0), 0) / candidateCount;
  const enteredNet = entered.length ? entered.reduce((s,row) => s + (finite(row.outcome.netReturnPct) ?? 0), 0) / entered.length : null;
  return {
    resolved: true,
    status: 'RESOLVED_RESEARCH_DIAGNOSTIC',
    candidateCount,
    enteredCount: entered.length,
    notEnteredCount: resolvedRows.filter(row => row.outcome.entered === false).length,
    ambiguousCount: resolvedRows.filter(row => row.outcome.ambiguous === true).length,
    equalWeightIssuedGrossReturnPct: round(gross),
    equalWeightIssuedNetReturnPct: round(net),
    enteredOnlyAverageNetReturnPct: round(enteredNet),
    decisionUse: 'RESEARCH_DIAGNOSTIC_ONLY_NOT_PRODUCTION_PERFORMANCE',
    appliedToProduction: false,
  };
}

module.exports = {
  finite, round, validOhlc, planRelationValid, researchPlanEligibility,
  buildConsensusCalendar, evaluateLongPlan, aggregateAppliedPortfolio, aggregateResearch,
};
