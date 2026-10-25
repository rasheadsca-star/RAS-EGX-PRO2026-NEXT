'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {verifyPublication}=require('../../scripts/stable/history-publication-gate.cjs');
const day='2026-10-25';
function fixture() {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'history-publish-gate-'));
 const row={ticker:'MIPH',date:day,source:'v16_session_aware_price_truth',close:683.5};
 const dir=path.join(root,'data/history');fs.mkdirSync(dir,{recursive:true});
 const historyPath=path.join(dir,'MIPH.json'),assessmentFile=path.join(root,'assessment.json');
 function writeHistory(rows){fs.writeFileSync(historyPath,JSON.stringify({sessions:rows}));}
 function writeAssessment(change={}){fs.writeFileSync(assessmentFile,JSON.stringify({
  runId:'run-123',expectedSession:day,sourceEligible:true,acceptedRows:1,accepted:[row],rejected:[],...change
 }));}
 writeHistory([row]);writeAssessment();
 return {root,row,historyPath,assessmentFile,writeAssessment,writeHistory};
}
test('passes exact accepted row and run after rebase',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
 const out=verifyPublication({assessmentFile:f.assessmentFile,root:f.root,expectedRunId:'run-123'});
 assert.equal(out.verifiedRows,1);assert.equal(out.expectedSession,day);assert.equal(out.runId,'run-123');
 assert.match(out.manifestSha256,/^[a-f0-9]{64}$/);
});
test('rejects rebase silently replacing accepted candle',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
 f.writeHistory([{...f.row,close:690}]);
 assert.throws(()=>verifyPublication({assessmentFile:f.assessmentFile,root:f.root,expectedRunId:'run-123'}),/MANIFEST_HISTORY_HASH_MISMATCH/);
});
test('rejects disappearing and duplicated rows',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
 f.writeHistory([]);assert.throws(()=>verifyPublication({assessmentFile:f.assessmentFile,root:f.root,expectedRunId:'run-123'}),/MANIFEST_HISTORY_HASH_MISMATCH/);
 f.writeHistory([f.row,f.row]);assert.throws(()=>verifyPublication({assessmentFile:f.assessmentFile,root:f.root,expectedRunId:'run-123'}),/MANIFEST_HISTORY_HASH_MISMATCH/);
});
test('rejects stale run and bad/incomplete assessments',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
 assert.throws(()=>verifyPublication({assessmentFile:f.assessmentFile,root:f.root,expectedRunId:'run-old'}),/STALE_PUBLICATION_RUN/);
 f.writeAssessment({sourceEligible:false});assert.throws(()=>verifyPublication({assessmentFile:f.assessmentFile,root:f.root,expectedRunId:'run-123'}),/SOURCE_INELIGIBLE/);
 f.writeAssessment({acceptedRows:2});assert.throws(()=>verifyPublication({assessmentFile:f.assessmentFile,root:f.root,expectedRunId:'run-123'}),/MANIFEST_COUNT_OR_SESSION_MISMATCH/);
});

test('R6 blocks rejected candle surviving rebase even when accepted manifest valid',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
 const dir=path.join(f.root,'data/history');
 fs.writeFileSync(path.join(dir,'FAIT.json'),JSON.stringify({sessions:[{ticker:'FAIT',date:day,source:'v16_session_aware_price_truth',close:40.58}]}));
 f.writeAssessment({rejected:[{ticker:'FAIT',reason:'REPORTED_CHANGE_MISMATCH'}]});
 assert.throws(()=>verifyPublication({assessmentFile:f.assessmentFile,root:f.root,expectedRunId:'run-123'}),/REJECTED_CANDLE_STILL_PUBLISHED:FAIT/);
});
test('R6 permits rejected symbol without session candle or with foreign source',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
 const dir=path.join(f.root,'data/history');
 fs.writeFileSync(path.join(dir,'FAIT.json'),JSON.stringify({sessions:[{ticker:'FAIT',date:day,source:'independent_approved',close:40.58}]}));
 f.writeAssessment({rejected:[{ticker:'FAIT',reason:'REPORTED_CHANGE_MISMATCH'}]});
 assert.equal(verifyPublication({assessmentFile:f.assessmentFile,root:f.root,expectedRunId:'run-123'}).verifiedRows,1);
});
test('R7 blocks conflicting same-date candle even when one matches accepted digest',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
 f.writeHistory([f.row,{...f.row,close:690}]);
 assert.throws(()=>verifyPublication({assessmentFile:f.assessmentFile,root:f.root,expectedRunId:'run-123'}),/MANIFEST_HISTORY_HASH_MISMATCH/);
});

