'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const REPO=path.resolve(__dirname,'../..');
const FIXTURE=path.join(REPO,'tests/fixtures/astra-hermetic');
const BUILD_REL='scripts/astra/native/astra-intelligence.cjs';
const GATE_REL='scripts/astra/native/production-gate.cjs';
function copyPrograms(root){for(const rel of [BUILD_REL,GATE_REL,'scripts/ops/egx-session-math.cjs']){const to=path.join(root,rel);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(REPO,rel),to)}}
const OUT=['recommendation-ledger','recommendation-outcomes','performance-summary','performance-by-rank','performance-by-regime','ticker-performance','market-universe','analytics-integrity'].map(n=>'astra-prod/app/intelligence/'+n+'.json');
function makeFixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'astra-gate-tests-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.cpSync(FIXTURE,root,{recursive:true});
  copyPrograms(root);
  return root;
}
function build(root){
  return cp.spawnSync(process.execPath,[path.join(root,BUILD_REL)],{cwd:root,env:{...process.env,ASTRA_INTELLIGENCE_ROOT:root,ASTRA_ALLOW_ROOT_OVERRIDE:'1',GITHUB_ACTIONS:'true'},encoding:'utf8'});
}
function gate(root){
  const out=cp.spawnSync(process.execPath,[path.join(root,GATE_REL),root],{cwd:root,env:{...process.env,GITHUB_ACTIONS:'true'},encoding:'utf8'});
  let report;try{report=JSON.parse(out.stdout)}catch(e){throw new Error('unparseable gate output '+out.stdout+' '+out.stderr)}
  return {code:out.status,report};
}
function certifiedRoot(t){
  const root=makeFixture(t);
  const result=build(root);
  assert.equal(result.status,0,result.stderr);
  for(const rel of OUT)assert.ok(fs.existsSync(path.join(root,rel)),rel);
  return root;
}
test('production gate passes byte-identical hermetic rebuild',t=>{
  const root=certifiedRoot(t);
  const r=gate(root);
  assert.equal(r.code,0,JSON.stringify(r.report));
  assert.equal(r.report.reason,'IDENTICAL');
  assert.deepEqual(r.report.sideEffects,[]);
});
test('production gate rejects tampered committed output',t=>{
  const root=certifiedRoot(t);
  fs.appendFileSync(path.join(root,OUT[0]),' ');
  const r=gate(root);
  assert.equal(r.code,1);
  assert.equal(r.report.reason,'OUTPUT_DIFFERS');
  assert.ok(r.report.differences.some(d=>d.file===OUT[0]));
});
test('production gate rejects missing committed output',t=>{
  const root=certifiedRoot(t);
  fs.rmSync(path.join(root,OUT[0]));
  const r=gate(root);
  assert.equal(r.code,1);
  assert.ok(r.report.differences.some(d=>d.kind==='MISSING_COMMITTED'));
});
test('production gate rejects subthreshold handoff',t=>{
  const root=certifiedRoot(t);
  const p=path.join(root,'data/ops/g22-main-app-handoff.json');
  const h=JSON.parse(fs.readFileSync(p,'utf8'));h.acceptedRows=199;
  fs.writeFileSync(p,JSON.stringify(h));
  const r=gate(root);
  assert.equal(r.code,1);
  assert.equal(r.report.reason,'BUILD_REJECTED');
});
test('production gate reports missing required input without side effects',t=>{
  const root=certifiedRoot(t);
  fs.rmSync(path.join(root,'data/ops/g22-main-app-handoff.json'));
  const r=gate(root);
  assert.equal(r.code,1);
  assert.equal(r.report.reason,'GATE_INPUT_ERROR');
  assert.deepEqual(r.report.sideEffects,[]);
});

