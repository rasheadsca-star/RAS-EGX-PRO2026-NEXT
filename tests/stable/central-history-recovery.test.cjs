'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {analyze,validBar}=require('../../scripts/stable/central-history-recovery.cjs');
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'egx-legacy-rec-'));
 const put=(p,v)=>{const q=path.join(dir,p);fs.mkdirSync(path.dirname(q),{recursive:true});fs.writeFileSync(q,JSON.stringify(v));};
 put('data/stable/v15-price-truth.json',{expectedSession:'2026-10-26',missingHistoryFiles:['ABC'],sampleRejected:[]});
 put('data/history-summary.json',{symbolsTotal:1,symbolsComplete100:0,symbols:[{ticker:'ABC',processingStatus:'failed',lastUpdateError:'Yahoo HTTP 404',availableSessions:0}]});
 return {dir,put};
}
const b=(date,close=10,volume=100)=>({date,open:close,high:close+1,low:close-1,close,volume});
test('valid OHLCV rejects malformed and future sessions',()=>{
 assert.equal(validBar(b('2026-10-27'),'2026-10-26','ABC'),null);
 assert.equal(validBar({...b('2026-10-20'),high:4},'2026-10-26','ABC'),null);
 assert.ok(validBar(b('2026-10-20'),'2026-10-26','ABC'));
});
test('legacy recovery produces quarantine candidates only and never writes canonicals',()=>{
 const {dir,put}=fixture();try{
  put('data/history/ABC.json',{ticker:'ABC',sessions:[b('2026-10-19'),b('2026-10-20'),b('2026-10-21')]});
  put('archive-v18/data/history/ABC.json',{ticker:'ABC',sessions:[b('2026-10-17'),b('2026-10-19'),b('2026-10-20'),b('2026-10-21')]});
  const report=analyze({root:dir,archivePaths:['archive-v18/data/history/ABC.json']});
  assert.equal(report.summary.archivalNewSessionRows,1);
  assert.equal(report.candidates[0].stageStatus,'OVERLAP_VALIDATED_NEEDS_INDEPENDENT_SECOND_SOURCE');
  assert.equal(report.candidates[0].eligibleForAutomaticCanonicalWrite,false);
  assert.equal(report.summary.canonicalRowsWritten,0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'data/history/ABC.json'))).sessions.length,3);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('conflicting legacy price is quarantined',()=>{
 const {dir,put}=fixture();try{
  put('data/history/ABC.json',{ticker:'ABC',sessions:[b('2026-10-20')]});
  put('legacy/data/history/ABC.json',{ticker:'ABC',sessions:[b('2026-10-18'),b('2026-10-20',1000)]});
  const report=analyze({root:dir,archivePaths:['legacy/data/history/ABC.json']});
  assert.equal(report.candidates[0].conflicts,1);
  assert.equal(report.candidates[0].stageStatus,'QUARANTINED_UNVERIFIED');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('ticker mismatch is not accepted',()=>{
 const {dir,put}=fixture();try{
  put('legacy/data/history/ABC.json',{ticker:'OTHER',sessions:[b('2026-10-18')]});
  const report=analyze({root:dir,archivePaths:['legacy/data/history/ABC.json']});
  assert.equal(report.candidates.length,0);assert.equal(report.rejections[0].reason,'TICKER_IDENTITY_CONFLICT');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
