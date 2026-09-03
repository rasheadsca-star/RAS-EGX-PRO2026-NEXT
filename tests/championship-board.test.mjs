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
  const sim={legacyComparison:{comparisonRules:{newTechniqueRoundTripCostPct:0.25,v16Comparison:'DATE_ALIGNED_POLICY_COMPARISON; execution horizons and costs may differ'},commonDates:['2026-08-04','2026-08-05'],newTechnique:{evidenceGrade:'POINT_IN_TIME_HISTORICAL_REPLAY'},v16_9:{evidenceGrade:'EXACT_LOGGED_LEDGER',commonSignalDates:2,resolvedMembers:4,targetHits:2,stopHits:2,targetHitRatePct:50,stopRatePct:50,averageNetReturnPct:1.1,netReturnProfitFactor:1.5,estimatedRoundTripCostPct:0.6}},records:[{signalSession:'2026-08-04',outcome:{state:'TARGET1'},netReturnPct:3},{signalSession:'2026-08-04',outcome:{state:'TARGET2'},netReturnPct:5},{signalSession:'2026-08-05',outcome:{state:'STOP'},netReturnPct:-2},{signalSession:'2026-08-05',outcome:{state:'TIMEOUT'},netReturnPct:-0.1},{signalSession:'2026-08-06',outcome:{state:'STOP'},netReturnPct:-3}]};
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

test('recommendation-number fallback derives daily rank and position groups before outcomes',()=>{
  const dates=['2026-08-04','2026-08-05'];
  const records=[];
  for(const session of dates){for(let n=1;n<=12;n++)records.push({signalSession:session,outcome:{state:n>=9?'TARGET1':'STOP'}})}
  const sim={legacyComparison:{comparisonRules:{v16Comparison:'DATE_ALIGNED_POLICY_COMPARISON'},commonDates:dates,newTechnique:{evidenceGrade:'POINT_IN_TIME_HISTORICAL_REPLAY'},v16_9:{evidenceGrade:'EXACT_LOGGED_LEDGER',commonSignalDates:2,targetHitRatePct:50,stopRatePct:50}},records};
  const c=B.buildComparison(sim,{resolutions:[]});
  const stats=c.current.recommendationNumberStats;
  assert.equal(stats.byNumber.length,12);
  assert.deepEqual(stats.byGroup.map(x=>x.label),['#1–4','#5–8','#9–12']);
  assert.equal(stats.positionEdge.bestNumber.recommendationNumber,9);
  assert.equal(stats.positionEdge.rankingAdjustment.eligible,false);
  assert.equal(stats.positionEdge.bestNumber.gate.positionAdjustmentEligible,false);
});

