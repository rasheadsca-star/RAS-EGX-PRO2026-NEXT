'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {inventory,valid}=require('../../scripts/research/egx-independent-history-recovery.cjs');
function put(root,p,o){const x=path.join(root,p);fs.mkdirSync(path.dirname(x),{recursive:true});fs.writeFileSync(x,JSON.stringify(o));}
const bar=(date,close)=>({ticker:'TEST',date,open:close,high:close+1,low:close-1,close,volume:1000});
test('rejects future, fabricated or impossible historical bars',()=>{
 assert.equal(valid(bar('2026-10-28',10),'TEST','2026-10-27'),null);
 assert.equal(valid({...bar('2026-10-21',10),high:9},'TEST','2026-10-27'),null);
 assert.equal(valid({...bar('2026-10-21',10),volume:null},'TEST','2026-10-27'),null);
 assert.ok(valid(bar('2026-10-21',10),'TEST','2026-10-27'));
});
test('old archives are read-only candidates and conflicting quotes are quarantined',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-recover-'));
 try{
  put(root,'data/stable/v15-price-truth.json',{expectedSession:'2026-10-27',missingHistoryFiles:['TEST','MISS']});
  put(root,'data/symbol-map.json',{TEST:{ticker:'TEST',active:true},MISS:{ticker:'MISS',active:true}});
  put(root,'data/history-summary.json',{symbols:[{ticker:'TEST',availableSessions:2,lastSession:'2026-10-21',symbolVerified:true},{ticker:'MISS',availableSessions:0,lastSession:null,symbolVerified:false}]});
  put(root,'data/history/TEST.json',{ticker:'TEST',currency:'EGP',exchange:'EGX',symbolVerified:true,sessions:[bar('2026-10-20',10),bar('2026-10-21',11)]});
  put(root,'sources/legacy-ras-egx-pro2026/data/history/TEST.json',{ticker:'TEST',currency:'EGP',exchange:'EGX',symbolVerified:true,sessions:[bar('2026-10-19',9),bar('2026-10-20',10),bar('2026-10-21',22),bar('2026-10-27',13)]});
  const before=fs.readFileSync(path.join(root,'data/history/TEST.json'),'utf8');
  const {report,ledger}=inventory({root,out:path.join(root,'reports')});
  assert.equal(report.summary.conflictDates,1);
  assert.equal(report.summary.researchCandidates,2);
  assert.equal(ledger.candidates.every(x=>x.promotionApproved===false),true);
  assert.equal(report.focus.find(x=>x.ticker==='TEST').status,'UNVERIFIED_HISTORIC_ALTERNATIVE');
  assert.equal(report.focus.find(x=>x.ticker==='MISS').status,'NOT_FOUND_IN_ANY_SCANNED_ARCHIVE');
  assert.equal(fs.readFileSync(path.join(root,'data/history/TEST.json'),'utf8'),before);
  assert.ok(fs.existsSync(path.join(root,'reports/candidate-ledger.json')));
 }finally{fs.rmSync(root,{force:true,recursive:true})}
});
test('ISIN conflict blocks cross-repository promotion',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-recover-'));
 try{
  put(root,'data/stable/v15-price-truth.json',{expectedSession:'2026-10-27'});
  put(root,'data/symbol-map.json',{TEST:{ticker:'TEST',active:true}});
  put(root,'data/history/TEST.json',{ticker:'TEST',isin:'EG111',sessions:[bar('2026-10-20',10)]});
  put(root,'sources/legacy-ras-egx-pro2026/data/history/TEST.json',{ticker:'TEST',isin:'EG222',symbolVerified:true,sessions:[bar('2026-10-19',10)]});
  const x=inventory({root,out:path.join(root,'reports')});
  assert.equal(x.ledger.candidates.length,0);
  assert.ok(x.ledger.blocked.some(z=>z.reason==='ISIN_CONFLICT_ACROSS_ARCHIVES'));
 }finally{fs.rmSync(root,{force:true,recursive:true})}
});

test('USD EGX share-class historic file is not incorrectly discarded as non-EGP',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-recover-usd-'));
 try{
  put(root,'data/stable/v15-price-truth.json',{expectedSession:'2026-10-26',ready:false,acceptedRows:0,missingHistoryFiles:[]});
  put(root,'data/symbol-map.json',{GTEX:{ticker:'GTEX',active:true,currency:'USD'}});
  put(root,'data/history-summary.json',{symbols:[{ticker:'GTEX',availableSessions:1,lastSession:'2026-10-20',symbolVerified:true}]});
  put(root,'data/history/GTEX.json',{ticker:'GTEX',exchange:'EGX',currency:'USD',symbolVerified:true,
   sessions:[{ticker:'GTEX',date:'2026-10-20',open:1.2,high:1.3,low:1.1,close:1.25,volume:10000}]});
  const x=inventory({root,out:path.join(root,'reports')});
  assert.equal(x.report.summary.mainSymbols,1);
  assert.equal(x.report.sources.find(z=>z.id==='main').identityRejected,0);
  assert.equal(x.report.focus.some(z=>z.ticker==='GTEX'),true);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
