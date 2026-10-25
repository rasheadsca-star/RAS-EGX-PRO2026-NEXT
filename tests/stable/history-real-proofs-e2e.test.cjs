'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {publish}=require('../../scripts/stable/history-safe-publish.cjs');
const {publicationJournal}=require('../../scripts/stable/history-publication-journal.cjs');
const {gitBackend}=require('../../scripts/stable/history-publication-git-store.cjs');
const {backend}=require('../../scripts/stable/history-git-lease-backend.cjs');
const {lease}=require('../../scripts/stable/history-writer-lease.cjs');
const {capture}=require('../../scripts/stable/history-r8-integrity.cjs');
const {evaluation,hash}=require('../../scripts/stable/history-quarantine-policy.cjs');
function git(cwd,...args){const r=cp.spawnSync('git',args,{cwd,encoding:'utf8'});if(r.status!==0)throw Error(args.join(' ')+':'+r.stderr);return r.stdout.trim();}
const SESSION='2026-10-25',SOURCE='v16_session_aware_price_truth';
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'egx-real-proof-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const bare=path.join(dir,'remote.git');git(dir,'init','--bare',bare);
 const seed=path.join(dir,'seed');git(dir,'clone',bare,seed);git(seed,'config','user.email','seed@test.invalid');git(seed,'config','user.name','seed');
 git(seed,'checkout','-b','main');fs.mkdirSync(path.join(seed,'data/history'),{recursive:true});
 const tickers=Array.from({length:200},(_,i)=>'T'+String(i).padStart(3,'0'));
 for(const ticker of tickers)fs.writeFileSync(path.join(seed,'data/history',ticker+'.json'),JSON.stringify({sessions:[{date:'2026-10-22',close:742}]}));
 git(seed,'add','.');git(seed,'commit','-m','initial clean history');git(seed,'push','origin','main');
 const root=path.join(dir,'writer');git(dir,'clone',bare,root);git(root,'config','user.email','writer@test.invalid');git(root,'config','user.name','writer');git(root,'checkout','-b','main','origin/main');
 const rows=tickers.map(ticker=>({ticker,date:SESSION,source:SOURCE,close:683}));
 const assessment={runId:'real-proof-1',expectedSession:SESSION,sourceEligible:true,acceptedRows:200,accepted:rows,missingHistory:[],rejected:[],dropped:[],inputRows:200,inputSymbols:tickers};
 const evaluationResult=evaluation(assessment);
 const baseline=capture({root,expectedSession:SESSION,affectedTickers:new Set(tickers),assessment:evaluationResult});
 const assessmentFile=path.join(dir,'assessment.json'),baselineFile=path.join(dir,'baseline.json');
 fs.writeFileSync(assessmentFile,JSON.stringify(assessment));fs.writeFileSync(baselineFile,JSON.stringify(baseline));
 function stageReport(){
  fs.mkdirSync(path.join(root,'data/stable'),{recursive:true});
  for(const row of rows)fs.writeFileSync(path.join(root,'data/history',row.ticker+'.json'),JSON.stringify({sessions:[{date:'2026-10-22',close:742},row]}));
  const report={schemaVersion:'16.3.5-session-aware-price-truth-bound',runId:assessment.runId,expectedSession:SESSION,sourceEligible:true,
   ready:true,executionGrade:true,acceptedRows:200,rejectedRows:0,droppedRows:0,inputRows:200,
   inputSymbolsSha256:hash([...tickers].sort()),updatedHistoryFiles:200,missingHistoryFiles:[],manifestSha256:evaluationResult.manifestSha256,
   rejectedFull:[],droppedFull:[]};
  fs.writeFileSync(path.join(root,'data/stable/v15-price-truth.json'),JSON.stringify(report));
 }
 stageReport();git(root,'add','.');git(root,'commit','-m','real price fixture');
 const baseSha=git(root,'rev-parse','origin/main'),targetSha=git(root,'rev-parse','HEAD');
 const tokenDir=path.join(dir,'token');git(dir,'clone',bare,tokenDir);git(tokenDir,'config','user.email','owner@test.invalid');git(tokenDir,'config','user.name','owner');
 git(tokenDir,'checkout','--orphan','lease-owner');git(tokenDir,'commit','--allow-empty','-m','owner lock');const leaseSha=git(tokenDir,'rev-parse','HEAD');
 const lock=lease({...backend({cwd:tokenDir}),owner:'real-proof'});lock.acquire(leaseSha);
 const store=publicationJournal(gitBackend({cwd:root}));
 const input={runId:assessment.runId,baseSha,targetSha,leaseSha,manifestSha256:evaluationResult.manifestSha256};
 const opts={root,assessmentFile,baselineFile,expectedRunId:assessment.runId,branch:'main',lockLease:lock,journal:{store,input}};
 return {dir,bare,root,opts,store,lock,targetSha,baseSha,reportFile:path.join(root,'data/stable/v15-price-truth.json')};
}
test('real Git lock + journal + genuine R8/R9 + push + independent recovery',t=>{
 const f=fixture(t);assert.equal(publish(f.opts).published,true);
 assert.equal(git(f.root,'ls-remote','--heads','origin','main').split(/\s+/)[0],f.targetSha);
 const recovered=path.join(f.dir,'recovered');git(f.dir,'clone',f.bare,recovered);
 const independent=publicationJournal(gitBackend({cwd:recovered}));
 assert.equal(independent.reconcile({runId:'real-proof-1',remoteSha:f.targetSha}).record.phase,'PUBLISHED');
 f.lock.release();
});
test('real R9 tampering stops before persistent journal and push',t=>{
 const f=fixture(t),doc=JSON.parse(fs.readFileSync(f.reportFile));doc.runId='wrong';fs.writeFileSync(f.reportFile,JSON.stringify(doc));git(f.root,'add','.');git(f.root,'commit','-m','tampered report');
 assert.throws(()=>publish(f.opts),/R9_PRODUCER_REPORT_MISMATCH/);
 assert.equal(git(f.root,'ls-remote','--heads','origin','main').split(/\s+/)[0],f.baseSha);
 assert.throws(()=>f.store.reconcile({runId:'real-proof-1',remoteSha:f.baseSha}));
 f.lock.release();
});
test('real historical session tampering blocks R8 before publication',t=>{
 const f=fixture(t),filename=path.join(f.root,'data/history/T000.json');
 const doc=JSON.parse(fs.readFileSync(filename));doc.sessions[0].close=999;fs.writeFileSync(filename,JSON.stringify(doc));
 git(f.root,'add','.');git(f.root,'commit','-m','tampered history');
 assert.throws(()=>publish(f.opts),/PREVIOUS_SESSIONS_CHANGED/);
 assert.equal(git(f.root,'ls-remote','--heads','origin','main').split(/\s+/)[0],f.baseSha);
 f.lock.release();
});
