#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../src/hash.js';
import { buildResearchFeatureRecord,buildDescriptiveLeaderboards } from '../src/research-feature-engine.js';

const root=path.resolve(process.env.RESEARCH_DATA_ROOT||'data/research');
const livePath=path.join(root,'live','latest.json');
const indexPath=path.join(root,'history-index.json');
if(!fs.existsSync(livePath)||!fs.existsSync(indexPath))throw new Error('RESEARCH_FEATURE_INPUTS_MISSING');
const live=JSON.parse(fs.readFileSync(livePath,'utf8'));
const index=JSON.parse(fs.readFileSync(indexPath,'utf8'));
if(live.authorityMode!=='RESEARCH'||live.researchOnly!==true||live.productionAuthority!==false)throw new Error('RESEARCH_LIVE_AUTHORITY_BOUNDARY_FAILED');
if(index.authorityMode!=='RESEARCH'||index.researchOnly!==true||index.productionAuthority!==false)throw new Error('RESEARCH_HISTORY_AUTHORITY_BOUNDARY_FAILED');
const signalSession=String(live.expectedSession||live.targetSession||'');
if(!/^\d{4}-\d{2}-\d{2}$/.test(signalSession))throw new Error('RESEARCH_FEATURE_SESSION_MISSING');
const decisionCutoff=String(live.generatedAt||new Date().toISOString());
const minPriorSessions=Math.max(20,Number(process.env.RESEARCH_FEATURE_MIN_PRIOR_SESSIONS||60));
const minFeatureCoveragePct=Number(process.env.RESEARCH_FEATURE_MIN_COVERAGE_PCT||70);
const corporateActionJumpPct=Number(process.env.RESEARCH_CA_JUMP_REVIEW_PCT||20.5);
const currentByTicker=new Map((live.records??[]).map(r=>[String(r.ticker).toUpperCase(),r]));
const records=[];
for(const item of index.records??[]){
  const ticker=String(item.ticker||'').toUpperCase();
  if(!ticker)continue;
  const currentRecord=currentByTicker.get(ticker)??null;
  const historyPath=path.join(root,'history',`${ticker}.json`);
  if(!fs.existsSync(historyPath)){
    records.push({ticker,state:'SOURCE_UNAVAILABLE',featureReady:false,reasons:['HISTORY_FILE_MISSING'],signalSession,authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,strategyAuthorized:false,recommendationAuthorized:false});
    continue;
  }
  const history=JSON.parse(fs.readFileSync(historyPath,'utf8'));
  const feature=buildResearchFeatureRecord({ticker,history,currentRecord,signalSession,decisionCutoff,minPriorSessions,corporateActionJumpPct});
  records.push({...feature,companyNameAr:history.companyNameAr??null,companyNameEn:history.companyNameEn??null,historyDatasetHash:item.datasetHash??null,currentResearchRowHash:currentRecord?.authoritativeResearch?.rowHash??null});
}
records.sort((a,b)=>a.ticker.localeCompare(b.ticker));
const counts={universe:records.length,currentSessionReady:records.filter(r=>currentByTicker.get(r.ticker)?.state==='READY_RESEARCH').length,featureReady:records.filter(r=>r.featureReady===true).length,insufficientHistory:records.filter(r=>r.state==='INSUFFICIENT_HISTORY').length,corporateActionReview:records.filter(r=>r.state==='CORPORATE_ACTION_REVIEW').length,sourceUnavailable:records.filter(r=>r.state==='SOURCE_UNAVAILABLE').length,blocked:records.filter(r=>r.state==='BLOCKED').length};
counts.featureCoveragePct=counts.currentSessionReady?Number((counts.featureReady/counts.currentSessionReady*100).toFixed(2)):0;
counts.universeFeatureCoveragePct=counts.universe?Number((counts.featureReady/counts.universe*100).toFixed(2)):0;
const reasons=[];
if(live.researchDataReadiness!=='PASS')reasons.push(`RESEARCH_DATA_READINESS:${live.researchDataReadiness}`);
if(counts.featureCoveragePct<minFeatureCoveragePct)reasons.push(`FEATURE_COVERAGE:${counts.featureCoveragePct}<${minFeatureCoveragePct}`);
if(!counts.featureReady)reasons.push('NO_FEATURE_READY_SYMBOLS');
const featureReadiness=reasons.length?'FAIL':'PASS';
const leaderboards=featureReadiness==='PASS'?buildDescriptiveLeaderboards(records,{limit:Number(process.env.RESEARCH_LEADERBOARD_LIMIT||10)}):{combinedOpportunityScore:null,rankingAuthority:'DESCRIPTIVE_ONLY_NOT_STRATEGY',momentum20:[],relativeVolume20:[],liquidity20:[],lowestAtrPct:[]};
const stable={schemaVersion:'egx-one-research-feature-snapshot-1',authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,signalSession,decisionCutoff,parentResearchSnapshotHash:live.snapshotHash??null,historyIndexHash:index.indexHash??null,featureReadiness,featureReadinessReasons:reasons,counts,policy:{minPriorSessions,minFeatureCoveragePct,corporateActionJumpPct,combinedOpportunityScoreForbidden:true},phaseBoundary:{researchFeaturesAuthorized:featureReadiness==='PASS',researchStrategyAuthorized:false,productionPhase4Authorized:false,recommendationAuthorized:false,reason:'PRODUCTION_PHASE3_NOT_AUTHORIZED'},descriptiveLeaderboards:leaderboards,records};
const snapshot={...stable,snapshotHash:sha256(stable),generatedAt:new Date().toISOString()};
const outDir=path.join(root,'features','sessions');fs.mkdirSync(outDir,{recursive:true});
fs.writeFileSync(path.join(root,'features','latest.json'),JSON.stringify(snapshot,null,2)+'\n');
fs.writeFileSync(path.join(outDir,`${signalSession}.json`),JSON.stringify(snapshot,null,2)+'\n');
console.log(JSON.stringify({featureReadiness,reasons,counts,snapshotHash:snapshot.snapshotHash,phaseBoundary:snapshot.phaseBoundary,descriptiveLeaderboards:snapshot.descriptiveLeaderboards},null,2));
