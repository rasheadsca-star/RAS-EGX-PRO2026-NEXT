#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..'),GFX=path.join(ROOT,'gann-fusion-x'),HIST=path.join(ROOT,'data','history');
const DQ=require(path.join(GFX,'engine','data-quality.js')),Fusion=require(path.join(GFX,'engine','fusion.js')),Planner=require(path.join(GFX,'engine','planner.js'));
const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};
assert(DQ.optionalNumber(null)===null,'null must remain unknown');
assert(DQ.optionalNumber(undefined)===null,'undefined must remain unknown');
assert(DQ.optionalNumber('')===null,'empty string must remain unknown');
assert(DQ.optionalNumber(0)===0,'real zero must remain zero');
assert(DQ.isKnownBelow(null,20)===false,'unknown liquidity must not fail low-liquidity gate');
assert(DQ.isKnownBelow(0,20)===true,'known zero liquidity must fail low-liquidity gate');
const read=(f,d=null)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){return d}},mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
function bars(doc){return(doc?.sessions||[]).map(x=>{const c=Number(x.close),a=Number(x.adjustedClose??x.close),f=c?a/c:1;return{date:x.date,open:Number(x.open)*f,high:Number(x.high)*f,low:Number(x.low)*f,close:a,volume:Number(x.volume||0)}}).filter(x=>x.close>0&&x.high>0&&x.low>0).sort((a,b)=>a.date.localeCompare(b.date))}
const market=read(path.join(ROOT,'data','quant','market-search-index-v13-17.json'),{}),date=market.marketDate||market.analysisSession,stocks=Array.isArray(market.stocks)?market.stocks:[],liq=new Map(stocks.map(x=>[String(x.ticker||'').toUpperCase(),DQ.optionalNumber(x.liquidityPercentile)]));
const universe=[];for(const file of fs.readdirSync(HIST).filter(x=>x.endsWith('.json'))){const doc=read(path.join(HIST,file));if(!doc)continue;const bs=bars(doc);if(bs.length<50||bs.at(-1)?.date!==date)continue;universe.push({ticker:String(doc.ticker||file.replace(/\.json$/i,'')).toUpperCase(),nameAr:doc.companyNameAr||doc.companyNameEn||'',bars:bs})}
const map=new Map();for(const u of universe){const base=u.bars[0].close;if(!base)continue;for(const b of u.bars){if(b.date>date)continue;if(!map.has(b.date))map.set(b.date,[]);map.get(b.date).push(b.close/base*100)}}const bench=[...map.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([d,v])=>{const c=mean(v);return{date:d,open:c,high:c,low:c,close:c,volume:1}});
const candidates=[];let plannerEligible=0,knownLowRejected=0,unknownLiquidityAccepted=0;for(const u of universe){const a=Fusion.analyze({ticker:u.ticker,nameAr:u.nameAr,bars:u.bars,marketBars:bench,fundamentals:{score:50,verified:false},dataQuality:{fresh:true,conflict:false}});if(!a.valid)continue;const p=Planner.buildPlan(a,'speculative',{portfolioValue:100000,riskPct:.5,verifiedFundamentals:false});if(!p?.eligible)continue;plannerEligible++;const lp=liq.get(u.ticker);if(lp!==null&&lp<20){knownLowRejected++;continue}if(lp===null)unknownLiquidityAccepted++;candidates.push({ticker:u.ticker,score:p.score,liquidityPercentile:lp,liquidityKnown:lp!==null,riskPct:p.levels?.riskPct,decision:p.decision?.code||a.classification?.code})}
candidates.sort((a,b)=>b.score-a.score);
assert(plannerEligible>0,'diagnostic expected at least one planner-eligible candidate for current captured session');
assert(candidates.length>0,'missing-liquidity regression: valid candidates must not collapse to zero');
console.log(JSON.stringify({ok:true,marketDate:date,freshUniverse:universe.length,plannerEligible,knownLowRejected,unknownLiquidityAccepted,candidates:candidates.slice(0,10)},null,2));
