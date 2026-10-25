'use strict';
// Git pre-publication orchestration; explicitly opt-in and fail closed.
// No -X ours; the immutable pre-merge assessment and baseline MUST preexist.
const cp=require('node:child_process'),fs=require('node:fs');
const {prepush}=require('./history-prepush-proof.cjs');
function publish({root,assessmentFile,baselineFile,expectedRunId,branch='main',remote='origin',execute,lockLease=null,journal=null,proofCheck=prepush}){
 if(!lockLease||typeof lockLease.verify!=='function')throw new Error('PUBLISH_CROSS_RUN_LOCK_REQUIRED');
 lockLease.verify();
 if(!/^[a-zA-Z0-9._/-]+$/.test(branch)||! /^[a-zA-Z0-9._-]+$/.test(remote))throw new Error('INVALID_PUBLISH_REF');
 if(!fs.existsSync(assessmentFile)||!fs.existsSync(baselineFile))throw new Error('FROZEN_EVIDENCE_REQUIRED');
 const run=execute||((args)=>{const r=cp.spawnSync('git',args,{cwd:root,encoding:'utf8'});if(r.status!==0)throw new Error('GIT_COMMAND_FAILED:'+args[0]+':'+(r.stderr||''));return r.stdout.trim();});
 const call=(...args)=>run(args);
 if(journal&&(!journal.store||!journal.input||typeof journal.store.begin!=='function'||typeof journal.store.transition!=='function'||typeof journal.store.reconcile!=='function'))throw new Error('INVALID_PUBLICATION_JOURNAL');
 // Prevent accidental push of an unrelated branch or local unrelated edits.
 if(call('branch','--show-current')!==branch)throw new Error('WRONG_PUBLICATION_BRANCH');
 if(call('status','--porcelain'))throw new Error('DIRTY_PUBLICATION_CHECKOUT');
 call('fetch',remote,branch);
 // Refuse any non-fast-forward baseline; require a clean, explicit rebase.
 call('rebase',remote+'/'+branch);
 // The proof must inspect exactly the files AFTER rebase.
 lockLease.verify();
 const proof=proofCheck({root,assessmentFile,baselineFile,expectedRunId});
 if(proof.status!=='PASS')throw new Error('PREPUSH_PROOF_INCOMPLETE');
 if(call('status','--porcelain'))throw new Error('POST_REBASE_DIRTY_CHECKOUT');
 // Freeze the exact commit being published and persist intent BEFORE push.
 const targetSha=call('rev-parse','HEAD');
 const baseSha=call('rev-parse','refs/remotes/'+remote+'/'+branch);
 const manifestSha256=proof?.publication?.manifestSha256||journal?.input?.manifestSha256;
 if(journal){
  if(!/^[a-f0-9]{40}$/.test(targetSha)||!/^[a-f0-9]{40}$/.test(baseSha))
   throw new Error('PUBLICATION_COMMIT_HASH_UNAVAILABLE');
  if(journal.input.targetSha!==targetSha||journal.input.baseSha!==baseSha||
     journal.input.runId!==expectedRunId||journal.input.manifestSha256!==manifestSha256)
   throw new Error('PUBLICATION_INTENT_BINDING_MISMATCH');
  journal.store.begin(journal.input);
  journal.store.transition(expectedRunId,'PREPARED','PUSH_PENDING');
 }
 lockLease.verify();
 try{
  call('push',remote,'HEAD:refs/heads/'+branch);
 }catch(error){
  // An unsuccessful transport does NOT establish whether the remote accepted
  // the commit. Keep PUSH_PENDING for recovery; never auto retry or release.
  if(journal)throw new Error('PUSH_RESULT_UNCERTAIN_RECONCILIATION_REQUIRED',{cause:error});
  throw error;
 }
 if(journal){
  const remoteHead=call('ls-remote','--refs',remote,'refs/heads/'+branch).split(/\s+/)[0];
  const state=journal.store.reconcile({runId:expectedRunId,remoteSha:remoteHead});
  if(state.decision!=='PUBLISHED_OBSERVED_REQUIRES_CAS')
   throw new Error('REMOTE_PUBLICATION_NOT_VERIFIED:'+state.decision);
  journal.store.transition(expectedRunId,'PUSH_PENDING','PUBLISHED');
 }
 return {published:true,proof};
}
module.exports={publish};
