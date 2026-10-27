'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {eligible,classify}=require('../../scripts/stable/v15-last-accepted-truth-audit.cjs');
const candidate={ready:true,executionGrade:true,expectedSession:'2026-10-26',
  minimumExecutionRows:180,acceptedRows:204,updatedHistoryFiles:180,generatedAt:'2026-10-27T05:05:00.000Z',
  source:{preciseSource:true,realFetch:true,verifiedExpectedSessionRows:204}};
const handoff={sourceReady:true,currentSessionReady:true,final:true,executionGrade:true,
  sessionDate:'2026-10-26',acceptedRows:204};
test('historical accepted price truth requires handoff + precise real source + 180 real files',()=>{
 assert.equal(eligible(candidate,handoff),true);
 assert.equal(eligible({...candidate,updatedHistoryFiles:179},handoff),false);
 assert.equal(eligible({...candidate,source:{...candidate.source,verifiedExpectedSessionRows:7}},handoff),false);
 assert.equal(eligible({...candidate,ready:false},handoff),false);
 assert.equal(eligible({...candidate,acceptedRows:205},handoff),false);
});
test('failed intraday current file remains blocked even if older 204-row truth exists',()=>{
 const failed={ready:false,executionGrade:false,expectedSession:'2026-10-26',acceptedRows:0,source:{verifiedExpectedSessionRows:7}};
 const doc=classify(failed,candidate,handoff,'a'.repeat(40));
 assert.equal(doc.activeFailClosed,true);
 assert.equal(doc.executionAllowed,false);
 assert.equal(doc.current.acceptedRows,0);
 assert.equal(doc.historicalEvidence.acceptedRows,204);
 assert.equal(doc.historicalEvidence.sameTargetSessionAsFailedAttempt,true);
 assert.equal(doc.activeDecisionSource,'data/stable/v15-price-truth.json');
});
test('older or mismatched handoff cannot be falsely certified from candidate Git file',()=>{
 assert.equal(eligible(candidate,{...handoff,sessionDate:'2026-10-21'}),false);
 const x=classify({ready:false,executionGrade:false,expectedSession:'2026-10-27'},null,handoff,null);
 assert.equal(x.historicalEvidence,null);
 assert.equal(x.executionAllowed,false);
});
test('even successful current sources never open trading through this forensic artifact',()=>{
 const x=classify(candidate,candidate,handoff,'b'.repeat(40));
 assert.equal(x.activeFailClosed,false);
 assert.equal(x.executionAllowed,false);
});
