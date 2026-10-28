'use strict';
// Conservative contamination guard: adjacent positive-volume OHLC copies can
// be legitimate but are not acceptable as independent market evidence.
const eq=(a,b)=>typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)&&a===b;
function copiedBarReasons(bars){
 const issues=[];
 if(!Array.isArray(bars))return issues;
 for(let i=1;i<bars.length;i++){
  const prev=bars[i-1],curr=bars[i];
  if(!(prev&&curr&&Number(curr.volume)>0&&Number(prev.volume)>0))continue;
  const ohl=['open','high','low'].every(k=>eq(curr[k],prev[k]));
  if(!ohl)continue;
  issues.push({index:i,date:curr.date||curr.sessionDate||null,
    reason:eq(curr.close,prev.close)?(eq(curr.volume,prev.volume)?'REPEATED_OHLCV':'REPEATED_OHLC'):'REPEATED_OHL'});
 }
 return issues;
}
module.exports={copiedBarReasons};
