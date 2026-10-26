'use strict';
// Git-only shadow simulation. Never pushes to the production remote.
// Returns a machine-readable artifact for independent review.
const cp=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
function git(cwd,...args){return cp.execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}
function simulate({candidate,remote,gate,artifact}){
 if(!candidate||!remote||typeof gate!=='function'||!artifact)throw Error('SHADOW_ARGS_REQUIRED');
 const result={mode:'SHADOW_ONLY',candidateHead:null,remoteBefore:null,remoteAfter:null,gate:'NOT_RUN',pushAttempted:false,pass:false};
 try{
  result.candidateHead=git(candidate,'rev-parse','HEAD');
  result.remoteBefore=git(candidate,'ls-remote',remote,'refs/heads/main').split(/\s+/)[0]||null;
  if(!result.remoteBefore)throw Error('REMOTE_MAIN_MISSING');
  gate();
  result.gate='PASS';
  // Simulation requires an explicit pass but uses only an isolated test remote.
  if(!path.resolve(remote).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('NON_TEMP_REMOTE_FORBIDDEN');
  if(git(candidate,'status','--porcelain'))throw Error('DIRTY_TREE');
  result.pushAttempted=true;
  git(candidate,'push',remote,'HEAD:refs/heads/main');
  result.remoteAfter=git(candidate,'ls-remote',remote,'refs/heads/main').split(/\s+/)[0]||null;
  result.pass=result.remoteAfter===result.candidateHead;
 }catch(e){result.error=String(e.message||e).split('\n')[0];}
 finally{
  try{result.remoteAfter=git(candidate,'ls-remote',remote,'refs/heads/main').split(/\s+/)[0]||null}catch{}
  fs.writeFileSync(artifact,JSON.stringify(result,null,2)+'\n');
 }
 return result;
}
module.exports={simulate};
