'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const ROOT=path.resolve(__dirname,'..','..');
const Fusion=require('../engine/fusion.js');
const Planner=require('../engine/planner.js');
const Sepa=require('../engine/sepa-adapter.js');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function bars(doc,cutoff){return(doc.sessions||[]).filter(x=>!cutoff||String(x.date)<=cutoff).map(x=>{const f=x.close?Number(x.adjustedClose??x.close)/Number(x.close):1;return{date:x.date,open:Number(x.open)*f,high:Number(x.high)*f,low:Number(x.low)*f,close:Number(x.adjustedClose??x.close),volume:Number(x.volume||0)}}).filter(x=>x.close>0&&x.high>0&&x.low>0)}
function benchmark(items,docs,cutoff){const m=new Map();for(const s of items){const bs=bars(docs.get(s.ticker),cutoff);if(bs.length<30)continue;const base=bs[0].close;for(const b of bs){if(!m.has(b.date))m.set(b.date,[]);m.get(b.date).push(b.close/base*100)}}return[...m.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,v])=>{const c=v.reduce((a,b)=>a+b,0)/v.length;return{date,open:c,high:c,low:c,close:c,volume:1}})}
const index=read(path.join(ROOT,'data','quant','market-search-index-v13-17.json'));
const sepa=Sepa.normalize(read(path.join(ROOT,'gann-fusion-x','data','sepa-x-snapshot.json')));
assert(index.marketDate,'marketDate required');
assert.equal(Planner.nextEgxSession(index.marketDate),'2026-08-30','expected next EGX session after Thursday snapshot');
const candidates=(index.stocks||[]).filter(x=>x.historyAvailable).sort((a,b)=>Number(b.inTodayRecommendations)-Number(a.inTodayRecommendations)||(Number(a.technicalRank)||9999)-(Number(b.technicalRank)||9999)).slice(0,30);
const docs=new Map();for(const s of candidates){const p=path.join(ROOT,'data','history',`${s.ticker}.json`);if(fs.existsSync(p))docs.set(s.ticker,read(p))}
const usable=candidates.filter(x=>docs.has(x.ticker)),bench=benchmark(usable,docs,index.marketDate),analyses=[];
for(const s of usable){const bs=bars(docs.get(s.ticker),index.marketDate);if(bs.length<20)continue;const ev=sepa.byTicker?.[s.ticker],a=Fusion.analyze({ticker:s.ticker,nameAr:s.companyNameAr||s.companyNameEn||s.ticker,bars:bs,marketBars:bench,fundamentals:ev?.fundamentals||{score:50,verified:false},dataQuality:{fresh:bs.at(-1)?.date===index.marketDate,conflict:false}});if(!a.valid)continue;a.marketMeta=s;a.sepaEvidence=ev;analyses.push(a)}
assert(analyses.length>=10,'at least ten real stocks should analyze');
assert(analyses.some(a=>a.sessionDate===index.marketDate),'at least one current-session stock required');
const counts={speculative:0,medium:0,long:0};for(const a of analyses){for(const h of Object.keys(counts)){const p=Planner.buildPlan(a,h,{portfolioValue:100000,riskPct:h==='speculative'?.5:h==='medium'?.65:.75,verifiedFundamentals:Boolean(a.sepaEvidence?.fundamentals?.verified)});if(p.eligible)counts[h]++;assert(p.levels.stopLoss<p.levels.referenceEntry);assert(p.levels.target1>p.levels.referenceEntry);assert(p.levels.target2>p.levels.target1);assert(p.levels.target3>p.levels.target2)}}
console.log('NEXT_SESSION_DATA_SMOKE_PASS',{marketDate:index.marketDate,nextSession:Planner.nextEgxSession(index.marketDate),analyzed:analyses.length,counts});
