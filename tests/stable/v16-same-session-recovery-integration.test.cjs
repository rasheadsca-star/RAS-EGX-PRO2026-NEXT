'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');
const DATE = '2026-10-27';
const write = (root, rel, value) => {
  const dest=path.join(root,rel);
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.writeFileSync(dest,JSON.stringify(value,null,2)+'\n');
};
const read = (root, rel) => JSON.parse(fs.readFileSync(path.join(root,rel),'utf8'));
const marketRow = (symbol, price) => ({symbol,price,open:price,high:price,low:price,volume:100,sourceSessionDate:DATE,source:'mubasher_symbol_pages'});
const history = (ticker, isin) => ({ticker,isin,symbolVerified:true,sessions:[{date:'2026-10-26',open:1,high:1,low:1,close:1,volume:100}]});
const approval = (ticker, price) => ({ticker,approved:true,originalReason:'REPORTED_CHANGE_MISMATCH',approvedEvidence:{provider:'STOCKANALYSIS_EGX_HISTORY',status:'APPROVED',sessionDate:DATE,close:price,open:price,high:price,low:price,volume:100,priceDifferencePct:0}});
function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-replay-'));
  const scripts=['v16-market-coverage-reconciler.cjs'];
  for(const name of scripts){const dest=path.join(root,'scripts/stable',name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(ROOT,'scripts/stable',name),dest);}
  write(root,'data/stable/v15-price-truth.json',{expectedSession:DATE,ready:true,executionGrade:true,minimumExecutionRows:1,acceptedRows:1,rejectedRows:2,droppedRows:0,
    source:{inputRows:3,sourceSessionEvidenceCoveragePct:100,verifiedExpectedSessionRows:3},sampleAccepted:[{ticker:'ABUK',date:DATE}],
    sampleRejected:[{ticker:'TRTO',reason:'REPORTED_CHANGE_MISMATCH'},{ticker:'NAHO',reason:'REPORTED_CHANGE_MISMATCH'}]});
  write(root,'data/stable/v16-market-second-source-evidence.json',{expectedSession:DATE,records:{TRTO:approval('TRTO',0.06),NAHO:approval('NAHO',0.13)}});
  write(root,'data/stable/v16-source-session-evidence.json',{expectedSession:DATE,matchingRows:3,totalRows:3,coveragePct:100,primaryMatchingRows:3,primaryMismatchedRows:0,primaryUnknownRows:0,staleSymbols:[],unknownSymbols:[]});
  write(root,'data/market.json',{rows:[marketRow('ABUK',1),marketRow('TRTO',0.06),marketRow('NAHO',0.13)]});
  write(root,'data/symbol-map.json',{TRTO:{active:true},NAHO:{active:true}});
  write(root,'data/history/TRTO.json',history('TRTO','EGS79072C012'));
  write(root,'data/history/NAHO.json',history('NAHO','EGS69182C011'));
  write(root,'data/fetch-status.json',{expectedSession:DATE,inputRows:3,marketRows:1,currentSessionRows:1,rejectedCurrentSessionRows:2,coveragePct:33.33,sourceSessionEvidenceCoveragePct:100});
  return root;
}
function run(root) {
  return cp.spawnSync(process.execPath,[path.join(ROOT,'scripts/stable/v16-same-session-recovery-replay.cjs')],{cwd:root,env:{...process.env,GITHUB_WORKSPACE:root},encoding:'utf8'});
}
test('real reconciler replays both verified bars and reconciles fetch-status atomically in isolated fixture',()=>{
  const root=fixture();
  try {
    const result=run(root);
    assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
    const truth=read(root,'data/stable/v15-price-truth.json'),status=read(root,'data/fetch-status.json');
    assert.equal(truth.acceptedRows,3);
    assert.equal(truth.rejectedRows,0);
    assert.equal(status.marketRows,3);
    assert.equal(status.rejectedCurrentSessionRows,0);
    assert.equal(status.coveragePct,100);
    assert.deepEqual(truth.secondSourceReconciliation.recoveredTickersThisRun,['TRTO','NAHO']);
    for(const t of ['TRTO','NAHO']) {
      const bar=read(root,'data/history/'+t+'.json').sessions.find(x=>x.date===DATE);
      assert.ok(bar,t+' history bar');
      assert.equal(bar.secondSourceConfirmed,true,t+' evidence');
      assert.ok(bar.open>0&&bar.high>=bar.close&&bar.low<=bar.close&&bar.volume>=0,t+' observed OHLCV');
    }
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('prior-session evidence never enters current-session truth',()=>{
  const root=fixture();
  try {
    const e=read(root,'data/stable/v16-market-second-source-evidence.json');e.expectedSession='2026-10-26';write(root,'data/stable/v16-market-second-source-evidence.json',e);
    const result=run(root);
    assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
    assert.match(result.stdout,/SECOND_SOURCE_NOT_SAME_SESSION/);
    assert.equal(read(root,'data/stable/v15-price-truth.json').acceptedRows,1);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('missing primary candle is recovered only from observed independent full candle with exact provenance',()=>{
 const root=fixture();
 try{
  const m=read(root,'data/market.json');m.rows.find(r=>r.symbol==='TRTO').high=null;write(root,'data/market.json',m);
  const p=read(root,'data/stable/v15-price-truth.json');p.sampleRejected.find(r=>r.ticker==='TRTO').reason='OBSERVED_OHLCV_REQUIRED_NO_RECONSTRUCTION';write(root,'data/stable/v15-price-truth.json',p);
  const result=run(root);assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
  const bar=read(root,'data/history/TRTO.json').sessions.find(x=>x.date===DATE);
  assert.equal(bar.ohlcMode,'SECOND_SOURCE_EXACT_SESSION_REPLACEMENT');
  assert.equal(bar.high,0.06);assert.match(bar.sourceSessionEvidence,/independent_second_source_.*_exact_session_replacement/);
  assert.equal(read(root,'data/stable/v15-price-truth.json').acceptedRows,3);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
