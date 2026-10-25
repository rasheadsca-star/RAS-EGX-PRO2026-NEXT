'use strict';
// Durable repository-level optimistic writer lease via a dedicated Git ref.
// Only the owner of the ref's exact SHA can release it. No force updates.
// This is an experimental primitive: ALL writers must honor it.
const crypto=require('node:crypto');
function assertToken(token){
 if(typeof token!=='string'||!/^[a-f0-9]{40}$/.test(token))throw new Error('INVALID_LOCK_COMMIT');
}
function lease({readRef,createRef,deleteRef,branch='refs/heads/egx-history-writer-lease',owner}){
 if(!owner||typeof owner!=='string')throw new Error('LOCK_OWNER_REQUIRED');
 if(!/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(branch))throw new Error('INVALID_LOCK_REF');
 if([readRef,createRef,deleteRef].some(x=>typeof x!=='function'))throw new Error('LOCK_BACKEND_REQUIRED');
 let held=null;
 function acquire(commit){
  assertToken(commit);
  const current=readRef(branch);
  if(current)throw new Error('HISTORY_WRITER_ALREADY_LOCKED');
  // Backend MUST guarantee create-only atomic ref creation, never overwrite.
  const result=createRef(branch,commit);
  if(result!==true)throw new Error('ATOMIC_REF_CREATE_UNCONFIRMED');
  if(readRef(branch)!==commit)throw new Error('LOCK_ACQUISITION_NOT_VERIFIED');
  held=commit;return {owner,branch,commit};
 }
 function verify(){
  if(!held||readRef(branch)!==held)throw new Error('HISTORY_WRITER_LOCK_LOST');
  return true;
 }
 function release(){
  verify();
  // Backend MUST implement compare-and-delete (expected SHA) atomically.
  const deleted=deleteRef(branch,held);
  if(deleted!==true)throw new Error('ATOMIC_REF_RELEASE_UNCONFIRMED');
  held=null;return true;
 }
 return {acquire,verify,release};
}
module.exports={lease};
