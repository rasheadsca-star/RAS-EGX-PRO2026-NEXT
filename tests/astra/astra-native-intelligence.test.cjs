'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os');
const mod=require('../../scripts/astra/native/astra-intelligence.cjs');

test('recommendation identity is stable and snapshot-linked',()=>{
  const ds={decisionSnapshotId:'G09-DS-aaaaaaaaaaaaaaaaaaaaaaaa',semanticDecisionHash:'b'.repeat(64),sessionDate:'2026-09-20'};
  const op={ticker:'ABUK',rank:1,strategyExecutionRef:'X'};
  assert.equal(mod.stableRecommendationId(ds,op),mod.stableRecommendationId(ds,op));
  assert.notEqual(mod.stableRecommendationId(ds,op),mod.stableRecommendationId({...ds,semanticDecisionHash:'c'.repeat(64)},op));
});

test('ledger prevents duplicates by recommendation id',()=>{
  const app={generatedAt:'x',sourceDecision:{decisionSnapshotId:'G09-DS-aaaaaaaaaaaaaaaaaaaaaaaa',semanticDecisionHash:'b'.repeat(64)},decisionSnapshot:{decisionSnapshotId:'G09-DS-aaaaaaaaaaaaaaaaaaaaaaaa',semanticDecisionHash:'b'.repeat(64),sessionDate:'2099-01-01',top5:[{ticker:'ABUK',rank:1,decisionScore:1,entryPlan:{low:1,high:2},stopLoss:.5,targets:[3]}]}};
  const h={canonicalDataHead:'a'.repeat(40),materialFingerprint:'b'.repeat(64),producerRunId:1};
  const one=mod.buildLedger(app,h,{records:[]});
  const two=mod.buildLedger(app,h,one);
  assert.equal(one.records.length,1);
  assert.equal(two.records.length,1);
  assert.equal(one.records[0].recommendationId,two.records[0].recommendationId);
});

test('state vocabulary is closed',()=>{
  for(const s of ['ISSUED','WAITING_FOR_ENTRY','ENTRY_ACTIVATED','OPEN','TARGET_1_HIT','TARGET_2_HIT','FINAL_TARGET_HIT','STOP_LOSS_HIT','EXPIRED','CLOSED','AMBIGUOUS_INTRADAY_PATH','CANCELLED_BY_GOVERNANCE']) assert.ok(mod.STATES.has(s));
});

test('KPI denominators exclude ambiguous outcomes from win/loss',()=>{
  const records=[1,2,3].map(i=>({recommendationId:'r'+i,rank:i,marketRegime:'NEUTRAL',ticker:'T'+i}));
  const outcomes=[
    {recommendationId:'r1',entryActivated:true,state:'CLOSED',target1Hit:true,finalTargetHit:true,stopLossHit:false,returnPct:5,timeline:[],sessionsHeld:2,timeToT1:1,timeToFinalTarget:2},
    {recommendationId:'r2',entryActivated:true,state:'CLOSED',target1Hit:false,finalTargetHit:false,stopLossHit:true,returnPct:-2,timeline:[],sessionsHeld:1},
    {recommendationId:'r3',entryActivated:true,state:'AMBIGUOUS_INTRADAY_PATH',target1Hit:false,finalTargetHit:false,stopLossHit:false,returnPct:null,timeline:[],sessionsHeld:1,ambiguous:true}
  ];
  const s=mod.summarize(records,outcomes);
  assert.equal(s.metrics.winRate.denominator,2);
  assert.equal(s.metrics.winRate.numerator,1);
  assert.equal(s.metrics.ambiguous,1);
});

