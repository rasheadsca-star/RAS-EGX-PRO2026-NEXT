'use strict';
const fs=require('node:fs'),path=require('node:path');
function inspect(symbol,history){
 const last=(history.sessions||[]).slice().filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date||'')).sort((a,b)=>a.date.localeCompare(b.date)).at(-1)||null;
 const truth=history.priceTruthLatest||{};
 const same=!!last&&truth.date===last.date;
 const a=Number(last?.close),b=Number(truth.close);
 const discrepancyPct=same&&Number.isFinite(a)&&Number.isFinite(b)&&a>0&&b>0?Math.abs(a-b)/b*100:null;
 return {ticker:symbol,latestHistoricalSession:last?.date||null,referenceSession:truth.date||null,historicalClose:Number.isFinite(a)?a:null,referenceClose:Number.isFinite(b)?b:null,comparison:same?'SAME_SESSION':'INCOMPARABLE_SESSION_DATES',sameSessionConflictPct:discrepancyPct,requiresReview:!same||discrepancyPct>2,reason:!same?'STALE_OR_MISMATCHED_REFERENCE_DATE':discrepancyPct>2?'SAME_SESSION_CLOSE_CONFLICT':'NO_SAME_SESSION_CONFLICT_GT_2_PCT',approval:'NOT_CERTIFIED'};
}
function report(summary,reader){
 const list=Array.isArray(summary.symbols)?summary.symbols:Object.values(summary.symbols||{});
 const rows=list.map(x=>{try{return inspect(x.ticker,reader(x.sourceFile||'data/history/'+x.ticker+'.json'))}catch(err){return {ticker:x.ticker,comparison:'SOURCE_UNAVAILABLE',reason:'SOURCE_UNAVAILABLE',approval:'NOT_CERTIFIED',error:String(err.message)}}});
 const buckets=rows.reduce((a,x)=>(a[x.reason]=(a[x.reason]||0)+1,a),{});
 return {schemaVersion:'egx-price-reference-session-audit-1',marketSession:summary.latestMarketSession,counts:buckets,reviewQueue:rows.filter(x=>x.requiresReview||x.comparison==='SOURCE_UNAVAILABLE').sort((a,b)=>(b.sameSessionConflictPct||0)-(a.sameSessionConflictPct||0)||a.ticker.localeCompare(b.ticker)),rows,tradeReady:false};
}
if(require.main===module){const out=report(JSON.parse(fs.readFileSync('data/history-summary.json','utf8')),p=>JSON.parse(fs.readFileSync(path.resolve(p),'utf8')));if(process.argv[2]){fs.mkdirSync(path.dirname(process.argv[2]),{recursive:true});fs.writeFileSync(process.argv[2],JSON.stringify(out,null,2)+'\n')}console.log(JSON.stringify({schemaVersion:out.schemaVersion,marketSession:out.marketSession,counts:out.counts,reviewQueueSize:out.reviewQueue.length,tradeReady:false},null,2))}
module.exports={inspect,report};
