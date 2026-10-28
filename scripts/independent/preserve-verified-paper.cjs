'use strict';
// Preserve independently verified dated observations, never orders or inferred fills.
const fs=require('node:fs'),path=require('node:path');
const {currentEvidenceValid,validIsin}=require('./egx-independent-paper.cjs');
const ROOT=process.env.GITHUB_WORKSPACE||process.cwd();
const dateOK=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
  !Number.isNaN(Date.parse(s+'T00:00:00Z'))&&
  new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const same=(a,b)=>a.ticker===b.ticker&&a.session===b.session&&a.close===b.close&&a.currency===b.currency;
// Re-read the persisted OHLCV, not the paper JSON label, before archiving.
function verifyObservationAgainstHistory(root,symbols,row){
 if(!row||!dateOK(row.session)||!(/^[A-Z0-9]{2,12}$/.test(row.ticker||'')))return false;
 const ticker=row.ticker;
 const sym=Array.isArray(symbols)?symbols.find(x=>x?.ticker===ticker):symbols?.[ticker];
 if(!sym||sym.active===false)return false;
 let h;
 try{h=JSON.parse(fs.readFileSync(path.join(root,'data/history',ticker+'.json'),'utf8'))}
 catch{return false}
 if(!h||h.symbolVerified!==true||!validIsin(h.isin)||
    (h.ticker&&h.ticker!==ticker)||
    (sym.isin&&String(sym.isin).toUpperCase()!==String(h.isin).toUpperCase())||
    (sym.currency&&h.currency&&sym.currency!==h.currency)||
    (sym.exchange&&h.exchange&&sym.exchange!==h.exchange))return false;
 const bars=(Array.isArray(h.sessions)?h.sessions:[]).filter(x=>
  (x?.date||x?.sessionDate)===row.session);
 if(bars.length!==1)return false; // same-day conflicts cannot enter last-known-good
 const bar=bars[0],currency=String(h.currency||bar.currency||sym.currency||'').toUpperCase();
 if(!currentEvidenceValid(bar,row.session)||bar.close!==row.close||
    currency!==row.currency||(bar.currency&&bar.currency!==row.currency)||
    (bar.ticker&&bar.ticker!==ticker))return false;
 const level=bar.secondSourceConfirmed===true?'CROSS_PROVIDER_CONFIRMED':'DATED_PROVIDER_EVIDENCE';
 return row.evidenceLevel===level;
}
function verifiedSnapshot(source,verifyRow=()=>false){
 if(!source||source.mode!=='PAPER_ONLY'||source.executable!==false||
   !dateOK(source.session)||!Array.isArray(source.datedPriceObservations)||
   !Array.isArray(source.recommendations)||source.recommendations.length||
   !Array.isArray(source.watchlist)||source.watchlist.some(x=>x.state==='EXECUTED'))return null;
 const rows=[],seen=new Set();
 for(const x of source.datedPriceObservations){
  if(!x||!/^\w{2,12}$/.test(x.ticker||'')||x.session!==source.session||
    typeof x.close!=='number'||!Number.isFinite(x.close)||x.close<=0||
    !['EGP','USD'].includes(x.currency)||
    !['DATED_PROVIDER_EVIDENCE','CROSS_PROVIDER_CONFIRMED'].includes(x.evidenceLevel)||
    x.state!=='DATED_PRICE_OBSERVATION_NOT_A_SIGNAL'||seen.has(x.ticker))return null;
  // A self-declared evidenceLevel is insufficient to authorize archive promotion.
  try{if(!verifyRow(x))return null}catch{return null}
  seen.add(x.ticker);
  rows.push({ticker:x.ticker,session:x.session,close:x.close,currency:x.currency,
   evidenceLevel:x.evidenceLevel,state:'OBSERVATION_ONLY_NO_ORDER'});
 }
 if(!rows.length)return null;
 rows.sort((a,b)=>a.ticker.localeCompare(b.ticker));
 return {schemaVersion:'egx-independent-last-verified-v1',session:source.session,
  mode:'PAPER_ONLY',executable:false,status:'ARCHIVED_DATED_EVIDENCE_NOT_CURRENT_SIGNAL',
  datedPriceObservations:rows,recommendations:[],orders:[]};
}
function validArchive(x){
 if(!x||x.schemaVersion!=='egx-independent-last-verified-v1'||!dateOK(x.session)||
  x.mode!=='PAPER_ONLY'||x.executable!==false||x.status!=='ARCHIVED_DATED_EVIDENCE_NOT_CURRENT_SIGNAL'||
  !Array.isArray(x.datedPriceObservations)||!Array.isArray(x.recommendations)||x.recommendations.length||
  !Array.isArray(x.orders)||x.orders.length)return false;
 const keys=new Set();
 for(const r of x.datedPriceObservations){
  if(r.session!==x.session||!/^\w{2,12}$/.test(r.ticker||'')||
   typeof r.close!=='number'||!Number.isFinite(r.close)||r.close<=0||
   !['EGP','USD'].includes(r.currency)||r.state!=='OBSERVATION_ONLY_NO_ORDER'||
   !['DATED_PROVIDER_EVIDENCE','CROSS_PROVIDER_CONFIRMED'].includes(r.evidenceLevel)||
   keys.has(r.ticker))return false;
  keys.add(r.ticker);
 }
 return keys.size>0;
}
function retainArchive(previous,current,verifyRow=()=>false){
 if(previous!=null&&!validArchive(previous))throw Error('INVALID_PREVIOUS_VERIFIED_ARCHIVE');
 const candidate=verifiedSnapshot(current,verifyRow);
 if(!candidate)return previous||null;
 if(!previous||candidate.session>previous.session)return candidate;
 if(candidate.session<previous.session)return previous;
 const incoming=new Map(candidate.datedPriceObservations.map(x=>[x.ticker,x]));
 for(const old of previous.datedPriceObservations){
  const next=incoming.get(old.ticker);
  if(!next||!same(old,next))return previous;
 }
 return candidate.datedPriceObservations.length>previous.datedPriceObservations.length?candidate:previous;
}
function validLedger(x){
 if(!x||x.schemaVersion!=='egx-independent-paper-observation-ledger-v1'||
  x.mode!=='PAPER_ONLY'||x.executable!==false||
  !Array.isArray(x.observations)||!Array.isArray(x.orders)||x.orders.length)return false;
 const seen=new Set();
 for(const r of x.observations){
  const k=r.session+'|'+r.ticker;
  if(!dateOK(r.session)||!/^\w{2,12}$/.test(r.ticker||'')||
   typeof r.close!=='number'||!Number.isFinite(r.close)||r.close<=0||
   !['EGP','USD'].includes(r.currency)||r.state!=='OBSERVATION_ONLY_NO_ORDER'||
   !['DATED_PROVIDER_EVIDENCE','CROSS_PROVIDER_CONFIRMED'].includes(r.evidenceLevel)||
   seen.has(k))return false;
  seen.add(k);
 }
 return true;
}
function updateLedger(previous,current,verifyRow=()=>false){
 if(previous!=null&&!validLedger(previous))throw Error('INVALID_PREVIOUS_PAPER_LEDGER');
 const ledger=previous?JSON.parse(JSON.stringify(previous)):
  {schemaVersion:'egx-independent-paper-observation-ledger-v1',mode:'PAPER_ONLY',
   executable:false,observations:[],orders:[]};
 const candidate=verifiedSnapshot(current,verifyRow);
 if(!candidate)return ledger;
 const maxSession=ledger.observations.reduce((d,r)=>r.session>d?r.session:d,'');
 if(maxSession&&candidate.session<maxSession)return ledger;
 const known=new Map(ledger.observations.map(x=>[x.session+'|'+x.ticker,x]));
 // Validate all conflicts before modifying anything.
 for(const row of candidate.datedPriceObservations){
  const old=known.get(row.session+'|'+row.ticker);
  if(old&&!same(old,row))throw Error('PAPER_OBSERVATION_PRICE_CONFLICT:'+row.session+':'+row.ticker);
 }
 for(const row of candidate.datedPriceObservations)
  if(!known.has(row.session+'|'+row.ticker))ledger.observations.push(row);
 ledger.observations.sort((a,b)=>a.session.localeCompare(b.session)||a.ticker.localeCompare(b.ticker));
 return ledger;
}
function readIfExists(p){return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):null}
function writeIfChanged(p,obj){
 if(!obj)return;
 const value=JSON.stringify(obj,null,2)+'\n';
 if(fs.existsSync(p)&&fs.readFileSync(p,'utf8')===value)return;
 fs.writeFileSync(p,value);
}
function main(){
 const dir=path.join(ROOT,'unified-console');
 const current=readIfExists(path.join(dir,'independent-paper.json'));
 const archivePath=path.join(dir,'independent-last-verified.json');
 const ledgerPath=path.join(dir,'independent-paper-ledger.json');
 const symbols=readIfExists(path.join(ROOT,'data/symbol-map.json'));
 const verifyRow=row=>verifyObservationAgainstHistory(ROOT,symbols,row);
 const archive=retainArchive(readIfExists(archivePath),current,verifyRow);
 const ledger=updateLedger(readIfExists(ledgerPath),current,verifyRow);
 // Both are validated before any write; a failed fetch never erases the archive.
 writeIfChanged(archivePath,archive);
 writeIfChanged(ledgerPath,ledger);
 console.log('EGX_PAPER_ARCHIVE '+JSON.stringify({lastVerifiedSession:archive?.session||null,
  archivedPrices:archive?.datedPriceObservations.length||0,ledgerObservations:ledger.observations.length,orders:0}));
}
if(require.main===module)main();
module.exports={verifiedSnapshot,retainArchive,updateLedger,validArchive,validLedger,verifyObservationAgainstHistory};
