#!/usr/bin/env node
'use strict';
// Explicit fail-closed pre-push history gate. Invoke AFTER git pull --rebase and BEFORE git push.
// No integration into production workflow until complete assessment is emitted.
const fs=require('node:fs'),path=require('node:path');
const {evaluation,verifyManifest,SOURCE}=require('./history-quarantine-policy.cjs');
function verifyPublication({assessmentFile,root=process.cwd(),expectedRunId}) {
  if(!assessmentFile||!expectedRunId)throw new Error('MISSING_PUBLICATION_ARGUMENTS');
  const payload=JSON.parse(fs.readFileSync(assessmentFile,'utf8'));
  if(payload.runId!==expectedRunId)throw new Error('STALE_PUBLICATION_RUN');
  if(payload.sourceEligible!==true)throw new Error('SOURCE_INELIGIBLE');
  const e=evaluation(payload);
  if(e.manifest.length!==e.acceptedRows)throw new Error('INVALID_PUBLICATION_COUNT');
  const history={};
  for(const item of e.manifest) {
    const file=path.join(root,'data','history',item.ticker+'.json');
    // Never tolerate absent or unreadable files.
    history[item.ticker]=JSON.parse(fs.readFileSync(file,'utf8'));
  }
  verifyManifest(e.manifest,history);
  // Rejected tickers are a negative assertion: no quarantinable candle may survive.
  for(const [ticker] of e.rejected) {
    const file=path.join(root,'data','history',ticker+'.json');
    if(!fs.existsSync(file)) continue;
    const doc=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!Array.isArray(doc.sessions)) throw new Error('INVALID_REJECTED_HISTORY:'+ticker);
    if(doc.sessions.some(row=>row?.source===SOURCE && String(row?.date||row?.sessionDate||'').slice(0,10)===e.expectedSession))
      throw new Error('REJECTED_CANDLE_STILL_PUBLISHED:'+ticker);
  }
  return {runId:e.runId,expectedSession:e.expectedSession,verifiedRows:e.manifest.length,manifestSha256:e.manifestSha256};
}
if(require.main===module) {
  try {
    const [assessmentFile,runId,root]=process.argv.slice(2);
    const outcome=verifyPublication({assessmentFile,expectedRunId:runId,root:root||process.cwd()});
    process.stdout.write(JSON.stringify({status:'PASS',...outcome})+'\n');
  }catch(e){process.stderr.write('HISTORY_PUBLICATION_BLOCKED: '+e.message+'\n');process.exitCode=1;}
}
module.exports={verifyPublication};
