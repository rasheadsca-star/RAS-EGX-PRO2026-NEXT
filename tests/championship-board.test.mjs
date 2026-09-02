import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

await import('../championship-board.js');
const B=globalThis.EGXOneChampionshipBoard;

test('championship board has zero production/recommendation authority',()=>{
  assert.equal(B.CONTRACT.authorityMode,'RESEARCH');
  assert.equal(B.CONTRACT.productionAuthority,false);
  assert.equal(B.CONTRACT.scoringImpact,'NONE');
  assert.equal(B.CONTRACT.recommendationMutationAllowed,false);
  assert.equal(B.CONTRACT.executionAllowed,false);
  assert.equal(B.CONTRACT.automaticOrders,false);
});

test('parses the real simulator outcome object shape',()=>{
  const row={signalSession:'2026-08-04',outcome:{state:'TARGET1',fill:10,exit:11,rMultiple:1},terminalSession:'2026-08-05',netReturnPct:9.5};
  assert.equal(B.outcomeOf(row),'TARGET1');
  assert.equal(B.signalSessionOf(row),'2026-08-04');
  assert.equal(B.netReturnOf(row),9.5);
});

test('date-aligned outcome comparison awards exactly one independent point',()=>{
  const sim={
    legacyComparison:{
      comparisonRules:{
        newTechniqueRoundTripCostPct:0.25,
        v16Comparison:'DATE_ALIGNED_POLICY_COMPARISON; execution horizons and costs may differ'
      },
      commonDates:['2026-08-04','2026-08-05'],
      newTechnique:{evidenceGrade:'POINT_IN_TIME_HISTORICAL_REPLAY'},
      v16_9:{
        evidenceGrade:'EXACT_LOGGED_LEDGER',commonSignalDates:2,resolvedMembers:4,
        targetHits:2,stopHits:2,targetHitRatePct:50,stopRatePct:50,
        averageNetReturnPct:1.1,netReturnProfitFactor:1.5,estimatedRoundTripCostPct:0.6
      }
    },
    records:[
      {signalSession:'2026-08-04',outcome:{state:'TARGET1'},netReturnPct:3},
      {signalSession:'2026-08-04',outcome:{state:'TARGET2'},netReturnPct:5},
      {signalSession:'2026-08-05',outcome:{state:'STOP'},netReturnPct:-2},
      {signalSession:'2026-08-05',outcome:{state:'TIMEOUT'},netReturnPct:-0.1},
      {signalSession:'2026-08-06',outcome:{state:'STOP'},netReturnPct:-3}
    ]
  };
  const c=B.buildComparison(sim,{resolutions:[]});
  assert.equal(c.current.resolvedMembers,3);
  assert.equal(c.current.timeouts,1);
  assert.equal(c.current.targetHitRatePct,66.67);
  assert.equal(c.current.stopRatePct,33.33);
  assert.equal(c.sameDateScope,true);
  assert.equal(c.score.current,1);
  assert.equal(c.score.v16,0);
  assert.equal(c.score.leader,'EGX ONE');
  assert.equal(c.score.qualifiedMetrics,1);
  assert.equal(c.metrics.find(x=>x.id==='failure').qualified,false);
  assert.equal(c.metrics.find(x=>x.id==='avgNet').qualified,false);
  assert.equal(c.costComparable,false);
});

