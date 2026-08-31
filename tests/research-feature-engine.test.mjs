import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchFeatureRecord,buildDescriptiveLeaderboards } from '../src/research-feature-engine.js';

function makeHistory({n=80,start=100}={}){
  const sessions=[];const startDate=new Date('2026-04-01T00:00:00Z');
  for(let i=0;i<n;i++){
    const d=new Date(startDate.getTime()+i*86400000).toISOString().slice(0,10),close=start+i*0.5,open=close-0.2;
    sessions.push({ticker:'TEST',session:d,open,high:close+1,low:open-1,close,volume:100000+i*1000,researchState:'READY_RESEARCH'});
  }
  return{metadata:{datasetHash:'hist-v1'},sessions};
}
function current(close=142){return{ticker:'TEST',state:'READY_RESEARCH',authoritativeResearch:{ticker:'TEST',session:'2026-08-31',open:close-1,high:close+2,low:close-2,close,volume:250000,rowHash:'current-v1'}}}

test('builds current-session research feature bundle without strategy authority',()=>{
  const r=buildResearchFeatureRecord({ticker:'TEST',history:makeHistory(),currentRecord:current(),signalSession:'2026-08-31',decisionCutoff:'2026-08-31T20:00:00Z'});
  assert.equal(r.featureReady,true);assert.equal(r.state,'FEATURE_READY');assert.equal(r.strategyAuthorized,false);assert.equal(r.recommendationAuthorized,false);assert.equal(r.productionAuthority,false);assert.ok(r.groups.find(g=>g.name==='TECHNICAL').payload.rsi14>0);
});

test('rejects stale current research row',()=>{
  const c=current();c.authoritativeResearch.session='2026-08-30';
  const r=buildResearchFeatureRecord({ticker:'TEST',history:makeHistory(),currentRecord:c,signalSession:'2026-08-31',decisionCutoff:'2026-08-31T20:00:00Z'});
  assert.equal(r.featureReady,false);assert.equal(r.state,'SOURCE_UNAVAILABLE');
});

test('requires sufficient clean prior sessions',()=>{
  const r=buildResearchFeatureRecord({ticker:'TEST',history:makeHistory({n:20}),currentRecord:current(),signalSession:'2026-08-31',decisionCutoff:'2026-08-31T20:00:00Z'});
  assert.equal(r.state,'INSUFFICIENT_HISTORY');
});

test('quarantined history sessions are excluded',()=>{
  const h=makeHistory({n:60});h.sessions[0].researchState='QUARANTINED_RESEARCH';
  const r=buildResearchFeatureRecord({ticker:'TEST',history:h,currentRecord:current(),signalSession:'2026-08-31',decisionCutoff:'2026-08-31T20:00:00Z',minPriorSessions:60});
  assert.equal(r.state,'INSUFFICIENT_HISTORY');
});

test('large unexplained close jump triggers corporate action review',()=>{
  const r=buildResearchFeatureRecord({ticker:'TEST',history:makeHistory({n:80}),currentRecord:current(250),signalSession:'2026-08-31',decisionCutoff:'2026-08-31T20:00:00Z'});
  assert.equal(r.featureReady,false);assert.equal(r.state,'CORPORATE_ACTION_REVIEW');
});

test('descriptive leaderboards expose no combined opportunity score',()=>{
  const a=buildResearchFeatureRecord({ticker:'AAA',history:makeHistory(),currentRecord:current(),signalSession:'2026-08-31',decisionCutoff:'2026-08-31T20:00:00Z'});
  const b=buildResearchFeatureRecord({ticker:'BBB',history:makeHistory({start:80}),currentRecord:current(130),signalSession:'2026-08-31',decisionCutoff:'2026-08-31T20:00:00Z'});
  const x=buildDescriptiveLeaderboards([a,b]);
  assert.equal(x.combinedOpportunityScore,null);assert.equal(x.rankingAuthority,'DESCRIPTIVE_ONLY_NOT_STRATEGY');
});
