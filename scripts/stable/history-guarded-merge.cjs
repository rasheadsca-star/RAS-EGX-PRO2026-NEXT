'use strict';
// Local guarded merge. Retains the intent until all post-write gates succeed.
// NOT cross-run durable. Caller must prevent all concurrent writers.
const fs=require('node:fs'),path=require('node:path');
const {begin,apply,recover,complete}=require('./history-transaction-journal.cjs');
const dateOf=r=>String(r?.date||r?.sessionDate||'').slice(0,10);
function buildUpdates({root,rows,generatedAt}){
 const updates=[],missingHistoryFiles=[];
 for(const row of rows){
  const ticker=row.ticker;
  if(typeof ticker!=='string'||!/^[A-Z0-9._-]+$/.test(ticker)||ticker==='.'||ticker==='..')throw new Error('INVALID_GUARDED_MERGE_TICKER');
  const file=path.join(root,'data/history',ticker+'.json');
  if(!fs.existsSync(file)){missingHistoryFiles.push(ticker);continue;}
  const document=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!Array.isArray(document.sessions))throw new Error('INVALID_GUARDED_MERGE_HISTORY:'+ticker);
  const byDate=new Map();
  for(const item of document.sessions){const date=dateOf(item);if(date)byDate.set(date,item);}
  byDate.set(row.date,row);
  document.sessions=[...byDate.values()].sort((a,b)=>dateOf(a).localeCompare(dateOf(b)));
  document.firstSession=dateOf(document.sessions[0]);
  document.lastSession=dateOf(document.sessions.at(-1));
  document.availableSessions=document.sessions.length;
  document.staleData=false;document.updateFailed=false;document.generatedAt=generatedAt;
  document.priceTruthLatest={date:row.date,close:row.close,source:row.primarySource,
   validationStatus:row.validationStatus,confidence:row.confidence.overall,sourceSessionDate:row.sourceSessionDate};
  updates.push({ticker,after:document});
 }
 return {updates,missingHistoryFiles,updated:updates.length};
}
function run({root,runId,rows,generatedAt,validate,faultAfter=-1}){
 if(typeof validate!=='function')throw new Error('GUARDED_VALIDATE_REQUIRED');
 const staged=buildUpdates({root,rows,generatedAt});
 if(!staged.updates.length)throw new Error('EMPTY_GUARDED_MERGE');
 const record=begin({root,runId,updates:staged.updates});
 try{
  apply({root,record,faultAfter});
  validate(staged);
  complete({root,record});
  return {updated:staged.updated,missingHistoryFiles:staged.missingHistoryFiles};
 }catch(error){
  try{recover({root});}catch(recoveryError){error.recoveryError=recoveryError;error.message+='; RECOVERY_FAILED:'+recoveryError.message;}
  throw error;
 }
}
module.exports={buildUpdates,run};