test('recommendation-number fallback derives daily rank before outcomes and stays info-only',()=>{
  const sim={legacyComparison:{comparisonRules:{v16Comparison:'DATE_ALIGNED_POLICY_COMPARISON'},commonDates:['2026-08-04','2026-08-05'],newTechnique:{evidenceGrade:'POINT_IN_TIME_HISTORICAL_REPLAY'},v16_9:{evidenceGrade:'EXACT_LOGGED_LEDGER',commonSignalDates:2,targetHitRatePct:50,stopRatePct:50,recommendationNumberStats:{numbering:'ONE_BASED_SESSION_ORDER',byNumber:[{recommendationNumber:1,resolved:2,targetHits:0,targetHitRatePct:0},{recommendationNumber:2,resolved:2,targetHits:2,targetHitRatePct:100}],mostTargets:{recommendationNumber:2,resolved:2,targetHits:2,targetHitRatePct:100}}}},records:[{signalSession:'2026-08-04',outcome:{state:'TARGET1'}},{signalSession:'2026-08-04',outcome:{state:'STOP'}},{signalSession:'2026-08-05',outcome:{state:'TARGET2'}},{signalSession:'2026-08-05',outcome:{state:'TARGET1'}}]};
  const c=B.buildComparison(sim,{resolutions:[]});
  assert.equal(c.current.recommendationNumberStats.mostTargets.recommendationNumber,1);
  assert.equal(c.current.recommendationNumberStats.mostTargets.targetHits,2);
  assert.equal(c.v16.recommendationNumberStats.mostTargets.recommendationNumber,2);
  assert.equal(c.score.qualifiedMetrics,1);
  const html=B.renderHTML(c);
  assert.match(html,/Recommendation # Performance/);
  assert.match(html,/MOST TARGETS/);
  assert.match(html,/Recommendation <span class="egx-rec-number">#1/);
  assert.match(html,/Recommendation <span class="egx-rec-number">#2/);
});

test('real simulator artifact agrees with common-date session summaries',()=>{
  const sim=JSON.parse(fs.readFileSync(new URL('../data/research/simulator/latest.json',import.meta.url),'utf8'));
  const c=B.buildComparison(sim,{resolutions:[]});
  const dates=new Set(sim.legacyComparison.commonDates);
  const sessions=(sim.performance?.allDailySignals?.sessions||[]).filter(s=>dates.has(s.session));
  const targets=sessions.reduce((n,s)=>n+Number(s.targetHits||0),0);
  const stops=sessions.reduce((n,s)=>n+Number(s.stops||0),0);
  const triggered=sessions.reduce((n,s)=>n+Number(s.triggered||0),0);
  assert.equal(c.current.commonSignalDates,sim.legacyComparison.commonDates.length);
  assert.equal(c.current.targetHits,targets);
  assert.equal(c.current.stopHits,stops);
  assert.equal(c.current.timeouts,triggered-targets-stops);
  assert.equal(c.current.resolvedMembers,targets+stops);
  assert.equal(c.v16.evidenceGrade,'EXACT_LOGGED_LEDGER');
  assert.equal(c.sameDateScope,true);
  assert.equal(c.costComparable,false);
  const expectedLeader=c.current.targetHitRatePct>c.v16.targetHitRatePct?'EGX ONE':c.current.targetHitRatePct<c.v16.targetHitRatePct?'V16.9 EGX PRO':'TIE';
  assert.equal(c.score.leader,expectedLeader);
});

test('missing exact/date-aligned evidence produces N/A leader and no fabricated point',()=>{
  const sim={legacyComparison:{comparisonRules:{v16Comparison:'DATE_ALIGNED_POLICY_COMPARISON'},commonDates:['2026-08-04'],newTechnique:{evidenceGrade:'POINT_IN_TIME_HISTORICAL_REPLAY'},v16_9:{evidenceGrade:'RECONSTRUCTED',commonSignalDates:1,targetHitRatePct:40}},records:[{signalSession:'2026-08-04',outcome:{state:'TARGET1'}}]};
  const c=B.buildComparison(sim,null);
  assert.equal(c.score.current,0);
  assert.equal(c.score.v16,0);
  assert.equal(c.score.leader,'N/A');
  assert.equal(c.metrics[0].qualified,false);
});

test('forward evidence is shown separately and never changes championship score',()=>{
  const sim={legacyComparison:{comparisonRules:{v16Comparison:'DATE_ALIGNED_POLICY_COMPARISON'},commonDates:['2026-08-04'],newTechnique:{evidenceGrade:'POINT_IN_TIME_HISTORICAL_REPLAY'},v16_9:{evidenceGrade:'EXACT_LOGGED_LEDGER',commonSignalDates:1,targetHitRatePct:0,stopRatePct:100}},records:[{signalSession:'2026-08-04',outcome:{state:'TARGET1'}}]};
  const a=B.buildComparison(sim,{resolutions:[]});
  const b=B.buildComparison(sim,{resolutions:[{outcome:'STOP'}]});
  assert.deepEqual(a.score,b.score);
  assert.equal(a.forwardStatus,'FORWARD_SHADOW_PENDING');
  assert.equal(b.forwardStatus,'FORWARD_SHADOW_REALIZED');
});
