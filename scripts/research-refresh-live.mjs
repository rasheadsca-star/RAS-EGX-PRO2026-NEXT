#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../src/hash.js';
import { fetchYahooResearch,fetchMubasherResearch,reconcileResearchObservations } from '../src/research-live-adapters.js';

const root=path.resolve(process.env.RESEARCH_DATA_ROOT||'data/research');
const index=JSON.parse(fs.readFileSync(path.join(root,'history-index.json'),'utf8'));
if(index.authorityMode!=='RESEARCH'||index.productionAuthority!==false)throw new Error('RESEARCH_INDEX_AUTHORITY_BOUNDARY_FAILED');
const concurrency=Math.max(1,Math.min(Number(process.env.RESEARCH_REFRESH_CONCURRENCY||6),12));
const timeoutMs=Math.max(5000,Number(process.env.RESEARCH_SOURCE_TIMEOUT_MS||16000));
const maxCloseConflictPct=Number(process.env.RESEARCH_CLOSE_CONFLICT_PCT||1);
const maxVolumeConflictPct=Number(process.env.RESEARCH_VOLUME_CONFLICT_PCT||20);
const tickers=index.records.map(x=>x.ticker);

async function mapLimit(items,limit,fn){const out=new Array(items.length);let cursor=0;async function worker(){while(true){const i=cursor++;if(i>=items.length)return;try{out[i]=await fn(items[i],i)}catch(error){out[i]={ticker:items[i],state:'SOURCE_UNAVAILABLE',reasons:[`UNHANDLED_REFRESH_ERROR:${error.message}`]}}}}await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));return out}

const records=await mapLimit(tickers,concurrency,async(t)=>{
  const [yahoo,mubasher]=await Promise.all([fetchYahooResearch(t,{range:'1mo',timeoutMs}),fetchMubasherResearch(t,{timeoutMs})]);
  const yLatest=yahoo?.sessions?.at(-1)??null,mObs=mubasher?.observation??null;
  const rec=reconcileResearchObservations({ticker:t,yahooObservation:yLatest,mubasherObservation:mObs,maxCloseConflictPct,maxVolumeConflictPct});
  return{ticker:t,state:rec.state,session:rec.session??null,reasons:[...new Set([...(yahoo?.reasons??[]),...(mubasher?.reasons??[]),...(rec.reasons??[])])].sort(),authoritativeResearch:rec.authoritativeResearch??null,sourceStatus:{yahoo:yahoo?.state??'SOURCE_UNAVAILABLE',mubasher:mubasher?.state??'SOURCE_UNAVAILABLE'},evidenceSummary:{yahooSession:yLatest?.session??null,mubasherSession:mObs?.session??null,yahooRowHash:yLatest?.rowHash??null,mubasherRowHash:mObs?.rowHash??null,closeConflictPct:rec.evidence?.comparisons?.closeConflictPct??null,volumeConflictPct:rec.evidence?.comparisons?.volumeConflictPct??null}};
});
records.sort((a,b)=>a.ticker.localeCompare(b.ticker));

const sessionCounts={};for(const r of records)if(r.session)sessionCounts[r.session]=(sessionCounts[r.session]||0)+1;
const targetSession=Object.entries(sessionCounts).sort((a,b)=>b[1]-a[1]||b[0].localeCompare(a[0]))[0]?.[0]??null;
const current=records.filter(r=>r.session===targetSession),readyCurrent=current.filter(r=>r.state==='READY_RESEARCH'),conflictCurrent=current.filter(r=>r.state==='DATA_CONFLICT');
const coveragePct=tickers.length?readyCurrent.length/tickers.length*100:0;
const crosschecked=readyCurrent.filter(r=>r.authoritativeResearch?.verificationState==='YAHOO_MUBASHER_CROSSCHECK').length;
const singleSource=readyCurrent.length-crosschecked;
const readinessReasons=[];if(!targetSession)readinessReasons.push('NO_DOMINANT_MARKET_SESSION');if(coveragePct<70)readinessReasons.push(`CURRENT_SESSION_COVERAGE_BELOW_70:${coveragePct.toFixed(2)}%`);if(conflictCurrent.length>Math.max(5,Math.floor(tickers.length*.1)))readinessReasons.push(`CURRENT_SESSION_CONFLICTS_EXCESSIVE:${conflictCurrent.length}`);
const researchDataReadiness=readinessReasons.length?'FAIL':'PASS';
const counts={universe:tickers.length,totalRecords:records.length,yahooReady:records.filter(r=>r.sourceStatus.yahoo==='READY').length,mubasherReady:records.filter(r=>r.sourceStatus.mubasher==='READY').length,readyResearch:records.filter(r=>r.state==='READY_RESEARCH').length,dataConflict:records.filter(r=>r.state==='DATA_CONFLICT').length,sourceUnavailable:records.filter(r=>r.state==='SOURCE_UNAVAILABLE').length,targetSession,currentSessionRows:current.length,currentSessionReady:readyCurrent.length,currentSessionConflicts:conflictCurrent.length,currentSessionCrosschecked:crosschecked,currentSessionSingleSource:singleSource,currentSessionCoveragePct:Number(coveragePct.toFixed(2))};
const stable={schemaVersion:'egx-one-research-live-snapshot-1',authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,sourcePolicy:{primary:'YAHOO_RESEARCH',crossCheck:'MUBASHER_RESEARCH',maxCloseConflictPct,maxVolumeConflictPct},historyIndexHash:index.indexHash,targetSession,researchDataReadiness,readinessReasons,counts,sessionCounts,records};
const snapshot={...stable,snapshotHash:sha256(stable),generatedAt:new Date().toISOString()};
fs.mkdirSync(path.join(root,'live','sessions'),{recursive:true});
fs.writeFileSync(path.join(root,'live','latest.json'),JSON.stringify(snapshot,null,2)+'\n');
if(targetSession){const sessionStable={schemaVersion:'egx-one-research-session-snapshot-1',authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,session:targetSession,parentSnapshotHash:snapshot.snapshotHash,records:current};const sessionSnapshot={...sessionStable,snapshotHash:sha256(sessionStable),generatedAt:snapshot.generatedAt};fs.writeFileSync(path.join(root,'live','sessions',`${targetSession}.json`),JSON.stringify(sessionSnapshot,null,2)+'\n')}
console.log(JSON.stringify({researchDataReadiness,readinessReasons,counts,snapshotHash:snapshot.snapshotHash},null,2));
if(!targetSession||coveragePct<40)process.exitCode=2;
