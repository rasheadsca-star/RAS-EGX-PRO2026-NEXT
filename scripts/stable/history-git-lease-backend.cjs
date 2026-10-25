'use strict';
// Git transport for a single-owner history-writer ref. Experimental.
// Lease tokens MUST be unique non-ancestor commits for each acquisition.
// Every caller is responsible for authenticating its remote and fencing writers.
const cp=require('node:child_process');
function git(cwd,args,{input}={}){
 const r=cp.spawnSync('git',args,{cwd,encoding:'utf8',input});
 if(r.error)throw r.error;
 return {ok:r.status===0,stdout:r.stdout.trim(),stderr:r.stderr.trim()};
}
function backend({cwd,remote='origin'}){
 if(!cwd||!/^[A-Za-z0-9._-]+$/.test(remote))throw new Error('INVALID_GIT_BACKEND');
 function readRef(ref){
  const r=git(cwd,['ls-remote','--refs',remote,ref]);
  if(!r.ok)throw new Error('REMOTE_REF_READ_FAILED:'+r.stderr);
  const rows=r.stdout.split('\n').filter(Boolean).filter(line=>line.split(/\s+/)[1]===ref);
  if(rows.length>1)throw new Error('AMBIGUOUS_REMOTE_REF');
  return rows.length?rows[0].split(/\s+/)[0]:null;
 }
 function createRef(ref,token){
  // A branch creation is guaranteed create-only only if the unique owner token
  // cannot fast-forward from another possible owner's commit.
  const result=git(cwd,['push','--porcelain',remote,token+':'+ref]);
  return result.ok;
 }
 function deleteRef(ref,token){
  // Compare-and-delete, not a read-then-unconditional-delete.
  const result=git(cwd,['push','--porcelain','--force-with-lease='+ref+':'+token,remote,':'+ref]);
  return result.ok;
 }
 return {readRef,createRef,deleteRef};
}
module.exports={backend};
