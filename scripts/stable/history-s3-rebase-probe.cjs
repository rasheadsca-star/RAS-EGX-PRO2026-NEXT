'use strict';
// Git merge-tree is read-only; no rebase, reset, checkout mutation or push.
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
function git(cwd,args){
 const r=cp.spawnSync('git',args,{cwd,encoding:'utf8'});
 if(r.error)throw r.error;
 return {code:r.status,stdout:r.stdout||'',stderr:r.stderr||''};
}
function head(cwd,ref){
 const r=git(cwd,['rev-parse','--verify',ref+'^{commit}']);
 if(r.code!==0||!/^([0-9a-f]{40}|[0-9a-f]{64})\s*$/.test(r.stdout))throw Error('S3_INVALID_GIT_REF:'+ref);
 return r.stdout.trim();
}
function measure({root,candidateRef='HEAD',remoteRef,expectedRemoteSha}){
 if(!root||!remoteRef||!expectedRemoteSha)throw Error('S3_REBASE_PROBE_ARGS');
 const candidate=head(root,candidateRef),remote=head(root,remoteRef);
 if(remote!==expectedRemoteSha)throw Error('S3_REMOTE_SHA_MOVED');
 const result=git(root,['merge-tree','--write-tree',remote,candidate]);
 if(result.code!==0&&result.code!==1)throw Error('S3_MERGE_TREE_ERROR:'+result.stderr.trim());
 return {method:'git merge-tree --write-tree',candidateSha:candidate,remoteSha:remote,
  prospectiveConflict:result.code===1,cleanMerge:result.code===0,
  detail:result.stdout.slice(0,12000),usedOursStrategy:false};
}
module.exports={measure};
