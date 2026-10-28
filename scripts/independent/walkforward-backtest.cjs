'use strict';
// Fixed-policy chronological OUT-OF-SAMPLE research backtest, never an order engine.
// No optimization, no inferred bars, no lookahead; trade at NEXT session's open.
const POLICY=Object.freeze({
 trainBars:100,minOosBars:40,fast:20,slow:50,atrBars:14,
 minTurnoverEgp:1000000,maxAtrPct:0.10,maxEntryGapAtr:0.5,
 stopAtr:2,targetAtr:4,maxHoldSessions:10,
 entryCostBps:25,exitCostBps:25,initialEquityEgp:100000,
 riskPerTradePct:0.005,maxPositionPct:0.10
});
const iso=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 !Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const mean=x=>x.reduce((a,b)=>a+b,0)/x.length;
function strictProvenance(r,barValid){
 const d=r?.date||r?.sessionDate;
 return barValid(r)&&iso(d)&&r.sourceSessionDate===d&&
  !(Array.isArray(r.warnings)&&r.warnings.some(w=>/invalid|conflict|quarantin|unresolved/i.test(String(w))))&&
  r.validationStatus==='precise_public_source_session_confirmed'&&
  typeof r.sourceSessionEvidence==='string'&&r.sourceSessionEvidence.length>=8&&
  /^https:\/\//.test(String(r.sourceUrls?.primary||''))&&
  Number.isFinite(Date.parse(String(r.fetchedAt||'')))&&
  ((Array.isArray(r.verifiedBy)&&r.verifiedBy.length>0)||
   (r.secondSourceConfirmed===true&&Array.isArray(r.verificationSources)&&r.verificationSources.length>0));
}
function signalAt(bars,index,p=POLICY){
 if(index<p.slow||index>=bars.length)return null;
 const current=bars[index],prefix=bars.slice(0,index+1);
 const fast=mean(prefix.slice(-p.fast).map(r=>r.close));
 const slow=mean(prefix.slice(-p.slow).map(r=>r.close));
 const v=mean(prefix.slice(-21,-1).map(r=>r.volume));
 let tr=0;
 for(let i=index-p.atrBars+1;i<=index;i++){
  const r=bars[i],prev=bars[i-1];
  tr+=Math.max(r.high-r.low,Math.abs(r.high-prev.close),Math.abs(r.low-prev.close));
 }
 const a=tr/p.atrBars;
 if(!(current.close>fast&&fast>slow&&a>0&&a/current.close<=p.maxAtrPct&&
  current.close*v>=p.minTurnoverEgp))return null;
 return {date:current.date||current.sessionDate,close:current.close,atr:a,
  sma20:fast,sma50:slow,averageVolume20:v};
}
function walkForwardBacktest(bars,{barValid,policy=POLICY,currency='EGP'}={}){
 const assumptions={...policy,entryTiming:'NEXT_SESSION_OPEN',signalTiming:'PRIOR_SESSION_CLOSE',
  costs:'FIXED_HYPOTHETICAL_BPS_EACH_SIDE',ambiguousIntrabar:'STOP_FIRST',
  overlappingPositions:false,parameterSearch:false};
 const blocked=(status,extra={})=>({status,performanceCertified:false,mode:'RESEARCH_ONLY',
  tradeCount:0,assumptions,...extra});
 if(currency!=='EGP')return blocked('EGP_LIQUIDITY_UNIT_UNVERIFIED');
 if(!Array.isArray(bars)||typeof barValid!=='function')return blocked('INVALID_INPUT');
 // Fail closed on ANY contaminated candle in the study window.
 if(bars.some((r,i)=>!strictProvenance(r,barValid)||
   (i>0&&(r.date||r.sessionDate)<=(bars[i-1].date||bars[i-1].sessionDate))))
  return blocked('UNVERIFIED_OR_DUPLICATE_HISTORICAL_OHLCV',{barsAvailable:bars.length});
 if(bars.length<policy.trainBars+policy.minOosBars)
  return blocked('INSUFFICIENT_VERIFIED_HISTORY',{barsAvailable:bars.length,
   barsRequired:policy.trainBars+policy.minOosBars});
 const trades=[];let unresolved=0,skippedGaps=0,equity=policy.initialEquityEgp;
 let peak=equity,maxDrawdownPct=0;
 for(let t=policy.trainBars-1;t<bars.length-1;t++){
  const signal=signalAt(bars,t,policy);if(!signal)continue;
  const next=bars[t+1],entry=next.open;
  // The gap is known only at execution, never at signal formation.
  if(Math.abs(entry-signal.close)>policy.maxEntryGapAtr*signal.atr){skippedGaps++;continue}
  const stop=entry-policy.stopAtr*signal.atr,target=entry+policy.targetAtr*signal.atr;
  if(stop<=0)continue;
  const riskPerShare=entry-stop+entry*(policy.entryCostBps+policy.exitCostBps)/10000;
  const shares=Math.floor(Math.min(
   equity*policy.riskPerTradePct/riskPerShare,
   equity*policy.maxPositionPct/(entry*(1+policy.entryCostBps/10000))));
  if(shares<1)continue;
  let exitIndex=-1,exitPrice=null,exitReason='';
  for(let j=t+1;j<=Math.min(bars.length-1,t+policy.maxHoldSessions);j++){
   const b=bars[j];
   if(b.open<=stop){exitPrice=b.open;exitReason='STOP_GAP';}
   else if(b.low<=stop){exitPrice=stop;exitReason='STOP_OR_AMBIGUOUS';}
   else if(b.high>=target){exitPrice=target;exitReason='TARGET';}
   else if(j===t+policy.maxHoldSessions){exitPrice=b.close;exitReason='TIME_LIMIT';}
   if(exitPrice!==null){exitIndex=j;break}
  }
  if(exitIndex<0){unresolved++;break}
  const fees=shares*(entry*policy.entryCostBps+exitPrice*policy.exitCostBps)/10000;
  const pnl=(exitPrice-entry)*shares-fees;equity+=pnl;
  peak=Math.max(peak,equity);
  maxDrawdownPct=Math.max(maxDrawdownPct,(peak-equity)/peak*100);
  trades.push({signalSession:signal.date,entrySession:next.date||next.sessionDate,
   exitSession:bars[exitIndex].date||bars[exitIndex].sessionDate,
   entryPrice:entry,exitPrice,shares,feesEgp:Number(fees.toFixed(2)),
   netPnlEgp:Number(pnl.toFixed(2)),exitReason});
  t=exitIndex; // no overlapping positions; next signal only after exit.
 }
 const netPnlEgp=equity-policy.initialEquityEgp;
 return {status:trades.length?'OOS_RESEARCH_RESULTS_NOT_CERTIFIED':'OOS_NO_CLOSED_TRADES',
  performanceCertified:false,mode:'RESEARCH_ONLY',
  oosStartSession:bars[policy.trainBars].date||bars[policy.trainBars].sessionDate,
  oosEndSession:bars.at(-1).date||bars.at(-1).sessionDate,
  oosBars:bars.length-policy.trainBars,tradeCount:trades.length,
  wins:trades.filter(t=>t.netPnlEgp>0).length,
  netPnlEgp:Number(netPnlEgp.toFixed(2)),
  netReturnPct:Number((netPnlEgp/policy.initialEquityEgp*100).toFixed(4)),
  maxDrawdownPct:Number(maxDrawdownPct.toFixed(4)),
  unresolvedTrades:unresolved,skippedGaps,trades,assumptions};
}
module.exports={POLICY,strictProvenance,signalAt,walkForwardBacktest};
