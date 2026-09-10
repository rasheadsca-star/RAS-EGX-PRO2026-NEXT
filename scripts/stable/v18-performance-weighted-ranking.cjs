#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const OUT=path.join(ROOT,'data/stable/v18-global-strategy-ensemble.json');
const SCHEMA='18.2.2-performance-weighted-ranking';
const CONSENSUS_SCHEMA='18.2.1-performance-weighted';

const read=()=>JSON.parse(fs.readFileSync(OUT,'utf8'));
const write=v=>fs.writeFileSync(OUT,`${JSON.stringify(v,null,2)}\n`,'utf8');
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const clone=v=>JSON.parse(JSON.stringify(v));
const uniq=a=>[...new Set(a)];
function evidencePriority(row){
  if(Number.isFinite(Number(row?.evidencePriority)))return Number(row.evidencePriority);
  const t=String(row?.tier||'');
  if(t.includes('TIER_A'))return 400;
  if(t.includes('TIER_B_CONFLUENCE'))return 350;
  if(t.includes('TIER_B_EMA_MACD'))return 330;
  if(t.includes('TIER_B_RESEARCH'))return 250;
  if(t.includes('TIER_B'))return 320;
  return 100;
}
function compare(a,b){
  return evidencePriority(b)-evidencePriority(a)
    || n(b.decisionScore)-n(a.decisionScore)
    || (b.sources?.length||0)-(a.sources?.length||0)
    || String(a.ticker).localeCompare(String(b.ticker));
}
function syncCandidateArray(arr,byTicker){
  return (arr||[]).map(x=>byTicker.get(x?.ticker)||x).filter(Boolean).sort((a,b)=>n(a.evidenceRank,9999)-n(b.evidenceRank,9999)).map(clone);
}

if(!fs.existsSync(OUT))throw new Error('Missing V18 unified output');
const out=read();
if(out.schemaVersion!=='18.2.0-shadow')throw new Error(`Unexpected V18 schema ${out.schemaVersion}`);
if(out.consensusSchemaVersion!==CONSENSUS_SCHEMA)throw new Error(`Weighted consensus must run first; got ${out.consensusSchemaVersion}`);
if(!Array.isArray(out.allCandidates)||!out.allCandidates.length)throw new Error('Missing V18 candidates');

const oldOrder=out.allCandidates.slice().sort((a,b)=>n(a.evidenceRank??a.rank,9999)-n(b.evidenceRank??b.rank,9999));
const before=new Map(oldOrder.map((row,i)=>[row.ticker,{
  evidenceRank:n(row.evidenceRank??row.rank,i+1),
  evidencePriority:evidencePriority(row),
  tier:row.tier,
  rawRank:row.rank,
  execution:JSON.stringify(row.execution||null),
  score:n(row.decisionScore),
  preWeightedScore:n(row.prePerformanceWeightedDecisionScore,row.decisionScore)
}]));

const ranked=out.allCandidates.slice().sort(compare);
ranked.forEach((row,i)=>{
  const prev=before.get(row.ticker);
  row.prePerformanceWeightedEvidenceRank=prev?.evidenceRank??null;
  row.evidencePriority=prev?.evidencePriority??evidencePriority(row);
  row.evidenceRank=i+1;
  row.performanceWeightedRank=i+1;
  row.performanceWeightedRankDelta=prev?prev.evidenceRank-(i+1):0;
});

const byTicker=new Map(ranked.map(x=>[x.ticker,x]));
out.allCandidates=ranked;
out.actionable=syncCandidateArray(out.actionable,byTicker);
out.watch=syncCandidateArray(out.watch,byTicker);
out.topFiveNow=ranked.slice(0,5).map(clone);

if(out.opportunityBuckets&&typeof out.opportunityBuckets==='object'){
  for(const key of ['pilot','conditional','research','watch']){
    if(Array.isArray(out.opportunityBuckets[key]))out.opportunityBuckets[key]=syncCandidateArray(out.opportunityBuckets[key],byTicker);
  }
}

