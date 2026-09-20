'use strict';

const fs=require('fs');
const path=require('path');
const cp=require('child_process');
const crypto=require('crypto');
const {parseHistory,hash}=require('../../astra/data-health/g11-data-health.cjs');
let listStrategyIds,getStrategyDescriptor;
try{
  ({listStrategyIds,getStrategyDescriptor}=require('../../astra/strategies/strategy-registry.cjs'));
}catch(_){
  const {SPECS}=require('../../astra/strategies/g08-final-overlay.cjs');
  listStrategyIds=()=>Object.keys(SPECS);
  getStrategyDescriptor=id=>SPECS[String(id||'')]||null;
}
const P=require('../../astra/pipeline/g09-unified-decision-pipeline.cjs');

const ROOT=path.resolve(__dirname,'../..');
const OUT=path.join(ROOT,'deploy/g22-full-app/data.json');
const read=(p,d=null)=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'))}catch{return d}};
const finite=v=>Number.isFinite(Number(v))?Number(v):null;
const sha=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');

function runV16(session){
  const out=cp.execFileSync('python3',[path.join(ROOT,'astra/data-health/g11-v16-context.py'),'--session',session],{cwd:ROOT,encoding:'utf8',maxBuffer:96*1024*1024});
  return JSON.parse(out);
}
function detailMap(){
  const dir=path.join(ROOT,'data/quant/stocks'),m=new Map();
  if(!fs.existsSync(dir))return m;
  for(const f of fs.readdirSync(dir).filter(x=>x.endsWith('.json'))){
    const d=read(path.join('data/quant/stocks',f),null);
    if(d?.ticker)m.set(String(d.ticker).toUpperCase(),d);
  }
  return m;
}
function currentHistoryRow(ticker,session){
  const doc=read(`data/history/${ticker}.json`,null);
  const parsed=parseHistory(doc||{});
  const idx=parsed.validated.findIndex(x=>x.date===session);
  if(idx<0)return null;
  const cur=parsed.validated[idx],prev=idx>0?parsed.validated[idx-1]:null;
  if(!prev)return null;
  return{open:cur.open,high:cur.high,low:cur.low,close:cur.close,volume:cur.volume,previousClose:prev.close};
}
function assert(cond,msg){if(!cond)throw new Error(msg)}
function normalizedSnapshot(snapshot){
  const copy=JSON.parse(JSON.stringify(snapshot));
  delete copy.durationMs;
  return copy;
}

