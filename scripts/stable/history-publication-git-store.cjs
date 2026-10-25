'use strict';
// Persistent per-run Git branch holding one JSON record per commit.
// Branch updates are CAS with --force-with-lease; never delete/reuse run refs.
const cp=require('node:child_process');
const RUN=/^[A-Za-z0-9._-]{1,128}$/;
function git(cwd,args,env){
 const r=cp.spawnSync('git',args,{cwd,encoding:'utf8',env:{...process.env,...env}});
 if(r.error||r.status!==0)throw new Error('PUBLICATION_GIT_FAILED:'+args[0]+':'+(r.stderr||r.error?.message||''));
 return r.stdout.trim();
}
function gitBackend({cwd,remote='origin'}){
 if(!cwd||!/^[A-Za-z0-9._-]+$/.test(remote))throw new Error('INVALID_PUBLICATION_BACKEND');
 const ref=id=>{
  if(!RUN.test(id)||id==='.'||id==='..')throw new Error('INVALID_PUBLICATION_RUN');
  return 'refs/heads/egx-publication-intent/'+id;
 };
 function remoteSha(name){
  const rows=git(cwd,['ls-remote','--refs',remote,name]).split('\n').filter(Boolean);
  return rows.length?rows[0].split(/\s+/)[0]:null;
 }
 function recordAt(sha){
  const payload=git(cwd,['show',sha+':record.json']);
  return JSON.parse(payload);
 }
 function commitRecord(record,parent){
  const env={GIT_AUTHOR_NAME:'EGX journal',GIT_AUTHOR_EMAIL:'journal@egx.invalid',
   GIT_COMMITTER_NAME:'EGX journal',GIT_COMMITTER_EMAIL:'journal@egx.invalid'};
  function inputGit(args,input){
   const r=cp.spawnSync('git',args,{cwd,encoding:'utf8',input,env:{...process.env,...env}});
   if(r.error||r.status!==0)throw new Error('JOURNAL_COMMIT_FAILED:'+r.stderr);
   return r.stdout.trim();
  }
  const blob=inputGit(['hash-object','-w','--stdin'],JSON.stringify(record)+'\n');
  const tree=inputGit(['mktree'],`100644 blob ${blob}\trecord.json\n`);
  return inputGit(['commit-tree',tree,...(parent?['-p',parent]:[])],`publication ${record.runId} ${record.phase}\n`);
 }
 function read(id){
  const name=ref(id),sha=remoteSha(name);
  if(!sha)return null;
  // Fetch the exact immutable journal commit even in a newly created runner.
  git(cwd,['fetch','--no-tags',remote,sha]);
  const doc=recordAt(sha);
  if(doc.runId!==id)throw new Error('JOURNAL_REMOTE_ID_MISMATCH');
  return doc;
 }
 function create(id,doc){
  const name=ref(id);
  if(remoteSha(name))return false;
  const token=commitRecord(doc,null);
  try{git(cwd,['push','--porcelain','--force-with-lease='+name+':'+('0'.repeat(40)),remote,token+':'+name]);}
  catch{return false;}
  return remoteSha(name)===token;
 }
 function cas(id,old,next){
  const name=ref(id),prior=remoteSha(name);
  if(!prior)return false;
  git(cwd,['fetch','--no-tags',remote,prior]);
  if(JSON.stringify(recordAt(prior))!==JSON.stringify(old))return false;
  const target=commitRecord(next,prior);
  try{git(cwd,['push','--porcelain','--force-with-lease='+name+':'+prior,remote,target+':'+name]);}
  catch{return false;}
  return remoteSha(name)===target;
 }
 return {read,create,cas};
}
module.exports={gitBackend};
