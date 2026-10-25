'use strict';
// Review-only historical candidate triage. Never writes canonical data/history.
const fs=require('node:fs');
function triage({missing,source}){
 if(!Array.isArray(missing)||!source||typeof source.symbols!=='object')throw Error('INVALID_TRIAGE_INPUT');
 return missing.map(ticker=>{
  const rows=source.symbols[ticker];
  if(!Array.isArray(rows)||!rows.length)return {ticker,status:'NO_SOURCE_CANDIDATE'};
  const valid=[],rejected=[];
  for(const r of rows){
   const nums=['open','high','low','close'].map(k=>r[k]);
   const ok=nums.every(x=>typeof x==='number'&&Number.isFinite(x)&&x>0)
    &&r.low<=Math.min(r.open,r.close)&&r.high>=Math.max(r.open,r.close)
    &&r.high>=r.low&&Number.isFinite(r.volume)&&r.volume>=0
    &&/^\\d{4}-\\d{2}-\\d{2}$/.test(r.date);
   (ok?valid:rejected).push({date:r.date,reason:ok?'STRUCTURALLY_VALID':'INVALID_OHLCV'});
  }
  return {ticker,status:rejected.length?'REVIEW_INVALID_CANDLES':'STRUCTURAL_CANDIDATE_ONLY',
   count:rows.length,validCount:valid.length,rejectedCount:rejected.length,
   dates:valid.map(r=>r.date),rejections:rejected};
 });
}
if(require.main===module){
 const [sourcePath,reportPath]=process.argv.slice(2);
 if(!sourcePath||!reportPath)throw Error('INPUT_FILES_REQUIRED');
 const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
 console.log(JSON.stringify(triage({missing:report.missingHistoryFiles,source:JSON.parse(fs.readFileSync(sourcePath,'utf8'))}),null,2));
}
module.exports={triage};