test('repository build preserves current DecisionSnapshot and produces reconciled native intelligence',()=>{
  const root=path.resolve(__dirname,'../..');
  const before=fs.readFileSync(path.join(root,'astra-prod/app/data.json'),'utf8');
  require('child_process').execFileSync(process.execPath,[path.join(root,'scripts/astra/native/astra-intelligence.cjs')],{cwd:root,stdio:'pipe'});
  const after=fs.readFileSync(path.join(root,'astra-prod/app/data.json'),'utf8');
  assert.equal(after,before);
  const summary=JSON.parse(fs.readFileSync(path.join(root,'astra-prod/app/intelligence/performance-summary.json'),'utf8'));
  const ledger=JSON.parse(fs.readFileSync(path.join(root,'astra-prod/app/intelligence/recommendation-ledger.json'),'utf8'));
  assert.equal(summary.reconciliation.pass,true);
  assert.equal(ledger.appendOnly,true);
  assert.equal(ledger.idempotent,true);
  assert.equal(ledger.records.length,3);
  assert.equal(ledger.records.every(r=>r.decisionSnapshotId==='G09-DS-018f3ecf434a0cc921814012'),true);
});


function recFixture(){
  return {
    recommendationId:'ASTRA-REC-TEST',decisionSnapshotId:'DS',semanticDecisionHash:'h',
    ticker:'TEST',sessionDate:'2026-09-20',effectiveFromSession:'2026-09-21',
    entryPlan:{low:10,high:11},stopLoss:9,targets:[12,13],rank:1,marketRegime:'NEUTRAL'
  };
}
const row=(date,open,high,low,close,warnings=[])=>({date,open,high,low,close,volume:100,warnings});

test('entry activation is evaluated only from effective session onward',()=>{
  const o=mod.evaluateRows(recFixture(),[
    row('2026-09-20',10.5,13,8,12),
    row('2026-09-21',10.5,11.5,10.1,11)
  ]);
  assert.equal(o.entryActivated,true);
  assert.equal(o.activationSession,'2026-09-21');
  assert.equal(o.state,'OPEN');
});

test('entry not triggered expires without becoming win or loss',()=>{
  const rows=Array.from({length:20},(_,i)=>row('2026-10-'+String(i+1).padStart(2,'0'),8,9,7,8));
  const o=mod.evaluateRows(recFixture(),rows,{expirySessions:20});
  assert.equal(o.state,'EXPIRED');
  assert.equal(o.entryNotTriggered,true);
  assert.equal(o.resolved,false);
  assert.equal(o.returnPct,null);
});

test('same daily candle stop and target becomes ambiguous',()=>{
  const o=mod.evaluateRows(recFixture(),[row('2026-09-21',10.5,12.2,8.8,11)]);
  assert.equal(o.state,'AMBIGUOUS_INTRADAY_PATH');
  assert.equal(o.ambiguous,true);
  assert.equal(o.resolved,false);
});

test('gap outside entry range is recorded without invented execution price',()=>{
  const o=mod.evaluateRows(recFixture(),[
    row('2026-09-21',14,14.5,13.5,14),
    row('2026-09-22',10.4,10.8,10.2,10.6)
  ]);
  assert.equal(o.entryActivated,true);
  assert.equal(o.activationPrice,10.4);
  assert.equal(o.timeline.some(x=>x.evidence==='GAP_ABOVE_ENTRY_RANGE'),true);
});

test('range touch from outside entry keeps execution price unknown',()=>{
  const o=mod.evaluateRows(recFixture(),[row('2026-09-21',12,12.1,10.5,11)]);
  assert.equal(o.entryActivated,true);
  assert.equal(o.activationPrice,null);
  assert.equal(o.activationPricePrecision,'ENTRY_RANGE_TOUCH_PRICE_UNKNOWN');
});

test('corporate action quarantine prevents ordinary win loss treatment',()=>{
  const o=mod.evaluateRows(recFixture(),[row('2026-09-21',10.5,11,10,10.8,['corporate_action_stock_split'])]);
  assert.equal(o.state,'CANCELLED_BY_GOVERNANCE');
  assert.equal(o.resolved,false);
});