for(const row of out.universeScreener||[]){
  const x=byTicker.get(row.ticker);
  if(!x)continue;
  row.engineAgreementBadge=x.engineAgreementBadge;
  if(row.decision){
    row.decision.evidenceRank=x.evidenceRank;
    row.decision.score=x.decisionScore;
    row.decision.labelAr=x.decisionLabelAr||row.decision.labelAr;
    row.decision.tier=x.tier;
    row.decision.sources=x.sources||[];
  }
}
out.universeScreener=(out.universeScreener||[]).slice().sort((a,b)=>
  n(a.decision?.evidenceRank,9999)-n(b.decision?.evidenceRank,9999)
  || n(b.technicalScore)-n(a.technicalScore)
  || n(b.averageTurnover20Egp)-n(a.averageTurnover20Egp)
);

for(const row of out.engineAgreement||[]){
  const x=byTicker.get(row.ticker);
  if(!x)continue;
  row.evidenceRank=x.evidenceRank;
  row.score=x.decisionScore;
  row.engineAgreementBadge=x.engineAgreementBadge;
  row.weightedAgreementScore=x.engineAgreementBadge?.weightedAgreementScore??row.weightedAgreementScore;
  row.forwardReliabilityScore=x.engineAgreementBadge?.forwardReliabilityScore??row.forwardReliabilityScore;
}
out.engineAgreement=(out.engineAgreement||[]).slice().sort((a,b)=>n(a.evidenceRank,9999)-n(b.evidenceRank,9999));

const changed=ranked.map(row=>{
  const prev=before.get(row.ticker);
  return{
    ticker:row.ticker,
    beforeRank:prev?.evidenceRank??null,
    afterRank:row.evidenceRank,
    delta:(prev?.evidenceRank??row.evidenceRank)-row.evidenceRank,
    evidencePriority:row.evidencePriority,
    tier:row.tier,
    scoreBeforeWeight:prev?.preWeightedScore??null,
    scoreAfterWeight:row.decisionScore,
    scoreAdjustment:row.consensusAdjustment??0,
    weightedAgreementScore:row.engineAgreementBadge?.weightedAgreementScore??null,
    forwardReliabilityScore:row.engineAgreementBadge?.forwardReliabilityScore??null
  };
}).filter(x=>x.beforeRank!==x.afterRank);

const topN=(arr,n)=>arr.slice(0,n).map(x=>x.ticker);
const top5Before=topN(oldOrder,5),top5After=topN(ranked,5),top20Before=topN(oldOrder,20),top20After=topN(ranked,20);
const added=(beforeList,afterList)=>afterList.filter(x=>!beforeList.includes(x));
const removed=(beforeList,afterList)=>beforeList.filter(x=>!afterList.includes(x));
const top5Added=added(top5Before,top5After),top5Removed=removed(top5Before,top5After);
const top20Added=added(top20Before,top20After),top20Removed=removed(top20Before,top20After);

const priorityMutation=ranked.filter(row=>before.get(row.ticker)?.evidencePriority!==row.evidencePriority);
const tierMutation=ranked.filter(row=>before.get(row.ticker)?.tier!==row.tier);
const rawRankMutation=ranked.filter(row=>before.get(row.ticker)?.rawRank!==row.rank);
const executionMutation=ranked.filter(row=>before.get(row.ticker)?.execution!==JSON.stringify(row.execution||null));
const duplicateTickers=ranked.length-uniq(ranked.map(x=>x.ticker)).length;
const contiguous=ranked.every((x,i)=>x.evidenceRank===i+1);
let crossEvidenceInversion=false;
for(let i=1;i<ranked.length;i++)if(evidencePriority(ranked[i])>evidencePriority(ranked[i-1])){crossEvidenceInversion=true;break;}
const orderMatchesComparator=ranked.every((row,i)=>i===0||compare(ranked[i-1],row)<=0);
const topFiveMatches=out.topFiveNow.map(x=>x.ticker).join('|')===top5After.join('|');

