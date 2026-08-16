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
const session=String(cross.sessionDate||'');const nativeSession=String(native.sessionDate||'');const v17Session=String(v17.sessionDate||'');
const aligned=Boolean(session&&cross.current?.sessionAligned===true&&nativeSession===session&&v17Session===session);
const mainSet=new Set(uniq(cross.current?.mainAppBasket));const v19Set=new Set(uniq(cross.current?.v19Selected));const nativeSet=new Set(uniq((native.publishedCandidates||[]).map(x=>x.ticker||x.symbol)));
const v17Map=new Map((v17.rows||[]).map(r=>[String(r.ticker||'').toUpperCase(),r]));
const activeIndependent=[
 {id:'V16_9_EQUAL_WEIGHT_BASKET',label:'MAIN APP · V16.9.2',role:'PRODUCTION_CHAMPION',voteEligible:true,authority:'PRIMARY_RECOMMENDATION',sessionDate:cross.current?.mainAppSessionDate||null,status:'ACTIVE_FROZEN_METHOD_LIVE_DATA'},
 {id:'V19_CHAT_GPT_NATIVE_CHALLENGER_V6',label:'V19 Challenger',role:'SHADOW_CHALLENGER',voteEligible:true,authority:'INDEPENDENT_CONFIRMATION_ONLY',sessionDate:cross.current?.v19SessionDate||null,status:'ACTIVE_SHADOW_RESEARCH'},
 {id:'V20_FULL_MARKET_NATIVE_SELECTION_V1',label:'V20 Native V1',role:'FULL_MARKET_DISCOVERY',voteEligible:true,authority:'INDEPENDENT_RESEARCH_CONFIRMATION_ONLY',sessionDate:nativeSession||null,status:native.status||'RESEARCH_ONLY'}
];
const monitoredNonVotes=[
 {id:'V17_PRODUCTION_VALIDATION_AUTHORITY',label:'V17 Validation',role:'VALIDATOR_EXECUTION_AUTHORITY',voteEligible:false,status:v17.sourceV17?.globalGateStatus||'UNKNOWN',reason:'V17 validates eligibility/execution and is not counted as an independent recommendation vote.'},
 {id:'V16_3_IMMEDIATE_SCAN',label:'V16.3 Immediate Scan',role:'LEGACY_HISTORICAL_ENGINE',voteEligible:false,status:'ARCHIVED_HISTORICAL',reason:'Historical lineage; not a current independent engine vote.'},
 {id:'V15_PRACTICAL_DECISION',label:'V15 Practical Decision',role:'LEGACY_HISTORICAL_ENGINE',voteEligible:false,status:'ARCHIVED_HISTORICAL',reason:'Historical lineage; monitored for retrospective overlap only.'},
 {id:'V20_LIQ30_EXPERIMENT',label:'V20 Liq30 experiment',role:'EXPERIMENT_BRANCH',voteEligible:false,status:'NO_CANONICAL_CURRENT_VOTE',reason:'Experimental branch exists but no canonical current recommendation artifact is registered for voting.'},
 {id:'V21',label:'V21',role:'FUTURE_ENGINE_SLOT',voteEligible:false,status:'NOT_PRESENT',reason:'No canonical V21 branch/artifact currently exists.'}
];
const universe=uniq([...mainSet,...v19Set,...nativeSet]);
const rows=universe.map(ticker=>{
 const main=aligned&&mainSet.has(ticker),v19Vote=aligned&&v19Set.has(ticker),nativeVote=aligned&&nativeSet.has(ticker);const votes=Number(main)+Number(v19Vote)+Number(nativeVote);const score=aligned?round(votes/3*100,2):0;
 const support=[main?'MAIN APP · V16.9.2':null,v19Vote?'V19 Challenger':null,nativeVote?'V20 Native V1':null].filter(Boolean);const v=v17Map.get(ticker)||null;
 const level=votes===3?'VERY_HIGH':votes===2?'HIGH':votes===1?'BASE_ONLY':'NONE';
 return {ticker,sessionDate:aligned?session:null,independentVotes:votes,independentEngineCount:3,confirmationScore:score,confirmationLevel:level,mainAppSelected:main,v19Selected:v19Vote,v20NativeSelected:nativeVote,supportingEngines:support,
  v17Validation:v?{selectionCandidate:v.v17SelectionCandidate===true,recommendationEligible:v.v17RecommendationEligible===true,executionEligible:v.v17ExecutionEligible===true,dataEligible:v.v17DataEligible===true,liquidityEligible:v.v17LiquidityEligible===true,technicalSourceEligible:v.v17TechnicalSourceEligible===true,srSourceEligible:v.v17SrSourceEligible===true,blockers:v.v17Blockers||[]}:null};
}).sort((a,b)=>b.confirmationScore-a.confirmationScore||Number(b.mainAppSelected)-Number(a.mainAppSelected)||a.ticker.localeCompare(b.ticker));
const annotations=rows.filter(r=>r.mainAppSelected).map(r=>{
 const confirmations=r.supportingEngines.filter(x=>!x.startsWith('MAIN APP'));
 const label=r.independentVotes===3?'تأكيد مرتفع جدًا':r.independentVotes===2?'تأكيد مرتفع':'توصية MAIN APP منفردة';
 const msg=confirmations.length?`أوصى/أكد السهم أيضًا: ${confirmations.join(' + ')}. لذلك يحصل على وزن تأكيدي أعلى في ترتيب المراجعة، دون تغيير خوارزمية MAIN APP أو إذن التنفيذ.`:'لم يظهر تأكيد من محرك مستقل آخر في الجلسة الحالية؛ تظل توصية MAIN APP كما هي دون وزن تأكيدي إضافي.';
 return {ticker,independentVotes:r.independentVotes,independentEngineCount:3,confirmationScore:r.confirmationScore,confirmationLevel:r.confirmationLevel,confirmationLabelAr:label,confirmingEngines:confirmations,noteAr:msg,v17Validation:r.v17Validation};
});
const report={schemaVersion:'20.0.0-multi-engine-consensus-1',generatedAt:new Date().toISOString(),sessionDate:aligned?session:null,status:aligned?'CURRENT_SESSION_ALIGNED':'SESSION_MISMATCH_FAIL_CLOSED',
 scoreDefinition:{name:'MULTI_ENGINE_CONFIRMATION_SCORE_V1',purpose:'DISPLAY_AND_REVIEW_PRIORITY_ONLY',independentEngineCount:3,formula:'independentVotes / 3 * 100',historicalPerformanceUsedInScore:false,changesMainAppRanking:false,changesExecutionPermission:false,levels:{'3/3':'VERY_HIGH','2/3':'HIGH','1/3':'BASE_ONLY','0/3':'NONE'}},
 engineRegistry:{activeIndependent,monitoredNonVotes,rule:'Only canonical, current-session, genuinely independent recommendation/discovery engines may add a confirmation vote. Validators, same-lineage versions, archived engines, experiments without canonical output, and nonexistent versions never add votes.'},
 current:{sessionAligned:aligned,mainAppBasket:[...mainSet],v19Selected:[...v19Set],v20NativePublished:[...nativeSet],rows,mainAppAnnotations:annotations,fullThreeEngineMainAppSupport:annotations.length>0&&annotations.every(x=>x.independentVotes===3),threeEngineSupportedMainAppTickers:annotations.filter(x=>x.independentVotes===3).map(x=>x.ticker)},
 historicalEvidence:{pairEvidenceSource:'data/v20/cross-version-consensus.json',v16V19Consensus:cross.historicalEvidence?.v16V19Consensus||null,v16OnlyNonConsensus:cross.historicalEvidence?.v16OnlyNonConsensus||null,recurringConsensusTickers:cross.historicalEvidence?.recurringConsensusTickers||[],note:'Historical pair evidence is retained as evidence only. V20 Native is not retroactively backfilled into historical votes without session-resolved canonical evidence.'},
 governance:{displayPriorityOnly:true,mainAppMethodologyFrozen:true,changesMainAppRecommendation:false,changesMainAppRanking:false,changesV19Methodology:false,changesV20NativeRanking:false,changesFinalDecision:false,changesExecutionPermission:false,v17RemainsProductionAuthority:true,corporateActionUnknownRemainsFailClosed:true,automaticPromotion:false,automaticBrokerExecution:false},
 provenance:{crossVersionConsensusGeneratedAt:cross.generatedAt||null,v20NativeRankingDigest:native.rankingDigest||null,v17Commit:v17.sourceV17?.commitSha||null}}
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:true,status:report.status,sessionDate:report.sessionDate,mainAppAnnotations:annotations.map(x=>({ticker:x.ticker,votes:`${x.independentVotes}/3`,score:x.confirmationScore,engines:x.confirmingEngines})),trackedActiveIndependent:activeIndependent.map(x=>x.id),monitoredNonVotes:monitoredNonVotes.map(x=>`${x.id}:${x.status}`)},null,2));
