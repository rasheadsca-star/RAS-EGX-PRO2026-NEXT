#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.');
const P=r=>path.join(root,r);
const read=r=>JSON.parse(fs.readFileSync(P(r),'utf8'));
const write=(r,v)=>{const f=P(r);fs.mkdirSync(path.dirname(f),{recursive:true});const t=`${f}.tmp`;fs.writeFileSync(t,`${JSON.stringify(v,null,2)}\n`,'utf8');JSON.parse(fs.readFileSync(t,'utf8'));fs.renameSync(t,f)};
const n=v=>{if(v===null||v===undefined||v==='')return null;const x=Number(v);return Number.isFinite(x)?x:null};
const round=(v,d=3)=>n(v)===null?null:Math.round(n(v)*10**d)/10**d;
const sym=v=>String(v||'').trim().toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9.]/g,'');

const CONTRACT='V20_SAFETY_STRENGTH_LEXICOGRAPHIC_TIE_BREAK_V2';
function tieMeta(row,policy){
  const state=row.alignmentState||row.tradePlan?.alignmentState||'UNKNOWN';
  const priorities=policy?.alignmentPriority||{IN_ENTRY_RANGE:0,BELOW_ENTRY_RANGE_WAITING:1,BELOW_ENTRY_RANGE:1,ABOVE_ENTRY_RANGE_DO_NOT_CHASE:2,UNKNOWN:3};
  const price=n(row.price),lo=n(row.tradePlan?.entryLow),hi=n(row.tradePlan?.entryHigh);
  let distance=null;
  if(state==='IN_ENTRY_RANGE')distance=0;
  else if(state==='ABOVE_ENTRY_RANGE_DO_NOT_CHASE'&&price!==null&&hi>0&&price>hi)distance=(price-hi)/hi*100;
  else if((state==='BELOW_ENTRY_RANGE_WAITING'||state==='BELOW_ENTRY_RANGE')&&price!==null&&lo>0&&price<lo)distance=(lo-price)/lo*100;
  return{
    contract:CONTRACT,
    appliesOnlyOnExactScoreTie:true,
    mutatesNativeResearchScore:false,
    canOverrideHigherNativeResearchScore:false,
    alignmentState:state,
    alignmentSafetyPriority:Number(priorities[state]??priorities.UNKNOWN??3),
    scoreBeforeRegimeAndCaps:n(row.scoreBeforeRegimeAndCaps),
    entryDistancePct:round(distance,3),
    netRiskReward:n(row.netRiskReward),
    liquidity2Score:n(row.componentScores?.liquidity),
    srConfluenceScore:n(row.componentScores?.supportResistance),
    technicalScore:n(row.componentScores?.currentTechnical),
    discoveryScore:n(row.discoveryScore)
  };
}
function compare(a,b,policy){
  let d=(n(b.nativeResearchScore)??-1)-(n(a.nativeResearchScore)??-1);if(d)return d;
  const x=tieMeta(a,policy),y=tieMeta(b,policy);
  d=x.alignmentSafetyPriority-y.alignmentSafetyPriority;if(d)return d;
  d=(n(y.scoreBeforeRegimeAndCaps)??-Infinity)-(n(x.scoreBeforeRegimeAndCaps)??-Infinity);if(d)return d;
  d=(n(x.entryDistancePct)??Infinity)-(n(y.entryDistancePct)??Infinity);if(d)return d;
  for(const k of ['netRiskReward','liquidity2Score','srConfluenceScore','technicalScore','discoveryScore']){d=(n(y[k])??-Infinity)-(n(x[k])??-Infinity);if(d)return d;}
  return sym(a.ticker).localeCompare(sym(b.ticker));
}
function tier(score,thresholds){const s=n(score);if(s===null)return'UNRATED';return s>=Number(thresholds.RESEARCH_A)?'RESEARCH_A':s>=Number(thresholds.RESEARCH_B)?'RESEARCH_B':s>=Number(thresholds.RESEARCH_C)?'RESEARCH_C':'RESEARCH_D'}

