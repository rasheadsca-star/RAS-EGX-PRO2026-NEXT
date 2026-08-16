#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');
const ROOT=process.cwd();const P=r=>path.join(ROOT,r);const read=r=>JSON.parse(fs.readFileSync(P(r),'utf8'));
const cross=read('data/v20/cross-version-consensus.json');const native=read('data/v20/native-current.json');const v17=read('data/v20/v17-production-decision-core.json');
const out=process.env.V20_MULTI_ENGINE_OUT||P('data/v20/multi-engine-consensus.json');
const round=(v,d=2)=>{const n=Number(v);if(!Number.isFinite(n))return null;const m=10**d;return Math.round(n*m)/m;};
const uniq=x=>[...new Set((x||[]).map(v=>String(v||'').trim().toUpperCase()).filter(Boolean))];
if(cross.schemaVersion!=='20.0.0-cross-version-consensus-1')throw Error('Cross-version consensus v1 input required');
if(native.engineId!=='V20_FULL_MARKET_NATIVE_SELECTION_V1')throw Error('Unexpected V20 Native engine');
if(v17.policy?.v17IsAuthoritativeForProductionEligibility!==true)throw Error('V17 authority contract missing');
const session=String(cross.sessionDate||''),nativeSession=String(native.sessionDate||''),v17Session=String(v17.sessionDate||'');
const aligned=Boolean(session&&cross.current?.sessionAligned===true&&nativeSession===session&&v17Session===session);
const mainSet=new Set(uniq(cross.current?.mainAppBasket));const v19Set=new Set(uniq(cross.current?.v19Selected));const nativeSet=new Set(uniq((native.publishedCandidates||[]).map(x=>x.ticker||x.symbol)));
const v17Map=new Map((v17.rows||[]).map(r=>[String(r.ticker||'').toUpperCase(),r]));

