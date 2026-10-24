'use strict';
// An evidence intake queue, NOT a price correction or official certification pipeline.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const VALID_TYPES=new Set(['EXCHANGE_OFFICIAL_CLOSE','OFFICIAL_CORPORATE_ACTION','INDEPENDENT_DATED_OHLCV','SECURITY_IDENTITY_DOCUMENT']);
const decimal=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
function analyzeEvidence(conflictReport,evidenceRows=[]){
 if(conflictReport?.schemaVersion!=='egx-central-price-conflict-attribution-v1'||!Array.isArray(conflictReport.reviewQueue))
  throw Error('Expected original conflict review queue');
 if(!Array.isArray(evidenceRows))throw Error('Evidence rows must be an array');
 const evidence=new Map(),rejected=[];
 for(const [index,item] of evidenceRows.entries()){
  const key=String(item?.ticker||'')+'|'+String(item?.date||'');
  const validKey=/^[A-Z0-9._-]+\|\d{4}-\d{2}-\d{2}$/.test(key);
  const good=validKey&&VALID_TYPES.has(item?.evidenceType)&&typeof item?.sourceUrl==='string'
   &&/^https:\/\//.test(item.sourceUrl)&&typeof item?.documentSha256==='string'
   &&/^[a-fA-F0-9]{64}$/.test(item.documentSha256)&&typeof item?.sourceName==='string'
   &&item.sourceName.trim().length>2&&typeof item?.capturedAt==='string'
   &&!Number.isNaN(Date.parse(item.capturedAt))
   &&(item.evidenceType==='OFFICIAL_CORPORATE_ACTION'||item.evidenceType==='SECURITY_IDENTITY_DOCUMENT'||decimal(item?.observedClose));
  if(!good){rejected.push({row:index,reason:'INVALID_EVIDENCE_METADATA'});continue}
  if(!evidence.has(key))evidence.set(key,[]);
  evidence.get(key).push(item);
 }
 const known=new Set(conflictReport.reviewQueue.map(c=>c.ticker+'|'+c.date));
 for(const [key,items] of evidence)if(!known.has(key)){rejected.push({key,reason:'NOT_IN_CONFLICT_QUEUE'});evidence.delete(key)}
 const queue=conflictReport.reviewQueue.map(c=>{
  const key=c.ticker+'|'+c.date,records=evidence.get(key)||[];
  const prices=records.filter(e=>decimal(e.observedClose)).map(e=>e.observedClose);
  const distinct=new Set(prices.map(p=>p.toFixed(6)));
  const conflictEvidence=distinct.size>1;
  return {...c,evidenceCount:records.length,evidenceState:!records.length?'AWAITING_INDEPENDENT_EVIDENCE':
   conflictEvidence?'CONTRADICTORY_EVIDENCE_REQUIRES_REVIEW':'EVIDENCE_RECEIVED_PENDING_MANUAL_VERIFICATION',
   evidenceReferences:records.map(e=>({type:e.evidenceType,sourceName:e.sourceName,sourceUrl:e.sourceUrl,
    documentSha256:e.documentSha256,capturedAt:e.capturedAt,observedClose:decimal(e.observedClose)?e.observedClose:null})),
   independentlyVerified:false,approvedClose:null,automaticRepairAllowed:false};
 });
 const counts=queue.reduce((o,r)=>(o[r.evidenceState]=(o[r.evidenceState]||0)+1,o),{});
 return {schemaVersion:'egx-price-evidence-triage-v1',generatedAt:new Date().toISOString(),
  status:'QUARANTINE_MANUAL_REVIEW_REQUIRED',totalConflictRows:queue.length,counts,rejected,
  approvedPrices:0,canPromoteToProduction:false,queue};
}
function csv(rows){
 const keys=['ticker','date','priority','sourceClose','mainClose','differencePct','requiredEvidence','evidenceState','evidenceCount','independentlyVerified'];
 const quote=x=>'"'+String(x??'').replace(/"/g,'""')+'"';
 return [keys.join(','),...rows.map(row=>keys.map(k=>quote(row[k])).join(','))].join('\n')+'\n';
}
if(require.main===module){
 const input=JSON.parse(fs.readFileSync(path.join(root,'data/research/egx-central-price-conflict-attribution-v1.json'),'utf8'));
 const file=path.join(root,'data/research/egx-independent-price-evidence-input.json');
 const rows=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
 const out=analyzeEvidence(input,rows);
 const dir=path.join(root,'data/research');fs.writeFileSync(path.join(dir,'egx-price-evidence-triage-v1.json'),JSON.stringify(out,null,2)+'\n');
 fs.writeFileSync(path.join(dir,'egx-price-evidence-triage-v1.csv'),csv(out.queue));
 console.log(JSON.stringify({status:out.status,totalConflictRows:out.totalConflictRows,counts:out.counts,rejectedEvidenceRows:out.rejected.length,approvedPrices:0}));
}
module.exports={analyzeEvidence,csv};
