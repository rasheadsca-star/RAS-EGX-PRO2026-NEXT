'use strict';
const fs=require('node:fs'),path=require('node:path');
if(process.env.EGX_ENABLE_LIVE_TRADING==='true')throw Error('AQM research-only sensitivity');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const {loadUniverse}=require('./egx-strategy-challengers-v1.cjs');
const {computeSignals,replay}=require('./egx-aqm-research-v1.cjs');
const {STYLES,act}=require('./egx-aqm-exit-policies-v1.cjs');
const {executable}=require('./egx-executable-session-series-v1.cjs');
const policy=require('../../data/research/egx-aqm-policy-v1.json');
const round=(v,d=3)=>+v.toFixed(d);
function pairedCohort(universe,entries,style){
 if(!STYLES.includes(style))throw Error('Invalid exit style');
 const risk=policy.risk,fee=risk.roundTripFeesPct/200,slip=risk.exitSlippagePct/100;
 const rowsBySymbol=new Map(Object.entries(universe).map(([ticker,rows])=>[ticker,rows]));
 const results=[];
 for(const original of entries){
  const rows=rowsBySymbol.get(original.ticker)||[],start=rows.findIndex(x=>x.date===original.dateOpened);
  if(start<0)throw Error('Missing recorded entry bar '+original.ticker+'/'+original.dateOpened);
  let p={...original,initialQty:original.qty,qty:original.qty,atr:original.atr,
    target1:original.entry+risk.firstTargetAtrMultiple*original.atr,
    target2:original.entry+risk.secondTargetAtrMultiple*original.atr,
    stop:original.stop,hitFirst:false,holdingBars:0,exitReason:null,proceeds:0};
  let lastPrice=original.entry,closed=false,partialCount=0,staleBars=0;
  for(let j=start;j<rows.length;j++){
   const bar=rows[j];if(!executable(bar)){staleBars++;continue}
   p.holdingBars++;lastPrice=bar.close;
   const action=act(p,bar,style,risk.maxHoldingExecutableSessions);
   for(const x of action.sells){
    if(x.qty>p.qty)throw Error('Overselling baseline paired entry');
    p.proceeds+=x.qty*x.price*(1-slip)*(1-fee);p.qty-=x.qty;
   }
   if(action.firstTarget){p.hitFirst=true;p.stop=Math.max(p.stop,p.entry);partialCount++}
   if(action.nextStop!==undefined)p.stop=action.nextStop;
   if(action.reason)p.exitReason=action.reason;
   if(p.qty===0){closed=true;break}
  }
  const mtmValue=p.qty*lastPrice;
  const pnl=p.proceeds+mtmValue-original.originalCost;
  results.push({ticker:p.ticker,signalDate:p.signalDate,entryDate:p.dateOpened,exitStyle:style,initialQty:p.initialQty,
    closed,holdingBars:p.holdingBars,exitReason:p.exitReason||'RIGHT_CENSORED',
    realizedPlusOpenPnlEgp:round(pnl,2),grossInvestmentEgp:round(original.originalCost,2),
    netReturnOnAllocatedPct:round(100*pnl/original.originalCost),
    stillOpenQty:p.qty,partialCount,missingOrReferenceBars:staleBars});
 }
 const closed=results.filter(x=>x.closed),winners=closed.filter(x=>x.realizedPlusOpenPnlEgp>0);
 const exits=closed.reduce((o,x)=>(o[x.exitReason]=(o[x.exitReason]||0)+1,o),{});
 return {style,entryCount:results.length,closedCount:closed.length,openCount:results.length-closed.length,winningClosedCount:winners.length,
  winRateClosedPct:closed.length?round(100*winners.length/closed.length):null,
  sumMarkedPnlEgp:round(results.reduce((v,x)=>v+x.realizedPlusOpenPnlEgp,0),2),
  sumInitialAllocationsEgp:round(results.reduce((v,x)=>v+x.grossInvestmentEgp,0),2),
  normalizedCohortReturnPct:results.length?round(100*results.reduce((v,x)=>v+x.realizedPlusOpenPnlEgp,0)/results.reduce((v,x)=>v+x.grossInvestmentEgp,0)):null,
  exitReasons:exits,tradeResults:results};
}
function compare(universe,signals,{liquidityFloorEgp=30000000}={}){
 const base=replay(universe,signals,'aqm_pullback',{exitStyle:'partial',riskPerTradePct:1});
 const comparisons=STYLES.map(exitStyle=>{
  const p=replay(universe,signals,'aqm_pullback',{exitStyle,riskPerTradePct:1});
  const small=replay(universe,signals,'aqm_pullback',{exitStyle,riskPerTradePct:0.5});
  const paired=pairedCohort(universe,base.openedEntries,exitStyle);
  const slim=x=>({returnPct:x.portfolioReturnPct,maxDrawdownPct:x.maxDrawdownPct,closedTrades:x.closedTrades,winRatePct:x.winRatePct,openPositions:x.openPositions,staleMarkSessions:x.staleMarkSessions,
    executedEntryCount:x.openedEntries.length,monthlyHaltDays:x.monthlyHaltDays,exitReasons:x.tradeLedger.reduce((o,t)=>(o[t.exitReason]=(o[t.exitReason]||0)+1,o),{})});
  return {exitStyle,portfolioRisk1Pct:slim(p),portfolioRiskHalfPct:slim(small),baselineEntryMatchedCohort:{...paired,tradeResults:undefined},changedEntriesComparedToBaseline:p.openedEntries.length-base.openedEntries.length};
 });
 const baseLosses=base.tradeLedger.filter(x=>x.netPnlEgp<0);
 return {schemaVersion:'egx-aqm-exit-cohort-comparison-v1',generatedAt:new Date().toISOString(),researchOnly:true,
  methodology:'One fixed signal tape; three executable exit policies at 1% and 0.5% risk. Actual portfolio entries may differ as exits free cash and slots at different times. Separately compare all exit policies on the exact baseline entry dates, quantities, price, ATR and entry costs.',
  liquidityFloorEgp,entrySignals:signals.filter(s=>s.variant==='aqm_pullback').length,
  initialCapitalEgp:policy.risk.initialEgp,entryBaselineCount:base.openedEntries.length,
  baselineLossDiagnosis:{closed:base.closedTrades,losing:baseLosses.length,winners:base.tradeLedger.filter(x=>x.netPnlEgp>0).length,
   gapLosses:baseLosses.filter(x=>x.exitReason==='STOP_GAP').length,
   lossByTicker:baseLosses.map(t=>({ticker:t.ticker,entryDate:t.entryDate,exitDate:t.exitDate,reason:t.exitReason,pnlEgp:t.netPnlEgp,netReturnPct:t.netReturnPct}))},
  comparisons,
  guardrails:{fullAQMValidated:false,independentOOS:false,productionEnabled:false,noParameterAutoPromotion:true},
  limitations:['The matched cohort ignores competition for cash and reinvestment; the separate dynamic portfolio test does not hold the actual selected entry set fixed','Right-censored cohort positions marked using last executable close without liquidation fees','Adjusted price continuity, suspensions, and public-as-of fundamentals/index/events not independently certified','Source history was already observed when researching these policy choices']};
}
if(require.main===module){
 const {universe}=loadUniverse();
 const scan=computeSignals(universe,{marketMode:'technicalDiagnostic',liquidityEgp:30000000});
 const result=compare(universe,scan.signals);
 const dst=path.join(root,'data/research/egx-aqm-exit-cohort-comparison-v1.json');
 fs.writeFileSync(dst,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({baselineLossDiagnosis:result.baselineLossDiagnosis,comparisons:result.comparisons},null,2));
}
module.exports={pairedCohort,compare};
