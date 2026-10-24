'use strict';
const fs=require('node:fs'),path=require('node:path');
if(process.env.EGX_ENABLE_LIVE_TRADING==='true')throw Error('AQM research never authorizes live execution');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const policy=require('../../data/research/egx-aqm-policy-v1.json');
const {loadUniverse}=require('./egx-strategy-challengers-v1.cjs');
const {executable,tradingWindow}=require('./egx-executable-session-series-v1.cjs');
const {breadthByDate}=require('./egx-topfour-breadth-regime-v1.cjs');
const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
const round=(n,d=3)=>+n.toFixed(d);
function technical(rows,i){
 const w=tradingWindow(rows,i,121);if(!w)return null;
 const p=policy.selection,last=w.at(-1),prev=w.at(-2);
 const close=w.map(b=>b.close),sma20=avg(close.slice(-20)),sma50=avg(close.slice(-50)),sma100=avg(close.slice(-100));
 const turnover20=avg(w.slice(-21,-1).map(b=>b.close*b.volume));
 const prev20=w.slice(-21,-1),avgVol20=avg(prev20.map(b=>b.volume));
 const lookback20=100*(last.close/w.at(-21).close-1);
 const sixMonth=100*(last.close/w[0].close-1);
 const trs=w.slice(-15).map((b,j)=>{const before=w[w.length-16+j];return Math.max(b.high-b.low,Math.abs(b.high-before.close),Math.abs(b.low-before.close))});
 const atr14=avg(trs.slice(1));
 const prevSma20=avg(w.slice(-21,-1).map(b=>b.close));
 const dryUp=avg(w.slice(-6,-1).map(b=>b.volume))<avgVol20;
 const green=last.close>last.open&&last.close>prev.close;
 const pullback=green&&dryUp&&Math.min(prev.low,last.low)<=prevSma20*1.015&&last.close>=sma20*.99;
 const breakout=last.close>Math.max(...prev20.map(b=>b.high))&&last.volume>=p.breakoutVolumeRatio*avgVol20;
 const start=Date.parse(rows.find(executable).date+'T00:00:00Z'),current=Date.parse(last.date+'T00:00:00Z');
 return {date:last.date,ticker:undefined,price:last.close,turnover20,avgVol20,volumeRatio:last.volume/avgVol20,atr14,sma20,sma50,sma100,sixMonth,lookback20,ageDays:(current-start)/86400000,priceDistanceAtr:(last.close-sma20)/atr14,pullback,breakout,green,trend:last.close>sma50&&sma50>sma100};
}
function computeSignals(universe,{liquidityEgp=policy.selection.minimumDailyTurnover20Egp,marketMode='technicalDiagnostic',indexHistory=null,pointInTimeFundamentals=null,eventCalendar=null,sectorHistory=null,haltHistory=null}={}){
 const byDate=new Map(),reasons={no120BarHistory:0,thinLiquidity:0,tooYoungOrCheap:0,weakTrend:0,overextended:0,notTop20Pct:0,noEntrySetup:0,scoreUnder70:0,weakBreadth:0,missingStrictInputs:0};
 const stockIndex=new Map(),barsByDate=new Map();
 for(const [ticker,rows] of Object.entries(universe)){
  const dates=new Map(rows.map((b,i)=>[b.date,i]));stockIndex.set(ticker,dates);barsByDate.set(ticker,dates);
  for(let i=0;i<rows.length;i++){
   if(!executable(rows[i]))continue;
   const f=technical(rows,i);if(!f){reasons.no120BarHistory++;continue}
   f.ticker=ticker;f.index=i;
   const arr=byDate.get(f.date)||[];arr.push(f);byDate.set(f.date,arr);
  }
 }
 const s=policy.selection,breadth=breadthByDate(universe),signals=[],asOfAudit={strictRequiredInputsPresent:!!(indexHistory&&pointInTimeFundamentals&&eventCalendar&&sectorHistory&&haltHistory),missing:[],mode:marketMode};
 for(const [name,ok] of [['egx30History',!!indexHistory],['pointInTimeFundamentals',!!pointInTimeFundamentals],['corporateEventCalendar',!!eventCalendar],['sectorHistory',!!sectorHistory],['haltHistory',!!haltHistory]])if(!ok)asOfAudit.missing.push(name);
 const strict=marketMode==='strict';
 if(strict)return {signals:[],reasons:{...reasons,missingStrictInputs:asOfAudit.missing.length},asOfAudit:{...asOfAudit,fullAsOfCertificationImplemented:false,reason:'Full as-of EGX30, financial, event, sector and halt verification has not been implemented or certified'},datesWithLongHistory:byDate.size,breadthDates:breadth.size};
 for(const [date,features] of [...byDate].sort((a,b)=>a[0].localeCompare(b[0]))){
  // Rank among all observable long-history securities, before strategy-specific hard filters.
  const marketRank=features.slice().sort((a,b)=>b.sixMonth-a.sixMonth||a.ticker.localeCompare(b.ticker));
  const rank=new Map(marketRank.map((f,i)=>[f.ticker,i]));
  const b=breadth.get(date),breadthGood=!!b&&b.eligible>=s.minBreadthUniverse&&b.breadthPct>s.minBreadthPct;
  for(const f of features){
   if(!(f.turnover20>=liquidityEgp)){reasons.thinLiquidity++;continue}
   if(f.ageDays<s.minCalendarListingAgeDays||f.price<s.minimumPriceEgp){reasons.tooYoungOrCheap++;continue}
   if(!f.trend){reasons.weakTrend++;continue}
   if(f.lookback20>=s.max20dMomentumPct||f.priceDistanceAtr>=s.maxDistanceFromSma20Atr){reasons.overextended++;continue}
   const idx=rank.get(f.ticker);
   if(idx>=Math.max(1,Math.ceil(marketRank.length*s.relativeStrengthTopFraction))){reasons.notTop20Pct++;continue}
   const variants=['aqm_pullback','aqm_breakout'].filter(k=>k==='aqm_pullback'?f.pullback:f.breakout);
   if(!variants.length){reasons.noEntrySetup++;continue}
   // Proxy only. The full model also requires EGX30 as-of SMA100, index-relative momentum, filings, events, sector and halt checks.
   const rs=Math.round(25*(1-idx/Math.max(1,marketRank.length-1)));
   const trend=20,liquidity=Math.min(15,Math.round(8+7*Math.min(1,f.turnover20/(2*liquidityEgp))));
   const market=breadthGood?10:0;
   for(const variant of variants){
    const timing=variant==='aqm_breakout'?20:Math.round(15+5*Math.min(1,Math.max(0,(f.sma20-f.price)/f.atr14+1)));
    const score=rs+trend+liquidity+timing+market; // Fundamental: deliberately zero without as-of filings.
    if(score<s.minScore){reasons.scoreUnder70++;continue}
    signals.push({ticker:f.ticker,date,variant,score,parts:{relativeStrength:rs,trend,liquidity,timing,fundamental:0,market},price:f.price,atr14:f.atr14,turnover20:round(f.turnover20),breadthPct:b?.breadthPct??null,marketExposureMaxPct:breadthGood?100:30,technicalProxyOnly:true,asOfSixMonthReturnPct:round(f.sixMonth)});
   }
   if(!breadthGood)reasons.weakBreadth++;
  }
 }
 return {signals,reasons,asOfAudit,datesWithLongHistory:byDate.size,breadthDates:breadth.size};
}
function replay(universe,signals,variant,{initial=policy.risk.initialEgp}={}){
 const p=policy.risk,marketDates=[...new Set(Object.values(universe).flatMap(rows=>rows.map(b=>b.date)))].sort();
 const quotes=new Map(Object.entries(universe).map(([ticker,rows])=>[ticker,new Map(rows.map(b=>[b.date,b]))]));
 const pending=new Map(),nextDate=new Map(marketDates.slice(0,-1).map((date,i)=>[date,marketDates[i+1]]));
 for(const s of signals.filter(x=>x.variant===variant)){const date=nextDate.get(s.date);if(date){const arr=pending.get(date)||[];arr.push(s);pending.set(date,arr)}}
 let cash=initial,peak=initial,maxDD=0,month=null,monthStart=initial,monthlyHaltDays=0,missingMarks=0,partialExits=0;
 const positions=[],trades=[],curve=[];
 const fee=p.roundTripFeesPct/200,entrySlip=p.entrySlippagePct/100,exitSlip=p.exitSlippagePct/100;
 for(const date of marketDates){
  const m=date.slice(0,7);if(month!==m){month=m;monthStart=cash+positions.reduce((v,x)=>v+x.qty*x.lastClose,0)}
  const preEquity=cash+positions.reduce((v,x)=>v+x.qty*x.lastClose,0);
  const halted=preEquity<monthStart*(1-p.monthlyLossHaltPct/100);
  if(halted)monthlyHaltDays++;
  // Entries are generated at the previous global session close. No same-session signal is visible at the open.
  for(const s of (pending.get(date)||[]).slice().sort((a,b)=>b.score-a.score||a.ticker.localeCompare(b.ticker))){
   if(halted||positions.length>=policy.selection.maxPositions||positions.some(x=>x.ticker===s.ticker))continue;
   const q=quotes.get(s.ticker)?.get(date);if(!q||!executable(q)||!(q.open>0))continue;
   const equity=cash+positions.reduce((v,x)=>v+x.qty*x.lastClose,0);
   const exposure=positions.reduce((v,x)=>v+x.qty*x.lastClose,0);
   const entry=q.open*(1+entrySlip),stop=entry-p.stopAtrMultiple*s.atr14;
   if(!(stop>0&&stop<entry))continue;
   const maxFromRisk=equity*p.riskPerTradePct/100/(entry-stop)*entry;
   const maxFromWeight=equity*p.maxWeightPct/100;
   const maxFromExposure=Math.max(0,equity*s.marketExposureMaxPct/100-exposure);
   const maxFromLiquidity=s.turnover20*p.maxDailyTurnoverParticipationPct/100;
   const nominal=Math.min(maxFromRisk,maxFromWeight,maxFromExposure,maxFromLiquidity,cash/(1+fee));
   const qty=Math.floor(nominal/entry);
   if(qty<=0)continue;
   const cost=qty*entry*(1+fee);if(cost>cash+1e-7)continue;
   cash-=cost;positions.push({ticker:s.ticker,variant,score:s.score,dateOpened:date,qty,initialQty:qty,entry,stop,atr:s.atr14,target1:entry+p.firstTargetAtrMultiple*s.atr14,target2:entry+p.secondTargetAtrMultiple*s.atr14,hitFirst:false,holdingBars:0,lastClose:entry,totalCost:cost,proceeds:0});
  }
  for(let j=positions.length-1;j>=0;j--){
   const pos=positions[j],bar=quotes.get(pos.ticker)?.get(date);
   if(!bar||!executable(bar)){missingMarks++;continue}
   pos.holdingBars++;pos.lastClose=bar.close;
   const sell=(qty,price)=>{const received=qty*price*(1-exitSlip)*(1-fee);cash+=received;pos.proceeds+=received;pos.qty-=qty};
   // Intraday OHLC has unknown ordering: test stop before all profit targets.
   if(bar.low<=pos.stop){sell(pos.qty,Math.min(bar.open,pos.stop));}
   else if(pos.hitFirst&&bar.high>=pos.target2){sell(pos.qty,pos.target2)}
   else if(!pos.hitFirst&&bar.high>=pos.target1){
    const part=Math.max(1,Math.ceil(pos.qty*p.firstSaleFraction));sell(part,pos.target1);pos.hitFirst=true;pos.stop=Math.max(pos.stop,pos.entry);partialExits++;
   }else if(pos.holdingBars>=p.maxHoldingExecutableSessions){sell(pos.qty,bar.close)}
   if(pos.qty===0){
    trades.push({ticker:pos.ticker,variant,entryDate:pos.dateOpened,exitDate:date,score:pos.score,netPnlEgp:round(pos.proceeds-pos.totalCost,2),netReturnPct:round(100*(pos.proceeds/pos.totalCost-1)),holdingBars:pos.holdingBars});
    positions.splice(j,1);
   }
  }
  const equity=cash+positions.reduce((v,x)=>v+x.qty*x.lastClose,0);
  peak=Math.max(peak,equity);maxDD=Math.max(maxDD,(peak-equity)/peak*100);
  curve.push({date,equityEgp:round(equity,2),cashEgp:round(cash,2),openPositions:positions.length});
 }
 const nav=curve.at(-1)?.equityEgp??initial,positive=trades.filter(x=>x.netPnlEgp>0).length;
 return {variant,researchOnly:true,portfolioReturnPct:round(100*(nav/initial-1)),endEquityEgp:nav,maxDrawdownPct:round(maxDD),closedTrades:trades.length,winRatePct:trades.length?round(positive/trades.length*100):null,openPositions:positions.length,partialExits,staleMarkSessions:missingMarks,monthlyHaltDays,initialEgp:initial,tradeLedger:trades,equityCurve:curve,limitations:['Research-only technical proxy; sector cap and fundamental/event/index checks not certified','Unadjusted OHLCV may have corporate actions; intrabar ordering unknown','Open positions marked at close without liquidation fees','Known universe and source uncertainty may introduce survivorship and price-source bias']};
}
function main(){
 const {universe,audit}=loadUniverse();
 const strict=computeSignals(universe,{marketMode:'strict'});
 const runs=[];
 for(const minLiquidity of [policy.selection.minimumDailyTurnover20Egp,policy.selection.alternativeDiagnosticMinTurnoverEgp]){
  const scan=computeSignals(universe,{marketMode:'technicalDiagnostic',liquidityEgp:minLiquidity});
  const variants=['aqm_pullback','aqm_breakout'].map(v=>{const x=replay(universe,scan.signals,v);const {equityCurve,tradeLedger,...summary}=x;return {...summary,lastTenTrades:tradeLedger.slice(-10)}});
  runs.push({liquidityFloorEgp:minLiquidity,signalCount:scan.signals.length,signalCountsByVariant:Object.fromEntries(['aqm_pullback','aqm_breakout'].map(v=>[v,scan.signals.filter(x=>x.variant===v).length])),rejections:scan.reasons,variants});
 }
 const result={schemaVersion:'egx-aqm-initial-historical-diagnostic-1',generatedAt:new Date().toISOString(),productionReady:false,liveTradingEnabled:false,priceInput:'main archive via canonical executable OHLCV gateway, no central quarantine promotion',coverage:audit,strict:{status:'BLOCKED_MISSING_HISTORICAL_INPUTS',signalCount:strict.signals.length,missing:strict.asOfAudit.missing},exploratoryTechnicalProxy:runs,truthfulness:'Technical proxy outcomes are not complete AQM historical validation, and previously viewed historical sessions cannot be untouched OOS'};
 const output=path.join(root,'data/research/egx-aqm-initial-historical-diagnostic-v1.json');fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({strict:result.strict,diagnostics:runs.map(x=>({liquidityFloorEgp:x.liquidityFloorEgp,signalCount:x.signalCount,signalCountsByVariant:x.signalCountsByVariant,variants:x.variants.map(z=>({variant:z.variant,portfolioReturnPct:z.portfolioReturnPct,maxDrawdownPct:z.maxDrawdownPct,closedTrades:z.closedTrades,staleMarkSessions:z.staleMarkSessions}))}))},null,2));
}
if(require.main===module)main();
module.exports={technical,computeSignals,replay};
