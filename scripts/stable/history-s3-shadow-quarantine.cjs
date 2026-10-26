'use strict';
// S3-B1 quarantine runner: operate only in an explicitly supplied disposable worktree.
// Never invoke from the production writer until independent acceptance.
const fs=require('node:fs'),path=require('node:path');
const {reconcile,SOURCE}=require('./history-quarantine-policy.cjs');
const {derive}=require('./history-s3-assessment-adapter.cjs');
const {evaluation}=require('./history-quarantine-policy.cjs');
function execute({root,runId,startedAt,generatedAt,shadow=true}){
 if(!root||!runId||!startedAt||!generatedAt||!Number.isFinite(Date.parse(generatedAt)))throw Error('S3_RUN_CONTEXT_REQUIRED');
 if(shadow!==true)throw Error('S3_SHADOW_ONLY');
 const report=JSON.parse(fs.readFileSync(path.join(root,'data/stable/v15-price-truth.json'),'utf8'));
 if(report.schemaVersion!=='16.3.4-session-aware-price-truth'||report.ready!==true||report.executionGrade!==true
   ||report.source?.realFetch!==true||report.source?.preciseSource!==true)throw Error('S3_SOURCE_INELIGIBLE');
 if(!Number.isInteger(report.rejectedRows)||report.rejectedRows!==report.sampleRejected?.length
    ||!Number.isInteger(report.droppedRows)||report.droppedRows!==report.sampleDropped?.length)throw Error('S3_INCOMPLETE_REJECTION');
 const rejected=report.sampleRejected.map(x=>({ticker:x.ticker,reason:x.reason}));
 const missing=report.missingHistoryFiles;
 if(!Array.isArray(missing)||!Number.isInteger(report.acceptedRows))throw Error('S3_INVALID_COUNTS');
 const dir=path.join(root,'data/history'),candidate=[];
 for(const item of rejected){
  if(!/^[A-Z0-9._-]+$/.test(item.ticker)||item.ticker==='.'||item.ticker==='..'||!item.reason)throw Error('S3_INVALID_REJECTION');
  const file=path.join(dir,item.ticker+'.json');
  if(!fs.existsSync(file))continue;
  if(fs.lstatSync(file).isSymbolicLink())throw Error('S3_SYMLINK');
  const doc=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!Array.isArray(doc.sessions))throw Error('S3_INVALID_HISTORY');
  if(doc.sessions.some(r=>r?.source===SOURCE&&String(r.date||r.sessionDate).slice(0,10)===report.expectedSession))candidate.push({ticker:item.ticker,file,doc});
 }
 // S1 evaluation requires a manifest; complete it only AFTER quarantining in a disposable checkout.
 // An explicit assessment of expected rejected tickers authorizes S1 reconcile.
 const staging=evaluation({runId,expectedSession:report.expectedSession,sourceEligible:true,
  acceptedRows:missing.length,accepted:[],rejected,missingHistory:missing});
 const writes=[];
 for(const c of candidate){
  const result=reconcile({document:c.doc,ticker:c.ticker,expectedSession:report.expectedSession,
   assessment:staging,generatedAt});
  if(result.quarantined.length)writes.push({file:c.file,ticker:c.ticker,document:result.document,quarantined:result.quarantined});
 }
 // This helper is intentionally scoped to shadow worktrees; R8 verification is an independent phase.
 for(const w of writes)fs.writeFileSync(w.file,JSON.stringify(w.document,null,2)+'\n');
 const checked=derive({root,runId,startedAt});
 return {result:checked.summary,quarantined:writes.flatMap(w=>w.quarantined.map(q=>({ticker:q.ticker,rowSha256:q.rowSha256,reason:q.rejectionReason})))};
}
module.exports={execute};
