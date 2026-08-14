#!/usr/bin/env node
'use strict';
const assert = require('assert');
const {
  buildConsensusCalendar, evaluateLongPlan, aggregateAppliedPortfolio,
  aggregateResearch, researchPlanEligibility,
} = require('./forward-evaluation-core.cjs');

const plan = { entryLow: 100, entryHigh: 102, stop: 95, target1: 110 };
const row = (date, open, high, low, close) => ({ date, open, high, low, close });

const histories = {
  A: [row('2026-08-16',100,101,99,100), row('2026-08-17',100,102,99,101)],
  B: [row('2026-08-16',100,101,99,100), row('2026-08-17',100,102,99,101)],
  C: [row('2026-08-16',100,101,99,100)],
  D: [row('2026-08-16',100,101,99,100), row('2026-08-17',100,102,99,101)],
  E: [row('2026-08-16',100,101,99,100), row('2026-08-18',100,102,99,101)],
};
const calendar = buildConsensusCalendar(histories, '2026-08-13', '2026-08-17', { consensusPct: 50, minimumVotes: 2 });
assert.deepStrictEqual(calendar.acceptedSessions, ['2026-08-16','2026-08-17']);
assert.ok(!calendar.candidates.some(x => x.date > '2026-08-17'));

let out = evaluateLongPlan(plan, [row('2026-08-16',103,105,100,102)], ['2026-08-16'], 1, 0.6);
assert.equal(out.state, 'NOT_ENTERED_FIRST_SESSION_OPEN_OUTSIDE_RANGE');
assert.equal(out.netReturnPct, 0);

out = evaluateLongPlan(plan, [row('2026-08-16',101,111,98,110)], ['2026-08-16'], 1, 0.6);
assert.equal(out.state, 'TARGET1_TOUCHED');
assert.equal(out.exitPrice, 110);
assert.equal(out.netReturnPct, 8.3109);

out = evaluateLongPlan(plan, [row('2026-08-16',101,105,94,96)], ['2026-08-16'], 1, 0.6);
assert.equal(out.state, 'STOP_TOUCHED');
assert.equal(out.exitPrice, 95);
assert.equal(out.netReturnPct, -6.5406);

out = evaluateLongPlan(plan, [row('2026-08-16',101,111,94,105)], ['2026-08-16'], 1, 0.6);
assert.equal(out.state, 'AMBIGUOUS_TARGET_STOP_TREATED_AS_STOP');
assert.equal(out.ambiguous, true);
assert.equal(out.exitPrice, 95);

out = evaluateLongPlan(plan, [
  row('2026-08-16',101,105,99,103),
  row('2026-08-17',94,98,92,95),
], ['2026-08-16','2026-08-17'], 2, 0.6);
assert.equal(out.state, 'GAP_BELOW_STOP_EXIT_AT_OPEN');
assert.equal(out.exitPrice, 94);
assert.ok(out.netReturnPct < -7);

out = evaluateLongPlan(plan, [
  row('2026-08-16',101,105,99,103),
  row('2026-08-17',112,115,111,114),
], ['2026-08-16','2026-08-17'], 2, 0.6);
assert.equal(out.state, 'GAP_ABOVE_TARGET_CREDIT_CAPPED_AT_TARGET');
assert.equal(out.exitPrice, 110);

out = evaluateLongPlan(plan, [
  row('2026-08-16',101,105,99,103),
  row('2026-08-17',104,106,101,105),
], ['2026-08-16','2026-08-17'], 2, 0.6);
assert.equal(out.state, 'CLOSED_AT_HORIZON_CLOSE');
assert.equal(out.exitPrice, 105);

out = evaluateLongPlan(plan, [row('2026-08-16',101,105,99,103)], ['2026-08-16'], 3, 0.6);
assert.equal(out.resolved, false);
assert.equal(out.state, 'PENDING_HORIZON_SESSION_NOT_AVAILABLE');

const eligibility = researchPlanEligibility({ ...plan, status: 'WAIT' }, { status: 'WAIT', tradePlan: { ...plan, alignment: { hardReviewRequired: true, relationshipValid: true } } });
assert.equal(eligibility.eligible, false);
assert.ok(eligibility.reasons.includes('ISSUED_HARD_REVIEW_REQUIRED'));

const cashApplied = aggregateAppliedPortfolio({ portfolio: { recommendedExposurePct: 0 }, opportunities: [{ ticker:'A', positionWeightPct:0 }] }, []);
assert.equal(cashApplied.status, 'CASH_NO_APPLIED_EXPOSURE');
assert.equal(cashApplied.netReturnPct, 0);

const research = aggregateResearch([
  { researchEligible:true, outcome:{ resolved:true, entered:true, netReturnPct:2, grossReturnPct:2.6, ambiguous:false } },
  { researchEligible:true, outcome:{ resolved:true, entered:false, netReturnPct:0, grossReturnPct:0, ambiguous:false } },
], 2);
assert.equal(research.equalWeightIssuedNetReturnPct, 1);
assert.equal(research.enteredOnlyAverageNetReturnPct, 2);
assert.equal(research.appliedToProduction, false);

console.log(JSON.stringify({ ok:true, cases:11, ambiguityPolicy:'TREAT_AS_STOP', appliedCashSeparation:true }, null, 2));
