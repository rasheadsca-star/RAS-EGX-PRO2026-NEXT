'use strict';
// Compare P0 historical sessions with published leads without promoting any price.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
function check(investigation,leads){
 if(investigation?.schemaVersion!=='egx-p0-scale-investigation-v1'||!Array.isArray(investigation.cases))throw Error('Invalid P0 investigation');
 if(leads?.schemaVersion!=='egx-p0-independent-leads-v1'||!Array.isArray(leads.cases))throw Error('Invalid P0 leads');
 const known=new Map(leads.cases.map(x=>[x.ticker,x]));
 const cases=investigation.cases.map(item=>{
  const lead=known.get(item.ticker);
  const dates=item.conflictingDates.map(x=>x.date);
  const repeated=new Set(dates).size!==dates.length;
  const invalid=dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||Number.isNaN(Date.parse(d+'T00:00:00Z')));
  const units=item.ticker==='SEIGA'?{suspectedFeedCurrencyMismatch:true,distinctSecurityIdentifiers:['EGS67032C010','EGS67031C012'],officiallyCertified:false}:null;
  return {ticker:item.ticker,conflictingSessions:item.conflictSessions,
   firstConflictDate:item.firstConflictDate,lastConflictDate:item.lastConflictDate,
   sessionDates:dates,identityAndCurrencyLead:units,
   hypothesis:lead?.hypothesis||null,secondaryEvidenceLinks:(lead?.evidence||[]).map(x=>x.url),
   sourceDateOverlapValidated:false,officialISINConfirmed:false,
   officialCorporateActionDateConfirmed:false,
   duplicateDatesDetected:repeated,invalidDatesDetected:invalid,
   decision:invalid||repeated?'INVALID_CONFLICT_LEDGER':'BLOCKED_REQUIRES_OFFICIAL_DATE_MATCHED_EVIDENCE',
   approvedFactor:null,approvedPrice:null,liveEligible:false};
 });
 return {schemaVersion:'egx-p0-evidence-crosscheck-v1',status:'BLOCKED_RESEARCH_ONLY',
   cases,approvedCorrections:0,canModifyHistoricalCandles:false};
}
if(require.main===module){
 const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
 const result=check(read('data/research/egx-p0-scale-investigation-v1.json'),read('data/research/egx-p0-independent-leads-v1.json'));
 fs.writeFileSync(path.join(root,'data/research/egx-p0-evidence-crosscheck-v1.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({status:result.status,cases:result.cases.map(x=>({ticker:x.ticker,dates:x.conflictingSessions,start:x.firstConflictDate,end:x.lastConflictDate,decision:x.decision})),approvedCorrections:0}));
}
module.exports={check};
