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