if(priorityMutation.length)throw new Error(`Evidence priority mutated: ${priorityMutation.map(x=>x.ticker).join(',')}`);
if(tierMutation.length)throw new Error(`Tier mutated: ${tierMutation.map(x=>x.ticker).join(',')}`);
if(rawRankMutation.length)throw new Error(`Raw rank mutated: ${rawRankMutation.map(x=>x.ticker).join(',')}`);
if(executionMutation.length)throw new Error(`Execution plan mutated: ${executionMutation.map(x=>x.ticker).join(',')}`);
if(duplicateTickers)throw new Error('Duplicate ticker after weighted rerank');
if(!contiguous)throw new Error('Weighted evidence ranks are not contiguous');
if(crossEvidenceInversion)throw new Error('Weighted rerank crossed evidence-priority boundary');
if(!orderMatchesComparator)throw new Error('Weighted rerank does not match evidence-first comparator');
if(!topFiveMatches)throw new Error('Top 5 is not synchronized to weighted evidence ranking');

out.rankingSchemaVersion=SCHEMA;
out.rankingPolicy={
  ...(out.rankingPolicy||{}),
  code:'EVIDENCE_FIRST_THEN_SCORE',
  descriptionAr:'الترتيب يحافظ على أولوية طبقة الدليل، ثم يستخدم Decision Score بعد Performance-Weighted Consensus داخل نفس طبقة الدليل.',
  postConsensusRerank:true,
  postConsensusRankingSchemaVersion:SCHEMA,
  immutableForwardRawRank:true
};
out.performanceWeightedRanking={
  schemaVersion:SCHEMA,
  generatedAt:new Date().toISOString(),
  sessionId:out.sessionId,
  comparator:['EVIDENCE_PRIORITY_DESC','POST_WEIGHTED_DECISION_SCORE_DESC','SOURCE_DIVERSITY_DESC','TICKER_ASC'],
  policy:{
    evidencePriorityMutation:false,
    crossEvidenceClassMovement:false,
    tierMutation:false,
    rawRankMutation:false,
    executionPlanMutation:false,
    evidenceRankRecomputedWithinEvidencePolicy:true,
    topFiveUsesPostWeightedEvidenceRank:true
  },
  safeguards:{
    evidencePriorityUnchanged:priorityMutation.length===0,
    noCrossEvidenceInversion:!crossEvidenceInversion,
    tierUnchanged:tierMutation.length===0,
    rawRankUnchanged:rawRankMutation.length===0,
    executionPlansUnchanged:executionMutation.length===0,
    ranksContiguous:contiguous,
    comparatorOrderPassed:orderMatchesComparator,
    topFiveSynchronized:topFiveMatches,
    duplicateTickerCount:duplicateTickers
  },
  impact:{
    candidates:ranked.length,
    changedPositions:changed.length,
    top5Before,top5After,top5Added,top5Removed,
    top20Before,top20After,top20Added,top20Removed,
    changed
  }
};
if(Array.isArray(out.featureManifest)&&!out.featureManifest.some(x=>x.id==='PERFORMANCE_WEIGHTED_RANKING'))out.featureManifest.push({id:'PERFORMANCE_WEIGHTED_RANKING',labelAr:'إعادة ترتيب التوصيات بالموثوقية والأداء داخل طبقة الدليل',provenance:'V18.2.2',enabled:true});

write(out);
console.log(JSON.stringify({
  schemaVersion:SCHEMA,
  sessionId:out.sessionId,
  changedPositions:changed.length,
  top5Before,top5After,top5Added,top5Removed,
  top20Added,top20Removed,
  biggestMoves:changed.slice().sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,12)
},null,2));
