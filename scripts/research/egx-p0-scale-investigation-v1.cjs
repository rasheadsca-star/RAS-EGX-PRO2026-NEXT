'use strict';
// Group P0 conflicts by ticker. An apparent scale ratio is a hypothesis, never an adjustment.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
function summarize(report){
 if(report?.schemaVersion!=='egx-central-price-conflict-attribution-v1'||!Array.isArray(report.reviewQueue))throw Error('Invalid source review queue');
 const rows=report.reviewQueue.filter(r=>r.priority==='P0_PERSISTENT_SCALE_NEEDS_IDENTITY_CA_PROOF');
 const groups=new Map();
 for(const r of rows){
  if(!groups.has(r.ticker))groups.set(r.ticker,[]);
  groups.get(r.ticker).push(r);
 }
 const cases=[...groups].map(([ticker,issues])=>{
  const ratios=issues.map(r=>r.sourceClose>0&&r.mainClose>0?r.mainClose/r.sourceClose:null).filter(Number.isFinite).sort((a,b)=>a-b);
  const median=ratios.length?ratios[Math.floor(ratios.length/2)]:null;
  const dates=issues.map(x=>x.date).sort();
  return {ticker,conflictSessions:issues.length,firstConflictDate:dates[0],lastConflictDate:dates.at(-1),
   approximateMedianMainToSource:median===null?null:Number(median.toFixed(6)),
   investigation:['CONFIRM_ISIN_AND_LISTING_IDENTITY','FIND_OFFICIAL_SPLIT_BONUS_RIGHTS_AND_PAR_VALUE_EVENTS','COMPARE_UNADJUSTED_EXCHANGE_CLOSE_BY_DATE'],
   classification:'UNRESOLVED_P0',adjustmentAuthorized:false,priceWinner:null,
   conflictingDates:issues.map(r=>({date:r.date,sourceClose:r.sourceClose,mainClose:r.mainClose,differencePct:r.differencePct}))};
 }).sort((a,b)=>b.conflictSessions-a.conflictSessions||a.ticker.localeCompare(b.ticker));
 return {schemaVersion:'egx-p0-scale-investigation-v1',status:'RESEARCH_UNRESOLVED',caseCount:cases.length,
  conflictSessionCount:rows.length,approvedAdjustments:0,cases};
}
if(require.main===module){
 const input=JSON.parse(fs.readFileSync(path.join(root,'data/research/egx-central-price-conflict-attribution-v1.json'),'utf8'));
 const report=summarize(input),folder=path.join(root,'data/research');
 fs.writeFileSync(path.join(folder,'egx-p0-scale-investigation-v1.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,cases:report.caseCount,conflictingSessions:report.conflictSessionCount,approvedAdjustments:0,top:report.cases.slice(0,8).map(c=>({ticker:c.ticker,sessions:c.conflictSessions,ratio:c.approximateMedianMainToSource}))}));
}
module.exports={summarize};
