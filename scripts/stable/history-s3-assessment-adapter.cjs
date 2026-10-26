'use strict';
// S3 read-only assessment adapter. No history writes and no 200-row archival threshold.
const fs=require('node:fs'),path=require('node:path');
const {evaluation,SOURCE}=require('./history-quarantine-policy.cjs');
const {verifyManifest}=require('./history-quarantine-policy.cjs');
const DATE=/^\d{4}-\d{2}-\d{2}$/,TICKER=/^[A-Z0-9._-]+$/;
const abort=s=>{throw new Error('S3_FAIL_CLOSED:'+s)};
const symbol=s=>typeof s==='string'&&TICKER.test(s)&&s!=='.'&&s!=='..';
const day=r=>String(r?.date||r?.sessionDate||'').slice(0,10);
function derive({root,runId,startedAt,reportPath}){
 if(!root||!runId||!startedAt||!Number.isFinite(Date.parse(startedAt)))abort('MISSING_RUN_CONTEXT');
 const report=JSON.parse(fs.readFileSync(reportPath||path.join(root,'data/stable/v15-price-truth.json'),'utf8'));
 if(report.schemaVersion!=='16.3.4-session-aware-price-truth'||report.ready!==true||report.executionGrade!==true)abort('REPORT_NOT_READY');
 const session=report.expectedSession;
 if(!DATE.test(session))abort('INVALID_SESSION');
 if(!Number.isFinite(Date.parse(report.generatedAt))||Date.parse(report.generatedAt)<Date.parse(startedAt))abort('STALE_REPORT');
 if(report.source?.realFetch!==true||report.source?.preciseSource!==true)abort('SOURCE_INELIGIBLE');
 for(const x of ['acceptedRows','rejectedRows','droppedRows','updatedHistoryFiles']){
  if(!Number.isInteger(report[x])||report[x]<0)abort('INVALID_'+x);
 }
 if(!Number.isInteger(report.source.inputRows)||report.source.inputRows!==report.acceptedRows+report.rejectedRows+report.droppedRows)abort('CLASSIFICATION_COUNT');
 if(report.rejectedRows!==report.sampleRejected?.length||report.droppedRows!==report.sampleDropped?.length)abort('INCOMPLETE_REJECTION_EVIDENCE');
 if(!Array.isArray(report.missingHistoryFiles))abort('MISSING_HISTORY_LIST');
 const missing=new Set(),rejected=new Map(),dropped=new Set();
 for(const t of report.missingHistoryFiles){if(!symbol(t)||missing.has(t))abort('DUPLICATE_MISSING');missing.add(t)}
 for(const r of report.sampleRejected){
  if(!symbol(r?.ticker)||!r.reason||rejected.has(r.ticker)||missing.has(r.ticker))abort('BAD_REJECTION');
  rejected.set(r.ticker,r.reason);
 }
 for(const r of report.sampleDropped){
  if(!symbol(r?.ticker)||dropped.has(r.ticker)||rejected.has(r.ticker)||missing.has(r.ticker))abort('BAD_DROPPED');
  dropped.add(r.ticker);
 }
 const dir=path.join(root,'data/history'),history={},accepted=[];
 for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
  if(!ent.isFile()||ent.isSymbolicLink())abort('UNEXPECTED_HISTORY_ENTRY');
  if(!ent.name.endsWith('.json'))continue; // R8 separately protects non-JSON bytes.
  const t=ent.name.slice(0,-5);
  if(!symbol(t)||missing.has(t))abort('INVALID_HISTORY_FILE:'+t);
  const doc=JSON.parse(fs.readFileSync(path.join(dir,ent.name),'utf8'));
  if(!Array.isArray(doc.sessions))abort('INVALID_HISTORY_DOC:'+t);
  history[t]=doc;
  const current=doc.sessions.filter(row=>day(row)===session&&row.source===SOURCE);
  if(current.length>1)abort('DUPLICATE_PRODUCER_CANDLE:'+t);
  if(current.length){
   if(rejected.has(t)||dropped.has(t))abort('REJECTED_CANDLE_STILL_PUBLISHED:'+t);
   if(current[0].ticker!==t||current[0].sourceSessionDate!==session)abort('BAD_PRODUCER_IDENTITY:'+t);
   if(!Number.isFinite(Date.parse(current[0].fetchedAt))||Date.parse(current[0].fetchedAt)<Date.parse(startedAt))abort('STALE_ACCEPTED_CANDLE:'+t);
   accepted.push(current[0]);
  }
 }
 if(accepted.length!==report.updatedHistoryFiles||accepted.length+missing.size!==report.acceptedRows)abort('ACCEPTED_COUNT_MISMATCH');
 const payload={runId,expectedSession:session,sourceEligible:true,acceptedRows:report.acceptedRows,accepted,
  rejected:[...rejected].map(([ticker,reason])=>({ticker,reason})),missingHistory:[...missing]};
 const assessed=evaluation(payload);
 verifyManifest(assessed.manifest,history);
 return {assessment:payload,summary:{session,runId,acceptedRows:report.acceptedRows,writtenRows:accepted.length,
  missingRows:missing.size,rejectedRows:rejected.size,manifestSha256:assessed.manifestSha256,
  handoffEligible:report.acceptedRows>=200}};
}
if(require.main===module){
 try{
  const [root,runId,startedAt]=process.argv.slice(2);
  process.stdout.write(JSON.stringify(derive({root,runId,startedAt}).summary)+'\n');
 }catch(e){process.stderr.write(e.message+'\n');process.exitCode=1}
}
module.exports={derive};
