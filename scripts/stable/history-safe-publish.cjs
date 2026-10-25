'use strict';
// Git pre-publication orchestration; explicitly opt-in and fail closed.
// No -X ours; the immutable pre-merge assessment and baseline MUST preexist.
const cp=require('node:child_process'),fs=require('node:fs');
const {prepush}=require('./history-prepush-proof.cjs');
function publish({root,assessmentFile,baselineFile,expectedRunId,branch='main',remote='origin',execute,lockLease=null}){
 if(!lockLease||typeof lockLease.verify!=='function')throw new Error('PUBLISH_CROSS_RUN_LOCK_REQUIRED');
 lockLease.verify();
 if(!/^[a-zA-Z0-9._/-]+$/.test(branch)||! /^[a-zA-Z0-9._-]+$/.test(remote))throw new Error('INVALID_PUBLISH_REF');
 if(!fs.existsSync(assessmentFile)||!fs.existsSync(baselineFile))throw new Error('FROZEN_EVIDENCE_REQUIRED');
 const run=execute||((args)=>{const r=cp.spawnSync('git',args,{cwd:root,encoding:'utf8'});if(r.status!==0)throw new Error('GIT_COMMAND_FAILED:'+args[0]+':'+(r.stderr||''));return r.stdout.trim();});
 const call=(...args)=>run(args);
 // Prevent accidental push of an unrelated branch or local unrelated edits.
 if(call('branch','--show-current')!==branch)throw new Error('WRONG_PUBLICATION_BRANCH');
 if(call('status','--porcelain'))throw new Error('DIRTY_PUBLICATION_CHECKOUT');
 call('fetch',remote,branch);
 // Refuse any non-fast-forward baseline; require a clean, explicit rebase.
 call('rebase',remote+'/'+branch);
 // The proof must inspect exactly the files AFTER rebase.
 lockLease.verify();
 const proof=prepush({root,assessmentFile,baselineFile,expectedRunId});
 if(proof.status!=='PASS')throw new Error('PREPUSH_PROOF_INCOMPLETE');
 if(call('status','--porcelain'))throw new Error('POST_REBASE_DIRTY_CHECKOUT');
 // Git push may still race with another writer; rejection is required and safe.
 lockLease.verify();
 call('push',remote,'HEAD:refs/heads/'+branch);
 return {published:true,proof};
}
module.exports={publish};