// Independence rule: a differently named/versioned engine is NOT an independent vote
// when its alpha-generation family is materially the same. V19 V6 still ranks the
// V19 TOP10 probability signal, while MAIN APP V16.9.2 is a calibrated TOP10
// probability engine. ATR filtering, inverse-vol weighting and exposure overlays
// change portfolio construction/risk, not the underlying alpha family. Therefore
// V19 is tracked as same-family corroboration, not a third independent vote.
const activeIndependent=[
 {id:'V16_9_EQUAL_WEIGHT_BASKET',label:'MAIN APP · V16.9.2',role:'PRODUCTION_CHAMPION',voteEligible:true,authority:'PRIMARY_RECOMMENDATION',alphaFamily:'CALIBRATED_TOP10_PROBABILITY',sessionDate:cross.current?.mainAppSessionDate||null,status:'ACTIVE_FROZEN_METHOD_LIVE_DATA'},
 {id:'V20_FULL_MARKET_NATIVE_SELECTION_V1',label:'V20 Native V1',role:'FULL_MARKET_DISCOVERY',voteEligible:true,authority:'INDEPENDENT_RESEARCH_CONFIRMATION_ONLY',alphaFamily:'MULTI_COMPONENT_EVIDENCE_COMPOSITE',sessionDate:nativeSession||null,status:native.status||'RESEARCH_ONLY'}
];
const relatedCorroborators=[
 {id:'V19_CHAT_GPT_NATIVE_CHALLENGER_V6',label:'V19 Challenger',role:'SAME_ALPHA_FAMILY_CHALLENGER',voteEligible:false,corroborationEligible:true,alphaFamily:'TOP10_PROBABILITY_RELATED',status:'ACTIVE_SHADOW_RESEARCH',reason:'V19 V6 uses TOP10 probability ranking with ATR candidate preference, inverse-volatility weights and exposure overlay. Because MAIN APP also derives its alpha from calibrated TOP10 probability, V19 is useful corroboration but is not counted as an independent alpha vote.'}
];
const monitoredNonVotes=[
 {id:'V13_HISTORICAL_LINEAGE',label:'V13 lineage',role:'LEGACY_HISTORICAL_ENGINE',voteEligible:false,status:'ARCHIVED_HISTORICAL',reason:'Historical monitoring only.'},
 {id:'V14_HISTORICAL_LINEAGE',label:'V14 lineage',role:'LEGACY_HISTORICAL_ENGINE',voteEligible:false,status:'ARCHIVED_HISTORICAL',reason:'Historical monitoring only.'},
 {id:'V15_PRACTICAL_DECISION',label:'V15 Practical Decision',role:'LEGACY_HISTORICAL_ENGINE',voteEligible:false,status:'ARCHIVED_HISTORICAL',reason:'Historical lineage; monitored retrospectively.'},
 {id:'V16_3_IMMEDIATE_SCAN',label:'V16.3 Immediate Scan',role:'LEGACY_HISTORICAL_ENGINE',voteEligible:false,status:'ARCHIVED_HISTORICAL',reason:'Historical lineage; not a current independent vote.'},
 {id:'V16_6_TRIPLE_BARRIER',label:'V16.6 Triple Barrier',role:'LEGACY_HISTORICAL_ENGINE',voteEligible:false,status:'ARCHIVED_HISTORICAL',reason:'Historical monitoring only.'},
 {id:'V16_7_COHERENT_ENGINE',label:'V16.7 Coherent Engine',role:'LEGACY_HISTORICAL_ENGINE',voteEligible:false,status:'ARCHIVED_HISTORICAL',reason:'Historical monitoring only.'},
 {id:'V16_8_PRACTICAL_SELECTOR',label:'V16.8 Practical Selector',role:'LEGACY_HISTORICAL_ENGINE',voteEligible:false,status:'ARCHIVED_HISTORICAL',reason:'Historical monitoring only.'},
 {id:'V17_PRODUCTION_VALIDATION_AUTHORITY',label:'V17 Validation',role:'VALIDATOR_EXECUTION_AUTHORITY',voteEligible:false,status:v17.sourceV17?.globalGateStatus||'UNKNOWN',reason:'Validator/execution authority; never an independent recommendation vote.'},
 {id:'V20_LIQ30_EXPERIMENT',label:'V20 Liq30 experiment',role:'EXPERIMENT_BRANCH',voteEligible:false,status:'NO_CANONICAL_CURRENT_VOTE',reason:'No canonical current recommendation artifact registered for voting.'},
 {id:'V21',label:'V21',role:'FUTURE_ENGINE_SLOT',voteEligible:false,status:'NOT_PRESENT',reason:'No canonical V21 engine/artifact exists.'}
];
const independenceAudit={
 schemaVersion:'20.0.0-engine-independence-audit-1',
 rule:'Independent votes require materially different alpha-generation methodology, not merely a different version, filter, weighting scheme, risk overlay or branch name.',
 engines:[
  {id:'V16_9_EQUAL_WEIGHT_BASKET',alphaGeneration:'Calibrated supervised TOP10 probability from historical feature vectors; adaptive basket size; equal basket weighting.',independentVote:true,family:'CALIBRATED_TOP10_PROBABILITY'},
  {id:'V19_CHAT_GPT_NATIVE_CHALLENGER_V6',alphaGeneration:'V19 TOP10 probability ranking; ATR<=8 preference; inverse-volatility weighting; prior-loss exposure overlay.',independentVote:false,family:'TOP10_PROBABILITY_RELATED',relatedTo:'V16_9_EQUAL_WEIGHT_BASKET'},
  {id:'V20_FULL_MARKET_NATIVE_SELECTION_V1',alphaGeneration:'Deterministic full-market evidence composite: data evidence, liquidity, multi-method S/R, net risk/reward, trade-plan alignment and current technical evidence; no legacy alpha score contribution.',independentVote:true,family:'MULTI_COMPONENT_EVIDENCE_COMPOSITE'}
 ],
 conclusion:'CURRENT_INDEPENDENT_VOTES_ARE_MAIN_APP_AND_V20_NATIVE_ONLY'
};
const universe=uniq([...mainSet,...v19Set,...nativeSet]);
const rows=universe.map(ticker=>{
 const main=aligned&&mainSet.has(ticker),nativeVote=aligned&&nativeSet.has(ticker),v19Corroborates=aligned&&v19Set.has(ticker);
 const votes=Number(main)+Number(nativeVote);const score=aligned?round(votes/2*100,2):0;const v=v17Map.get(ticker)||null;
 const level=votes===2?'VERY_HIGH':votes===1?'BASE_ONLY':'NONE';
 return {ticker,sessionDate:aligned?session:null,independentVotes:votes,independentEngineCount:2,confirmationScore:score,confirmationLevel:level,mainAppSelected:main,v20NativeSelected:nativeVote,v19Corroborates,supportingIndependentEngines:[main?'MAIN APP · V16.9.2':null,nativeVote?'V20 Native V1':null].filter(Boolean),relatedCorroborators:v19Corroborates?['V19 Challenger · same TOP10-probability family']:[],
  v17Validation:v?{selectionCandidate:v.v17SelectionCandidate===true,recommendationEligible:v.v17RecommendationEligible===true,executionEligible:v.v17ExecutionEligible===true,dataEligible:v.v17DataEligible===true,liquidityEligible:v.v17LiquidityEligible===true,technicalSourceEligible:v.v17TechnicalSourceEligible===true,srSourceEligible:v.v17SrSourceEligible===true,blockers:v.v17Blockers||[]}:null};
}).sort((a,b)=>b.confirmationScore-a.confirmationScore||Number(b.mainAppSelected)-Number(a.mainAppSelected)||a.ticker.localeCompare(b.ticker));
const annotations=rows.filter(r=>r.mainAppSelected).map(r=>{
 const independentConfirmations=r.supportingIndependentEngines.filter(x=>!x.startsWith('MAIN APP'));
 const label=r.independentVotes===2?'تأكيد مستقل مرتفع':'توصية MAIN APP بلا تأكيد مستقل';
 const independentMsg=independentConfirmations.length?`تأكيد مستقل من: ${independentConfirmations.join(' + ')}. هذا يرفع وزن المراجعة لأن منهج الاختيار مختلف فعليًا عن MAIN APP.`:'لا يوجد تأكيد من محرك ذي منهج ألفا مستقل في الجلسة الحالية.';
 const relatedMsg=r.v19Corroborates?' V19 وافق أيضًا، لكن لا يُحتسب صوتًا مستقلًا لأنه من نفس عائلة TOP10 probability.':'';
 return {ticker:r.ticker,independentVotes:r.independentVotes,independentEngineCount:2,confirmationScore:r.confirmationScore,confirmationLevel:r.confirmationLevel,confirmationLabelAr:label,confirmingIndependentEngines:independentConfirmations,relatedCorroborators:r.relatedCorroborators,noteAr:independentMsg+relatedMsg,v17Validation:r.v17Validation};
});
const report={schemaVersion:'20.1.0-method-independent-consensus-1',generatedAt:new Date().toISOString(),sessionDate:aligned?session:null,status:aligned?'CURRENT_SESSION_ALIGNED':'SESSION_MISMATCH_FAIL_CLOSED',
 scoreDefinition:{name:'METHOD_INDEPENDENT_CONFIRMATION_SCORE_V1',purpose:'DISPLAY_AND_REVIEW_PRIORITY_ONLY',independentEngineCount:2,formula:'independentVotes / 2 * 100',historicalPerformanceUsedInScore:false,changesMainAppRanking:false,changesExecutionPermission:false,levels:{'2/2':'VERY_HIGH','1/2':'BASE_ONLY','0/2':'NONE'}},
 engineRegistry:{activeIndependent,relatedCorroborators,monitoredNonVotes,monitoredEngineCount:activeIndependent.length+relatedCorroborators.length+monitoredNonVotes.length,rule:independenceAudit.rule},engineIndependenceAudit:independenceAudit,
 current:{sessionAligned:aligned,mainAppBasket:[...mainSet],v19Selected:[...v19Set],v20NativePublished:[...nativeSet],rows,mainAppAnnotations:annotations,fullIndependentMainAppSupport:annotations.length>0&&annotations.every(x=>x.independentVotes===2),independentlySupportedMainAppTickers:annotations.filter(x=>x.independentVotes===2).map(x=>x.ticker)},
 historicalEvidence:{pairEvidenceSource:'data/v20/cross-version-consensus.json',v16V19SameFamilyCorroboration:cross.historicalEvidence?.v16V19Consensus||null,v16OnlyNonConsensus:cross.historicalEvidence?.v16OnlyNonConsensus||null,recurringCorroborationTickers:cross.historicalEvidence?.recurringConsensusTickers||[],note:'V16/V19 historical overlap remains useful same-family corroboration evidence, but is no longer represented as independent-engine evidence.'},
 governance:{displayPriorityOnly:true,mainAppMethodologyFrozen:true,changesMainAppRecommendation:false,changesMainAppRanking:false,changesV19Methodology:false,changesV20NativeRanking:false,changesFinalDecision:false,changesExecutionPermission:false,v17RemainsProductionAuthority:true,corporateActionUnknownRemainsFailClosed:true,automaticPromotion:false,automaticBrokerExecution:false},
 provenance:{crossVersionConsensusGeneratedAt:cross.generatedAt||null,v20NativeRankingDigest:native.rankingDigest||null,v17Commit:v17.sourceV17?.commitSha||null}};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:true,status:report.status,sessionDate:report.sessionDate,independentEngines:activeIndependent.map(x=>x.id),sameFamilyCorroborator:'V19_CHAT_GPT_NATIVE_CHALLENGER_V6',annotations:annotations.map(x=>({ticker:x.ticker,votes:`${x.independentVotes}/2`,score:x.confirmationScore,v19SameFamily:x.relatedCorroborators.length>0}))},null,2));
