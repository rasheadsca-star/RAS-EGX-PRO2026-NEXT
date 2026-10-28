'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=process.env.GITHUB_WORKSPACE||process.cwd();
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const write=(p,v)=>fs.writeFileSync(path.join(root,p),JSON.stringify(v,null,2)+'\n');
const tickerOf=r=>String(r?.symbol||r?.ticker||r?.code||'').toUpperCase().replace(/\.CA$/,'');
const num=x=>x===null||x===undefined||!['number','string'].includes(typeof x)||(typeof x==='string'&&!x.trim())?null:Number.isFinite(Number(x))?Number(x):null;
const date=x=>String(x||'').slice(0,10);
function observed(r,closeKey='close'){
 const c=num(r?.[closeKey]??r?.close),o=num(r?.open),h=num(r?.high),l=num(r?.low),v=num(r?.volume);
 return c>0&&o>0&&h>=Math.max(o,c)&&l>0&&l<=Math.min(o,c)&&v!==null&&v>=0;
}
// Preserve an observed independently approved candle only while its exact
// session, verified security identity and approval remain valid. A fresh
// same-session primary price conflict is quarantined rather than hidden.
function retainedSameSessionBar(ticker, expected, second, history, symbol, primary) {
 const record=second.records?.[ticker], e=record?.approvedEvidence;
 if(date(second.expectedSession)!==expected||record?.approved!==true||e?.status!=='APPROVED'
   ||date(e.sessionDate)!==expected||!['YAHOO_CHART','STOCKANALYSIS_EGX_HISTORY','SIGMA_CAPITAL_LIVE_MARKET'].includes(e.provider)
   ||!(num(e.close)>0)||symbol?.active===false||!symbol||history?.symbolVerified!==true
   ||tickerOf(history)!==ticker||(record.ticker&&tickerOf(record)!==ticker)
   ||(symbol.ticker&&tickerOf(symbol)!==ticker)
   ||(symbol.isin&&symbol.isin!==history.isin)||(e.ticker&&tickerOf(e)!==ticker)
   ||(symbol.isin&&String(symbol.isin).toUpperCase()!==String(history.isin||'').toUpperCase())
   ||!/^EG[A-Z0-9]{9,}$/i.test(String(history.isin||'')))return null;
 const bars=(history.sessions||[]).filter(r=>date(r.date||r.sessionDate)===expected);
 if(bars.length!==1)return null;
 const bar=bars[0];
 if(date(bar.sourceSessionDate)!==expected||bar.secondSourceConfirmed!==true
   ||bar.secondSourceProvider!==e.provider||!observed(bar)
   ||(bar.ticker&&tickerOf(bar)!==ticker)
   ||/invalid|conflict|failed|quarantined|unresolved/i.test(String(bar.validationStatus||''))
   ||(bar.warnings||[]).some(w=>/reconstruct|synthetic|conflict/i.test(String(w)))
   ||Math.abs(bar.close/num(e.close)-1)*100>2.5)return null;
 const currentPrice=num(primary?.price??primary?.last??primary?.close);
 if(date(primary?.sourceSessionDate)===expected&&currentPrice>0
   &&Math.abs(currentPrice/num(e.close)-1)*100>2.5)return null;
 return {...bar,ticker};
}
function filterApproved(second,price,market,symbols,historyByTicker){
 const expected=date(price.expectedSession);
 if(date(second.expectedSession)!==expected||!/^\d{4}-\d{2}-\d{2}$/.test(expected))throw Error('RECOVERY_SESSION_MISMATCH');
 const rows=new Map((market.rows||[]).map(r=>[tickerOf(r),r]));
 const rejects=new Map((price.sampleRejected||[]).map(r=>[tickerOf(r),r]));
 const filtered=structuredClone(second),quarantined=[];
 for(const [key,record] of Object.entries(filtered.records||{})){
  if(record.approved!==true)continue;
  const ticker=tickerOf({ticker:key}),h=historyByTicker[ticker],s=symbols[ticker],m=rows.get(ticker),reject=rejects.get(ticker);
  const e=record.approvedEvidence,fullCandleRequired=reject?.reason==='OBSERVED_OHLCV_REQUIRED_NO_RECONSTRUCTION',stale=['SOURCE_SESSION_MISMATCH','SOURCE_SESSION_UNKNOWN'].includes(reject?.reason);
  let reason=null;
  if(!s||s.active===false||!h||h.symbolVerified!==true||!/^EG[A-Z0-9]{9,}$/i.test(String(h.isin||'')))reason='EXISTING_VERIFIED_ISIN_HISTORY_REQUIRED';
  else if(!reject||!m||tickerOf(m)!==ticker)reason='PRIMARY_REJECTION_AND_TICKER_REQUIRED';
  else if(date(e?.sessionDate)!==expected||e?.status!=='APPROVED'||!['YAHOO_CHART','STOCKANALYSIS_EGX_HISTORY','SIGMA_CAPITAL_LIVE_MARKET'].includes(e?.provider))reason='INDEPENDENT_SAME_SESSION_EVIDENCE_REQUIRED';
  else if(!stale&&date(m?.sourceSessionDate)!==expected)reason='PRIMARY_SOURCE_SESSION_REQUIRED';
  else if((stale||fullCandleRequired)?!observed(e):!observed(m,'price'))reason='OBSERVED_OHLCV_REQUIRED_NO_RECONSTRUCTION';
  else if(!stale&&Math.abs(num(e?.close)/num(m?.price)-1)*100>2.5)reason='SECOND_SOURCE_PRICE_DISAGREEMENT';
  if(reason){record.approved=false;record.quarantineReason=reason;record.approvedEvidence=null;quarantined.push({ticker,reason});}
 }
 filtered.approvedTickers=Object.entries(filtered.records||{}).filter(([,r])=>r.approved===true).map(([t])=>t);
 filtered.approvedCount=filtered.approvedTickers.length;
 filtered.unresolvedTickers=Object.entries(filtered.records||{}).filter(([,r])=>r.approved!==true).map(([t])=>t);
 filtered.unresolvedCount=filtered.unresolvedTickers.length;
 filtered.incrementalIdentityAndOhlcvGuard={expectedSession:expected,quarantined,policy:'Existing verified ISIN history, active symbol, independent exact session and fully observed OHLCV only; no new history seed.'};
 return filtered;
}
function verify(before,after,second,historyByTicker){
 const old=Number(before.acceptedRows||0),next=Number(after.acceptedRows||0);
 const rec=after.secondSourceReconciliation?.recoveredTickersThisRun||[];
 if(date(before.expectedSession)!==date(after.expectedSession)||date(second.expectedSession)!==date(after.expectedSession))throw Error('SESSION_CHANGED');
 if(before.ready!==true||before.executionGrade!==true||after.ready!==true||after.executionGrade!==true)throw Error('EXECUTION_GRADE_REGRESSED');
 if(next<old||next-old!==rec.length)throw Error('ACCEPTED_ROWS_DELTA_MISMATCH');
 if(new Set(rec).size!==rec.length)throw Error('DUPLICATE_RECOVERY');
 for(const ticker of rec){
  const e=second.records?.[ticker];const h=historyByTicker[ticker];
  const row=h?.sessions?.find(x=>date(x.date||x.sessionDate)===date(after.expectedSession));
  if(!e?.approved||!h?.symbolVerified||!h.isin||!row?.secondSourceConfirmed||!observed(row))throw Error('UNVERIFIED_RECOVERY_'+ticker);
  if(row.sourceSessionDate!==after.expectedSession||row.secondSourceProvider!==e.approvedEvidence?.provider)throw Error('EVIDENCE_IDENTITY_MISMATCH_'+ticker);
 }
 return {session:after.expectedSession,baselineAccepted:old,accepted:next,recovered:rec,increment:rec.length};
}
function main(){
 const mode=process.argv[2],historyDir=path.join(root,'data/history');
 const second=read('data/stable/v16-market-second-source-evidence.json');
 const price=read('data/stable/v15-price-truth.json');
 const history={};
 const relevant=new Set([...(price.sampleRejected||[]).map(x=>tickerOf(x)),...(price.secondSourceReconciliation?.recoveredTickersThisRun||[])]);
 for(const t of relevant){try{history[t]=read('data/history/'+t+'.json')}catch{}}
 if(mode==='filter'){
  const filtered=filterApproved(second,price,read('data/market.json'),read('data/symbol-map.json'),history);
  write('data/stable/v16-market-second-source-evidence.json',filtered);
  console.log('INCREMENTAL_SECOND_SOURCE_FILTER '+JSON.stringify({approved:filtered.approvedCount,quarantined:filtered.incrementalIdentityAndOhlcvGuard.quarantined}));
 }else if(mode==='verify'){
  const before=read('artifacts/recovery-before-price-truth.json');
  const result=verify(before,price,second,history);
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
  write('artifacts/verified-incremental-recovery-result.json',result);
  if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'recovered='+result.increment+'\n');
  console.log('VERIFIED_INCREMENTAL_RECOVERY '+JSON.stringify(result));
 }else throw Error('Use filter or verify');
}
if(require.main===module)main();
module.exports={observed,filterApproved,verify,retainedSameSessionBar};
