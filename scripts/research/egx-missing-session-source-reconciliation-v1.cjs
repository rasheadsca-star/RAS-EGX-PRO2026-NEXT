'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
if(process.env.EGX_ENABLE_LIVE_TRADING==='true')throw Error('Research only');
const {loadUniverse}=require('./egx-strategy-challengers-v1.cjs');
const {confirmedClosures,isTradingSession,shiftDay}=require('../ops/egx-session-math.cjs');
function diagnose(universe,closed=confirmedClosures(root)){
 const seen=new Map(),first={},last={};
 for(const [ticker,rows] of Object.entries(universe)){
  const dates=rows.map(x=>x.date).sort();if(!dates.length)continue;
  first[ticker]=dates[0];last[ticker]=dates.at(-1);
  for(const d of dates)seen.set(d,(seen.get(d)||0)+1);
 }
 const observed=[...seen.keys()].sort(),min=observed[0],max=observed.at(-1);
 const intervals=[],missing=[],classes={exchangeClosed:0,marketWideDataMissing:0,tickerSpecificAbsence:0,lowMarketCoverage:0};
 if(!min||!max)return {coverage:{},classes,missing,intervals};
 const threshold=Math.max(3,Math.floor(Object.keys(first).length*.1));
 for(let d=min;d<=max;d=shiftDay(d,1)){
  if(!isTradingSession(d,closed)){classes.exchangeClosed++;continue}
  if(!seen.has(d)){classes.marketWideDataMissing++;intervals.push({date:d,status:'MARKET_WIDE_UNOBSERVED',action:'VERIFY_EXCHANGE_SESSION_AND_RETRIEVE_SOURCE'});continue}
  if(seen.get(d)<threshold){classes.lowMarketCoverage++;intervals.push({date:d,status:'LOW_MARKET_COVERAGE',observedTickers:seen.get(d),action:'VERIFY_VENDOR_BATCH_AND_EXCHANGE_SESSION'})}
 }
 const globalMissing=new Set(intervals.map(x=>x.date));
 for(const [ticker,rows] of Object.entries(universe)){
  const observedForTicker=new Set(rows.map(r=>r.date));for(let d=first[ticker];d<=last[ticker];d=shiftDay(d,1)){
   if(!isTradingSession(d,closed)||observedForTicker.has(d)||globalMissing.has(d))continue;
   classes.tickerSpecificAbsence++;missing.push({ticker,date:d,marketCoverage:seen.get(d)||0,status:'UNVERIFIED_TICKER_ABSENCE',action:'CHECK_SUSPENSION_CORPORATE_ACTION_OR_PRICE_SOURCE'});
  }
 }
 return {schemaVersion:'egx-missing-session-source-reconciliation-1',generatedAt:new Date().toISOString(),researchOnly:true,coverage:{tickerCount:Object.keys(first).length,firstDate:min,lastDate:max,lowMarketCoverageThreshold:threshold},classes,exchangeWideReview:intervals,tickerReviewCount:missing.length,tickerReviewSample:missing.slice(0,200),tickerReviewByTicker:Object.entries(missing.reduce((m,x)=>(m[x.ticker]=(m[x.ticker]||0)+1,m),{})).sort((a,b)=>b[1]-a[1]).slice(0,30).map(([ticker,count])=>({ticker,missingSessions:count})),status:'UNVERIFIED_DO_NOT_IMPUTE',limitations:['A market-wide unobserved trading weekday may be an undocumented exchange closure; confirm independently','Ticker absent in otherwise observed market may be suspended, halted, untraded or missing from vendor; no zero-volume or price bars are fabricated','Ticker coverage can contain survivorship bias','Does not validate corporate-action price adjustment']};
}
if(require.main===module){const r=diagnose(loadUniverse().universe),dst=path.join(root,'data/research/egx-missing-session-source-reconciliation-v1.json');fs.writeFileSync(dst,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({coverage:r.coverage,classes:r.classes,tickerReviewCount:r.tickerReviewCount,topTickers:r.tickerReviewByTicker.slice(0,8),exampleExchangeDates:r.exchangeWideReview.slice(0,12)},null,2))}
module.exports={diagnose};
