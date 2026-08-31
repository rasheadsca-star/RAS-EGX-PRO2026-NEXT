#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../src/hash.js';
import { fetchYahooResearch,fetchMubasherResearch } from '../src/research-live-adapters.js';
import { importLegacyMarketSnapshot } from '../src/research-legacy-market-import.js';
import { resolveResearchCurrentSession,evaluateResearchDataReadiness } from '../src/research-current-session.js';

const root=path.resolve(process.env.RESEARCH_DATA_ROOT||'data/research');
const index=JSON.parse(fs.readFileSync(path.join(root,'history-index.json'),'utf8'));
if(index.authorityMode!=='RESEARCH'||index.productionAuthority!==false)throw new Error('RESEARCH_INDEX_AUTHORITY_BOUNDARY_FAILED');
const status=fs.existsSync('status.json')?JSON.parse(fs.readFileSync('status.json','utf8')):{};
const expectedSession=String(process.env.RESEARCH_EXPECTED_SESSION||status.marketSession||'').slice(0,10);
if(!/^\d{4}-\d{2}-\d{2}$/.test(expectedSession))throw new Error('RESEARCH_EXPECTED_SESSION_REQUIRED');
const concurrency=Math.max(1,Math.min(Number(process.env.RESEARCH_REFRESH_CONCURRENCY||6),12));
const timeoutMs=Math.max(5000,Number(process.env.RESEARCH_SOURCE_TIMEOUT_MS||16000));
const maxCloseConflictPct=Number(process.env.RESEARCH_CLOSE_CONFLICT_PCT||1);
const maxVolumeConflictPct=Number(process.env.RESEARCH_VOLUME_CONFLICT_PCT||20);
const tickers=index.records.map(x=>x.ticker);

const legacyMarketPath=process.env.LEGACY_MARKET_SNAPSHOT_PATH?path.resolve(process.env.LEGACY_MARKET_SNAPSHOT_PATH):null;
let legacyMarket={state:'SOURCE_UNAVAILABLE',reasons:['LEGACY_MARKET_SNAPSHOT_NOT_CONFIGURED'],manifest:null,observations:[]};
if(legacyMarketPath&&fs.existsSync(legacyMarketPath)){
  const raw=fs.readFileSync(legacyMarketPath),snapshot=JSON.parse(raw.toString('utf8'));
  legacyMarket=importLegacyMarketSnapshot(snapshot,{legacyCommit:process.env.LEGACY_MARKET_COMMIT,sourceFileHash:sha256(raw),expectedSession,importedAt:new Date().toISOString()});
}
const legacyByTicker=new Map(legacyMarket.observations.map(x=>[x.ticker,x]));

async function mapLimit(items,limit,fn){const out=new Array(items.length);let cursor=0;async function worker(){while(true){const i=cursor++;if(i>=items.length)return;try{out[i]=await fn(items[i],i)}catch(error){out[i]={ticker:items[i],state:'SOURCE_UNAVAILABLE',reasons:[`UNHANDLED_REFRESH_ERROR:${error.message}`],authoritativeResearch:null}}}}await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));return out}

const records=await mapLimit(tickers,concurrency,async(t)=>{
  const [yahoo,mubasher]=await Promise.all([fetchYahooResearch(t,{range:'1mo',timeoutMs}),fetchMubasherResearch(t,{timeoutMs})]);
  const yLatest=yahoo?.sessions?.at(-1)??null,mObs=mubasher?.observation??null,legacy=legacyByTicker.get(t)??null;
  const rec=resolveResearchCurrentSession({ticker:t,expectedSession,observations:[yLatest,mObs,legacy],maxCloseConflictPct,maxVolumeConflictPct});
  return{ticker:t,state:rec.state,expectedSession,reasons:[...new Set([...(yahoo?.reasons??[]),...(mubasher?.reasons??[]),...(rec.reasons??[])])].sort(),authoritativeResearch:rec.authoritativeResearch??null,sourceStatus:{yahoo:yahoo?.state??'SOURCE_UNAVAILABLE',mubasher:mubasher?.state??'SOURCE_UNAVAILABLE',legacyMarket:legacy?legacy.researchState:'SOURCE_UNAVAILABLE'},evidenceSummary:{yahooSession:yLatest?.session??null,mubasherSession:mObs?.session??null,legacyMarketSession:legacy?.session??null,yahooRowHash:yLatest?.rowHash??null,mubasherRowHash:mObs?.rowHash??null,legacyMarketRowHash:legacy?.rowHash??null,independentProviderCount:rec.evidence?.independent?.length??0,comparisons:rec.evidence?.comparisons??[]}};
});
records.sort((a,b)=>a.ticker.localeCompare(b.ticker));

