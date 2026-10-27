'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const tool=path.resolve(__dirname,'../../scripts/research/egx-recovery-readiness-v2.cjs');
function exercise(change){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-recovery-test-'));
 const docs={
  '04_ACCEPTANCE_GATES.json':{certified:true,gates:[{id:'G09',status:'GREEN'},{id:'G11',status:'GREEN'},{id:'G19',status:'GREEN'}]},
  'docs/astra/G11_DATA_HEALTH_METRICS.json':{latestExpectedSession:'2026-10-26',activeUniverse:{count:10},currentCanonicalSecurities:{numerator:10},decisionPipeline:{pipelineReadySecurities:10},missingSessions:{unresolvedAfterLegitimateExceptions:0},strategyInputReadiness:{productionCritical:{unresolved:0}},stale:{productionCriticalRecords:0}},
  'data/stable/v15-price-truth.json':{expectedSession:'2026-10-26'},
  'docs/astra/G11_CURRENT_UNIVERSE_GAPS.json':{expectedSession:'2026-10-26',activeUniverse:10,currentValidCanonicalUniverse:10,gapCount:0},
  'docs/astra/G11_DATA_HEALTH_ISSUES.json':{criticalUnresolved:0,highProductionRelevantUnresolved:0}
 };
 change?.(docs);
 for(const [p,x] of Object.entries(docs)){const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(x))}
 const r=cp.spawnSync(process.execPath,[tool],{env:{...process.env,GITHUB_WORKSPACE:root,EGX_RECOVERY_OUT:'artifacts/history-recovery'},encoding:'utf8'});
 const output=JSON.parse(fs.readFileSync(path.join(root,'artifacts/history-recovery/readiness-evidence.json'),'utf8'));
 fs.rmSync(root,{recursive:true,force:true});
 return {status:r.status,output};
}
test('complete consistent source evidence does not authorize paper orders',()=>{
 const a=exercise();assert.equal(a.status,0);assert.equal(a.output.status,'SOURCE_EVIDENCE_PASS');assert.equal(a.output.paperTradingExecutable,false);
});
test('mismatched price truth session blocks',()=>{
 const a=exercise(d=>d['data/stable/v15-price-truth.json'].expectedSession='2026-10-25');
 assert.equal(a.status,2);assert.ok(a.output.blockers.includes('PRICE_TRUTH_G11_SESSION_MISMATCH'));
});
test('unreconciled 1-symbol gap blocks',()=>{
 const a=exercise(d=>d['docs/astra/G11_DATA_HEALTH_METRICS.json'].currentCanonicalSecurities.numerator=9);
 assert.equal(a.status,2);assert.ok(a.output.blockers.includes('UNRECONCILED_GAP_LEDGER'));
});
test('G11 blocked means no pass',()=>{
 const a=exercise(d=>d['04_ACCEPTANCE_GATES.json'].gates[1].status='BLOCKED');
 assert.equal(a.status,2);assert.ok(a.output.blockers.includes('G11_NOT_CERTIFIED'));
});
test('critical issue blocks',()=>{
 const a=exercise(d=>d['docs/astra/G11_DATA_HEALTH_ISSUES.json'].criticalUnresolved=1);
 assert.equal(a.status,2);assert.ok(a.output.blockers.includes('G11_SEVERE_FINDINGS'));
});
test('missing issue evidence fails closed',()=>{
 const a=exercise(d=>delete d['docs/astra/G11_DATA_HEALTH_ISSUES.json']);
 assert.equal(a.status,2);assert.ok(a.output.blockers.includes('G11_SEVERE_FINDINGS'));
});

test('missing critical-severity count blocks, not coerced to zero',()=>{
 const a=exercise(d=>delete d['docs/astra/G11_DATA_HEALTH_ISSUES.json'].criticalUnresolved);
 assert.equal(a.status,2);assert.ok(a.output.blockers.includes('G11_SEVERE_FINDINGS'));
});
test('negative or unparseable coverage blocks',()=>{
 const a=exercise(d=>d['docs/astra/G11_DATA_HEALTH_METRICS.json'].decisionPipeline.pipelineReadySecurities=-1);
 assert.equal(a.status,2);assert.ok(a.output.blockers.includes('IMPOSSIBLE_COVERAGE'));
});
test('G19 not green blocks full Astra certification',()=>{
 const a=exercise(d=>d['04_ACCEPTANCE_GATES.json'].gates[2].status='PENDING');
 assert.equal(a.status,2);assert.ok(a.output.blockers.includes('ASTRA_FULL_CERTIFICATION_MISSING'));
});
