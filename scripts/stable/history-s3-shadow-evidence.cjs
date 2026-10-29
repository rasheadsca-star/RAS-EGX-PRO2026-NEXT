'use strict';
// Integrated S3-B1 shadow evidence. This module NEVER pushes or changes production.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {preflight}=require('./history-s3-shadow-preflight.cjs');
const {execute}=require('./history-s3-shadow-quarantine.cjs');
const {verify}=require('./history-r8-integrity.cjs');
const {staticGuard}=require('../../tests/stable/s2/history-static-guard.cjs');
const {measure}=require('./history-s3-rebase-probe.cjs');
function run({root,runId,startedAt,generatedAt,artifact,remoteRef,expectedRemoteSha}){
 if(!artifact||!path.isAbsolute(artifact))throw Error('S3_ARTIFACT_REQUIRED');
 const evidence={schemaVersion:1,mode:'SHADOW_ONLY',runId,passed:false,stages:{},quarantined:[],errors:[]};
 let pre;
 try{
  pre=preflight({root,runId,startedAt});
  evidence.head=pre.head;evidence.session=pre.session;evidence.stages.preflight='PASS';
  const out=execute({root:pre.root,runId,startedAt,generatedAt,shadow:true});
  evidence.stages.quarantine='PASS';evidence.quarantined=out.quarantined;evidence.assessment=out.result;
  const violations=staticGuard(pre.root);
  if(violations.length)throw Error('S3_STATIC_GUARD:'+violations.join(';'));
  evidence.stages.staticGuard='PASS';
  evidence.r8=verify({root:pre.root,baseline:pre.baseline,affectedTickers:pre.affectedTickers});
  evidence.stages.r8='PASS';
  if(remoteRef||expectedRemoteSha){
   if(!remoteRef||!expectedRemoteSha)throw Error('S3_REMOTE_CONTEXT_INCOMPLETE');
   evidence.rebase=measure({root:pre.root,remoteRef,expectedRemoteSha});
   evidence.stages.rebase='PASS';
  }else{
   evidence.stages.rebase='NOT_MEASURED';
  }
  evidence.passed=evidence.stages.rebase==='PASS' && evidence.rebase.cleanMerge===true;
 }catch(error){evidence.errors.push(String(error?.message||error));}
 finally{
  // Artifact is outside the protected checkout to avoid modifying git worktree.
  if(root&&fs.existsSync(root)){
   try{evidence.headAfter=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()}catch{}
  }
  fs.mkdirSync(path.dirname(artifact),{recursive:true});
  fs.writeFileSync(artifact,JSON.stringify(evidence,null,2)+'\n');
 }
 return evidence;
}
function evidenceGate(e){
 return e?.mode==='SHADOW_ONLY'&&e.passed===true&&e.stages?.preflight==='PASS'
  &&e.stages?.quarantine==='PASS'&&e.stages?.staticGuard==='PASS'
  &&e.stages?.r8==='PASS'&&e.stages?.rebase==='PASS'
  &&e.rebase?.cleanMerge===true&&e.r8?.previousSessionsIntact===true
  &&e.r8?.unaffectedFilesIntact===true&&Array.isArray(e.errors)&&e.errors.length===0;
}
module.exports={run,evidenceGate};
