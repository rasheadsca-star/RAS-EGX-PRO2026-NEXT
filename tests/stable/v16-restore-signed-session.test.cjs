'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {validateSigned,verifyHistory}=require('../../scripts/stable/v16-restore-signed-session.cjs');
const session='2026-10-27';
function fixture(){return {
 marker:{sessionDate:session,expectedSession:session,final:true,pagesPublished:true,sourceReady:true,executionGrade:true,acceptedRows:2,sourceSessionEvidenceCoveragePct:100},
 truth:{expectedSession:session,ready:true,executionGrade:true,acceptedRows:2,rejectedRows:0,droppedRows:0,source:{inputRows:2,sourceSessionEvidenceCoveragePct:100}},
 status:{expectedSession:session,executionGrade:true,marketRows:2,inputRows:2,currentSessionRows:2,rejectedCurrentSessionRows:0,droppedCurrentSessionRows:0,coveragePct:100,sourceSessionEvidenceCoveragePct:100},
 market:{rows:[{symbol:'ABCD',sourceSessionDate:session,open:10,high:11,low:9,close:10,volume:100},{symbol:'EFGH',sourceSessionDate:session,open:20,high:22,low:19,close:21,volume:200}]}
};}
test('signed same-session source requires exact counts',()=>{
 const f=fixture();assert.equal(validateSigned(f.marker,f.truth,f.status,f.market,session).accepted,2);
});
test('reject stale sessions, unsigned sources and mismatched accepted counts',()=>{
 for(const mutate of [f=>f.marker.sessionDate='2026-10-26',f=>f.marker.pagesPublished=false,
  f=>f.marker.acceptedRows=3,f=>f.status.coveragePct=90,
  f=>f.status.rejectedCurrentSessionRows=1,f=>f.marker.sourceSessionEvidenceCoveragePct=89]){
  const f=fixture();mutate(f);assert.throws(()=>validateSigned(f.marker,f.truth,f.status,f.market,session));
 }
});
test('require verified current OHLCV in persisted history for every accepted bar',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-signed-'));
 try{
  fs.mkdirSync(path.join(root,'data/history'),{recursive:true});const f=fixture();
  for(const r of f.market.rows)fs.writeFileSync(path.join(root,'data/history',r.symbol+'.json'),
   JSON.stringify({symbolVerified:true,isin:'EGS123456789',sessions:[{date:session,open:r.open,high:r.high,low:r.low,close:r.close,volume:r.volume}]}));
  assert.equal(verifyHistory(root,f.market,session,2),2);
  const p=path.join(root,'data/history/EFGH.json'),h=JSON.parse(fs.readFileSync(p));
  h.sessions[0].close=22;fs.writeFileSync(p,JSON.stringify(h));
  assert.throws(()=>verifyHistory(root,f.market,session,2),/SIGNED_HISTORY_BAR_MISMATCH/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
