#!/usr/bin/env node
'use strict';
// Standalone pre-push proof: run AFTER rebase, BEFORE push. Do not regenerate
// frozen assessment or phase-B baseline on failure. No writes to history.
const fs=require('node:fs'),path=require('node:path');
const {verify}=require('./history-r8-integrity.cjs');
const {verifyTruthBinding}=require('./history-r9-report-binding.cjs');
const {verifyPublication}=require('./history-publication-gate.cjs');
const {evaluation}=require('./history-quarantine-policy.cjs');
function prepush({root,assessmentFile,baselineFile,expectedRunId}){
 if(!root||!assessmentFile||!baselineFile||!expectedRunId)throw new Error('PREPUSH_PROOF_ARGS_REQUIRED');
 const assessment=JSON.parse(fs.readFileSync(assessmentFile,'utf8'));
 const baseline=JSON.parse(fs.readFileSync(baselineFile,'utf8'));
 if(assessment.runId!==expectedRunId)throw new Error('PREPUSH_STALE_RUN');
 const a=evaluation(assessment);
 if(!a.sourceEligible)throw new Error('PREPUSH_INELIGIBLE_SOURCE');
 if(a.expectedSession!==baseline.expectedSession)throw new Error('PREPUSH_WRONG_SESSION');
 const reportPath=path.join(root,'data/stable/v15-price-truth.json');
 const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
 // Binding ensures the report was produced for exactly the frozen run.
 const bound=verifyTruthBinding({assessment,report});
 // Baseline is captured BEFORE local producer writes, retained outside checkout.
 const affected=new Set(baseline.affected);
 const integrity=verify({root,baseline,affectedTickers:affected});
 const publication=verifyPublication({root,assessmentFile,expectedRunId});
 return {status:'PASS',runId:expectedRunId,session:a.expectedSession,bound,integrity,publication};
}
if(require.main===module){
 try{
  const [assessmentFile,baselineFile,expectedRunId,root=process.cwd()]=process.argv.slice(2);
  console.log(JSON.stringify(prepush({assessmentFile,baselineFile,expectedRunId,root}),null,2));
 }catch(error){console.error('PREPUSH_PROOF_BLOCKED: '+error.message);process.exitCode=1;}
}
module.exports={prepush};
