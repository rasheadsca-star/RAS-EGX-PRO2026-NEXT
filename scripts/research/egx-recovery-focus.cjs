'use strict';
// Recover actual symbol-level gaps from persistent summary, not one failed v15 attempt.
function focusFromPersistent({truth={},historySummary={},symbolMap={},expectedSession}={}){
 const maps=Array.isArray(symbolMap)?symbolMap:Object.values(symbolMap||{});
 const active=maps.filter(x=>x?.ticker&&x.active!==false);
 const by=new Map((historySummary.symbols||[]).filter(x=>x?.ticker)
  .map(x=>[String(x.ticker).toUpperCase(),x]));
 const truthMissing=new Set((truth.missingHistoryFiles||[]).map(x=>String(x).toUpperCase()));
 const focus=[];
 for(const e of active){
  const t=String(e.ticker).toUpperCase(),h=by.get(t);
  const sessions=Number(h?.availableSessions||0);
  const reasons=[];
  if(!h||sessions===0)reasons.push('NO_HISTORIC_BARS');
  else if(sessions<60)reasons.push('LESS_THAN_60_VALID_BARS_REQUIRES_SOURCE_AUDIT');
  if(!h?.lastSession||h.lastSession!==expectedSession)reasons.push('EXPECTED_SESSION_HISTORY_GAP');
  if(h?.symbolVerified!==true)reasons.push('UNVERIFIED_HISTORY_SYMBOL_IDENTITY');
  if(String(h?.lastUpdateError||'').includes('HTTP 404'))reasons.push('YAHOO_HTTP_404');
  if(truthMissing.has(t))reasons.push('FAILED_OR_MISSING_V15_HISTORY_REFERENCE');
  if(reasons.length)focus.push({ticker:t,reasons,historySessions:sessions,
   lastSession:h?.lastSession||null,historyStatus:h?.historyStatus||null,
   sourceStatus:h?.processingStatus||null,expectedSession,
   mandatoryPointInTimeVerification:true,autoPromote:false});
 }
 return focus.sort((a,b)=>a.ticker.localeCompare(b.ticker));
}
module.exports={focusFromPersistent};
