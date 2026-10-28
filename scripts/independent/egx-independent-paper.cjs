'use strict';
// Independent, fail-closed, paper-only engine. No Astra dependencies.
const fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GITHUB_WORKSPACE||process.cwd();
const {walkForwardBacktest,strictProvenance}=require('./walkforward-backtest.cjs');
const {copiedBarReasons}=require('./stale-bar-detector.cjs');
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const day=s=>typeof s==='string'?s.slice(0,10):'';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=(n,d=4)=>Number(n.toFixed(d));
function historicalBarValid(r){
 const d=day(r?.date||r?.sessionDate);
 return /^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&
  (!r?.sourceSessionDate||day(r.sourceSessionDate)===d)&&
  [r?.open,r?.high,r?.low,r?.close,r?.volume].every(finite)&&
  r.open>0&&r.close>0&&r.low>0&&r.high>=Math.max(r.open,r.close)&&
  r.low<=Math.min(r.open,r.close)&&r.volume>=0&&
  !/reconstruct|synthetic|partial_ohlc/i.test(String(r.validationStatus||''))&&
  !r.warnings?.some(x=>/reconstruct|synthetic|partial_ohlc/i.test(String(x)));
}
function validBar(r,session){
 return historicalBarValid(r)&&day(r?.date||r?.sessionDate)===session&&
  day(r?.sourceSessionDate)===session&&
  r.validationStatus==='precise_public_source_session_confirmed';
}
function sma(rows,n){return rows.slice(-n).reduce((s,r)=>s+r.close,0)/n}
function atr(rows,n=14){
 let sum=0;for(let i=rows.length-n;i<rows.length;i++){
  const r=rows[i],prev=rows[i-1];if(!prev)return null;
  sum+=Math.max(r.high-r.low,Math.abs(r.high-prev.close),Math.abs(r.low-prev.close));
 }return sum/n;
}
// Research can inspect independently dated historical evidence even when the
// aggregate price feed fails. It must never turn that evidence into orders.
function currentEvidenceValid(r,session){
 const confirmations=(Array.isArray(r?.verifiedBy)&&r.verifiedBy.length>0)||
   (r?.secondSourceConfirmed===true&&Array.isArray(r?.verificationSources)&&r.verificationSources.length>0);
 return validBar(r,session)&&confirmations&&
   typeof r.sourceSessionEvidence==='string'&&r.sourceSessionEvidence.length>=8&&
   /^https:\/\//i.test(String(r.sourceUrls?.primary||''))&&
   Number.isFinite(Date.parse(String(r.fetchedAt||'')))&&
   !r.warnings?.some(x=>/invalid|conflict|quarantined|unresolved/i.test(String(x)));
}
function evaluate({price,handoff,symbols,loadHistory,session,minimumRows=190}){
 const aggregateReady=day(price?.expectedSession)===session&&price?.ready===true&&
   price?.executionGrade===true&&Number(price?.acceptedRows||0)>=minimumRows;
 const handoffAligned=day(handoff?.sessionDate)===session&&
   handoff?.acceptedRows===price?.acceptedRows;
 const result={schemaVersion:'egx-independent-paper-v2',session,mode:'PAPER_ONLY',executable:false,
  status:'BLOCKED',blockers:[],diagnostics:[],datedPriceObservations:[],verifiedCandidates:[],researchWatchlist:[],
  recommendations:[],watchlist:[],
  inputs:{priceAccepted:price?.acceptedRows??null,handoffAccepted:handoff?.acceptedRows??null,
   aggregatePriceReady:aggregateReady,handoffAligned}};
 if(!/^\d{4}-\d{2}-\d{2}$/.test(session)||Number.isNaN(Date.parse(session+'T00:00:00Z')))
  result.blockers.push('INVALID_SESSION');
 if(day(price?.expectedSession)!==session)result.blockers.push('PRICE_SESSION_MISMATCH');
 if(!aggregateReady)result.blockers.push('PRICE_TRUTH_NOT_EXECUTION_GRADE');
 // G22 is an Astra handoff, NOT an independent research dependency.
 if(!handoffAligned)result.diagnostics.push('ASTRA_HANDOFF_NOT_ALIGNED_INFORMATIONAL');
 if(result.blockers.includes('INVALID_SESSION')||result.blockers.includes('PRICE_SESSION_MISMATCH'))return result;
 const accepted=new Set((price?.sampleAccepted||[]).map(r=>String(r?.ticker||'').toUpperCase()));
 // sampleAccepted is incomplete: never infer that other tickers passed the aggregate gate.
 const rows=Array.isArray(symbols)?symbols:Object.values(symbols||{});
 for(const sym of rows){
  const ticker=String(sym?.ticker||'').trim().toUpperCase();
  if(!/^[A-Z0-9]{2,12}$/.test(ticker)||sym.active===false)continue;
  let h;try{h=loadHistory(ticker)}catch{continue}
  if(h?.symbolVerified!==true||!/^EG[A-Z0-9]{10}$/i.test(h?.isin||'')||
     (h.ticker&&String(h.ticker).toUpperCase()!==ticker)||
     (sym.isin&&String(sym.isin).toUpperCase()!==String(h.isin).toUpperCase())||
     (sym.currency&&h.currency&&String(sym.currency).toUpperCase()!==String(h.currency).toUpperCase())||
     (sym.exchange&&h.exchange&&String(sym.exchange).toUpperCase()!==String(h.exchange).toUpperCase()))continue;
  const bars=(Array.isArray(h.sessions)?h.sessions:[]).filter(r=>day(r?.date||r?.sessionDate)<=session)
    .sort((a,b)=>day(a.date||a.sessionDate).localeCompare(day(b.date||b.sessionDate)));
  if(!currentEvidenceValid(bars.at(-1),session))continue;
  const recent=bars.slice(-60),dates=recent.map(r=>day(r.date||r.sessionDate));
  const c=recent.at(-1),currency=String(h.currency||c.currency||sym.currency||'').toUpperCase();
  if(c.currency&&currency!==String(c.currency).toUpperCase())continue;
  // Indicator eligibility must use the same full dated provenance as OOS tests.
  // Plausible OHLCV alone cannot create an SMA/ATR research candidate.
  const cleanBars=recent.filter(r=>strictProvenance(r,historicalBarValid)).length;
  const indicatorBlockers=[];
  if(recent.length!==60)indicatorBlockers.push('INSUFFICIENT_LOOKBACK_BARS');
  if(new Set(dates).size!==recent.length)indicatorBlockers.push('DUPLICATE_LOOKBACK_SESSION');
  if(cleanBars!==recent.length)indicatorBlockers.push('UNVERIFIED_HISTORICAL_OHLCV');
  if(copiedBarReasons(recent).length)indicatorBlockers.push('STALE_COPIED_BAR_IN_LOOKBACK');
  const indicatorReady=indicatorBlockers.length===0;
  // Dated observations are NOT indicator-ready candidates or trade signals.
  // This exposes independently sourced current prices without laundering
  // synthetic historical candles into SMA/ATR calculations.
  result.datedPriceObservations.push({ticker,session,close:c.close,currency,
   cleanLookbackBars:cleanBars,lookbackBars:recent.length,indicatorReady,indicatorBlockers,
   evidenceLevel:c.secondSourceConfirmed===true?'CROSS_PROVIDER_CONFIRMED':'DATED_PROVIDER_EVIDENCE',
   state:'DATED_PRICE_OBSERVATION_NOT_A_SIGNAL'});
  if(!indicatorReady)continue;
  const m20=sma(recent,20),m50=sma(recent,50),a=atr(recent);
  const avgVolume=recent.slice(-21,-1).reduce((s,r)=>s+r.volume,0)/20;
  if(!a||a<=0||avgVolume<=0)continue;
  // The liquidity threshold is denominated in EGP; no unverified USD/EGP conversion.
  const liquid=currency==='EGP'&&c.close*avgVolume>=1000000;
  const trending=c.close>m20&&m20>m50;
  const score=round((c.close/m20-1)*100+(m20/m50-1)*100,3);
  const evidenceLevel=c.secondSourceConfirmed===true?'CROSS_PROVIDER_CONFIRMED':'DATED_PROVIDER_EVIDENCE';
  // Fixed, chronological holdout; every candle requires independently dated provenance.
  // No result is a certification or a live/paper order. A dirty archive blocks the test.
  const {trades:researchTrades,...oos}=walkForwardBacktest(bars,{
   barValid:historicalBarValid,currency
  });
  result.verifiedCandidates.push({ticker,session,close:c.close,currency,score,liquid,trending,evidenceLevel,
   outOfSample:oos});
  if(liquid&&trending&&a/c.close<=0.1){
   const entry=round(c.close),stop=round(Math.max(0.01,c.close-2*a));
   const target=round(c.close+4*a);
   if(stop<entry&&target>entry){
    const item={ticker,session,currency,entry,stop,target,
      riskReward:round((target-entry)/(entry-stop),2),
      signal:'SMA20_ABOVE_SMA50_AND_CLOSE_ABOVE_SMA20',
      source:'DATED_VERIFIED_SAME_SESSION_HISTORY',evidenceLevel,
      // Close is an indicative reference, not a fill. Earliest simulated entry is
      // the NEXT verified session open, subject to a <=0.5 ATR opening gap.
      entryBasis:'DATED_CLOSE_INDICATIVE_NOT_EXECUTED',
      earliestEntry:'NEXT_VERIFIED_SESSION_OPEN',expiresAfterSessions:1,
      maxEntryGapAtr:0.5,maxHoldSessions:10,riskPerTradePct:0.005,
      maxPositionPct:0.10,costBpsEachSide:25,
      outOfSampleStatus:oos.status,performanceCertified:false,
      state:'RESEARCH_ONLY_NO_EXECUTION'};
    result.researchWatchlist.push(item);
    if(aggregateReady&&accepted.has(ticker))
     result.watchlist.push({...item,state:'CANDIDATE_NOT_EXECUTED'});
   }
  }
 }
 result.datedPriceObservations.sort((a,b)=>a.ticker.localeCompare(b.ticker));
 result.verifiedCandidates.sort((a,b)=>a.ticker.localeCompare(b.ticker));
 result.researchWatchlist.sort((a,b)=>a.ticker.localeCompare(b.ticker));
 result.watchlist.sort((a,b)=>a.ticker.localeCompare(b.ticker));
 result.status=aggregateReady?'RESEARCH_READY_PAPER_VALIDATION_REQUIRED':
   (result.verifiedCandidates.length||result.datedPriceObservations.length)?'RESEARCH_ONLY_PRICE_GATE_BLOCKED':'BLOCKED';
 result.blockers.push('NO_INDEPENDENT_OUT_OF_SAMPLE_PERFORMANCE_CERTIFICATION');
 // No execution-grade recommendations until forward/paper validation exists.
 return result;
}
function main(){
 const price=read('data/stable/v15-price-truth.json');
 // Astra G22 is informational for independent research, never a required input.
 // Missing or malformed handoff must not disable valid, dated paper-only research.
 let handoff=null;
 try{handoff=read('data/ops/g22-main-app-handoff.json')}
 catch(e){if(e?.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
 const symbols=read('data/symbol-map.json');
 const output=evaluate({price,handoff,symbols,session:day(price.expectedSession),
  loadHistory:t=>read('data/history/'+t+'.json')});
 const out=path.join(ROOT,'unified-console/independent-paper.json');
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(output,null,2)+'\n');
 console.log('EGX_INDEPENDENT_PAPER '+JSON.stringify({status:output.status,blockers:output.blockers,watch:output.watchlist.length,research:output.researchWatchlist.length,candidates:output.verifiedCandidates.length,datedPrices:output.datedPriceObservations.length}));
}
if(require.main===module)main();
module.exports={evaluate,validBar,historicalBarValid,currentEvidenceValid,atr};
