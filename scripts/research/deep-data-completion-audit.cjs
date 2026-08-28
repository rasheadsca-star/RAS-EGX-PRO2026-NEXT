#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const DATA=path.join(ROOT,'data'),HIST=path.join(DATA,'history'),OUT=path.join(ROOT,'gann-fusion-x','data');
const {fetchTargetedTicker}=require('../history/adapters/starta-targeted-adapter.cjs');
const read=(p,d=null)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return d}};
const round=(n,d=2)=>Number.isFinite(Number(n))?Number(Number(n).toFixed(d)):null;
const median=a=>{const s=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!s.length)return null;const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2};
const pctRank=(v,arr)=>{const s=arr.filter(Number.isFinite).sort((a,b)=>a-b);if(!s.length||!Number.isFinite(v))return null;let below=0,equal=0;for(const x of s){if(x<v)below++;else if(x===v)equal++;}return round((below+0.5*equal)/s.length*100,1)};
const summary=read(path.join(DATA,'history-summary.json'),{});
const market=read(path.join(DATA,'quant','market-search-index-v13-17.json'),{});
const symbolMapRaw=read(path.join(DATA,'symbol-map.json'),{});
const symbolEntries=Array.isArray(symbolMapRaw)?symbolMapRaw:Object.values(symbolMapRaw||{});
const symbolMap=new Map(symbolEntries.map(x=>[String(x.ticker||'').toUpperCase(),x]));
const latest=summary.latestMarketSession||market.marketDate||market.analysisSession||null;
const stocks=Array.isArray(market.stocks)?market.stocks:[];
const summarySymbols=Array.isArray(summary.symbols)?summary.symbols:[];

function historyDoc(t){return read(path.join(HIST,`${t}.json`),null)}
function histLast(doc){return doc?.lastSession||doc?.sessions?.at(-1)?.date||null}
function lagDays(d){if(!latest||!d)return null;return Math.round((new Date(`${latest}T00:00:00Z`)-new Date(`${d}T00:00:00Z`))/86400000)}
function liquidityMetric(doc){const rows=(doc?.sessions||[]).slice(-20).filter(x=>Number(x.close)>0&&Number(x.volume)>=0);if(rows.length<10)return null;const turnovers=rows.map(x=>Number(x.close)*Number(x.volume)).filter(Number.isFinite);return median(turnovers)}
const histRows=[];
for(const s of summarySymbols){const ticker=String(s.ticker||'').toUpperCase(),doc=historyDoc(ticker),last=histLast(doc)||s.lastSession||null;histRows.push({ticker,companyNameAr:s.companyNameAr||null,companyNameEn:s.companyNameEn||null,processingStatus:s.processingStatus||null,historyStatus:s.historyStatus||null,symbolVerified:Boolean(s.symbolVerified),sessions:(doc?.sessions||[]).length||Number(s.availableSessions||0),lastSession:last,lagCalendarDays:lagDays(last),staleData:Boolean(s.staleData),failed:s.processingStatus==='failed'||!s.symbolVerified,primarySource:s.primarySource||null,lastUpdateError:s.lastUpdateError||null,liquidityMetric20:liquidityMetric(doc)});}
const liqUniverse=histRows.map(x=>x.liquidityMetric20).filter(Number.isFinite);
for(const r of histRows)r.derivedLiquidityPercentile=pctRank(r.liquidityMetric20,liqUniverse);

const marketGaps=stocks.map(s=>({ticker:String(s.ticker||'').toUpperCase(),historyAvailable:s.historyAvailable===true,priceMissing:!(Number(s.price)>0),turnoverMissing:!Number.isFinite(Number(s.turnover)),liquidityMissing:!Number.isFinite(Number(s.liquidityPercentile)),riskMissing:!Number.isFinite(Number(s.riskScore)),momentumMissing:!s.momentumMoneyFlow,nameArMissing:!String(s.companyNameAr||'').trim(),nameEnMissing:!String(s.companyNameEn||'').trim()}));
const derivedLiquidity=new Map(histRows.filter(x=>Number.isFinite(x.derivedLiquidityPercentile)).map(x=>[x.ticker,x.derivedLiquidityPercentile]));
const liquidityRecoverable=marketGaps.filter(x=>x.liquidityMissing&&derivedLiquidity.has(x.ticker)).map(x=>({ticker:x.ticker,derivedLiquidityPercentile:derivedLiquidity.get(x.ticker)}));

const failedOrStale=histRows.filter(x=>x.failed||x.staleData||(Number.isFinite(x.lagCalendarDays)&&x.lagCalendarDays>1));
const startaCfg=read(path.join(DATA,'history-targeted-seven-config.json'),{});
const LIVE=String(process.env.DEEP_DATA_LIVE_STARTA||'true').toLowerCase()==='true';
const LIMIT=Math.max(0,Number(process.env.DEEP_DATA_STARTA_LIMIT||60));
const starta=[];
if(LIVE){
  for(const row of failedOrStale.slice(0,LIMIT)){
    const ticker=row.ticker,map=symbolMap.get(ticker)||{},target={ticker,isin:map.isin||null,companyNameEn:row.companyNameEn||map.companyNameEn||null,companyNameAr:row.companyNameAr||map.companyNameAr||null,periodCandidates:['1y','2y','5y']};
    try{
      const f=await fetchTargetedTicker(ticker,map,target,{...startaCfg,periodCandidates:target.periodCandidates});
      const existing=historyDoc(ticker)?.sessions||[];
      const last=f.rows.at(-1)||null,first=f.rows[0]||null;
      const overlapDates=new Set(existing.map(x=>x.date));
      const overlap=f.rows.filter(x=>overlapDates.has(x.date));
      let closeDiffs=[];const oldBy=new Map(existing.map(x=>[x.date,x]));
      for(const x of overlap){const o=oldBy.get(x.date);if(Number(o?.close)>0&&Number(x.close)>0)closeDiffs.push(Math.abs(Number(o.close)-Number(x.close))/Number(o.close)*100)}
      const medDiff=median(closeDiffs);
      starta.push({ticker,status:'FETCHED',identityVerified:Boolean(f.identity?.verified),exactSymbol:Boolean(f.identity?.exactSymbol),exactIsin:Boolean(f.identity?.exactIsin),nameSimilarity:f.identity?.nameSimilarity??null,rows:f.rows.length,firstDate:first?.date||null,lastDate:last?.date||null,latestReached:last?.date===latest,overlapRows:overlap.length,medianOverlapCloseDiffPct:round(medDiff,3),sourceUrl:f.sourceUrl||null,warnings:f.identity?.warnings||[]});
    }catch(e){starta.push({ticker,status:'FAILED',error:String(e.message||e).slice(0,1200)});}
  }
}

