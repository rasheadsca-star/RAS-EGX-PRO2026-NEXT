import test from 'node:test';
import assert from 'node:assert/strict';
import {
  V169_RISK_ALPHA_POLICY,
  classifyRiskAlphaMember,
  evaluateRiskAlphaSession,
  aggregateRiskAlphaReturns,
} from '../src/v169RiskAlphaChallenger.js';

test('RiskAlpha is hard locked to zero production authority', () => {
  assert.equal(V169_RISK_ALPHA_POLICY.baseChampion, 'V16.9');
  assert.equal(V169_RISK_ALPHA_POLICY.rankingMutation, false);
  assert.equal(V169_RISK_ALPHA_POLICY.scoreMutation, false);
  assert.equal(V169_RISK_ALPHA_POLICY.entryZoneMutation, false);
  assert.equal(V169_RISK_ALPHA_POLICY.stopMutation, false);
  assert.equal(V169_RISK_ALPHA_POLICY.targetMutation, false);
  assert.equal(V169_RISK_ALPHA_POLICY.scoringImpact, 'NONE');
  assert.equal(V169_RISK_ALPHA_POLICY.alphaWeight, 0);
  assert.equal(V169_RISK_ALPHA_POLICY.productionAuthority, false);
  assert.equal(V169_RISK_ALPHA_POLICY.promotionEligible, false);
  assert.equal(V169_RISK_ALPHA_POLICY.retuningAllowedAfterAudit, false);
  assert.equal(V169_RISK_ALPHA_POLICY.freshForwardLedgerChanged, false);
});

test('only next-open below frozen entry low is vetoed', () => {
  assert.equal(classifyRiskAlphaMember({ ticker: 'AAA', entryLow: 100, nextOpen: 99 }).veto, true);
  assert.equal(classifyRiskAlphaMember({ ticker: 'AAA', entryLow: 100, nextOpen: 100 }).veto, false);
  assert.equal(classifyRiskAlphaMember({ ticker: 'AAA', entryLow: 100, nextOpen: 101 }).veto, false);
});

test('future outcome fields cannot change entry guard decision', () => {
  const a = classifyRiskAlphaMember({ ticker: 'AAA', entryLow: 100, nextOpen: 99 });
  const b = classifyRiskAlphaMember({
    ticker: 'AAA', entryLow: 100, nextOpen: 99,
    nextCloseReturnPct: 50, targetTouched: true, stopTouched: false,
  });
  assert.deepEqual(a, b);
});

test('vetoed member is removed without replacement and remaining members are reweighted', () => {
  const result = evaluateRiskAlphaSession({
    signalDate: '2026-08-01',
    outcomeDate: '2026-08-02',
    netReturnPct: -1.6,
    members: [
      { ticker: 'BAD', entryLow: 100, nextOpen: 99, nextCloseReturnPct: -5 },
      { ticker: 'GOOD', entryLow: 100, nextOpen: 101, nextCloseReturnPct: 2 },
    ],
  });
  assert.deepEqual(result.vetoedTickers, ['BAD']);
  assert.equal(result.keptCount, 1);
  assert.equal(result.vetoedCount, 1);
  assert.equal(result.challengerNetReturnPct, 1.4);
});

test('all vetoed becomes no-trade with zero return and no transaction cost', () => {
  const result = evaluateRiskAlphaSession({
    members: [
      { ticker: 'A', entryLow: 100, nextOpen: 99, nextCloseReturnPct: -2 },
      { ticker: 'B', entryLow: 50, nextOpen: 49, nextCloseReturnPct: -3 },
    ],
  });
  assert.equal(result.noTrade, true);
  assert.equal(result.challengerNetReturnPct, 0);
});

test('return aggregation computes profit factor and drawdown on the supplied session series', () => {
  const x = aggregateRiskAlphaReturns([2, -1, 1]);
  assert.equal(x.sessions, 3);
  assert.equal(x.profitFactor, 3);
  assert.ok(x.maximumDrawdownPct < 0);
});
