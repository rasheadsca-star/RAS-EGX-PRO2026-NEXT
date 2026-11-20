'use strict';
// Read-only current-main replay. Generates evidence for review, never publishes.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {run}=require('./history-s3-shadow-evidence.cjs');
function git(cwd,...args){return cp.execFileSync('git',args,{cwd,encoding:'utf8'}).trim()}
function replay({repository,artifact}){
 if(!repository||!artifact||!path.isAbsolute(artifact))throw Error('S3_REPLAY_ARGS_REQUIRED');
 const main=git(repository,'rev-parse','refs/remotes/origin/main');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-main-shadow-'));fs.rmdirSync(root);
 let added=false;
 try{
  git(repository,'worktree','add','--detach',root,main);added=true;
  const report=JSON.parse(fs.readFileSync(path.join(root,'data/stable/v15-price-truth.json'),'utf8'));
  const at=Date.parse(report.generatedAt);
  if(!Number.isFinite(at))throw Error('S3_REPLAY_INVALID_TIME');
  // Historical simulation of a completed producer run; NEVER call this a live session.
  return run({root,runId:'REPLAY-'+report.expectedSession+'-'+main.slice(0,8),
   startedAt:new Date(at-60000).toISOString(),generatedAt:report.generatedAt,
   artifact,remoteRef:'HEAD',expectedRemoteSha:main});
 }finally{
  if(added)git(repository,'worktree','remove','--force',root);
 }
}
if(require.main===module){
 const [repository,artifact]=process.argv.slice(2);
 try{
  const result=replay({repository,artifact});
  process.stdout.write(JSON.stringify({passed:result.passed,session:result.session,errors:result.errors})+'\n');
 }catch(e){
  fs.mkdirSync(path.dirname(artifact),{recursive:true});
  fs.writeFileSync(artifact,JSON.stringify({schemaVersion:1,mode:'HISTORICAL_REPLAY',passed:false,errors:[String(e.message)]},null,2)+'\n');
  process.exitCode=1;
 }
}
module.exports={replay};