function main(){
  const persisted=read('docs/astra/G11_CURRENT_PIPELINE_RUN.json');
  const metrics=read('docs/astra/G11_DATA_HEALTH_METRICS.json');
  const issues=read('docs/astra/G11_DATA_HEALTH_ISSUES.json');
  const guard=read('docs/astra/G11_GUARD37_EVIDENCE.json');
  const g21=read('docs/astra/G21_CERTIFICATION.json');
  assert(persisted&&metrics&&issues&&guard&&g21,'G22 required certified inputs missing');
  assert(g21.status==='GREEN'&&g21.productionCutover===true,'G21 must be GREEN with production cutover true');

  const session=persisted.session;
  const v16=runV16(session);
  const details=detailMap();
  const pipelineRows=[];
  for(const model of v16.currentRows){
    const ticker=String(model.ticker).toUpperCase();
    const cur=currentHistoryRow(ticker,session);
    if(!cur)continue;
    const tech=v16.technicalByTicker[ticker];
    const d=details.get(ticker);
    const support=finite(d?.indicators?.support20),resistance=finite(d?.indicators?.resistance20);
    pipelineRows.push({
      snapshotId:`G11-CAN-${ticker}-${session}`,
      securityId:`EGX:${ticker}`,
      ticker,
      sessionDate:session,
      validationStatus:'VALID',
      migrationValidationStatus:'VALID',
      ohlc:{open:cur.open,high:cur.high,low:cur.low,close:cur.close,previousClose:cur.previousClose},
      volume:cur.volume,
      turnover:cur.close*cur.volume,
      technicalInputs:{
        return1Pct:tech.return1Pct,
        return5Pct:tech.return5Pct,
        return20Pct:tech.return20Pct,
        aboveSma20:tech.aboveSma20,
        aboveSma50:tech.aboveSma50,
        volatility20AnnualizedPct:tech.volatility20AnnualizedPct,
        relativeVolume20:tech.relativeVolume20
      },
      supportResistanceInputs:{asOfSessionDate:session,support,resistance}
    });
  }
  assert(pipelineRows.length===v16.currentRows.length,'G22 canonical rebuild row count mismatch');

  const context={
    sessionDate:session,
    canonicalSnapshot:{snapshotId:`G11-CURRENT-${session}-${hash(pipelineRows).slice(0,16)}`,sessionDate:session,rows:pipelineRows},
    historyIdentities:{source:'validation-approved data/history',latestSession:session},
    historyByTicker:{},
    modelGuardHistory:v16.modelGuardHistory,
    modelTrainingSessions:v16.trainingSessions,
    modelCurrentRows:v16.currentRows,
    capitalEgp:1000000,
    approvedStrategyVersions:{PORTFOLIO_BASKET_EQUAL_WEIGHT:getStrategyDescriptor('PORTFOLIO_BASKET_EQUAL_WEIGHT').sourceCommit},
    approvedConfig:{basketSize:3},
    requestedStrategyIds:listStrategyIds(),
    generatedAt:persisted.evaluatedAt,
    applicationVersion:'ASTRA_G11_SHADOW_CERTIFICATION',
    codeVersion:persisted.sourceHead
  };
  const result=P.runUnifiedDecisionPipeline(context);
  assert(result.ok,'G22 Astra pipeline rebuild failed');
  const snapshot=result.decisionSnapshot;
  assert(snapshot.decisionSnapshotId===persisted.decisionSnapshotId,`DecisionSnapshot ID mismatch ${snapshot.decisionSnapshotId} != ${persisted.decisionSnapshotId}`);
  assert(snapshot.semanticDecisionHash===persisted.semanticDecisionHash,'DecisionSnapshot semantic hash mismatch');
  assert((snapshot.top5||[]).length===persisted.opportunities,'Opportunity count mismatch');

  const repeat=P.runUnifiedDecisionPipeline(context);
  assert(repeat.ok,'G22 Astra repeat pipeline rebuild failed');
  assert(repeat.decisionSnapshot.decisionSnapshotId===snapshot.decisionSnapshotId,'Repeat DecisionSnapshot ID mismatch');
  assert(repeat.decisionSnapshot.semanticDecisionHash===snapshot.semanticDecisionHash,'Repeat semantic hash mismatch');
  const normalizedObjectHash=hash(normalizedSnapshot(snapshot));
  const repeatNormalizedObjectHash=hash(normalizedSnapshot(repeat.decisionSnapshot));
  assert(normalizedObjectHash===repeatNormalizedObjectHash,'Normalized DecisionSnapshot is not deterministic');
  const rebuiltObjectHash=hash(snapshot);
  const persistedObjectHash=persisted.decisionSnapshotObjectHash;

  const payload={
    schemaVersion:'astra-g22-ui-snapshot-1',
    generatedAt:new Date().toISOString(),
    sourceDecision:{
      certification:'G01-G21 GREEN',
      session,
      status:snapshot.status,
      decisionSnapshotId:snapshot.decisionSnapshotId,
      semanticDecisionHash:snapshot.semanticDecisionHash,
      persistedDecisionSnapshotObjectHash:persistedObjectHash,
      rebuiltDecisionSnapshotObjectHash:rebuiltObjectHash,
      normalizedRebuildHash:normalizedObjectHash,
      objectHashReproduced:rebuiltObjectHash===persistedObjectHash,
      objectHashVarianceReason:'Persisted object hash includes non-semantic runtime durationMs; semanticDecisionHash and decisionSnapshotId are the authoritative decision identity.',
      originalGeneratedAt:snapshot.generatedAt,
      originalProductionCutover:snapshot.productionCutover,
      currentProductionCutover:true,
      sourceHead:persisted.sourceHead
    },
    decisionSnapshot:snapshot,
    health:{
      evaluatedAt:metrics.evaluatedAt,
      latestExpectedSession:metrics.latestExpectedSession,
      latestAvailableSession:metrics.latestAvailableSession,
      freshness:metrics.sessionFreshnessStatus,
      activeUniverse:metrics.activeUniverse?.count,
      currentCanonical:metrics.currentCanonicalSecurities,
      decisionReady:metrics.decisionPipeline,
      supportResistance:metrics.supportResistance,
      searchReadiness:metrics.searchReadiness,
      criticalUnresolved:issues.criticalUnresolved,
      highUnresolved:issues.highProductionRelevantUnresolved??issues.highUnresolved,
      guardStatus:guard.status,
      guardSelfTests:guard.selfTests
    },
    uiPolicy:{
      currentDecisionTruth:'decisionSnapshot',
      topOpportunityLimit:5,
      actualOpportunityCount:(snapshot.top5||[]).length,
      noSyntheticRecommendations:true,
      noLegacyDecisionSource:true,
      marketSearchAuxiliary:'../../data/quant/market-search-index-v13-17.json',
      stockDisplayAuxiliary:'../../data/quant/stock-intelligence-index.json',
      recommendationHistoryAuxiliary:'../../data/rc2/recommendation-history.json',
      historyPathTemplate:'../../data/history/{TICKER}.json',
      auxiliaryDecisionInfluence:false,
      portfolioStorage:'LOCAL_BROWSER_ONLY',
      morningConfirmationPolicy:'DISPLAY_ONLY_IF_PERSISTED_RECORD_EXISTS; OTHERWISE UNKNOWN'
    },
    integrity:{
      pipelineRows:pipelineRows.length,
      v16CurrentRows:v16.currentRows.length,
      decisionSemanticRebuildExact:true,
      normalizedObjectDeterministic:normalizedObjectHash===repeatNormalizedObjectHash,
      persistedObjectHashPreserved:Boolean(persistedObjectHash),
      nonSemanticVarianceFields:['durationMs'],
      zeroLegacyNetworkCalls:snapshot.legacyNetworkCalls===0,
      quantEdgeLiveInfluence:snapshot.quantEdgeLiveInfluence,
      payloadSha256:null
    }
  };
  payload.integrity.payloadSha256=sha({...payload,integrity:{...payload.integrity,payloadSha256:null}});
  fs.mkdirSync(path.dirname(OUT),{recursive:true});
  fs.writeFileSync(OUT,JSON.stringify(payload,null,2)+'\n');
  console.log(JSON.stringify({
    status:'PASS',
    output:path.relative(ROOT,OUT),
    decisionSnapshotId:snapshot.decisionSnapshotId,
    semanticDecisionHash:snapshot.semanticDecisionHash,
    persistedObjectHash,
    rebuiltObjectHash,
    normalizedObjectHash,
    objectHashReproduced:rebuiltObjectHash===persistedObjectHash,
    opportunities:(snapshot.top5||[]).length,
    marketUniverseEvaluated:snapshot.marketUniverseEvaluated,
    payloadSha256:payload.integrity.payloadSha256
  },null,2));
}

main();
