'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
if(process.env.EGX_ENABLE_LIVE_TRADING==='true')throw Error('Research only; live trading prohibited');
const {confirmedClosures,isTradingSession}=require('../ops/egx-session-math.cjs');
const cfg=require('../../data/v13-4-quant-policy.json').research;
const {tradingWindow,tradeForwardWindow,executable}=require('./egx-executable-session-series-v1.cjs');
const {resolveExit}=require('./egx-research-execution-fills-v1.cjs');
const policy=Object.freeze({minBars:65,minimumTurnover20:100000,momentum20MinPct:3,relativeRankTopFraction:0.25,minUniversePeers:15,shortSma:20,longSma:50,pullbackMinPct:-4,pullbackMaxPct:1.0,stopPct:5,targetPct:9});
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length,round=(n,d=3)=>+n.toFixed(d);
function features(rows,i){
 const w=tradingWindow(rows,i,55);if(!w)return null;
 const c=w.at(-1),prev=w.slice(-21,-1),sma20=mean(w.slice(-20).map(x=>x.close)),sma50=mean(w.slice(-50).map(x=>x.close));
 const turnover20=mean(prev.map(x=>x.close*x.volume)),momentum20Pct=100*(c.close/w.at(-21).close-1);
 return {turnover20,momentum20Pct,sma20,sma50,above50:c.close>sma50,pullbackPct:100*(c.close/sma20-1),uptrend:sma20>sma50&&sma20>mean(w.slice(-25,-5).map(x=>x.close))};
}
function summarize(trades){const r=trades.map(x=>x.netReturnPct),wins=r.filter(x=>x>0),loss=r.filter(x=>x<0);return {trades:r.length,winRatePct:r.length?round(100*wins.length/r.length,2):null,meanNetReturnPct:r.length?round(mean(r)):null,profitFactor:loss.length?round(wins.reduce((a,b)=>a+b,0)/(-loss.reduce((a,b)=>a+b,0))):null};}
function backtest(universe,research=cfg){
 const byDate=new Map(),trades=[],unresolved=[],blocked=new Set();
 for(const [ticker,rows] of Object.entries(universe)){
  for(let i=54;i<rows.length-1;i++){
   if(!executable(rows[i])||!executable(rows[i+1]))continue;
   const f=features(rows,i);if(!f||f.turnover20<policy.minimumTurnover20)continue;
   if(!byDate.has(rows[i].date))byDate.set(rows[i].date,[]);
   byDate.get(rows[i].date).push({ticker,rows,i,f});
  }
 }
 const dates=[...byDate.keys()].sort(),busy=new Map();
 for(const date of dates){
  const picks=byDate.get(date),peers=picks.map(p=>p.f.momentum20Pct).sort((a,b)=>b-a),peerMin=peers.length>=policy.minUniversePeers;
  const cutoff=peerMin?peers[Math.max(0,Math.ceil(peers.length*policy.relativeRankTopFraction)-1)]:Infinity;
  const signals=[];
  for(const p of picks){
   const f=p.f;const momentum=peerMin&&f.uptrend&&f.above50&&f.momentum20Pct>=Math.max(policy.momentum20MinPct,cutoff);
   const pullback=f.uptrend&&f.above50&&f.pullbackPct>=policy.pullbackMinPct&&f.pullbackPct<=policy.pullbackMaxPct&&p.rows[p.i].close>p.rows[p.i-1].close;
   if(momentum)signals.push({...p,variant:'relative_momentum'});
   if(pullback)signals.push({...p,variant:'trend_pullback'});
  }
  for(const p of signals){
   const key=p.variant+'|'+p.ticker;if((busy.get(key)||'')>=date)continue;
   const next=p.rows[p.i+1];if(!executable(next))continue;
   const entry=next.open*(1+research.entrySlippagePct/100),future=tradeForwardWindow(p.rows,p.i+1,research.maximumHoldingSessions);
   if(!(entry>0))continue;
   const fill=resolveExit(future,entry,research.maximumHoldingSessions,policy.stopPct,policy.targetPct);
   if(!fill){unresolved.push({ticker:p.ticker,variant:p.variant,signalDate:date});continue}
   const {exitPrice:exit,offset,status}=fill;
   const exitDate=future[offset].date;busy.set(key,exitDate);
   trades.push({ticker:p.ticker,variant:p.variant,signalDate:date,entryDate:next.date,exitDate,status,netReturnPct:round((exit/entry-1)*100-research.roundTripCostPct)});
  }
 }
 return {trades,unresolved,dates:dates.length};
}
function loadUniverse(){return require('./egx-canonical-ohlcv-gateway.cjs').build(root)}
function main(){
 const {universe,audit}=loadUniverse(),r=backtest(universe),variants=['relative_momentum','trend_pullback'].map(variant=>({variant,...summarize(r.trades.filter(x=>x.variant===variant))}));
 const output={schemaVersion:'egx-strategy-challengers-v1',generatedAt:new Date().toISOString(),researchOnly:true,policy,coverage:audit,variants,unresolved:r.unresolved.length,trades:r.trades,limitations:['Exploratory, not out-of-sample','Relative rank computed against available historical rows, not certified contemporaneous listing universe; survivorship bias possible','No portfolio capital/market impact simulation','Legacy breakout baseline differs in eligibility and censoring treatment; comparisons are indicative only','Unverified source parity and omitted corporate-action checks']};
 const dest=path.join(root,'data/research/egx-strategy-challengers-v1.json');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({coverage:audit,variants,unresolved:output.unresolved},null,2));
}
if(require.main===module)main();module.exports={features,backtest,summarize,policy,loadUniverse};
