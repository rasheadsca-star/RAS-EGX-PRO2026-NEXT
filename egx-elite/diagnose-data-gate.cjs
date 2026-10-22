#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const load=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
function diagnose(price,handoff,app,second){
  const session=price.expectedSession;
  const rejected=price.sampleRejected||[];
  const byReason={};for(const row of rejected)byReason[row.reason||'UNKNOWN']=(byReason[row.reason||'UNKNOWN']||0)+1;
  const approved=Object.entries(second.records||{}).filter(([,r])=>r?.approved===true&&r?.approvedEvidence?.sessionDate===session).map(([ticker])=>ticker);
  const result={
    session,acceptedRows:price.acceptedRows,requiredRows:200,shortfall:Math.max(0,200-Number(price.acceptedRows||0)),
    rejectedCount:rejected.length,rejectedByReason:byReason,
    candidatesNeedingVerification:rejected.map(({ticker,reason,sourceSessionDate})=>({ticker,reason,sourceSessionDate:sourceSessionDate||null,independentSameSessionEvidenceAvailable:approved.includes(ticker)})),
    secondSourceSession:second.expectedSession||null,
    secondSourceEvidenceCurrent:second.expectedSession===session,
    handoffSession:handoff.sessionDate||null,
    snapshotSession:app.sourceDecision?.session||null,
    sessionIdentityMatches:app.sourceDecision?.session===handoff.sessionDate&&handoff.expectedSession===handoff.sessionDate,
    eligibleForRegeneration:Number(price.acceptedRows)>=200&&second.expectedSession===session&&app.sourceDecision?.session===handoff.sessionDate&&handoff.expectedSession===handoff.sessionDate,
    warning:'No bars, evidence, thresholds, or handoff metadata have been modified.'
  };
  return result;
}
if(require.main===module){
  const result=diagnose(load('data/stable/v15-price-truth.json'),load('data/ops/g22-main-app-handoff.json'),load('astra-prod/app/data.json'),load('data/stable/v16-market-second-source-evidence.json'));
  console.log(JSON.stringify(result,null,2));
  if(!result.eligibleForRegeneration)process.exitCode=2;
}
module.exports={diagnose};