test('immutable G22 handoff rejects stale or under-covered inputs',()=>{
  const app={sourceDecision:{session:'2026-09-20'}};
  const good={final:true,pagesPublished:true,sourceReady:true,executionGrade:true,canonicalDataHead:'a'.repeat(40),materialFingerprint:'b'.repeat(64),acceptedRows:207,sourceSessionEvidenceCoveragePct:95,sessionDate:'2026-09-20',expectedSession:'2026-09-20'};
  assert.equal(mod.validateHandoff(app,good).status,'PASS');
  assert.equal(mod.validateHandoff(app,{...good,acceptedRows:199}).status,'FAIL');
  assert.equal(mod.validateHandoff(app,{...good,sourceSessionEvidenceCoveragePct:89}).status,'FAIL');
  assert.equal(mod.validateHandoff(app,{...good,pagesPublished:false}).status,'FAIL');
  assert.equal(mod.validateHandoff(app,{...good,sessionDate:'2026-09-19'}).status,'FAIL');
});

test('KPI rates carry explicit denominator labels and reconcile expiry/cancelled states',()=>{
  const records=['a','b','c'].map((x,i)=>({recommendationId:x,rank:i+1,marketRegime:'NEUTRAL',ticker:x}));
  const outcomes=[
    {recommendationId:'a',entryActivated:false,entryNotTriggered:true,state:'EXPIRED',target1Hit:false,target2Hit:false,finalTargetHit:false,stopLossHit:false,returnPct:null,timeline:[],sessionsHeld:0},
    {recommendationId:'b',entryActivated:false,entryNotTriggered:false,state:'CANCELLED_BY_GOVERNANCE',target1Hit:false,target2Hit:false,finalTargetHit:false,stopLossHit:false,returnPct:null,timeline:[],sessionsHeld:0},
    {recommendationId:'c',entryActivated:false,entryNotTriggered:false,state:'WAITING_FOR_ENTRY',target1Hit:false,target2Hit:false,finalTargetHit:false,stopLossHit:false,returnPct:null,timeline:[],sessionsHeld:0}
  ];
  const s=mod.summarize(records,outcomes);
  assert.equal(s.reconciliation.pass,true);
  assert.equal(s.metrics.entryNotTriggered,1);
  assert.equal(s.metrics.governanceCancelled,1);
  assert.equal(s.metrics.activationRate.denominatorLabel,'Issued');
  assert.equal(s.metrics.winRate.denominatorLabel,'Closed Resolved Trades');
});


test('effective session policy is explicit without inventing a future session',()=>{
  const app={
    generatedAt:'2026-09-20T15:00:00Z',
    sourceDecision:{decisionSnapshotId:'G09-DS-aaaaaaaaaaaaaaaaaaaaaaaa',semanticDecisionHash:'b'.repeat(64)},
    decisionSnapshot:{decisionSnapshotId:'G09-DS-aaaaaaaaaaaaaaaaaaaaaaaa',semanticDecisionHash:'b'.repeat(64),sessionDate:'2099-01-01',top5:[{ticker:'ABUK',rank:1,decisionScore:1,entryPlan:{low:1,high:2},stopLoss:.5,targets:[3]}]}
  };
  const h={canonicalDataHead:'a'.repeat(40),materialFingerprint:'b'.repeat(64),producerRunId:1};
  const ledger=mod.buildLedger(app,h,{records:[]});
  const rec=ledger.records[0];
  assert.equal(rec.effectiveFromSession,null);
  assert.equal(rec.effectiveFromPolicy,'NEXT_FINALIZED_SESSION_AFTER_DECISION');
  assert.equal(rec.effectiveFromStatus,'PENDING_NEXT_FINALIZED_SESSION');
});