test('R6-c previous-session candle from producer remains allowed for explicitly rejected ticker',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(f.root,'data/history/FAIT.json'),JSON.stringify({sessions:[
  {ticker:'FAIT',date:'2026-10-22',source:'v16_session_aware_price_truth',close:43.31}
 ]}));
 f.writeAssessment({rejected:[{ticker:'FAIT',reason:'REPORTED_CHANGE_MISMATCH'}]});
 assert.equal(verifyPublication({assessmentFile:f.assessmentFile,root:f.root,expectedRunId:'run-123'}).verifiedRows,1);
});
test('R6-d sessionDate-only rejected candle is blocked',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(f.root,'data/history/FAIT.json'),JSON.stringify({sessions:[
  {ticker:'FAIT',sessionDate:day,source:'v16_session_aware_price_truth',close:40.58}
 ]}));
 f.writeAssessment({rejected:[{ticker:'FAIT',reason:'REPORTED_CHANGE_MISMATCH'}]});
 assert.throws(()=>verifyPublication({assessmentFile:f.assessmentFile,root:f.root,expectedRunId:'run-123'}),/REJECTED_CANDLE_STILL_PUBLISHED:FAIT/);
});
test('R6-e missing history file of rejected ticker is permitted',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
 f.writeAssessment({rejected:[{ticker:'FAIT',reason:'REPORTED_CHANGE_MISMATCH'}]});
 assert.equal(fs.existsSync(path.join(f.root,'data/history/FAIT.json')),false);
 assert.equal(verifyPublication({assessmentFile:f.assessmentFile,root:f.root,expectedRunId:'run-123'}).verifiedRows,1);
});
test('R6-f malformed rejected ticker history without sessions is blocked',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(f.root,'data/history/FAIT.json'),JSON.stringify({ticker:'FAIT',lastSession:day}));
 f.writeAssessment({rejected:[{ticker:'FAIT',reason:'REPORTED_CHANGE_MISMATCH'}]});
 assert.throws(()=>verifyPublication({assessmentFile:f.assessmentFile,root:f.root,expectedRunId:'run-123'}),/INVALID_REJECTED_HISTORY:FAIT/);
});
test('unassessed NOT_IN_MARKET history does not enter reject assertion',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(f.root,'data/history/SEIG.json'),JSON.stringify({sessions:[
  {ticker:'SEIG',date:day,source:'v16_session_aware_price_truth',close:149.57}
 ]}));
 assert.equal(verifyPublication({assessmentFile:f.assessmentFile,root:f.root,expectedRunId:'run-123'}).verifiedRows,1);
});

test('B2 accepts explicitly declared accepted ticker without a history file',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
 f.writeAssessment({acceptedRows:2,missingHistory:['BONY']});
 assert.equal(verifyPublication({assessmentFile:f.assessmentFile,root:f.root,expectedRunId:'run-123'}).verifiedRows,1);
});
test('B2 blocks missing accepted ticker not explicitly declared or materialized',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
 f.writeAssessment({acceptedRows:2,accepted:[f.row,{ticker:'BONY',date:day,source:'v16_session_aware_price_truth',close:2}]});
 assert.throws(()=>verifyPublication({assessmentFile:f.assessmentFile,root:f.root,expectedRunId:'run-123'}),/ENOENT/);
});
test('B2 rejects declared missing symbol that actually has history',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
 f.writeAssessment({acceptedRows:2,missingHistory:['BONY']});
 fs.writeFileSync(path.join(f.root,'data/history/BONY.json'),JSON.stringify({sessions:[]}));
 assert.throws(()=>verifyPublication({assessmentFile:f.assessmentFile,root:f.root,expectedRunId:'run-123'}),/DECLARED_MISSING_HISTORY_EXISTS:BONY/);
});