const sepa=read(path.join(OUT,'sepa-x-snapshot.json'),{});
const verifiedRecords=Array.isArray(sepa?.verified?.records)?sepa.verified.records:[];
const sepaRows=Array.isArray(sepa.rows)?sepa.rows:[];
const report={schemaVersion:'egx-deep-data-completion-audit-v1',generatedAt:new Date().toISOString(),latestMarketSession:latest,repositorySnapshot:{historySummaryGeneratedAt:summary.generatedAt||null,marketIndexGeneratedAt:market.generatedAt||null,sepaGeneratedAt:sepa.generatedAt||null,sepaBootstrapCompact:Boolean(sepa.bootstrapCompact)},counts:{mappedSymbols:summary.symbolsTotal||summarySymbols.length,runtimeVerified:summary.symbolsRuntimeVerified||histRows.filter(x=>x.symbolVerified).length,historyFailed:histRows.filter(x=>x.failed).length,historyStaleFlag:histRows.filter(x=>x.staleData).length,strictLastSessionMismatch:histRows.filter(x=>x.lastSession&&x.lastSession!==latest).length,lagOver1CalendarDay:histRows.filter(x=>Number.isFinite(x.lagCalendarDays)&&x.lagCalendarDays>1).length,marketStocks:stocks.length,missingHistoryFlag:marketGaps.filter(x=>!x.historyAvailable).length,missingLiquidityPercentile:marketGaps.filter(x=>x.liquidityMissing).length,liquidityRecoverableFromOwnOHLCV:liquidityRecoverable.length,missingRiskScore:marketGaps.filter(x=>x.riskMissing).length,missingMomentum:marketGaps.filter(x=>x.momentumMissing).length,missingTurnover:marketGaps.filter(x=>x.turnoverMissing).length,missingPrice:marketGaps.filter(x=>x.priceMissing).length,sepaRows:sepaRows.length,sepaVerifiedRecords:verifiedRecords.length,startaAttempted:starta.length,startaFetched:starta.filter(x=>x.status==='FETCHED').length,startaIdentityVerified:starta.filter(x=>x.identityVerified).length,startaReachedLatest:starta.filter(x=>x.latestReached).length},historyProblemRows:failedOrStale,marketGapRows:marketGaps.filter(x=>!x.historyAvailable||x.liquidityMissing||x.riskMissing||x.momentumMissing||x.turnoverMissing||x.priceMissing||x.nameArMissing||x.nameEnMissing),liquidityRecoverable,startaDiagnostics:starta,guardrails:['No history file is modified by this audit.','Missing latest-session bar is not automatically treated as a zero-volume trading bar.','Derived liquidity percentile uses the stock own last-20-session median turnover and cross-sectional percentile; it is marked derived, not vendor supplied.','Starta data is candidate fallback evidence only until identity and second-source/overlap checks pass.','No production ranking or decision is changed by this audit.']};
fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'deep-data-completion-audit-v1.json'),JSON.stringify(report,null,2)+'\n');
let md=`# Deep Data Completion Audit V1\n\nGenerated: ${report.generatedAt}\n\nLatest market session: **${latest}**\n\n## Counts\n\n`;
for(const [k,v] of Object.entries(report.counts))md+=`- ${k}: **${v}**\n`;
md+='\n## Starta diagnostic candidates\n\n| Ticker | Status | Identity | Exact ISIN | Rows | Last | Reached latest | Overlap | Median close diff % |\n|---|---|---|---|---:|---|---|---:|---:|\n';
for(const x of starta)md+=`| ${x.ticker} | ${x.status} | ${x.identityVerified??''} | ${x.exactIsin??''} | ${x.rows??0} | ${x.lastDate??''} | ${x.latestReached??''} | ${x.overlapRows??0} | ${x.medianOverlapCloseDiffPct??''} |\n`;
md+=`\n## Liquidity recovery\n\nMissing vendor liquidity percentile: **${report.counts.missingLiquidityPercentile}**. Recoverable deterministically from existing OHLCV: **${liquidityRecoverable.length}**.\n\nThis is a research audit only; no production files were altered.\n`;
fs.writeFileSync(path.join(OUT,'deep-data-completion-audit-v1.md'),md);
console.log(JSON.stringify({latest,counts:report.counts,failedOrStale:failedOrStale.map(x=>({ticker:x.ticker,sessions:x.sessions,last:x.lastSession,lag:x.lagCalendarDays,failed:x.failed,stale:x.staleData})),starta:starta.map(x=>({ticker:x.ticker,status:x.status,identity:x.identityVerified,rows:x.rows,last:x.lastDate,latest:x.latestReached,overlap:x.overlapRows,diff:x.medianOverlapCloseDiffPct}))},null,2));
