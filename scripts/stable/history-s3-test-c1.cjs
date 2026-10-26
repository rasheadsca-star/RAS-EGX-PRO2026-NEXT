'use strict';
// Frozen C1 replay from the accepted S3-A baseline. NEVER changes production history.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {preflight}=require('./history-s3-shadow-preflight.cjs');
const {execute}=require('./history-s3-shadow-quarantine.cjs');
const {verify}=require('./history-r8-integrity.cjs');
const {staticGuard}=require('../../tests/stable/s2/history-static-guard.cjs');
const BASE='b1b8af3650bbbca2b54d3941612290b047bdddf7';
function git(cwd,...args){return cp.execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}
function replay({repository,artifact}){
 if(!repository||!artifact||!path.isAbsolute(artifact))throw Error('C1_ARGS_REQUIRED');
 const worktree=fs.mkdtempSync(path.join(os.tmpdir(),'egx-c1-'));
 // Git worktree requires the destination path not to exist.
 fs.rmdirSync(worktree);
 const result={schemaVersion:1,mode:'FROZEN_TEST_C1',sourceCommit:BASE,passed:false,errors:[],quarantined:[]};
 let added=false;
 try{
  git(repository,'worktree','add','--detach',worktree,BASE);added=true;
  const report=JSON.parse(fs.readFileSync(path.join(worktree,'data/stable/v15-price-truth.json'),'utf8'));
  if(report.expectedSession!=='2026-10-25'||report.acceptedRows!==193||report.updatedHistoryFiles!==171||
     report.missingHistoryFiles?.length!==22||report.rejectedRows!==24)throw Error('C1_SNAPSHOT_MISMATCH');
  const runId='C1-FROZEN-20261025',startedAt='2026-10-25T00:00:00Z';
  const pre=preflight({root:worktree,runId,startedAt});
  result.before={session:pre.session,sourceSha:git(worktree,'rev-parse','HEAD'),acceptedRows:report.acceptedRows,
   writtenRows:report.updatedHistoryFiles,missingRows:report.missingHistoryFiles.length,rejectedRows:report.rejectedRows};
  const outcome=execute({root:worktree,runId,startedAt,generatedAt:report.generatedAt,shadow:true});
  result.quarantined=outcome.quarantined;
  result.after=outcome.result;
  result.staticGuardViolations=staticGuard(worktree);
  if(result.staticGuardViolations.length)throw Error('C1_STATIC_GUARD');
  result.r8=verify({root:worktree,baseline:pre.baseline,affectedTickers:pre.affectedTickers});
  const tickers=result.quarantined.map(x=>x.ticker).sort();
  if(JSON.stringify(tickers)!==JSON.stringify(['EALR','FAIT','MIPH','SEIG']))throw Error('C1_QUARANTINE_SET:'+JSON.stringify(tickers));
  if(result.after.acceptedRows!==193||result.after.writtenRows!==171||result.after.missingRows!==22||result.after.rejectedRows!==24)throw Error('C1_COUNTER_MISMATCH');
  if(!result.r8.previousSessionsIntact||!result.r8.unaffectedFilesIntact)throw Error('C1_R8_FAILED');
  result.passed=true;
 }catch(e){result.errors.push(String(e.message||e));}
 finally{
  fs.mkdirSync(path.dirname(artifact),{recursive:true});
  fs.writeFileSync(artifact,JSON.stringify(result,null,2)+'\n');
  if(added){try{git(repository,'worktree','remove','--force',worktree)}catch{}}
 }
 return result;
}
if(require.main===module){
 const [repository,artifact]=process.argv.slice(2);
 const r=replay({repository,artifact});
 process.stdout.write(JSON.stringify(r)+'\n');
 if(!r.passed)process.exitCode=1;
}
module.exports={replay};
