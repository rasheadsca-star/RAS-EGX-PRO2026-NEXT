'use strict';
// Recovery decision only: no implicit stealing, expiry guesses, or remote mutations.
// A stale-looking lock is still OWNED until a separate verified operator protocol
// confirms no running holder and reconciles the durable publication record.
function assessRecovery({readRef,ref='refs/heads/egx-history-writer-lease',expectedOwnerSha,runState,publicationState}){
 if(typeof readRef!=='function'||!/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(ref))throw new Error('RECOVERY_BACKEND_REQUIRED');
 if(typeof expectedOwnerSha!=='string'||!/^[a-f0-9]{40}$/.test(expectedOwnerSha))throw new Error('RECOVERY_OWNER_REQUIRED');
 const observed=readRef(ref);
 if(observed===null)return {action:'STOP',reason:'LEASE_ABSENT_REQUIRES_NEW_TRANSACTION'};
 if(!/^[a-f0-9]{40}$/.test(observed))throw new Error('RECOVERY_INVALID_REMOTE_REF');
 if(observed!==expectedOwnerSha)return {action:'STOP',reason:'LEASE_OWNED_BY_DIFFERENT_COMMIT',observed};
 if(runState==='RUNNING')return {action:'WAIT',reason:'ORIGINAL_OWNER_STILL_RUNNING'};
 if(runState!=='TERMINATED_CONFIRMED')return {action:'STOP',reason:'OWNER_TERMINATION_NOT_PROVEN'};
 if(!['NOT_STARTED','PUBLISHED_VERIFIED','PUBLISH_UNCERTAIN'].includes(publicationState))
  return {action:'STOP',reason:'PUBLICATION_STATE_UNKNOWN'};
 if(publicationState==='PUBLISH_UNCERTAIN')return {action:'STOP',reason:'REMOTE_PUBLICATION_RECONCILIATION_REQUIRED'};
 return {action:'MANUAL_REVIEW',reason:'OWNER_TERMINATED_BUT_PERSISTENT_JOURNAL_REQUIRED',
  observed,publicationState};
}
module.exports={assessRecovery};
