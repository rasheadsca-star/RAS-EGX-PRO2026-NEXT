'use strict';
const fs=require('node:fs'),path=require('node:path');
const ALLOWED=new Set(['VERIFIED_TRADED','VERIFIED_NO_TRADE','VERIFIED_SUSPENDED','UNRESOLVED']);
function validate(rows,requests){
 const known=new Set((requests.pairs||[]).map(x=>x.ticker+'|'+x.date)),seen=new Set(),approved=[],rejected=[];
 for(const row of rows){
  const reasons=[],key=row.ticker+'|'+row.date;
  if(!known.has(key))reasons.push('not_requested');
  if(seen.has(key))reasons.push('duplicate');seen.add(key);
  if(!ALLOWED.has(row.status))reasons.push('invalid_status');
  if(row.status==='VERIFIED_TRADED'){
   const nums=['open','high','low','close','volume'].map(k=>row[k]===null||row[k]===undefined||String(row[k]).trim()===''?NaN:Number(row[k]));
   if(nums.some(v=>!Number.isFinite(v))||nums.slice(0,4).some(v=>v<=0)||nums[4]<=0)reasons.push('invalid_ohlcv');
   else if(nums[1]<Math.max(nums[0],nums[3],nums[2])||nums[2]>Math.min(nums[0],nums[3],nums[1]))reasons.push('ohlc_inconsistent');
   if(!/^https:\/\//.test(row.sourceUrl||'')||!row.sourceSessionDate||row.sourceSessionDate!==row.date)reasons.push('missing_dated_source');
   if(!row.sourceInstrumentId||!row.verificationMethod||!row.reviewer)reasons.push('missing_identity_or_review');
  }else if(row.status==='VERIFIED_NO_TRADE'||row.status==='VERIFIED_SUSPENDED'){
   if(!/^https:\/\//.test(row.sourceUrl||'')||row.sourceSessionDate!==row.date||!row.sourceInstrumentId||!row.reviewer)reasons.push('missing_status_evidence');
  }
  if(row.status==='UNRESOLVED')reasons.push('unresolved_not_approved');
  if(reasons.length)rejected.push({ticker:row.ticker,date:row.date,reasons});
  else approved.push({...row,automaticCanonicalMergeAllowed:false});
 }
 return {approved,rejected,requested:known.size,submitted:rows.length,complete:seen.size===known.size&&rejected.length===0,automaticCanonicalMergeAllowed:false};
}
if(require.main===module){
 const input=process.argv[2],queue=process.argv[3]||'research-artifacts/unique-price-gaps.json',output=process.argv[4]||'research-artifacts/verified-import-gate.json';
 if(!input)throw Error('usage: node verify-gap-import.cjs <claude-json-array> [request-list] [output]');
 const rows=JSON.parse(fs.readFileSync(input,'utf8')),requests=JSON.parse(fs.readFileSync(queue,'utf8'));
 const result=validate(Array.isArray(rows)?rows:rows.rows||[],requests);
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({approved:result.approved.length,rejected:result.rejected.length,complete:result.complete,automaticCanonicalMergeAllowed:false}));
 if(result.rejected.length)process.exitCode=1;
}
module.exports={validate};
