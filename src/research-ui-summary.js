import { sha256 } from './hash.js';

const FORBIDDEN_KEYS=new Set(['decision','decisionCode','entry','entryLow','entryHigh','entryExpiry','stop','target','target1','target2','grossRiskReward','netRiskReward','opportunityScore','combinedOpportunityScore']);

function groupPayload(record,name){return record?.groups?.find(group=>group?.name===name)?.payload??null}
function finiteOrNull(value){return Number.isFinite(Number(value))?Number(value):null}
function scanForbidden(value,path='root'){
  if(Array.isArray(value)){for(let i=0;i<value.length;i++)scanForbidden(value[i],`${path}[${i}]`);return}
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){
    if(FORBIDDEN_KEYS.has(key))throw new Error(`RESEARCH_UI_FORBIDDEN_FIELD:${path}.${key}`);
    scanForbidden(item,`${path}.${key}`);
  }
}
function cleanDisplayName(value){
  const text=String(value??'').replace(/\s+/g,' ').trim();
  if(!text||text.length<2||text.length>180)return null;
  if(/(?:AdSlot|End AdSlot|-->|<!--|###\s*Size|\[\[?\d{2,3},|^['"`\s]*\d{1,3},\d{1,3}\]|\]\]\s*End)/i.test(text))return null;
  if(/[<>]{1,}/.test(text))return null;
  return text;
}

export function buildResearchUiSummary(featureSnapshot,liveSnapshot){
  if(featureSnapshot?.authorityMode!=='RESEARCH'||featureSnapshot?.researchOnly!==true||featureSnapshot?.productionAuthority!==false)throw new Error('RESEARCH_UI_FEATURE_AUTHORITY_INVALID');
  if(liveSnapshot?.authorityMode!=='RESEARCH'||liveSnapshot?.researchOnly!==true||liveSnapshot?.productionAuthority!==false)throw new Error('RESEARCH_UI_LIVE_AUTHORITY_INVALID');
  const session=String(featureSnapshot.signalSession??'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(session)||String(liveSnapshot.expectedSession??liveSnapshot.targetSession??'')!==session)throw new Error('RESEARCH_UI_SESSION_MISMATCH');

  const symbols=(featureSnapshot.records??[]).map(record=>{
    const technical=groupPayload(record,'TECHNICAL');
    const liquidity=groupPayload(record,'LIQUIDITY');
    const corporate=groupPayload(record,'CORPORATE_ACTIONS');
    const companyNameAr=cleanDisplayName(record.companyNameAr);
    const companyNameEn=cleanDisplayName(record.companyNameEn);
    return {
      ticker:String(record.ticker??'').toUpperCase(),
      displayName:companyNameAr??companyNameEn??null,
      companyNameAr,
      companyNameEn,
      state:record.state??'SOURCE_UNAVAILABLE',
      featureReady:record.featureReady===true,
      metrics:record.featureReady===true?{
        close:finiteOrNull(technical?.close),
        momentum20Pct:finiteOrNull(technical?.momentum20Pct),
        momentum60Pct:finiteOrNull(technical?.momentum60Pct),
        rsi14:finiteOrNull(technical?.rsi14),
        atrPct:finiteOrNull(technical?.atrPct),
        closeVsSma20Pct:finiteOrNull(technical?.closeVsSma20Pct),
        closeVsSma50Pct:finiteOrNull(technical?.closeVsSma50Pct),
        breakoutAbovePrior20dHigh:technical?.breakoutAbovePrior20dHigh===true,
        relativeVolume20:finiteOrNull(liquidity?.relativeVolume20),
        medianTradedValue20:finiteOrNull(liquidity?.medianTradedValue20),
        currentTradedValue:finiteOrNull(liquidity?.currentTradedValue)
      }:null,
      review:record.state==='CORPORATE_ACTION_REVIEW'?{
        historicalDiscontinuities:Number(corporate?.historicalDiscontinuities?.length??0),
        currentJumpReviewRequired:corporate?.currentJumpReviewRequired===true
      }:null
    };
  }).sort((a,b)=>a.ticker.localeCompare(b.ticker));

  const boards=featureSnapshot.descriptiveLeaderboards??{};
  const summary={
    schemaVersion:'egx-one-research-ui-summary-2',
    authorityMode:'RESEARCH',
    researchOnly:true,
    productionAuthority:false,
    notARecommendation:true,
    session,
    featureReadiness:featureSnapshot.featureReadiness,
    counts:{
      universe:Number(featureSnapshot.counts?.universe??symbols.length),
      currentSessionReady:Number(featureSnapshot.counts?.currentSessionReady??0),
      featureReady:Number(featureSnapshot.counts?.featureReady??0),
      corporateActionReview:Number(featureSnapshot.counts?.corporateActionReview??0),
      insufficientHistory:Number(featureSnapshot.counts?.insufficientHistory??0),
      sourceUnavailable:Number(featureSnapshot.counts?.sourceUnavailable??0),
      featureCoveragePct:finiteOrNull(featureSnapshot.counts?.featureCoveragePct),
      currentSessionCoveragePct:finiteOrNull(liveSnapshot.counts?.currentSessionCoveragePct??liveSnapshot.readiness?.counts?.coveragePct)
    },
    authority:{researchFeatures:featureSnapshot.phaseBoundary?.researchFeaturesAuthorized===true,researchStrategy:false,productionPhase4:false,automaticOrders:false},
    leaderboards:{
      rankingAuthority:'DESCRIPTIVE_ONLY_NOT_STRATEGY',
      momentum20:Array.isArray(boards.momentum20)?boards.momentum20:[],
      relativeVolume20:Array.isArray(boards.relativeVolume20)?boards.relativeVolume20:[],
      liquidity20:Array.isArray(boards.liquidity20)?boards.liquidity20:[],
      lowestAtrPct:Array.isArray(boards.lowestAtrPct)?boards.lowestAtrPct:[]
    },
    symbols,
    lineage:{featureSnapshotHash:featureSnapshot.snapshotHash??null,marketSnapshotHash:featureSnapshot.parentResearchSnapshotHash??null,historyIndexHash:featureSnapshot.historyIndexHash??null}
  };
  scanForbidden(summary);
  const uiSnapshotHash=sha256(summary);
  return Object.freeze({...summary,uiSnapshotHash});
}

export function assertResearchUiSummary(summary){
  if(summary?.authorityMode!=='RESEARCH'||summary?.researchOnly!==true||summary?.productionAuthority!==false||summary?.notARecommendation!==true)throw new Error('RESEARCH_UI_AUTHORITY_BOUNDARY_FAILED');
  if(summary?.authority?.researchStrategy!==false||summary?.authority?.productionPhase4!==false||summary?.authority?.automaticOrders!==false)throw new Error('RESEARCH_UI_PREMATURE_AUTHORITY');
  scanForbidden(summary);
  const {uiSnapshotHash,...stable}=summary;
  if(!uiSnapshotHash||sha256(stable)!==uiSnapshotHash)throw new Error('RESEARCH_UI_HASH_INVALID');
  return true;
}
