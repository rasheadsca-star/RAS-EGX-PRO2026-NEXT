'use strict';
// R8 scoped immutable baseline. Capture AFTER legitimate reconciliation,
// verify AGAIN AFTER rebase; a baseline made from post-rebase files is not evidence.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {hash}=require('./history-quarantine-policy.cjs');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function filesAt(root) {
 const dir=path.join(root,'data/history');
 return fs.readdirSync(dir).filter(x=>/^[A-Z0-9._-]+\.json$/.test(x)).sort();
}
function capture({root,expectedSession,affectedTickers}) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(expectedSession)||!(affectedTickers instanceof Set))
  throw new Error('INVALID_HISTORY_BASELINE_ARGS');
 const files={};
 for(const name of filesAt(root)){
  const bytes=fs.readFileSync(path.join(root,'data/history',name));
  const doc=JSON.parse(bytes);
  if(!Array.isArray(doc.sessions))throw new Error('INVALID_BASELINE_HISTORY:'+name);
  const previous=doc.sessions.filter(row=>String(row?.date||row?.sessionDate||'').slice(0,10)<expectedSession);
  files[name]={previousSha256:hash(previous),previousRows:previous.length,
   ...(affectedTickers.has(name.slice(0,-5))?{}:{fileSha256:sha(bytes)})};
 }
 return {schemaVersion:1,expectedSession,files};
}
function verify({root,baseline,affectedTickers}) {
 if(!baseline||baseline.schemaVersion!==1||!(affectedTickers instanceof Set)||!baseline.files)
  throw new Error('INVALID_HISTORY_BASELINE');
 const names=filesAt(root);
 const original=Object.keys(baseline.files).sort();
 if(JSON.stringify(names)!==JSON.stringify(original))throw new Error('HISTORY_FILESET_CHANGED');
 for(const name of names) {
  const bytes=fs.readFileSync(path.join(root,'data/history',name));
  const doc=JSON.parse(bytes);
  if(!Array.isArray(doc.sessions))throw new Error('INVALID_HISTORY_DOCUMENT:'+name);
  const rows=doc.sessions.filter(row=>String(row?.date||row?.sessionDate||'').slice(0,10)<baseline.expectedSession);
  const entry=baseline.files[name];
  if(rows.length!==entry.previousRows||hash(rows)!==entry.previousSha256)
   throw new Error('PREVIOUS_SESSIONS_CHANGED:'+name);
  if(!affectedTickers.has(name.slice(0,-5)) && sha(bytes)!==entry.fileSha256)
   throw new Error('UNAFFECTED_HISTORY_FILE_CHANGED:'+name);
 }
 return {verifiedFiles:names.length,previousSessionsIntact:true,unaffectedFilesIntact:true};
}
module.exports={capture,verify};
