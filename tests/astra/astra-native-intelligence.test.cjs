'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os');

// --- Hermetic harness: unit tests never read or write production data. ---
const REPO=path.resolve(__dirname,'../..');
const SOURCE_FIXTURE=path.join(__dirname,'../fixtures/astra-hermetic');
const FIXTURE=fs.mkdtempSync(path.join(os.tmpdir(),'astra-module-fixture-'));
fs.cpSync(SOURCE_FIXTURE,FIXTURE,{recursive:true});
// The module resolves ROOT (closures, history) at require time: point it at the fixture BEFORE requiring,
// so in-process tests cannot read production data either.
process.env.ASTRA_INTELLIGENCE_ROOT=FIXTURE;
process.env.ASTRA_ALLOW_ROOT_OVERRIDE='1';
const mod=require('../../scripts/astra/native/astra-intelligence.cjs');
const {confirmedClosures,isTradingSession}=require('../../scripts/ops/egx-session-math.cjs');
const TMP_ROOTS=[];
test.after(()=>{for(const d of [...TMP_ROOTS,FIXTURE])fs.rmSync(d,{recursive:true,force:true})});
const BUILD=path.join(REPO,'scripts/astra/native/astra-intelligence.cjs');
const INVENTORY=path.join(REPO,'scripts/astra/native/workflow-inventory.cjs');
function hermeticRoot(){const t=fs.mkdtempSync(path.join(os.tmpdir(),'astra-hermetic-'));TMP_ROOTS.push(t);fs.cpSync(FIXTURE,t,{recursive:true});return t}
function runScript(script,root){
  // Run a COPY of the builder. A deliberately broken ROOT override must never execute
  // a mutating script whose __dirname points into the production checkout.
  const rel=path.relative(REPO,script);
  assert.ok(['scripts/astra/native/astra-intelligence.cjs','scripts/astra/native/workflow-inventory.cjs'].includes(rel));
  const target=path.join(root,rel);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.copyFileSync(script,target);
  const ops=path.join(root,'scripts/ops/egx-session-math.cjs');
  fs.mkdirSync(path.dirname(ops),{recursive:true});
  fs.copyFileSync(path.join(REPO,'scripts/ops/egx-session-math.cjs'),ops);
  return require('child_process').execFileSync(process.execPath,[target],{cwd:root,env:{...process.env,ASTRA_INTELLIGENCE_ROOT:root,ASTRA_ALLOW_ROOT_OVERRIDE:'1'},stdio:'pipe'});
}
// Trading sessions that respect weekends (Fri/Sat) and confirmed exchange closures.
function tradingSessionsAfter(date,count,closed=confirmedClosures(FIXTURE)){
  const out=[];let d=new Date(date+'T12:00:00Z');
  while(out.length<count){d.setUTCDate(d.getUTCDate()+1);const iso=d.toISOString().slice(0,10);if(isTradingSession(iso,closed))out.push(iso)}
  return out;
}

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

test('build preserves DecisionSnapshot and produces reconciled native intelligence (hermetic fixture)',()=>{
  const root=hermeticRoot();
  const before=fs.readFileSync(path.join(root,'astra-prod/app/data.json'),'utf8');
  runScript(BUILD,root);
  const after=fs.readFileSync(path.join(root,'astra-prod/app/data.json'),'utf8');
  assert.equal(after,before);
  const app=JSON.parse(before);
  const summary=JSON.parse(fs.readFileSync(path.join(root,'astra-prod/app/intelligence/performance-summary.json'),'utf8'));
  const ledger=JSON.parse(fs.readFileSync(path.join(root,'astra-prod/app/intelligence/recommendation-ledger.json'),'utf8'));
  const currentRecs=app.decisionSnapshot.top5||app.decisionSnapshot.opportunities||[];
  const currentLedger=ledger.records.filter(r=>r.decisionSnapshotId===app.sourceDecision.decisionSnapshotId&&r.sessionDate===app.sourceDecision.session);
  assert.equal(summary.reconciliation.pass,true);
  assert.equal(ledger.appendOnly,true);
  assert.equal(ledger.idempotent,true);
  assert.ok(ledger.records.length>=currentRecs.length);
  assert.equal(currentLedger.length,currentRecs.length);
  assert.deepEqual(currentLedger.map(r=>r.ticker).sort(),currentRecs.map(r=>r.ticker).sort());
  assert.equal(summary.sourceSnapshot.decisionSnapshotId,app.sourceDecision.decisionSnapshotId);
  assert.equal(summary.sessionRange.last,app.sourceDecision.session);
});

test('build refuses a handoff that fails the production safety gate (acceptedRows 199)',()=>{
  const root=hermeticRoot();
  const f=path.join(root,'data/ops/g22-main-app-handoff.json');
  const h=JSON.parse(fs.readFileSync(f,'utf8'));h.acceptedRows=199;fs.writeFileSync(f,JSON.stringify(h));
  assert.throws(()=>runScript(BUILD,root),e=>/Immutable handoff rejected: acceptedRows/.test(String(e.stderr||e.message)));
  assert.equal(fs.existsSync(path.join(root,'astra-prod/app/intelligence/recommendation-ledger.json')),false);
});

