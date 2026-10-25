'use strict';
// Baseline must be captured before the operation it guards. The phase-A and
// phase-B snapshots must be independently retained; never rebase the baseline.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {hash}=require('./history-quarantine-policy.cjs');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const symbol=/^[A-Z0-9._-]+$/;
function dateOf(row){return String(row?.date||row?.sessionDate||'').slice(0,10);}
function walk(root){
 const base=path.join(root,'data/history'), result=[];
 function scan(dir,prefix=''){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   const rel=prefix?prefix+'/'+entry.name:entry.name;
   if(entry.isSymbolicLink())throw new Error('HISTORY_SYMLINK_FORBIDDEN:'+rel);
   if(entry.isDirectory())scan(path.join(dir,entry.name),rel);
   else if(entry.isFile())result.push(rel);
   else throw new Error('INVALID_HISTORY_ENTRY:'+rel);
  }
 }
 scan(base);return result.sort();
}
function snapshot({root,expectedSession,affectedTickers,assessment=null}){
 // When an assessment is supplied, derive permissible affected symbols from it.
 // An unrestricted Set is not sufficient evidence of authorization.
 if(!assessment)throw new Error('AFFECTED_ASSESSMENT_REQUIRED');
 {
  const accepted=assessment.manifest, rejected=assessment.rejected;
  if(!assessment.sourceEligible||assessment.expectedSession!==expectedSession||!Array.isArray(accepted)||!(rejected instanceof Map))throw new Error('INVALID_AFFECTED_ASSESSMENT');
  const authorized=new Set([...accepted.map(x=>x.ticker),...rejected.keys()]);
  if(authorized.size!==affectedTickers.size||[...affectedTickers].some(x=>!authorized.has(x)))throw new Error('UNAUTHORIZED_AFFECTED_SET');
 }
 if(typeof expectedSession!=='string'||!DATE.test(expectedSession)||new Date(expectedSession+'T00:00:00Z').toISOString().slice(0,10)!==expectedSession
    ||!(affectedTickers instanceof Set)||[...affectedTickers].some(t=>!symbol.test(t)))throw new Error('INVALID_HISTORY_BASELINE_ARGS');
 const affected=[...affectedTickers].sort(),files={};
 for(const rel of walk(root)){
  const bytes=fs.readFileSync(path.join(root,'data/history',rel));
  const isSymbol=symbol.test(rel.slice(0,-5))&&rel.endsWith('.json')&&!rel.includes('/');
  const ticker=isSymbol?rel.slice(0,-5):null;
  if(!ticker) { files[rel]={fileSha256:sha(bytes)};continue; }
  const doc=JSON.parse(bytes);
  if(!Array.isArray(doc.sessions))throw new Error('INVALID_BASELINE_HISTORY:'+rel);
  const prev=doc.sessions.filter(row=>dateOf(row)<expectedSession);
  files[rel]={previousSha256:hash(prev),previousRows:prev.length,
   futureSha256:hash(doc.sessions.filter(row=>dateOf(row)>expectedSession)),
   futureRows:doc.sessions.filter(row=>dateOf(row)>expectedSession).length,
   ...(affectedTickers.has(ticker)?{}:{fileSha256:sha(bytes)})};
 }
 for(const ticker of affected){if(!Object.hasOwn(files,ticker+'.json'))throw new Error('AFFECTED_TICKER_HISTORY_MISSING:'+ticker);}
 return {schemaVersion:2,expectedSession,affected,affectedSha256:hash(affected),files};
}
function capture(args){return snapshot(args);}
function verify({root,baseline,affectedTickers}){
 if(!baseline||baseline.schemaVersion!==2||!Array.isArray(baseline.affected)||!baseline.files
    ||!(affectedTickers instanceof Set))throw new Error('INVALID_HISTORY_BASELINE');
 const affected=[...affectedTickers].sort();
 if(hash(affected)!==baseline.affectedSha256||JSON.stringify(affected)!==JSON.stringify(baseline.affected))
  throw new Error('AFFECTED_SET_CHANGED');
 const names=walk(root),original=Object.keys(baseline.files).sort();
 if(JSON.stringify(names)!==JSON.stringify(original))throw new Error('HISTORY_FILESET_CHANGED');
 for(const rel of names){
  const bytes=fs.readFileSync(path.join(root,'data/history',rel));
  const entry=baseline.files[rel];
  if('fileSha256' in entry && sha(bytes)!==entry.fileSha256)
   throw new Error('UNAFFECTED_HISTORY_FILE_CHANGED:'+rel);
  if(!('previousSha256' in entry))continue;
  const doc=JSON.parse(bytes);
  if(!Array.isArray(doc.sessions))throw new Error('INVALID_HISTORY_DOCUMENT:'+rel);
  const prior=doc.sessions.filter(row=>dateOf(row)<baseline.expectedSession);
  const future=doc.sessions.filter(row=>dateOf(row)>baseline.expectedSession);
  if(prior.length!==entry.previousRows||hash(prior)!==entry.previousSha256)
   throw new Error('PREVIOUS_SESSIONS_CHANGED:'+rel);
  if(future.length!==entry.futureRows||hash(future)!==entry.futureSha256)
   throw new Error('FUTURE_SESSIONS_CHANGED:'+rel);
 }
 return {verifiedFiles:names.length,previousSessionsIntact:true,unaffectedFilesIntact:true};
}
module.exports={capture,verify};
