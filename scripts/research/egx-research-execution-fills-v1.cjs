'use strict';
// Research-only fill model. Stop is tested before target when both occur in a bar.
// A gap below stop must be filled at the worse actual opening price, not magically at stop.
function resolveExit(future,entry,maxHoldingBars,stopPct=5,targetPct=9){
 if(!(entry>0)||!Array.isArray(future)||!Number.isInteger(maxHoldingBars)||maxHoldingBars<1)return null;
 const stop=entry*(1-stopPct/100),target=entry*(1+targetPct/100);
 for(let k=0;k<Math.min(maxHoldingBars,future.length);k++){
  const b=future[k];if(b.executable===false||!(b.volume>0))continue;
  if(b.low<=stop)return {exitPrice:Math.min(stop,b.open),offset:k,status:b.open<stop?'STOP_GAP':'STOP'};
  if(b.high>=target)return {exitPrice:target,offset:k,status:'TARGET'};
 }
 if(future.length<maxHoldingBars)return null;
 const b=future.at(maxHoldingBars-1);if(!b||b.executable===false||!(b.volume>0))return null;
 return {exitPrice:b.close,offset:maxHoldingBars-1,status:'TIME_EXIT'};
}
module.exports={resolveExit};
