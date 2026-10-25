'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {prepare}=require('../../scripts/stable/history-producer-assessment.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-producer-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'data/history'),{recursive:true});
 fs.writeFileSync(path.join(root,'data/history/MIPH.json'),JSON.stringify({sessions:[]}));
 const acceptedRows=[{ticker:'MIPH',date:'2026-10-25',source:'v16_session_aware_price_truth',close:683.5},
 {ticker:'BONY',date:'2026-10-25',source:'v16_session_aware_price_truth',close:4}];
 const args={root,expectedSession:'2026-10-25',runId:'run-123',sourceEligible:true,
  marketRows:[{symbol:'MIPH'},{symbol:'BONY'},{symbol:'FAIT'}],acceptedRows,
  rejected:[{ticker:'FAIT',reason:'REPORTED_CHANGE_MISMATCH'}],dropped:[]};
 return {args};
}
test('producer adapter partitions written and 22-like missing accepted rows and validates R9',t=>{
 const {args}=fixture(t),out=prepare(args);
 assert.deepEqual(out.assessment.missingHistory,['BONY']);assert.equal(out.assessment.accepted.length,1);
 assert.equal(out.reportFields.acceptedRows,2);assert.equal(out.reportFields.updatedHistoryFiles,1);
 assert.equal(out.reportFields.inputRows,3);
});
test('producer adapter fails closed on duplicated raw symbols instead of silently ignoring them',t=>{
 const {args}=fixture(t);args.marketRows.push({symbol:'MIPH'});
 assert.throws(()=>prepare(args),/GUARD_INVALID_OR_DUPLICATE_INPUT_SYMBOLS/);
});
test('producer adapter rejects dropped null ticker until explicit source accounting exists',t=>{
 const {args}=fixture(t);args.marketRows[2]={symbol:''};
 args.rejected=[];args.dropped=[{ticker:null,reason:'INVALID_TICKER'}];
 assert.throws(()=>prepare(args),/GUARD_INVALID_OR_DUPLICATE_INPUT_SYMBOLS/);
});
test('producer adapter refuses source-ineligible assessment',t=>{
 const {args}=fixture(t);args.sourceEligible=false;
 assert.throws(()=>prepare(args),/GUARD_SOURCE_INELIGIBLE/);
});