test('position edge displays #10 first, #12 second evidence while ranking stays locked',()=>{
  const stats={
    baseline:{targetHitRatePct:52},
    byNumber:[
      {recommendationNumber:10,resolved:7,targetHits:6,targetHitRatePct:85.71,targetHitRateLiftPctPoints:33.71,sessions:7,appearanceRatePct:100},
      {recommendationNumber:12,resolved:6,targetHits:5,targetHitRatePct:83.33,targetHitRateLiftPctPoints:31.33,sessions:6,appearanceRatePct:85.71}
    ],
    byGroup:[
      {groupId:'EARLY_1_4',label:'#1–4',resolved:28,targetHits:13,targetHitRatePct:46.43,targetHitRateLiftPctPoints:-5.57,appearanceRatePct:100},
      {groupId:'MIDDLE_5_8',label:'#5–8',resolved:28,targetHits:15,targetHitRatePct:53.57,targetHitRateLiftPctPoints:1.57,appearanceRatePct:100},
      {groupId:'LATE_9_12',label:'#9–12',resolved:27,targetHits:19,targetHitRatePct:70.37,targetHitRateLiftPctPoints:18.37,appearanceRatePct:96.43}
    ],
    mostTargets:{recommendationNumber:10,resolved:7,targetHits:6,targetHitRatePct:85.71},
    highestHitRate:{recommendationNumber:10,resolved:7,targetHits:6,targetHitRatePct:85.71},
    positionEdge:{bestNumber:{recommendationNumber:10,resolved:7,targetHits:6,targetHitRatePct:85.71,targetHitRateLiftPctPoints:33.71,sessions:7,appearanceRatePct:100,gate:{status:'DISCOVERY_ONLY',candidateForForwardValidation:false,positionAdjustmentEligible:false,reasons:['RESOLVED_LT_20','SESSIONS_LT_12'],rule:'NO_RANKING_ADJUSTMENT_WITHOUT_SEPARATE_FORWARD_VALIDATION'}},bestGroup:{label:'#9–12',targetHitRatePct:70.37},lateVsEarlyTargetHitRateLiftPctPoints:23.94,laterPositionSelectionBias:'LATER_POSITIONS_EXIST_ONLY_IN_SESSIONS_WITH_ENOUGH_RECOMMENDATIONS; appearanceRatePct must be reviewed before inference.',rankingAdjustment:{eligible:false,status:'LOCKED_PENDING_FORWARD_VALIDATION'}}
  };
  const sim={legacyComparison:{comparisonRules:{v16Comparison:'DATE_ALIGNED_POLICY_COMPARISON',positionEdgePolicy:'INFO_ONLY_NO_RANKING_MUTATION_PENDING_FORWARD_VALIDATION'},commonDates:['2026-08-04'],newTechnique:{evidenceGrade:'POINT_IN_TIME_HISTORICAL_REPLAY',onV16ExactSignalDates:{recommendationNumberStats:stats}},v16_9:{evidenceGrade:'EXACT_LOGGED_LEDGER',commonSignalDates:1,targetHitRatePct:0,stopRatePct:100,recommendationNumberStats:null}},records:[{signalSession:'2026-08-04',outcome:{state:'TARGET1'}}]};
  const c=B.buildComparison(sim,{resolutions:[]});
  const scoreBefore=structuredClone(c.score);
  const html=B.renderHTML(c);
  assert.match(html,/POSITION EDGE · INFO ONLY/);
  assert.match(html,/#1–4/);
  assert.match(html,/#5–8/);
  assert.match(html,/#9–12/);
  assert.match(html,/DISCOVERY_ONLY/);
  assert.match(html,/Ranking adjustment: LOCKED/);
  assert.match(html,/separate forward validation required/i);
  assert.deepEqual(c.score,scoreBefore);
  assert.equal(c.current.recommendationNumberStats.positionEdge.bestNumber.recommendationNumber,10);
  assert.equal(c.current.recommendationNumberStats.byNumber[1].recommendationNumber,12);
  assert.equal(c.current.recommendationNumberStats.positionEdge.rankingAdjustment.eligible,false);
});

test('recommendation-number stats and position edge never create extra championship points',()=>{
  const base={legacyComparison:{comparisonRules:{v16Comparison:'DATE_ALIGNED_POLICY_COMPARISON'},commonDates:['2026-08-04'],newTechnique:{evidenceGrade:'POINT_IN_TIME_HISTORICAL_REPLAY'},v16_9:{evidenceGrade:'EXACT_LOGGED_LEDGER',commonSignalDates:1,targetHitRatePct:0,stopRatePct:100}},records:[{signalSession:'2026-08-04',outcome:{state:'TARGET1'}}]};
  const a=B.buildComparison(base,{resolutions:[]});
  const boosted=structuredClone(base);
  boosted.legacyComparison.newTechnique.onV16ExactSignalDates={recommendationNumberStats:{byNumber:[{recommendationNumber:10,resolved:100,targetHits:100,targetHitRatePct:100}],byGroup:[{groupId:'LATE_9_12',label:'#9–12',resolved:100,targetHits:100,targetHitRatePct:100}],mostTargets:{recommendationNumber:10,resolved:100,targetHits:100,targetHitRatePct:100},highestHitRate:{recommendationNumber:10,resolved:100,targetHits:100,targetHitRatePct:100},positionEdge:{bestNumber:{recommendationNumber:10,resolved:100,targetHits:100,targetHitRatePct:100,gate:{status:'CANDIDATE_FOR_FORWARD_VALIDATION',positionAdjustmentEligible:false}},rankingAdjustment:{eligible:false,status:'LOCKED_PENDING_FORWARD_VALIDATION'}}}};
  const b=B.buildComparison(boosted,{resolutions:[]});
  assert.deepEqual(a.score,b.score);
  assert.equal(b.score.current,1);
  assert.equal(b.score.qualifiedMetrics,1);
});

test('real simulator artifact agrees with common-date session summaries',()=>{
  const sim=JSON.parse(fs.readFileSync(new URL('../data/research/simulator/latest.json',import.meta.url),'utf8'));
  const c=B.buildComparison(sim,{resolutions:[]});
  const dates=new Set(sim.legacyComparison.commonDates),sessions=(sim.performance?.allDailySignals?.sessions||[]).filter(s=>dates.has(s.session)),targets=sessions.reduce((n,s)=>n+Number(s.targetHits||0),0),stops=sessions.reduce((n,s)=>n+Number(s.stops||0),0),triggered=sessions.reduce((n,s)=>n+Number(s.triggered||0),0);
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
  assert.equal(c.score.current,0);assert.equal(c.score.v16,0);assert.equal(c.score.leader,'N/A');assert.equal(c.metrics[0].qualified,false);
});

test('forward evidence is shown separately and never changes championship score',()=>{
  const sim={legacyComparison:{comparisonRules:{v16Comparison:'DATE_ALIGNED_POLICY_COMPARISON'},commonDates:['2026-08-04'],newTechnique:{evidenceGrade:'POINT_IN_TIME_HISTORICAL_REPLAY'},v16_9:{evidenceGrade:'EXACT_LOGGED_LEDGER',commonSignalDates:1,targetHitRatePct:0,stopRatePct:100}},records:[{signalSession:'2026-08-04',outcome:{state:'TARGET1'}}]};
  const a=B.buildComparison(sim,{resolutions:[]}),b=B.buildComparison(sim,{resolutions:[{outcome:'STOP'}]});
  assert.deepEqual(a.score,b.score);assert.equal(a.forwardStatus,'FORWARD_SHADOW_PENDING');assert.equal(b.forwardStatus,'FORWARD_SHADOW_REALIZED');
});
