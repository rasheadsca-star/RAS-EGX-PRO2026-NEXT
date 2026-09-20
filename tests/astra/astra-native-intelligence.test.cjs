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
