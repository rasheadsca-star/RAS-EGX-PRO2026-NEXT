#!/usr/bin/env node
'use strict';
// Independent, fail-closed historic OHLCV inventory. Outputs are RESEARCH ONLY.
// No writes to data/history, stable, Astra, decision snapshots, or paper ledgers.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {focusFromPersistent}=require('./egx-recovery-focus.cjs');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const OUT=path.resolve(process.env.EGX_RECOVERY_OUT||path.join(ROOT,'artifacts/history-recovery'));
const asDate=x=>{const s=String(x||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s?s:null};
const num=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const ticker=x=>String(x||'').trim().toUpperCase().replace(/[^A-Z0-9._-]/g,'');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function read(f,fallback){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){if(fallback!==undefined)return fallback;throw e}}
function valid(row,expected,cutoff){
 const date=asDate(row.date||row.sessionDate);
 const o=num(row.open),h=num(row.high),l=num(row.low),c=num(row.close),v=num(row.volume);
 if(!date||date>cutoff||!(o>0&&h>0&&l>0&&c>0&&h>=Math.max(o,c)&&l<=Math.min(o,c)))return null;
 if(v===null||v<0||!Number.isInteger(v))return null;
 if(row.ticker&&ticker(row.ticker)!==expected)return null;
 return {date,open:o,high:h,low:l,close:c,volume:v};
}
function sources(root=ROOT){
 return [
  {id:'main',dir:path.join(root,'data/history'),trust:'CURRENT_ARCHIVE_NOT_AUTOMATICALLY_OFFICIAL'},
  {id:'legacy_pro2026',dir:path.join(root,'sources/legacy-ras-egx-pro2026/data/history'),trust:'LEGACY_SINGLE_SOURCE_RESEARCH'},
  {id:'legacy_egx01',dir:path.join(root,'sources/legacy-ras-egx01/data/history'),trust:'LEGACY_RESEARCH'},
  {id:'v17_long',dir:path.join(root,'data/v17/historical-recovery/history'),trust:'YAHOO_UNCERTIFIED_ACTIONS'},
  {id:'v17_long_checked_out',dir:path.join(root,'sources/legacy-v17-long/data/v17/historical-recovery/history'),trust:'YAHOO_UNCERTIFIED_ACTIONS'}
 ];
}
function inventory({root=ROOT,out=OUT,cutoff,extraSources=[]}={}){
 const truth=read(path.join(root,'data/stable/v15-price-truth.json'),{});
 const historySummary=read(path.join(root,'data/history-summary.json'),{});
 const rawSymbols=read(path.join(root,'data/symbol-map.json'),{});
 const expected=asDate(cutoff||truth.expectedSession);
 if(!expected)throw Error('Expected session missing: fail closed');
 const all=new Map(),scanned=[],blocked=[];
 for(const source of [...sources(root),...extraSources]){
  if(!fs.existsSync(source.dir)) {scanned.push({id:source.id,available:false,files:0,valid:0,rejected:0});continue}
  let validCount=0,rejected=0,files=0,identityRejected=0;
  for(const file of fs.readdirSync(source.dir).filter(x=>/^[A-Za-z0-9._-]+\.json$/.test(x)).sort()){
   files++;
   const t=ticker(file.slice(0,-5)),doc=read(path.join(source.dir,file),null);
   const match=Array.isArray(rawSymbols)?rawSymbols.find(x=>ticker(x?.ticker)===t):rawSymbols[t];
   const expectedCurrency=String(match?.currency||'EGP').toUpperCase();
   if(!doc||ticker(doc.ticker)!==t||doc.exchange&&String(doc.exchange).toUpperCase()!=='EGX'||doc.currency&&String(doc.currency).toUpperCase()!==expectedCurrency){
    identityRejected++;blocked.push({ticker:t,source:source.id,reason:'FILE_IDENTITY_EXCHANGE_OR_CURRENCY_CONFLICT'});continue
   }
   const rows=Array.isArray(doc.sessions)?doc.sessions:[];
   if(!all.has(t))all.set(t,{ticker:t,documents:[],dates:new Map()});
   const stock=all.get(t);
   stock.documents.push({source:source.id,verified:doc.symbolVerified===true,sessionCount:rows.length,isin:doc.isin||null,sourceSymbol:doc.yahooSymbol||null});
   for(const raw of rows){
    const v=valid(raw,t,expected);
    if(!v){rejected++;continue}
    validCount++;
    const item={...v,ticker:t,source:source.id,sourceTrust:source.trust,
      identityVerified:doc.symbolVerified===true,originalPrimarySource:raw.primarySource||doc.primarySource||null,
      originalSessionProvenance:raw.sourceSessionEvidence||null,
      sourceUrl:raw.sourceUrls?.primary||null,hash:sha([v.date,v.open,v.high,v.low,v.close,v.volume])};
    if(!stock.dates.has(v.date))stock.dates.set(v.date,[]);
    stock.dates.get(v.date).push(item);
   }
  }
  scanned.push({id:source.id,available:true,files,valid:validCount,rejected,identityRejected,readOnly:true});
 }
 if(!scanned[0]?.available||scanned[0].files===0)throw Error('Main archive absent: fail closed');
 const focusItems=focusFromPersistent({truth,historySummary,symbolMap:rawSymbols,expectedSession:expected});
 const focus=focusItems.map(x=>x.ticker);
 const focusReasonBy=new Map(focusItems.map(x=>[x.ticker,x.reasons]));
 let overlapDates=0,conflictDates=0,researchCandidates=0,mainSymbols=0;
 const conflicts=[],candidates=[],symbolStats=[],focusRecords=[];
 for(const stock of [...all.values()].sort((a,b)=>a.ticker.localeCompare(b.ticker))){
  const ids=stock.documents.map(d=>d.isin).filter(Boolean);
  const identityConflict=new Set(ids).size>1;
  if(identityConflict)blocked.push({ticker:stock.ticker,reason:'ISIN_CONFLICT_ACROSS_ARCHIVES',isinValues:[...new Set(ids)]});
  const mainDates=new Set(),legacyDates=new Set();
  let tickerConflicts=0,tickerCandidates=0,matchingDates=0;
  for(const [date,rows] of [...stock.dates.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
   const mains=rows.filter(x=>x.source==='main'),legacy=rows.filter(x=>x.source!=='main');
   if(mains.length)mainDates.add(date);
   if(legacy.length)legacyDates.add(date);
   if(mains.length&&legacy.length){
    overlapDates++;const baseline=mains[0];
    const mismatched=legacy.filter(x=>x.hash!==baseline.hash&&Math.abs(x.close/baseline.close-1)>.005);
    if(mismatched.length){
     tickerConflicts++;conflictDates++;
     conflicts.push({ticker:stock.ticker,date,classification:'CROSS_SOURCE_PRICE_CONFLICT',main:{close:baseline.close,source:baseline.originalPrimarySource,hash:baseline.hash},
       older:mismatched.map(x=>({source:x.source,close:x.close,sourceUrl:x.sourceUrl,hash:x.hash})),action:'QUARANTINE_NO_OVERWRITE'});
    }else matchingDates++;
   }
   if(!mains.length&&legacy.length){
    const verified=legacy.filter(x=>x.identityVerified&&!identityConflict);
    if(verified.length){
     tickerCandidates++;researchCandidates++;
     const chosen=verified[0];
     candidates.push({ticker:stock.ticker,date,open:chosen.open,high:chosen.high,low:chosen.low,close:chosen.close,volume:chosen.volume,
       source:chosen.source,sourceTrust:chosen.sourceTrust,sourceUrl:chosen.sourceUrl,rowHash:chosen.hash,
       status:'HISTORICAL_GAP_CANDIDATE_ONLY',promotionApproved:false,
       requiredChecks:['POINT_IN_TIME_IDENTITY','SESSION_EVIDENCE','CORPORATE_ACTION_AND_SPLIT','SECOND_SOURCE_PARITY']});
    }else{
     blocked.push({ticker:stock.ticker,date,reason:'NO_VERIFIED_HISTORIC_SYMBOL_IDENTITY',sources:legacy.map(x=>x.source)});
    }
   }
  }
  if(mainDates.size)mainSymbols++;
  const latestMain=[...mainDates].sort().at(-1)||null;
  const latestAny=[...stock.dates.keys()].sort().at(-1)||null;
  const stat={ticker:stock.ticker,mainSessionCount:mainDates.size,legacyOnlySessions:tickerCandidates,matchingCrossSourceDates:matchingDates,
   conflictDates:tickerConflicts,latestMain,latestAvailable:latestAny,mainHasExpected:mainDates.has(expected),sourceIds:stock.documents.map(x=>x.source),
   identityConflict};
  symbolStats.push(stat);
  if(focus.includes(stock.ticker))focusRecords.push({...stat,expectedSession:expected,
    currentSessionGap:!mainDates.has(expected),legacyHasExpected:legacyDates.has(expected),
    status:mainDates.has(expected)?'MAIN_ALREADY_HAS_SESSION':legacyDates.has(expected)?'UNVERIFIED_HISTORIC_ALTERNATIVE':'CURRENT_SESSION_NOT_RECOVERED'});
 }
 for(const t of focus.filter(t=>!all.has(t)))focusRecords.push({ticker:t,expectedSession:expected,status:'NOT_FOUND_IN_ANY_SCANNED_ARCHIVE'});
 const mapped=Array.isArray(rawSymbols)?rawSymbols:Object.values(rawSymbols);
 const mapByTicker=new Map(mapped.filter(x=>x?.ticker).map(x=>[ticker(x.ticker),x]));
 const summaryByTicker=new Map((historySummary.symbols||[]).filter(x=>x?.ticker).map(x=>[ticker(x.ticker),x]));
 for(const item of focusRecords){
   const h=summaryByTicker.get(item.ticker)||{},identity=mapByTicker.get(item.ticker)||{};
   const error=String(h.lastUpdateError||'');
   item.focusReasons=focusReasonBy.get(item.ticker)||[];
   item.sourceTriage={
     mappedActive:identity.active===false?false:identity.active===true?true:null,
     historicalSessions:Number(h.availableSessions||0),
     historicalLastSession:h.lastSession||null,
     identityVerified:h.symbolVerified===true,
     failureCode:error.includes('HTTP 404')?'YAHOO_SYMBOL_HTTP_404':error?'SOURCE_RETRIEVAL_FAILED':'NO_SOURCE_ERROR_RECORDED',
     action:'VERIFY_EXCHANGE_LISTING_AND_SECURITY_IDENTITY_THEN_FETCH_OFFICIAL_OR_LICENSED_DATED_OHLCV',
     autoPromote:false
   };
 }
 const conflictTickerSet=new Set(conflicts.map(x=>x.ticker));
 for(const candidate of candidates)candidate.reviewBucket=conflictTickerSet.has(candidate.ticker)?'HOLD_CROSS_SOURCE_PRICE_CONFLICT':'GAP_NEEDS_INDEPENDENT_PARITY';
 const legacyCandidateConflicted=candidates.filter(x=>x.reviewBucket==='HOLD_CROSS_SOURCE_PRICE_CONFLICT').length;
 const report={schemaVersion:'egx-independent-history-recovery-1',generatedAt:new Date().toISOString(),
   expectedSession:expected,mode:'RESEARCH_STAGING_ONLY',noAutomaticPromotion:true,
   sources:scanned,summary:{archiveSymbols:all.size,mainSymbols,missingLatestSourceFocus:focus.length,focusWithLegacyExpected:focusRecords.filter(x=>x.legacyHasExpected).length,
     focusYahoo404:focusRecords.filter(x=>x.sourceTriage?.failureCode==='YAHOO_SYMBOL_HTTP_404').length,
     focusNoHistory:focusRecords.filter(x=>x.focusReasons?.includes('NO_HISTORIC_BARS')).length,
     focusStaleCurrent:focusRecords.filter(x=>x.focusReasons?.includes('EXPECTED_SESSION_HISTORY_GAP')).length,
     overlapDates,conflictDates,conflictAffectedSymbols:conflictTickerSet.size,researchCandidates,
     candidateRowsInConflictSymbols:legacyCandidateConflicted,priorityCandidatesWithoutObservedConflict:researchCandidates-legacyCandidateConflicted,blockedRecords:blocked.length},
   focus:focusRecords,stockCoverage:symbolStats,conflictExamples:conflicts.slice(0,100)};
 const ledger={schemaVersion:'egx-independent-history-candidates-1',expectedSession:expected,productionEligible:false,
   rule:'No source overwrite, no auto-approval, old archives never confer current-session proof',
   candidates,conflicts,blocked};
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'inventory.json'),JSON.stringify(report,null,2)+'\n');
 fs.writeFileSync(path.join(out,'candidate-ledger.json'),JSON.stringify(ledger,null,2)+'\n');
 console.log('EGX_INDEPENDENT_HISTORY_RECOVERY',JSON.stringify({expectedSession:expected,...report.summary}));
 return {report,ledger};
}
if(require.main===module)inventory();
module.exports={inventory,valid,sources};
