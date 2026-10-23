'use strict';
const fs=require('node:fs'),path=require('node:path');
if(process.env.EGX_ENABLE_LIVE_TRADING==='true')throw Error('Live trading disabled for unified research');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const {loadUniverse,features:challengerFeatures,policy:cp}=require('./egx-strategy-challengers-v1.cjs');
const {indicators:breakoutFeatures}=require('./hybrid-alpha-v1-early-replay.cjs');
const {decision:quality}=require('./hybrid-alpha-v1-filter-lab.cjs');
const policyDoc=require('../../data/v13-4-quant-policy.json');
const cost=policyDoc.research;
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length,round=(v,n=3)=>Number(v.toFixed(n));
const strategies=['breakout_filtered','relative_momentum','trend_pullback'];
function stats(a){
 const r=a.map(x=>x.netReturnPct),wins=r.filter(x=>x>0),losses=r.filter(x=>x<0);
 return {trades:a.length,winRatePct:r.length?round(wins.length/r.length*100,2):null,meanNetReturnPct:r.length?round(mean(r)):null,profitFactor:losses.length?round(wins.reduce((x,y)=>x+y,0)/-losses.reduce((x,y)=>x+y,0)):null};
}
function simulate(universe,config=cost){
 const calendar=new Map(),trades=[],openAtEnd=[];
 for(const [ticker,rows] of Object.entries(universe)){
  for(let i=54;i<rows.length-1;i++){
   const c=challengerFeatures(rows,i);const b=breakoutFeatures(rows.slice(0,i+1),policyDoc);
   if(!c||!b||!Number.isFinite(c.turnover20)||c.turnover20<cp.minimumTurnover20)continue;
   const date=rows[i].date;if(!calendar.has(date))calendar.set(date,[]);
   const q=quality({signalFeatures:{extensionSma20Pct:b.extensionSma20Pct,atr14Pct:b.atr14Pct,closePosition:b.closePosition}});
   calendar.get(date).push({ticker,rows,i,c,b,breakout:q?.extension&&q?.volatility&&b.breakout});
  }
 }
 const busy=new Map(),minPeer=cp.minUniversePeers,sortedDates=[...calendar.keys()].sort();
 for(const date of sortedDates){
  const daily=calendar.get(date);const peerMom=daily.map(p=>p.c.momentum20Pct).sort((a,b)=>b-a);
  const cutoff=peerMom.length>=minPeer?peerMom[Math.ceil(peerMom.length*cp.relativeRankTopFraction)-1]:Infinity;
  for(const p of daily){
   const options={
    breakout_filtered:p.breakout,
    relative_momentum:peerMom.length>=minPeer&&p.c.uptrend&&p.c.above50&&p.c.momentum20Pct>=Math.max(cp.momentum20MinPct,cutoff),
    trend_pullback:p.c.uptrend&&p.c.above50&&p.c.pullbackPct>=cp.pullbackMinPct&&p.c.pullbackPct<=cp.pullbackMaxPct&&p.rows[p.i].close>p.rows[p.i-1].close
   };
   for(const id of strategies){
    if(!options[id])continue;
    const key=id+'|'+p.ticker;if((busy.get(key)||'')>=date)continue;
    const next=p.rows[p.i+1],entry=next.open*(1+config.entrySlippagePct/100);
    if(!(entry>0))continue;
    const future=p.rows.slice(p.i+1,p.i+1+config.maximumHoldingSessions),stop=entry*.95,target=entry*1.09;
    let exit=null,offset=-1,status='';
    for(let k=0;k<future.length;k++){
     if(future[k].low<=stop){exit=stop;offset=k;status='STOP';break}
     if(future[k].high>=target){exit=target;offset=k;status='TARGET';break}
    }
    if(exit===null&&future.length<config.maximumHoldingSessions){openAtEnd.push({ticker:p.ticker,variant:id,signalDate:date});continue}
    if(exit===null){exit=future.at(-1).close;offset=future.length-1;status='TIME_EXIT'}
    const trade={ticker:p.ticker,variant:id,signalDate:date,entryDate:next.date,exitDate:future[offset].date,status,netReturnPct:round((exit/entry-1)*100-config.roundTripCostPct)};
    trades.push(trade);busy.set(key,trade.exitDate);
   }
  }
 }
 return {trades,unresolved:openAtEnd,calendarDates:sortedDates};
}
function report(sim){
 const dates=[...new Set(sim.trades.map(x=>x.signalDate))].sort(),cut=dates[Math.floor(dates.length*.70)]||null;
 return {schemaVersion:'egx-comparable-three-strategy-v1',generatedAt:new Date().toISOString(),researchOnly:true,sharedExecution:{entry:'next-supplied-session-open',slippagePct:cost.entrySlippagePct,roundTripCostPct:cost.roundTripCostPct,stopPct:5,targetPct:9,maxHoldingSessions:cost.maximumHoldingSessions,sameBarRule:'stop-first',rightCensoredUnresolvedExcluded:true},historicalSplit:{boundaryDate:cut,note:'Diagnostic only: model rules were selected after seeing earlier pooled historical results; NOT an untouched OOS validation.'},byPeriod:['all','earlier','later'].map(period=>({period,variants:strategies.map(variant=>({variant,...stats(sim.trades.filter(t=>t.variant===variant&&(period==='all'||(period==='earlier'?t.signalDate<cut:t.signalDate>=cut))))}))})),unresolved:sim.unresolved.length,tradeCount:sim.trades.length,limitations:['Historical strategy choice already conditioned on prior sample performance','Ticker availability can introduce survivorship and listing bias','No portfolio capital constraints, position sizing, market impact or corporate-action audit','Daily bar OHLC order unknown; stop-first is conservative','Same-historical-universe comparison is exploratory and not certified strategy parity']};
}
if(require.main===module){const {universe,audit}=loadUniverse(),r=simulate(universe),out={...report(r),coverage:audit,trades:r.trades};const p=path.join(root,'data/research/egx-comparable-three-strategy-v1.json');fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({coverage:audit,byPeriod:out.byPeriod,unresolved:out.unresolved},null,2));}
module.exports={simulate,report,stats};
