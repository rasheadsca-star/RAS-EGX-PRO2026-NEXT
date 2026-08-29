import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMetaOpportunityV2 } from '../src/metaEngineV2.js';

const base = {
  ticker: 'TEST', signalDate: '2026-08-27', dataQuality: 95, liquidityScore: 90,
  netRiskReward: 1.8, expectedEdgePct: 2, estimatedRoundTripCostPct: 0.6, marketRegime: 'NEUTRAL'
};

const v16 = {
  id: 'V16_9', role: 'PRIMARY_ALPHA', lineageStatus: 'SHARED_RESEARCH_LINEAGE',
  lineageGroup: 'V16_RESEARCH_LINEAGE', signalDate: '2026-08-27',
  evidenceClass: 'WALK_FORWARD_POINT_IN_TIME', signalScore: 88, priorWeight: 1,
  sampleSize: 55, hitRatePct: 40
};

const v19 = {
  id: 'V19_V6', role: 'CONFIRMATORY_ALPHA', lineageStatus: 'SHARED_RESEARCH_LINEAGE',
  lineageGroup: 'V16_RESEARCH_LINEAGE', signalDate: '2026-08-27',
  evidenceClass: 'HOLDOUT_REUSED_DIAGNOSTIC', signalScore: 90, priorWeight: 1,
  sampleSize: 52, hitRatePct: 34.62
};

test('V19 shared lineage is capped and never counted as a fresh independent family', () => {
  const r = analyzeMetaOpportunityV2({ ...base, engines: [v16, v19] });
  assert.equal(r.gates.freshIndependentFamilyCount, 0);
  assert.equal(r.governance.promotionEligible, false);
  assert.equal(r.lineageAudit.find(x => x.id === 'V19_V6').alphaPriorWeight, 0.25);
});

test('Gann and SEPA diagnostic engines have exactly zero alpha weight', () => {
  const r = analyzeMetaOpportunityV2({ ...base, engines: [
    v16,
    { id: 'GANN', role: 'DIAGNOSTIC_ONLY', lineageStatus: 'INDEPENDENT', signalDate: '2026-08-27', signalScore: 100 },
    { id: 'SEPA', role: 'DIAGNOSTIC_ONLY', lineageStatus: 'INDEPENDENT', signalDate: '2026-08-27', signalScore: 100 }
  ] });
  assert.equal(r.lineageAudit.find(x => x.id === 'GANN').alphaPriorWeight, 0);
  assert.equal(r.lineageAudit.find(x => x.id === 'SEPA').alphaPriorWeight, 0);
});

test('fundamentals/news risk modifiers can penalize but never create alpha', () => {
  const risk = { id: 'NEWS', role: 'RISK_ONLY', lineageStatus: 'INDEPENDENT', signalDate: '2026-08-27', signalScore: 100, riskPenalty: 7 };
  const r = analyzeMetaOpportunityV2({ ...base, engines: [v16, risk] });
  assert.equal(r.lineageAudit.find(x => x.id === 'NEWS').alphaPriorWeight, 0);
  assert.equal(r.gates.riskOnlyPenalty, 7);
});

test('stale V19 confirmation is excluded instead of interpreted as bearish', () => {
  const stale = { ...v19, signalDate: '2026-08-26' };
  const r = analyzeMetaOpportunityV2({ ...base, engines: [v16, stale] });
  const a = r.lineageAudit.find(x => x.id === 'V19_V6');
  assert.equal(a.alphaPriorWeight, 0);
  assert.ok(a.exclusionReasons.includes('SESSION_NOT_ALIGNED'));
});

test('same underlying method aliases receive zero alpha independence', () => {
  const alias = {
    id: 'V17_ALIAS', role: 'CONFIRMATORY_ALPHA', lineageStatus: 'SAME_UNDERLYING_METHOD',
    lineageGroup: 'V16_RESEARCH_LINEAGE', signalDate: '2026-08-27',
    evidenceClass: 'WALK_FORWARD_POINT_IN_TIME', signalScore: 100
  };
  const r = analyzeMetaOpportunityV2({ ...base, engines: [v16, alias] });
  assert.equal(r.lineageAudit.find(x => x.id === 'V17_ALIAS').alphaPriorWeight, 0);
});

test('missing primary alpha forces NO_TRADE', () => {
  const independent = {
    id: 'NEW', role: 'CONFIRMATORY_ALPHA', lineageStatus: 'INDEPENDENT', family: 'NEW',
    signalDate: '2026-08-27', evidenceClass: 'FRESH_FORWARD_INDEPENDENT', signalScore: 99,
    sampleSize: 50, hitRatePct: 60
  };
  const r = analyzeMetaOpportunityV2({ ...base, engines: [independent] });
  assert.equal(r.decision, 'NO_TRADE');
  assert.ok(r.gates.blocking.includes('PRIMARY_ALPHA_MISSING'));
});

test('future or mismatched timestamps cannot manufacture confirmation', () => {
  const future = { ...v19, signalDate: '2026-08-28' };
  const r = analyzeMetaOpportunityV2({ ...base, engines: [v16, future] });
  assert.equal(r.lineageAudit.find(x => x.id === 'V19_V6').alphaPriorWeight, 0);
});

test('fresh independent family accounting ignores shared-lineage engines', () => {
  const primaryIndependent = { ...v16, lineageStatus: 'INDEPENDENT', family: 'V16_PRIMARY' };
  const independent = {
    id: 'RAW_A', role: 'CONFIRMATORY_ALPHA', lineageStatus: 'INDEPENDENT', family: 'RAW_A',
    signalDate: '2026-08-27', evidenceClass: 'FRESH_FORWARD_INDEPENDENT', signalScore: 99,
    priorWeight: 1, sampleSize: 50, hitRatePct: 60
  };
  const r = analyzeMetaOpportunityV2({ ...base, engines: [primaryIndependent, independent, v19] });
  assert.equal(r.gates.freshIndependentFamilyCount, 2);
  assert.equal(r.lineageAudit.find(x => x.id === 'V19_V6').lineageStatus, 'SHARED_RESEARCH_LINEAGE');
});
