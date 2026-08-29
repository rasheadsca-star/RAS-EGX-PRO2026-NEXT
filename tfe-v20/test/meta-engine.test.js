import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMetaOpportunity, rankMetaOpportunities } from '../src/metaEngine.js';

function strongEngines() {
  return [
    { id: 'TFE_V20', family: 'TFE', signalScore: 88, evidenceClass: 'WALK_FORWARD_POINT_IN_TIME', sampleSize: 55, wilsonLowerPct: 36, dataQuality: 100 },
    { id: 'SEPA_X', family: 'SEPA', signalScore: 84, evidenceClass: 'RETROSPECTIVE_POINT_IN_TIME', sampleSize: 40, wilsonLowerPct: 42, dataQuality: 95 },
    { id: 'GANN_FUSION', family: 'GANN', signalScore: 78, evidenceClass: 'RETROSPECTIVE_PROXY', sampleSize: 30, hitRatePct: 55, dataQuality: 90 }
  ];
}

test('hard data gate forces NO_TRADE even when all engines are bullish', () => {
  const r = analyzeMetaOpportunity({
    ticker: 'TEST', dataQuality: 60, liquidityScore: 90, netRiskReward: 2, expectedEdgePct: 2,
    marketRegime: 'RISK_ON', engines: strongEngines()
  });
  assert.equal(r.decision, 'NO_TRADE');
  assert.ok(r.gates.blocking.includes('DATA_QUALITY_GATE_FAIL'));
});

test('missing engine evidence is downweighted rather than treated as a bearish vote', () => {
  const base = {
    ticker: 'TEST', dataQuality: 95, liquidityScore: 90, netRiskReward: 1.8, expectedEdgePct: 1.5,
    marketRegime: 'NEUTRAL'
  };
  const a = analyzeMetaOpportunity({ ...base, engines: strongEngines().slice(0, 2) });
  const b = analyzeMetaOpportunity({ ...base, engines: [...strongEngines().slice(0, 2), { id: 'MISSING', family: 'OTHER', evidenceClass: 'UNVERIFIED' }] });
  assert.ok(Math.abs(a.metaScore - b.metaScore) < 2.5);
});

test('correlated engines cannot manufacture independent consensus', () => {
  const engines = [
    { id: 'A1', family: 'TFE', signalScore: 95, evidenceClass: 'FRESH_FORWARD_INDEPENDENT', sampleSize: 100, wilsonLowerPct: 60 },
    { id: 'A2', family: 'TFE', signalScore: 95, evidenceClass: 'FRESH_FORWARD_INDEPENDENT', sampleSize: 100, wilsonLowerPct: 60 },
    { id: 'A3', family: 'TFE', signalScore: 95, evidenceClass: 'FRESH_FORWARD_INDEPENDENT', sampleSize: 100, wilsonLowerPct: 60 }
  ];
  const r = analyzeMetaOpportunity({
    ticker: 'TEST', dataQuality: 100, liquidityScore: 100, netRiskReward: 2, expectedEdgePct: 2,
    marketRegime: 'RISK_ON', engines
  });
  assert.equal(r.gates.independentFamilyCount, 1);
  assert.notEqual(r.decision, 'BUY');
});

test('transaction costs are deducted before the edge gate', () => {
  const r = analyzeMetaOpportunity({
    ticker: 'TEST', dataQuality: 95, liquidityScore: 90, netRiskReward: 1.8,
    expectedEdgePct: 0.7, estimatedRoundTripCostPct: 0.5, engines: strongEngines()
  });
  assert.equal(r.decision, 'NO_TRADE');
  assert.ok(r.gates.blocking.includes('EDGE_AFTER_COSTS_TOO_LOW'));
});

test('risk-off regime reduces score instead of silently preserving bullish rank', () => {
  const common = { ticker: 'TEST', dataQuality: 95, liquidityScore: 90, netRiskReward: 1.8, expectedEdgePct: 1.5, engines: strongEngines() };
  const neutral = analyzeMetaOpportunity({ ...common, marketRegime: 'NEUTRAL' });
  const riskOff = analyzeMetaOpportunity({ ...common, marketRegime: 'RISK_OFF' });
  assert.ok(riskOff.metaScore < neutral.metaScore);
});

test('BUY requires independent families and sufficiently strong evidence', () => {
  const engines = [
    { id: 'TFE', family: 'TFE', signalScore: 98, evidenceClass: 'FRESH_FORWARD_INDEPENDENT', sampleSize: 120, wilsonLowerPct: 70 },
    { id: 'SEPA', family: 'SEPA', signalScore: 96, evidenceClass: 'FRESH_FORWARD_INDEPENDENT', sampleSize: 90, wilsonLowerPct: 68 }
  ];
  const r = analyzeMetaOpportunity({
    ticker: 'TEST', dataQuality: 100, liquidityScore: 100, netRiskReward: 2.5,
    expectedEdgePct: 2.5, marketRegime: 'RISK_ON', engines
  });
  assert.equal(r.decision, 'BUY');
});

test('ranking puts actionable decisions before watch/no-trade and remains deterministic', () => {
  const ranked = rankMetaOpportunities([
    { ticker: 'CCC', decision: 'NO_TRADE', metaScore: 90 },
    { ticker: 'BBB', decision: 'READY', metaScore: 70 },
    { ticker: 'AAA', decision: 'BUY', metaScore: 80 }
  ]);
  assert.deepEqual(ranked.map(x => x.ticker), ['AAA', 'BBB', 'CCC']);
});