function main(){
  const selection=read('data/v20/full-market-native-selection.json');
  const explain=read('data/v20/native-explainability.json');
  const rootPolicy=read('data/v20/decision-intelligence-policy.json');
  const p=rootPolicy.fullMarketNativeSelection||{};
  const rd=p.rankingDiscrimination||{};
  if(selection.engineId!=='V20_FULL_MARKET_NATIVE_SELECTION_V1'||explain.engineId!==selection.engineId)throw new Error('Native V1 artifact mismatch');
  if(rd.contract&&rd.contract!==CONTRACT)throw new Error(`Native ranking contract drift: ${rd.contract}`);
  if(rd.mutatesNativeResearchScore!==false||rd.canOverrideHigherNativeResearchScore!==false)throw new Error('Native ranking tie-break policy would mutate/override score');
  const eligible=(explain.rows||[]).filter(r=>r.recommendationEligible===true).map(r=>({...r,rankingTieBreaker:tieMeta(r,rd)})).sort((a,b)=>compare(a,b,rd));
  if(!eligible.length)throw new Error('No Native eligible rows available to finalize');
  let tied=0;
  for(let i=0;i<eligible.length;i++){
    eligible[i].eligibleRank=i+1;
    eligible[i].entryDistancePct=eligible[i].rankingTieBreaker.entryDistancePct;
    if(i>0){const prev=eligible[i-1],ps=n(prev.nativeResearchScore),cs=n(eligible[i].nativeResearchScore);if(ps!==null&&cs!==null&&ps<cs)throw new Error(`Tie-break overrode higher score: ${prev.ticker}/${eligible[i].ticker}`);if(ps===cs)tied++;}
  }
  if(tied===0)throw new Error('Tie-break contract not exercised by current eligible set');
  const maxPublished=Number(p.maximumPublishedResearchCandidates||30);
  const ranking=eligible.map((r,i)=>({
    rank:i+1,ticker:sym(r.ticker),nameAr:r.nameAr??null,nameEn:r.nameEn??null,price:n(r.price),nativeResearchScore:n(r.nativeResearchScore),nativeResearchTier:tier(r.nativeResearchScore,rootPolicy.tierThresholds||{}),discoveryScore:n(r.discoveryScore),liquidity2Score:n(r.componentScores?.liquidity),srConfluenceScore:n(r.componentScores?.supportResistance),srMethodCount:Number(r.srMethodCount||0),technicalScore:n(r.componentScores?.currentTechnical),netRiskReward:n(r.netRiskReward),entryLow:n(r.tradePlan?.entryLow),entryHigh:n(r.tradePlan?.entryHigh),stop:n(r.tradePlan?.stop),target1:n(r.tradePlan?.target1),target2:n(r.tradePlan?.target2),alignmentState:r.alignmentState||null,entryDistancePct:r.rankingTieBreaker.entryDistancePct,rankingTieBreaker:r.rankingTieBreaker,wasInLegacySeedUniverse:r.wasInLegacySeedUniverse===true,baselineResearchRank:n(r.baselineResearchRank)
  }));
  const published=ranking.slice(0,maxPublished);
  const eligibleMap=new Map(eligible.map(r=>[sym(r.ticker),r]));
  for(const row of explain.rows||[]){
    const e=eligibleMap.get(sym(row.ticker));
    if(e){row.eligibleRank=e.eligibleRank;row.entryDistancePct=e.entryDistancePct;row.rankingTieBreaker=e.rankingTieBreaker;row.publicationState=e.eligibleRank<=maxPublished?'PUBLISHED_TOP_NATIVE':'ELIGIBLE_NOT_PUBLISHED_TOP_CUTOFF';row.whyExcluded=e.eligibleRank<=maxPublished?[]:['TOP_30_PUBLICATION_CUTOFF_ONLY'];}
  }
  explain.summary.eligibleCount=eligible.length;
  explain.summary.publishedCount=published.length;
  explain.summary.eligibleNotPublishedCount=Math.max(0,eligible.length-published.length);
  explain.summary.outsideLegacyPublishedCount=published.filter(r=>!r.wasInLegacySeedUniverse).length;
  explain.policy.rankingContract=CONTRACT;
  explain.policy.rankingFinalizedFromCheckedInSource=true;

  selection.scoring=selection.scoring||{};
  selection.scoring.rankingDiscrimination={...rd,contract:CONTRACT,scoreMutation:false,executionInfluence:false};
  selection.eligibleResearchRanking=ranking;
  selection.recommendationRanking=published;
  selection.top5=published.slice(0,5);
  selection.top10=published.slice(0,10);
  selection.summary=selection.summary||{};
  selection.summary.nativeResearchRecommendationCount=eligible.length;
  selection.summary.publishedResearchCandidateCount=published.length;
  selection.summary.nativeResearchCandidatesOutsideLegacySeedCount=eligible.filter(r=>!r.wasInLegacySeedUniverse).length;
  selection.summary.top10OutsideLegacySeedCount=published.slice(0,10).filter(r=>!r.wasInLegacySeedUniverse).length;
  selection.summary.legacyScoringContributionPct=0;
  selection.rankingDiscrimination={contract:CONTRACT,appliesOnlyOnExactScoreTie:true,mutatesNativeResearchScore:false,canOverrideHigherNativeResearchScore:false,materializedInCheckedInSource:'scripts/v20/finalize-native-ranking-v1.cjs'};
  selection.governance={...(selection.governance||{}),researchOnly:true,executionPermission:false,productionAllocation:false,automaticPromotion:false,canChangeChampion:false,V17RemainsExecutionAuthority:true};

  write('data/v20/native-explainability.json',explain);
  write('data/v20/full-market-native-selection.json',selection);
  const profiles=read('data/v20/stock-profiles.json');profiles.fullMarketNativeSelection=selection;write('data/v20/stock-profiles.json',profiles);
  console.log(JSON.stringify({ok:true,contract:CONTRACT,eligibleCount:eligible.length,publishedCount:published.length,tiedAdjacentPairs:tied,top5:selection.top5.map(r=>({rank:r.rank,ticker:r.ticker,score:r.nativeResearchScore,preCap:r.rankingTieBreaker.scoreBeforeRegimeAndCaps,alignment:r.alignmentState}))},null,2));
  return selection;
}
if(require.main===module)main();module.exports={main,tieMeta,compare};
