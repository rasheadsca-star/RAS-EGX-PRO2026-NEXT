import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEgxRecommendationNumbers, summarizeV169RecommendationNumbers, enrichLegacyComparisonRecommendationNumbers, RECOMMENDATION_NUMBER_STATS_CONTRACT, POSITION_EDGE_GATE } from '../src/recommendation-number-stats.js';

test('recommendation-number stats have zero production/scoring authority',()=>{
  assert.equal(RECOMMENDATION_NUMBER_STATS_CONTRACT.authorityMode,'RESEARCH');
  assert.equal(RECOMMENDATION_NUMBER_STATS_CONTRACT.productionAuthority,false);
  assert.equal(RECOMMENDATION_NUMBER_STATS_CONTRACT.scoringImpact,'NONE');
  assert.equal(RECOMMENDATION_NUMBER_STATS_CONTRACT.recommendationMutationAllowed,false);
  assert.equal(RECOMMENDATION_NUMBER_STATS_CONTRACT.automaticOrders,false);
});

test('EGX ONE recommendation number is deterministic daily output order',()=>{
  const records=[
    {signalSession:'2026-08-04',ticker:'AAA',outcome:{state:'TARGET1',rMultiple:1.2},netReturnPct:3},
    {signalSession:'2026-08-04',ticker:'BBB',outcome:{state:'STOP',rMultiple:-1},netReturnPct:-2},
    {signalSession:'2026-08-05',ticker:'CCC',outcome:{state:'TARGET2',rMultiple:2},netReturnPct:5},
    {signalSession:'2026-08-05',ticker:'DDD',outcome:{state:'TARGET1',rMultiple:1},netReturnPct:2},
    {signalSession:'2026-08-06',ticker:'EEE',outcome:{state:'TARGET1'},netReturnPct:1}
  ];
  const s=summarizeEgxRecommendationNumbers(records,['2026-08-04','2026-08-05']);
  assert.deepEqual(s.byNumber.map(x=>[x.recommendationNumber,x.targetHits,x.stops,x.resolved,x.targetHitRatePct]),[[1,2,0,2,100],[2,1,1,2,50]]);
  assert.equal(s.mostTargets.recommendationNumber,1);
  assert.equal(s.mostTargets.targetHits,2);
  assert.equal(s.baseline.targetHitRatePct,75);
  assert.equal(s.byNumber[0].targetHitRateLiftPctPoints,25);
  assert.equal(s.byNumber[1].targetHitRateLiftPctPoints,-25);
  assert.equal(s.byNumber[0].averageNetReturnPct,4);
  assert.equal(s.byNumber[1].netReturnProfitFactor,1);
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

test('position edge exposes #1-4 #5-8 #9-12 groups, appearance bias and no automatic reranking',()=>{
  const records=[];
  for(let day=1;day<=7;day++){
    const session=`2026-08-${String(day).padStart(2,'0')}`;
    const count=day===7?10:12;
    for(let n=1;n<=count;n++){
      let state='STOP';
      if(n===10)state=day<=6?'TARGET1':'STOP';
      else if(n===12)state=day<=5?'TARGET1':'STOP';
      else if(n<=4&&day<=3)state='TARGET1';
      records.push({signalSession:session,ticker:`T${day}_${n}`,outcome:{state,rMultiple:state.startsWith('TARGET')?1:-1},netReturnPct:state.startsWith('TARGET')?2:-1});
    }
  }
  const s=summarizeEgxRecommendationNumbers(records);
  assert.equal(s.highestHitRate.recommendationNumber,10);
  assert.equal(s.highestHitRate.targetHits,6);
  assert.equal(s.highestHitRate.resolved,7);
  assert.equal(s.highestHitRate.targetHitRatePct,85.71);
  const twelve=s.byNumber.find(x=>x.recommendationNumber===12);
  assert.equal(twelve.targetHits,5);
  assert.equal(twelve.resolved,6);
  assert.equal(twelve.targetHitRatePct,83.33);
  assert.equal(twelve.appearanceRatePct,85.71);
  assert.deepEqual(s.byGroup.map(x=>x.label),['#1–4','#5–8','#9–12']);
  assert.equal(s.positionEdge.bestNumber.recommendationNumber,10);
  assert.equal(s.positionEdge.bestNumber.gate.status,'DISCOVERY_ONLY');
  assert.equal(s.positionEdge.bestNumber.gate.positionAdjustmentEligible,false);
  assert.ok(s.positionEdge.bestNumber.gate.reasons.includes(`RESOLVED_LT_${POSITION_EDGE_GATE.minResolved}`));
  assert.equal(s.positionEdge.rankingAdjustment.eligible,false);
});

test('legacy comparison enrichment carries auditable stats and explicit position-edge policy',()=>{
  const comparison={commonDates:['2026-08-04'],comparisonRules:{},newTechnique:{onV16ExactSignalDates:{targetHitRatePct:50}},v16_9:{evidenceGrade:'EXACT_LOGGED_LEDGER'}};
  const simulation={records:[{signalSession:'2026-08-04',outcome:{state:'TARGET1'}},{signalSession:'2026-08-04',outcome:{state:'STOP'}}]};
  const legacyV169={sessions:[{signalDate:'2026-08-04',members:[{memberStatus:'STOP_HIT'},{memberStatus:'TARGET_HIT'}]}]};
  const c=enrichLegacyComparisonRecommendationNumbers({comparison,simulation,legacyV169});
  assert.equal(c.comparisonRules.recommendationNumberDefinition,'ONE_BASED_SESSION_ORDER_PRE_OUTCOME');
  assert.equal(c.comparisonRules.positionEdgePolicy,'INFO_ONLY_NO_RANKING_MUTATION_PENDING_FORWARD_VALIDATION');
  assert.equal(c.newTechnique.onV16ExactSignalDates.recommendationNumberStats.mostTargets.recommendationNumber,1);
  assert.equal(c.v16_9.recommendationNumberStats.mostTargets.recommendationNumber,2);
});