test('validateHandoff keeps every production gate (negative cases)',()=>{
  const app=JSON.parse(fs.readFileSync(path.join(FIXTURE,'astra-prod/app/data.json'),'utf8'));
  const ok=JSON.parse(fs.readFileSync(path.join(FIXTURE,'data/ops/g22-main-app-handoff.json'),'utf8'));
  assert.equal(mod.validateHandoff(app,ok).status,'PASS');
  assert.equal(mod.validateHandoff(app,{...ok,acceptedRows:200}).status,'PASS');
  const cases=[
    ['acceptedRows',{acceptedRows:199}],
    ['sourceCoverage',{sourceSessionEvidenceCoveragePct:89.9}],
    ['sessionIdentity',{sessionDate:'2026-09-19'}],
    ['sessionIdentity',{expectedSession:'2026-09-21'}],
    ['materialFingerprint',{materialFingerprint:''}],
    ['canonicalDataHead',{canonicalDataHead:'abc'}],
    ['sourceReady',{sourceReady:false}],
    ['executionGrade',{executionGrade:false}],
    ['final',{final:false}],
    ['pagesPublished',{pagesPublished:false}]
  ];
  for(const [gate,patch] of cases){
    const r=mod.validateHandoff(app,{...ok,...patch});
    assert.equal(r.status,'FAIL',gate+' must fail');
    assert.ok(r.failedChecks.includes(gate),gate+' must be reported, got '+r.failedChecks);
  }
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
  const rows=tradingSessionsAfter('2026-09-20',20).map(d=>row(d,8,9,7,8));
  assert.equal(rows.length,20);
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

test('MFE and MAE use only exact observed post-activation OHLC against exact activation price',()=>{
  const o=mod.evaluateRows(recFixture(),[
    row('2026-09-21',10.5,11.4,10.0,11),
    row('2026-09-22',11,11.8,10.2,11.5)
  ]);
  assert.equal(o.entryActivated,true);
  assert.equal(o.activationPrice,10.5);
  assert.equal(o.maxFavorableExcursionPct,12.381);
  assert.equal(o.maxAdverseExcursionPct,-4.7619);
});

test('MFE and MAE remain unavailable when entry execution price is unknown',()=>{
  const o=mod.evaluateRows(recFixture(),[row('2026-09-21',12,12.1,10.5,11)]);
  assert.equal(o.activationPrice,null);
  assert.equal(o.maxFavorableExcursionPct,null);
  assert.equal(o.maxAdverseExcursionPct,null);
});

test('performance windows expose required 7 30 90 YTD and ALL views',()=>{
  const records=['2026-01-01','2026-01-02','2026-01-03'].map((sessionDate,i)=>({recommendationId:'w'+i,sessionDate,rank:i+1,marketRegime:'NEUTRAL',ticker:'W'+i}));
  const outcomes=records.map(r=>({recommendationId:r.recommendationId,entryActivated:false,entryNotTriggered:false,state:'WAITING_FOR_ENTRY',target1Hit:false,target2Hit:false,finalTargetHit:false,stopLossHit:false,returnPct:null,timeline:[{session:r.sessionDate}],sessionsHeld:0}));
  const w=mod.performanceWindows(records,outcomes);
  for(const k of ['7_SESSIONS','30_SESSIONS','90_SESSIONS','YTD','ALL']) assert.ok(w[k],k+' missing');
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
  const paths=[
    'recommendation-ledger.json','recommendation-outcomes.json','performance-summary.json','performance-by-rank.json',
    'performance-by-regime.json','ticker-performance.json','market-universe.json','analytics-integrity.json'
  ].map(x=>'astra-prod/app/intelligence/'+x);
  const root=hermeticRoot();
  runScript(BUILD,root);
  const first=new Map(paths.map(p=>[p,fs.readFileSync(path.join(root,p),'utf8')]));
  runScript(BUILD,root);
  for(const p of paths) assert.equal(fs.readFileSync(path.join(root,p),'utf8'),first.get(p),p+' is not byte-reproducible');
  // An independent root with identical inputs must also produce identical bytes.
  const root2=hermeticRoot();
  runScript(BUILD,root2);
  for(const p of paths) assert.equal(fs.readFileSync(path.join(root2,p),'utf8'),first.get(p),p+' differs across roots');
});

test('workflow inventory does not classify development guard text as a publisher',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'astra-inventory-'));TMP_ROOTS.push(root);
  fs.cpSync(path.join(__dirname,'../fixtures/astra-hermetic-workflows'),path.join(root,'.github/workflows'),{recursive:true});
  runScript(INVENTORY,root);
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


test('target touched before unknown intraday entry remains ambiguous',()=>{
  const o=mod.evaluateRows(recFixture(),[row('2026-09-21',14,14,10.5,11)]);
  assert.equal(o.state,'AMBIGUOUS_INTRADAY_PATH');
  assert.equal(o.finalTargetHit,false);
  assert.equal(o.returnPct,null);
});

test('prior target survives a later stop and gap fill uses observed open',()=>{
  const o=mod.evaluateRows(recFixture(),[row('2026-09-21',10.5,12.1,10.1,11.5),row('2026-09-22',8,8.5,7.5,8)]);
  assert.equal(o.target1Hit,true);
  assert.equal(o.timeToT1,1);
  assert.equal(o.stopLossHit,true);
  assert.equal(o.exitPrice,8);
  assert.equal(o.returnPct,-23.8095);
});

test('stop gap precedes later same-day target touches on an existing position',()=>{
  const o=mod.evaluateRows(recFixture(),[row('2026-09-21',10.5,11,10,10.8),row('2026-09-22',8,14,7.5,13)]);
  assert.equal(o.state,'CLOSED');
  assert.equal(o.exitPrice,8);
  assert.equal(o.finalTargetHit,false);
});

test('governance cancellation after activation reconciles and retains earlier target',()=>{
  const r=recFixture();
  const o=mod.evaluateRows(r,[row('2026-09-21',10.5,12.1,10.1,11.5),row('2026-09-22',10,11,9.5,10,['corporate_action_stock_split'])]);
  assert.equal(o.state,'CANCELLED_BY_GOVERNANCE');
  assert.equal(o.target1Hit,true);
  assert.equal(mod.summarize([r],[o]).reconciliation.pass,true);
  assert.equal(o.returnPct,null);
});

test('UI current plans reject prior session, prior snapshot and mismatched hash',()=>{
  const code=fs.readFileSync(path.resolve(__dirname,'../../astra-prod/app/astra-analytics-pro-v3.js'),'utf8');
  const fn=code.match(/  function currentRecommendations\(\)\{[\s\S]*?\n  \}/)[0];
  const current={ticker:'ATQA',sessionDate:'2026-09-21',decisionSnapshotId:'new',semanticDecisionHash:'h',entryPlan:{low:13.472,high:13.568}};
  const S={app:{sourceDecision:{session:'2026-09-21',decisionSnapshotId:'new',semanticDecisionHash:'h'}},ledger:{records:[{...current,sessionDate:'2026-09-20'},{...current,decisionSnapshotId:'old'},{...current,semanticDecisionHash:'wrong'},current]}};
  const select=new Function('S','A',fn+';return currentRecommendations();');
  assert.deepEqual(select(S,v=>Array.isArray(v)?v:[]),[current]);
  S.ledger.records=[];
  assert.deepEqual(select(S,v=>Array.isArray(v)?v:[]),[]);
});

test('UI rates preserve missing and zero-denominator values',()=>{
  const code=fs.readFileSync(path.resolve(__dirname,'../../astra-prod/app/astra-analytics-pro-v3.js'),'utf8');
  const fn=code.match(/  function rateBlock\(m\)\{[\s\S]*?\n  \}/)[0];
  const rate=new Function('m',fn+';return rateBlock(m);');
  assert.equal(rate({pct:null,denominator:0}).pct,null);
  assert.equal(rate({pct:0,denominator:0}).pct,null);
  assert.equal(rate({pct:0,denominator:3}).pct,0);
});


test('invalid or duplicated OHLC fails evaluation instead of manufacturing a result',()=>{
  for(const rows of [[row('2026-09-21',10.5,9,10,11)],[row('2026-09-21',null,12,10,11)],[row('2026-09-21',10.5,12,10,11),row('2026-09-21',10.5,12,10,11)]]){
    assert.throws(()=>mod.evaluateRows(recFixture(),rows),/Invalid or duplicate OHLC/);
  }
});

test('chart rejects invalid OHLC and excludes future rows',()=>{
  const code=fs.readFileSync(path.resolve(__dirname,'../../astra-prod/app/astra-analytics-pro-v3.js'),'utf8');
  const fn=code.slice(code.indexOf('  function clean(doc){'),code.indexOf('  function ema('));
  const clean=new Function('S','A','doc',fn+';return clean(doc);').bind(null,{app:{sourceDecision:{session:'2026-09-21'}}},v=>Array.isArray(v)?v:[]);
  assert.throws(()=>clean({sessions:[row('2026-09-21',10,9,8,10)]}),/Invalid or duplicate OHLC/);
  const valid=row('2026-09-21',10,12,9,11);
  assert.equal(clean({sessions:[valid,row('2026-09-22',10,12,9,11)]}).length,1);
  assert.throws(()=>clean({sessions:[valid,valid]}),/Invalid or duplicate OHLC/);
});

test('production portfolio bundle matches maintained source including snapshot and missing-price fixes',()=>{
  const root=path.resolve(__dirname,'../..');
  assert.equal(fs.readFileSync(path.join(root,'astra-prod/app/astra-market-portfolio.js'),'utf8'),fs.readFileSync(path.join(root,'astra-prod/app/astra-portfolio-pro-v3.js'),'utf8'));
});
