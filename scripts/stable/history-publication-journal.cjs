'use strict';
// Immutable publication evidence contract. Storage backend MUST be persistent,
// create-only and compare-and-swap; this module never silently overwrites.
const crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const SHA=/^[a-f0-9]{40}$/;
const RUN=/^[A-Za-z0-9._-]{1,128}$/;
function requireRecord(x){
 if(!x||x.schemaVersion!==1||!RUN.test(x.runId)||!SHA.test(x.baseSha)
    ||!SHA.test(x.targetSha)||!SHA.test(x.leaseSha)
    ||typeof x.manifestSha256!=='string'||!/^[a-f0-9]{64}$/.test(x.manifestSha256)
    ||!['PREPARED','PUSH_PENDING','PUBLISHED'].includes(x.phase))
  throw new Error('INVALID_PUBLICATION_RECORD');
 return x;
}
function publicationJournal({read,create,cas}){
 if([read,create,cas].some(f=>typeof f!=='function'))throw new Error('PERSISTENT_BACKEND_REQUIRED');
 function begin(input){
  const record=requireRecord({...input,schemaVersion:1,phase:'PREPARED'});
  if(read(record.runId)!==null)throw new Error('PUBLICATION_RUN_ALREADY_EXISTS');
  if(create(record.runId,record)!==true)throw new Error('PUBLICATION_CREATE_UNCONFIRMED');
  const saved=read(record.runId);
  if(sha(saved)!==sha(record))throw new Error('PUBLICATION_CREATE_READBACK_MISMATCH');
  return record;
 }
 function transition(runId,expectedPhase,nextPhase){
  if(!RUN.test(runId))throw new Error('INVALID_PUBLICATION_RUN');
  const current=requireRecord(read(runId));
  if(current.phase!==expectedPhase)throw new Error('PUBLICATION_PHASE_MISMATCH');
  if(!((expectedPhase==='PREPARED'&&nextPhase==='PUSH_PENDING')
       ||(expectedPhase==='PUSH_PENDING'&&nextPhase==='PUBLISHED')))
    throw new Error('ILLEGAL_PUBLICATION_TRANSITION');
  const next={...current,phase:nextPhase};
  if(cas(runId,current,next)!==true)throw new Error('PUBLICATION_CAS_FAILED');
  if(sha(read(runId))!==sha(next))throw new Error('PUBLICATION_CAS_READBACK_MISMATCH');
  return next;
 }
 function reconcile({runId,remoteSha}){
  const record=requireRecord(read(runId));
  if(!SHA.test(remoteSha))throw new Error('REMOTE_SHA_REQUIRED');
  if(record.phase==='PUSH_PENDING'){
   if(remoteSha===record.targetSha)return {decision:'PUBLISHED_OBSERVED_REQUIRES_CAS',record};
   if(remoteSha===record.baseSha)return {decision:'NOT_PUBLISHED_REQUIRES_OWNER_REVIEW',record};
   return {decision:'AMBIGUOUS_REMOTE_DIVERGENCE_STOP',record};
  }
  if(record.phase==='PUBLISHED'&&remoteSha!==record.targetSha)return {decision:'REMOTE_MOVED_AFTER_PUBLICATION',record};
  return {decision:'NO_AUTOMATIC_ACTION',record};
 }
 return {begin,transition,reconcile};
}
module.exports={publicationJournal};
