'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {prepush}=require('../../scripts/stable/history-prepush-proof.cjs');
const {capture}=require('../../scripts/stable/history-r8-integrity.cjs');
const {evaluation,hash}=require('../../scripts/stable/history-quarantine-policy.cjs');
const day='2026-10-25',SOURCE='v16_session_aware_price_truth';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-prepush-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'data/history'),{recursive:true});
 fs.mkdirSync(path.join(root,'data/stable'),{recursive:true});
 const row={ticker:'MIPH',date:day,source:SOURCE,close:683};
 fs.writeFileSync(path.join(root,'data/history/MIPH.json'),JSON.stringify({sessions:[{date:'2026-10-22',close:742}]}));
 const assessment={runId:'run-verified',expectedSession:day,sourceEligible:true,acceptedRows:1,accepted:[row],
  missingHistory:[],rejected:[],dropped:[],inputRows:1,inputSymbols:['MIPH']};
 const a=evaluation(assessment);
 const baseline=capture({root,expectedSession:day,affectedTickers:new Set(['MIPH']),assessment:a});
 const assessmentFile=path.join(root,'frozen-assessment.json'),baselineFile=path.join(root,'frozen-baseline.json');
 fs.writeFileSync(assessmentFile,JSON.stringify(assessment));fs.writeFileSync(baselineFile,JSON.stringify(baseline));
 const report={schemaVersion:'16.3.5-session-aware-price-truth-bound',runId:'run-verified',expectedSession:day,sourceEligible:true,
  ready:true,executionGrade:true,acceptedRows:1,rejectedRows:0,droppedRows:0,inputRows:1,
  inputSymbolsSha256:hash(['MIPH']),updatedHistoryFiles:1,missingHistoryFiles:[],manifestSha256:a.manifestSha256,
  rejectedFull:[],droppedFull:[]};
 fs.writeFileSync(path.join(root,'data/history/MIPH.json'),JSON.stringify({sessions:[{date:'2026-10-22',close:742},row]}));
 fs.writeFileSync(path.join(root,'data/stable/v15-price-truth.json'),JSON.stringify(report));
 return {root,assessmentFile,baselineFile,expectedRunId:'run-verified'};
}
test('prepush rejects valid but under-200 history as not execution-grade',t=>{
 const f=fixture(t);assert.throws(()=>prepush(f),/PREPUSH_INSUFFICIENT_EXECUTION_ROWS:1\/1/);
});
test('prepush blocks stale run and rebase-swapped producer report',t=>{
 const f=fixture(t);assert.throws(()=>prepush({...f,expectedRunId:'other'}),/PREPUSH_STALE_RUN/);
 const file=path.join(f.root,'data/stable/v15-price-truth.json'),report=JSON.parse(fs.readFileSync(file));
 report.runId='another-run';fs.writeFileSync(file,JSON.stringify(report));
 assert.throws(()=>prepush(f),/R9_PRODUCER_REPORT_MISMATCH/);
});
test('prepush blocks rebase changing protected prior session',t=>{
 const f=fixture(t),file=path.join(f.root,'data/history/MIPH.json'),doc=JSON.parse(fs.readFileSync(file));
 doc.sessions[0].close=999;fs.writeFileSync(file,JSON.stringify(doc));
 assert.throws(()=>prepush(f),/PREVIOUS_SESSIONS_CHANGED/);
});
test('prepush blocks changed accepted candle even when R8 permits same-session edits',t=>{
 const f=fixture(t),file=path.join(f.root,'data/history/MIPH.json'),doc=JSON.parse(fs.readFileSync(file));
 doc.sessions[1].close=999;fs.writeFileSync(file,JSON.stringify(doc));
 assert.throws(()=>prepush(f),/MANIFEST_HISTORY_HASH_MISMATCH/);
});