test('native artifact build is byte-reproducible for identical inputs',()=>{
  const root=path.resolve(__dirname,'../..');
  const paths=[
    'astra-prod/app/intelligence/recommendation-ledger.json',
    'astra-prod/app/intelligence/recommendation-outcomes.json',
    'astra-prod/app/intelligence/performance-summary.json',
    'astra-prod/app/intelligence/performance-by-rank.json',
    'astra-prod/app/intelligence/performance-by-regime.json',
    'astra-prod/app/intelligence/ticker-performance.json',
    'astra-prod/app/intelligence/market-universe.json',
    'astra-prod/app/intelligence/analytics-integrity.json'
  ];
  require('child_process').execFileSync(process.execPath,[path.join(root,'scripts/astra/native/astra-intelligence.cjs')],{cwd:root,stdio:'pipe'});
  const first=new Map(paths.map(p=>[p,fs.readFileSync(path.join(root,p),'utf8')]));
  require('child_process').execFileSync(process.execPath,[path.join(root,'scripts/astra/native/astra-intelligence.cjs')],{cwd:root,stdio:'pipe'});
  for(const p of paths) assert.equal(fs.readFileSync(path.join(root,p),'utf8'),first.get(p),p+' is not byte-reproducible');
});

test('workflow inventory does not classify development guard text as a publisher',()=>{
  const root=path.resolve(__dirname,'../..');
  require('child_process').execFileSync(process.execPath,[path.join(root,'scripts/astra/native/workflow-inventory.cjs')],{cwd:root,stdio:'pipe'});
  const inv=JSON.parse(fs.readFileSync(path.join(root,'docs/astra/development/WORKFLOW_INVENTORY.json'),'utf8'));
  const final=inv.workflows.find(x=>x.path==='.github/workflows/astra-development-final-certification.yml');
  assert.ok(final);
  assert.equal(final.deployPages,false);
  assert.equal(final.gitPush,false);
  assert.equal(final.categories.includes('Competing publisher'),false);
  assert.equal(final.categories.includes('Dangerous'),false);
});


test('legacy ledger records are metadata-enriched without rewriting immutable decision',()=>{
  const app={
    generatedAt:'2026-09-20T15:00:00Z',
    sourceDecision:{decisionSnapshotId:'G09-DS-aaaaaaaaaaaaaaaaaaaaaaaa',semanticDecisionHash:'b'.repeat(64)},
    decisionSnapshot:{decisionSnapshotId:'G09-DS-aaaaaaaaaaaaaaaaaaaaaaaa',semanticDecisionHash:'b'.repeat(64),sessionDate:'2099-01-01',top5:[{ticker:'ABUK',rank:1,decisionScore:1,entryPlan:{low:1,high:2},stopLoss:.5,targets:[3]}]}
  };
  const h={canonicalDataHead:'a'.repeat(40),materialFingerprint:'b'.repeat(64),producerRunId:1};
  const fresh=mod.buildLedger(app,h,{records:[]});
  const old=JSON.parse(JSON.stringify(fresh.records[0]));
  delete old.effectiveFromPolicy; delete old.effectiveFromStatus; old.schemaVersion='astra-recommendation-record-1';
  const immutableBefore=JSON.stringify(old.immutableDecision);
  const migrated=mod.buildLedger(app,h,{records:[old]}).records[0];
  assert.equal(migrated.schemaVersion,'astra-recommendation-record-2');
  assert.equal(migrated.effectiveFromPolicy,'NEXT_FINALIZED_SESSION_AFTER_DECISION');
  assert.equal(migrated.effectiveFromStatus,'PENDING_NEXT_FINALIZED_SESSION');
  assert.equal(JSON.stringify(migrated.immutableDecision),immutableBefore);
});

test('pending effective session resolves to first actual post-decision finalized row',()=>{
  const rec={...recFixture(),effectiveFromSession:null,effectiveFromPolicy:'NEXT_FINALIZED_SESSION_AFTER_DECISION',effectiveFromStatus:'PENDING_NEXT_FINALIZED_SESSION'};
  const o=mod.evaluateRows(rec,[row('2026-09-21',10.5,11.5,10.1,11)]);
  assert.equal(o.effectiveFromSession,'2026-09-21');
  assert.equal(o.effectiveFromStatus,'RESOLVED');
  assert.equal(o.entryActivated,true);
});