const readiness=evaluateResearchDataReadiness({expectedSession,universeSize:tickers.length,records,minCoveragePct:Number(process.env.RESEARCH_MIN_COVERAGE_PCT||70),maxConflictPct:Number(process.env.RESEARCH_MAX_CONFLICT_PCT||10)});
const counts={universe:tickers.length,totalRecords:records.length,yahooReady:records.filter(r=>r.sourceStatus.yahoo==='READY').length,mubasherReady:records.filter(r=>r.sourceStatus.mubasher==='READY').length,legacyMarketImported:legacyMarket.observations.length,legacyMarketExpectedSession:legacyMarket.observations.filter(x=>x.session===expectedSession).length,readyResearch:records.filter(r=>r.state==='READY_RESEARCH').length,dataConflict:records.filter(r=>r.state==='DATA_CONFLICT').length,staleResearch:records.filter(r=>r.state==='STALE_RESEARCH').length,sourceUnavailable:records.filter(r=>r.state==='SOURCE_UNAVAILABLE').length,expectedSession,currentSessionRows:readiness.counts.currentRows,currentSessionReady:readiness.counts.ready,currentSessionConflicts:readiness.counts.conflicts,currentSessionCoveragePct:readiness.counts.coveragePct,currentSessionProviderCoverage:readiness.counts.providers};
const stable={schemaVersion:'egx-one-research-live-snapshot-2',authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,sourcePolicy:{currentSessionPriority:['MUBASHER_RESEARCH','LEGACY_MARKET_IMPORT','YAHOO_RESEARCH'],independentProviderRule:'providerGroup must differ',maxCloseConflictPct,maxVolumeConflictPct},historyIndexHash:index.indexHash,expectedSession,targetSession:expectedSession,researchDataReadiness:readiness.state,readinessReasons:readiness.reasons,readiness,legacyMarketManifest:legacyMarket.manifest,counts,records};
const snapshot={...stable,snapshotHash:sha256(stable),generatedAt:new Date().toISOString()};
fs.mkdirSync(path.join(root,'live','sessions'),{recursive:true});
fs.writeFileSync(path.join(root,'live','latest.json'),JSON.stringify(snapshot,null,2)+'\n');
const current=records.filter(r=>r.authoritativeResearch?.session===expectedSession);
const sessionStable={schemaVersion:'egx-one-research-session-snapshot-2',authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,session:expectedSession,parentSnapshotHash:snapshot.snapshotHash,researchDataReadiness:readiness.state,readinessReasons:readiness.reasons,records:current};const sessionSnapshot={...sessionStable,snapshotHash:sha256(sessionStable),generatedAt:snapshot.generatedAt};fs.writeFileSync(path.join(root,'live','sessions',`${expectedSession}.json`),JSON.stringify(sessionSnapshot,null,2)+'\n');
console.log(JSON.stringify({researchDataReadiness:readiness.state,readinessReasons:readiness.reasons,counts,snapshotHash:snapshot.snapshotHash,legacyMarketManifest:legacyMarket.manifest?{legacyCommit:legacyMarket.manifest.legacyCommit,counts:legacyMarket.manifest.counts,manifestHash:legacyMarket.manifest.manifestHash}:null},null,2));
if(readiness.counts.coveragePct<40)process.exitCode=2;
