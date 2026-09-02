import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEgxRecommendationNumbers, summarizeV169RecommendationNumbers, enrichLegacyComparisonRecommendationNumbers, RECOMMENDATION_NUMBER_STATS_CONTRACT } from '../src/recommendation-number-stats.js';

test('recommendation-number stats have zero production/scoring authority',()=>{
  assert.equal(RECOMMENDATION_NUMBER_STATS_CONTRACT.authorityMode,'RESEARCH');
  assert.equal(RECOMMENDATION_NUMBER_STATS_CONTRACT.productionAuthority,false);
  assert.equal(RECOMMENDATION_NUMBER_STATS_CONTRACT.scoringImpact,'NONE');
  assert.equal(RECOMMENDATION_NUMBER_STATS_CONTRACT.automaticOrders,false);
});

test('EGX ONE recommendation number is deterministic daily output order',()=>{
  const records=[
    {signalSession:'2026-08-04',ticker:'AAA',outcome:{state:'TARGET1'}},
    {signalSession:'2026-08-04',ticker:'BBB',outcome:{state:'STOP'}},
    {signalSession:'2026-08-05',ticker:'CCC',outcome:{state:'TARGET2'}},
    {signalSession:'2026-08-05',ticker:'DDD',outcome:{state:'TARGET1'}},
    {signalSession:'2026-08-06',ticker:'EEE',outcome:{state:'TARGET1'}}
  ];
  const s=summarizeEgxRecommendationNumbers(records,['2026-08-04','2026-08-05']);
  assert.deepEqual(s.byNumber.map(x=>[x.recommendationNumber,x.targetHits,x.stops,x.resolved,x.targetHitRatePct]),[[1,2,0,2,100],[2,1,1,2,50]]);
  assert.equal(s.mostTargets.recommendationNumber,1);
  assert.equal(s.mostTargets.targetHits,2);
});

test('V16.9 recommendation number preserves exact member order per signal date',()=>{
  const ledger={sessions:[
    {signalDate:'2026-08-04',members:[{ticker:'A',memberStatus:'STOP_HIT'},{ticker:'B',memberStatus:'TARGET_HIT'}]},
    {signalDate:'2026-08-05',members:[{ticker:'C',memberStatus:'TARGET_HIT'},{ticker:'D',memberStatus:'TARGET_HIT'}]}
  ]};
  const s=summarizeV169RecommendationNumbers(ledger,['2026-08-04','2026-08-05']);
  assert.deepEqual(s.byNumber.map(x=>[x.recommendationNumber,x.targetHits,x.stops,x.targetHitRatePct]),[[1,1,1,50],[2,2,0,100]]);
  assert.equal(s.mostTargets.recommendationNumber,2);
  assert.equal(s.mostTargets.targetHits,2);
});

test('legacy comparison enrichment carries auditable stats for both engines',()=>{
  const comparison={commonDates:['2026-08-04'],comparisonRules:{},newTechnique:{onV16ExactSignalDates:{targetHitRatePct:50}},v16_9:{evidenceGrade:'EXACT_LOGGED_LEDGER'}};
  const simulation={records:[{signalSession:'2026-08-04',outcome:{state:'TARGET1'}},{signalSession:'2026-08-04',outcome:{state:'STOP'}}]};
  const legacyV169={sessions:[{signalDate:'2026-08-04',members:[{memberStatus:'STOP_HIT'},{memberStatus:'TARGET_HIT'}]}]};
  const c=enrichLegacyComparisonRecommendationNumbers({comparison,simulation,legacyV169});
  assert.equal(c.comparisonRules.recommendationNumberDefinition,'ONE_BASED_SESSION_ORDER_PRE_OUTCOME');
  assert.equal(c.newTechnique.onV16ExactSignalDates.recommendationNumberStats.mostTargets.recommendationNumber,1);
  assert.equal(c.v16_9.recommendationNumberStats.mostTargets.recommendationNumber,2);
});
