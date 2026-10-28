'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const {observed}=require('../../scripts/stable/v16-verified-incremental-recovery.cjs');
test('all accepted independently recovered tickers persist a same-session, independently evidenced OHLCV history bar',()=>{
 const truth=read('data/stable/v15-price-truth.json'),second=read('data/stable/v16-market-second-source-evidence.json'),market=read('data/market.json');
 const tickers=truth.secondSourceReconciliation?.recoveredTickersThisRun||[];
 // A previous-session second-source archive may remain for audit. It cannot
 // validate a current-session recovery, and must never cause a false promotion.
 if(second.expectedSession!==truth.expectedSession){
  assert.equal(tickers.length,0,'STALE_SECOND_SOURCE_CANNOT_CERTIFY_CURRENT_RECOVERY');
  return;
 }
 const marketByTicker=new Map((market.rows||[]).map(r=>[r.symbol,r]));
 for(const ticker of tickers){
  const h=read('data/history/'+ticker+'.json'),e=second.records?.[ticker]?.approvedEvidence,m=marketByTicker.get(ticker);
  const row=(h.sessions||[]).find(x=>x.date===truth.expectedSession);
  assert.equal(h.symbolVerified,true,ticker+' identity');
  assert.match(String(h.isin||''),/^EG[A-Z0-9]{9,}$/,ticker+' ISIN');
  assert.ok(row,ticker+' missing current verified history');
  assert.equal(row.sourceSessionDate,truth.expectedSession,ticker+' session');
  assert.equal(row.secondSourceConfirmed,true,ticker+' independent confirmation');
  assert.equal(row.secondSourceProvider,e?.provider,ticker+' source identity');
  assert.ok(observed(row),ticker+' incomplete OHLCV');
  assert.ok(e?.status==='APPROVED'&&e?.sessionDate===truth.expectedSession,ticker+' second-source evidence');
  assert.ok(Math.abs(row.close/e.close-1)*100<=2.5,ticker+' second-source close mismatch');
  if(row.ohlcMode==='PRIMARY_OHLC_SECOND_SOURCE_CLOSE_CONFIRMED'){
   assert.equal(m?.sourceSessionDate,truth.expectedSession,ticker+' primary session');
   for(const k of ['open','high','low','volume'])assert.equal(row[k],m[k],ticker+' '+k+' changed from observed primary');
  }
 }
});
