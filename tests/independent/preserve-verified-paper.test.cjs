'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {verifiedSnapshot:rawSnapshot,retainArchive:rawRetain,updateLedger:rawLedger,
 validArchive,validLedger,verifyObservationAgainstHistory}=
 require('../../scripts/independent/preserve-verified-paper.cjs');
const verifiedSnapshot=x=>rawSnapshot(x,()=>true); // explicitly trusted unit fixtures
const retainArchive=(old,current)=>rawRetain(old,current,()=>true);
const updateLedger=(old,current)=>rawLedger(old,current,()=>true);
const observation=(ticker='COMI',session='2026-10-27',close=121.82)=>({
 ticker,session,close,currency:'EGP',evidenceLevel:'DATED_PROVIDER_EVIDENCE',
 state:'DATED_PRICE_OBSERVATION_NOT_A_SIGNAL'});
const source=(session='2026-10-27',rows=[observation()])=>({
 session,mode:'PAPER_ONLY',executable:false,recommendations:[],watchlist:[],
 datedPriceObservations:rows,status:'RESEARCH_ONLY_PRICE_GATE_BLOCKED'});
test('archives only dated, non-executable evidence',()=>{
 const a=verifiedSnapshot(source());
 assert.equal(validArchive(a),true);
 assert.equal(a.session,'2026-10-27');
 assert.equal(a.datedPriceObservations.length,1);
 assert.deepEqual(a.orders,[]);
 assert.deepEqual(a.recommendations,[]);
});
test('failed fetch or empty research cannot destroy last verified snapshot',()=>{
 const old=verifiedSnapshot(source());
 assert.deepEqual(retainArchive(old,source('2026-10-28',[])),old);
 assert.deepEqual(retainArchive(old,null),old);
 assert.deepEqual(retainArchive(old,{...source(),executable:true}),old);
});
test('a newer verified session replaces old archive, not vice versa',()=>{
 const old=verifiedSnapshot(source());
 const newer=source('2026-10-28',[observation('COMI','2026-10-28',123)]);
 const latest=retainArchive(old,newer);
 assert.equal(latest.session,'2026-10-28');
 assert.deepEqual(retainArchive(latest,source()),latest);
});
test('same-session shrink or price correction cannot silently overwrite archived prices',()=>{
 const old=verifiedSnapshot(source('2026-10-27',[observation(),observation('EGBE','2026-10-27',0.5)]));
 assert.deepEqual(retainArchive(old,source()),old);
 assert.deepEqual(retainArchive(old,source('2026-10-27',[observation('COMI','2026-10-27',999),observation('EGBE','2026-10-27',0.5)])),old);
});
test('append-only ledger deduplicates same session and keeps zero orders',()=>{
 const first=updateLedger(null,source());
 const same=updateLedger(first,source());
 assert.equal(validLedger(same),true);
 assert.deepEqual(same,first);
 const next=updateLedger(same,source('2026-10-28',[observation('COMI','2026-10-28',123)]));
 assert.equal(next.observations.length,2);
 assert.deepEqual(next.orders,[]);
 assert.deepEqual(updateLedger(next,source()),next);
});
test('ledger rejects a changed price for same ticker and session',()=>{
 const first=updateLedger(null,source());
 assert.throws(()=>updateLedger(first,source('2026-10-27',[observation('COMI','2026-10-27',999)])),/PAPER_OBSERVATION_PRICE_CONFLICT/);
});
test('malformed or executable data cannot enter archival ledger',()=>{
 const first=updateLedger(null,source());
 for(const invalid of [
  {...source(),executable:true},
  {...source(),recommendations:[{ticker:'COMI'}]},
  source('2026-10-27',[observation('COMI','2026-10-26')]),
  source('2026-10-27',[observation('COMI','2026-10-27',-1)]),
  source('2026-10-27',[observation(),observation()]),
  source('2026-02-30',[observation('COMI','2026-02-30')])
 ])assert.deepEqual(updateLedger(first,invalid),first);
});
test('invalid existing archive or ledger fails closed rather than being erased',()=>{
 assert.throws(()=>retainArchive({foo:'bar'},source()),/INVALID_PREVIOUS_VERIFIED_ARCHIVE/);
 assert.throws(()=>updateLedger({foo:'bar'},source()),/INVALID_PREVIOUS_PAPER_LEDGER/);
});

test('archive promotion fails closed without a persisted OHLCV verifier',()=>{
 assert.equal(rawSnapshot(source()),null);
 assert.equal(rawRetain(null,source()),null);
 assert.equal(rawLedger(null,source()).observations.length,0);
});
test('persisted session OHLCV must exactly match archive close, ISIN, date and provenance',()=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
 const root=path.resolve(__dirname,'../..');
 const symbols=JSON.parse(fs.readFileSync(path.join(root,'data/symbol-map.json'),'utf8'));
 const h=JSON.parse(fs.readFileSync(path.join(root,'data/history/COMI.json'),'utf8'));
 const last=h.sessions.at(-1);
 const row={...observation('COMI',last.date,last.close),
  evidenceLevel:last.secondSourceConfirmed===true?'CROSS_PROVIDER_CONFIRMED':'DATED_PROVIDER_EVIDENCE'};
 assert.equal(verifyObservationAgainstHistory(root,symbols,row),true);
 assert.equal(verifyObservationAgainstHistory(root,symbols,{...row,close:row.close+0.01}),false);
 assert.equal(verifyObservationAgainstHistory(root,symbols,{...row,session:'2026-01-01'}),false);
 assert.equal(verifyObservationAgainstHistory(root,symbols,{...row,evidenceLevel:'CROSS_PROVIDER_CONFIRMED'}),false);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'egx-archive-verified-'));
 try{
  fs.mkdirSync(path.join(dir,'data/history'),{recursive:true});
  const copy=JSON.parse(JSON.stringify(h));
  copy.sessions=[last,{...last}];
  fs.writeFileSync(path.join(dir,'data/history/COMI.json'),JSON.stringify(copy));
  assert.equal(verifyObservationAgainstHistory(dir,symbols,row),false);
  copy.sessions=[{...last,validationStatus:'single_source_validated'}];
  fs.writeFileSync(path.join(dir,'data/history/COMI.json'),JSON.stringify(copy));
  assert.equal(verifyObservationAgainstHistory(dir,symbols,row),false);
  copy.sessions=[last];
  copy.isin='EG0000000000';
  fs.writeFileSync(path.join(dir,'data/history/COMI.json'),JSON.stringify(copy));
  assert.equal(verifyObservationAgainstHistory(dir,symbols,row),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('a poisoned newer paper JSON cannot replace last-known-good archive or ledger',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const root=path.resolve(__dirname,'../..');
 const symbols=JSON.parse(fs.readFileSync(path.join(root,'data/symbol-map.json'),'utf8'));
 const verify=r=>verifyObservationAgainstHistory(root,symbols,r);
 const h=JSON.parse(fs.readFileSync(path.join(root,'data/history/COMI.json'),'utf8'));
 const last=h.sessions.at(-1),row=observation('COMI',last.date,last.close);
 const good=source(last.date,[row]),bad=source(last.date,[{...row,close:row.close+999}]);
 const previous=rawSnapshot(good,verify),ledger=rawLedger(null,good,verify);
 assert.equal(validArchive(previous),true);
 assert.equal(ledger.observations.length,1);
 assert.deepEqual(rawRetain(previous,bad,verify),previous);
 assert.deepEqual(rawLedger(ledger,bad,verify),ledger);
});
