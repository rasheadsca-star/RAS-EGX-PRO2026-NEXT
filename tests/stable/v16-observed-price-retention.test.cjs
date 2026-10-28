'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeMarketRow}=require('../../scripts/stable/v16-session-aware-price-truth.cjs');
const {retainedSameSessionBar}=require('../../scripts/stable/v16-verified-incremental-recovery.cjs');
const {validOhlc}=require('../../scripts/stable/v16-market-coverage-reconciler.cjs');
const session='2026-10-27',ticker='NAHO';
const primary={symbol:ticker,sourceSessionDate:session,price:0.13,open:0.12,high:0.13,low:0.12,volume:100};
const bar={ticker,date:session,sourceSessionDate:session,open:0.12,high:0.13,low:0.12,close:0.13,volume:100,
 secondSourceConfirmed:true,secondSourceProvider:'STOCKANALYSIS_EGX_HISTORY',validationStatus:'precise_public_source_session_confirmed'};
const evidence={expectedSession:session,records:{NAHO:{approved:true,approvedEvidence:{status:'APPROVED',provider:'STOCKANALYSIS_EGX_HISTORY',sessionDate:session,close:0.13}}}};
const history={ticker,isin:'EGS69182C011',symbolVerified:true,sessions:[bar]};
const retain=(e=evidence,h=history,m=primary)=>retainedSameSessionBar(ticker,session,e,h,{active:true},m);
test('execution normalization rejects absent OHLCV and never fabricates candles',()=>{
 for(const k of ['open','high','low','volume'])for(const missing of [null,undefined,'',' ',false]){
  const row={...primary,[k]:missing};
  assert.equal(normalizeMarketRow(row,session,'source','2026-10-28').reason,'OBSERVED_OHLCV_REQUIRED_NO_RECONSTRUCTION',k);
  assert.equal(validOhlc(row,row.price),null,k);
 }
 assert.equal(validOhlc({...primary,high:0.129},primary.price),null,'invalid range must not be expanded to close');
 assert.equal(validOhlc({...primary,volume:0},primary.price).volume,0,'observed zero is valid');
});
test('independently evidenced observed bar survives same-session refetch without losing metadata',()=>{
 assert.deepEqual(retain(),bar);
 assert.deepEqual(retain(evidence,history,{...primary,sourceSessionDate:'2026-10-26'}),bar);
 assert.deepEqual(retain(evidence,history,{...primary,high:null}),bar);
});
test('retention fails closed on old session, revoked approval, disagreement and invalid identity or candle',()=>{
 assert.equal(retain({...evidence,expectedSession:'2026-10-26'}),null);
 assert.equal(retain({...evidence,records:{NAHO:{...evidence.records.NAHO,approved:false}}}),null);
 assert.equal(retain(evidence,history,{...primary,price:0.2}),null);
 for(const replacement of [{...bar,date:'2026-10-26'},{...bar,sourceSessionDate:'2026-10-26'},
  {...bar,volume:null},{...bar,secondSourceConfirmed:false},{...bar,close:0.5},
  {...bar,warnings:['partial_ohlc_reconstructed_from_close_or_previous_close']}]){
  assert.equal(retain(evidence,{...history,sessions:[replacement]}),null);
 }
 assert.equal(retain(evidence,{...history,symbolVerified:false}),null);
 const badIdentity=structuredClone(evidence);badIdentity.records.NAHO.approvedEvidence.ticker='COMI';assert.equal(retain(badIdentity),null);
 assert.equal(retainedSameSessionBar(ticker,session,evidence,history,{active:true,isin:'EGS123456789'},primary),null);
 assert.equal(retain(evidence,{...history,sessions:[bar,bar]}),null);
});

test('full price-truth run retains omitted independently observed symbol and removes it on session advance',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
 const {expectedLatestCompletedSessionCairo}=require('../../scripts/stable/v16-session-aware-price-truth.cjs');
 const current=expectedLatestCompletedSessionCairo(),root=fs.mkdtempSync(path.join(os.tmpdir(),'observed-retention-'));
 const write=(p,v)=>{const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v));};
 const script=path.resolve(__dirname,'../../scripts/stable/v16-session-aware-price-truth.cjs');
 try{
  const b={...bar,date:current,sourceSessionDate:current,confidence:{overall:95}};
  const e=structuredClone(evidence);e.expectedSession=current;e.records.NAHO.approvedEvidence={...e.records.NAHO.approvedEvidence,...b,sessionDate:current,status:'APPROVED',provider:b.secondSourceProvider};
  write('data/market.json',{ok:true,source:'mubasher_symbol_pages_precise_enriched',rows:[{...primary,symbol:'ABUK',sourceSessionDate:current,price:1,open:1,high:1,low:1}]});
  write('data/fetch-status.json',{realFetch:true});
  write('data/stable/v16-market-second-source-evidence.json',e);
  write('data/symbol-map.json',{NAHO:{active:true,ticker:'NAHO'},ABUK:{active:true,ticker:'ABUK'}});
  write('data/history/NAHO.json',{...history,sessions:[b]});write('data/history/ABUK.json',{ticker:'ABUK',sessions:[]});
  const run=()=>cp.spawnSync(process.execPath,[script],{cwd:root,env:{...process.env,GITHUB_WORKSPACE:root,EGX_MIN_EXECUTION_ROWS:'1'},encoding:'utf8'});
  let result=run();assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
  let truth=JSON.parse(fs.readFileSync(path.join(root,'data/stable/v15-price-truth.json')));
  assert.equal(truth.acceptedRows,2);assert.equal(truth.source.inputRows,2);assert.equal(truth.source.primaryInputRows,1);
  assert.deepEqual(truth.retainedOmittedIndependentSameSessionTickers,['NAHO']);
  e.expectedSession='2000-01-01';write('data/stable/v16-market-second-source-evidence.json',e);
  // Persisted retained inputs cannot masquerade as a fresh primary quote after revocation.
  result=run();assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
  truth=JSON.parse(fs.readFileSync(path.join(root,'data/stable/v15-price-truth.json')));assert.equal(truth.acceptedRows,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('whitespace and boolean fields cannot become observed volume',()=>{for(const volume of [' ', '\t', false, true]) assert.equal(require('../../scripts/stable/v16-verified-incremental-recovery.cjs').observed({open:10,high:11,low:9,close:10,volume}),false)});