test('production gate detects mutated input with exit 3',t=>{
  const root=certifiedRoot(t);
  const builder=path.join(root,BUILD_REL);
  fs.appendFileSync(builder,`
if(process.env.EVIL==='1')require('fs').appendFileSync(require('path').join(process.env.EVIL_TARGET,'astra-prod/app/data.json'),'evil');
`);
  // Override passes to gate's child process only in this disposable fixture.
  const out=cp.spawnSync(process.execPath,[path.join(root,GATE_REL),root],{
    cwd:root,env:{...process.env,GITHUB_ACTIONS:'true',EVIL:'1',EVIL_TARGET:root},encoding:'utf8'
  });
  const report=JSON.parse(out.stdout);
  assert.equal(out.status,3,JSON.stringify(report));
  assert.ok(report.sideEffects.some(s=>s.includes('INPUT_CHANGED astra-prod/app/data.json')));
});
test('production gate detects git status mutation outside input hash set',t=>{
  const root=certifiedRoot(t);
  const git=(args)=>cp.execFileSync('git',args,{cwd:root,encoding:'utf8'});
  git(['init','-q']);
  git(['-c','user.email=ci@example.invalid','-c','user.name=CI Test','commit','--allow-empty','-qm','seed']);
  fs.writeFileSync(path.join(root,'unrelated.txt'),'baseline');
  git(['add','unrelated.txt']);
  git(['-c','user.email=ci@example.invalid','-c','user.name=CI Test','commit','-qm','baseline']);
  const builder=path.join(root,BUILD_REL);
  fs.appendFileSync(builder,`
if(process.env.EVIL==='1')require('fs').appendFileSync(require('path').join(process.env.EVIL_TARGET,'unrelated.txt'),'evil');
`);
  const out=cp.spawnSync(process.execPath,[path.join(root,GATE_REL),root],{
    cwd:root,env:{...process.env,GITHUB_ACTIONS:'true',EVIL:'1',EVIL_TARGET:root},encoding:'utf8'
  });
  const report=JSON.parse(out.stdout);
  assert.equal(out.status,3,JSON.stringify(report));
  assert.ok(report.sideEffects.includes('GIT_STATUS_CHANGED'),JSON.stringify(report));
});

test('history is copied, never writable through a symlink to source history',t=>{
  const root=certifiedRoot(t);
  const source=path.join(root,'data/history/AAAA.json');
  const baseline=fs.readFileSync(source);
  const builder=path.join(root,BUILD_REL);
  fs.appendFileSync(builder,`
if(process.env.EVIL==='1')require('fs').appendFileSync(require('path').join(process.cwd(),'data/history/AAAA.json'),'evil');
`);
  const out=cp.spawnSync(process.execPath,[path.join(root,GATE_REL),root],{
    cwd:root,env:{...process.env,GITHUB_ACTIONS:'true',EVIL:'1'},encoding:'utf8'
  });
  const report=JSON.parse(out.stdout);
  assert.notEqual(out.status,null,out.stderr);
  assert.deepEqual(fs.readFileSync(source),baseline,'source history was modified via gate temp root');
  assert.deepEqual(report.sideEffects,[],'gate source must remain immutable');
});
test('production gate detects malicious source-history mutation with exit 3',t=>{
  const root=certifiedRoot(t);
  const builder=path.join(root,BUILD_REL);
  fs.appendFileSync(builder,`
if(process.env.EVIL==='1')require('fs').appendFileSync(require('path').join(process.env.EVIL_TARGET,'data/history/AAAA.json'),'evil');
`);
  const out=cp.spawnSync(process.execPath,[path.join(root,GATE_REL),root],{
    cwd:root,env:{...process.env,GITHUB_ACTIONS:'true',EVIL:'1',EVIL_TARGET:root},encoding:'utf8'
  });
  const report=JSON.parse(out.stdout);
  assert.equal(out.status,3,JSON.stringify(report));
  assert.ok(report.sideEffects.includes('INPUT_CHANGED data/history/*'),JSON.stringify(report));
});
