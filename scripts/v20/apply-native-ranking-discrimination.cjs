#!/usr/bin/env node
'use strict';
require('./apply-full-market-native-quality-gate.cjs');
const fs=require('fs'),path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r);
function patch(rel,marker,from,to){const file=P(rel);let text=fs.readFileSync(file,'utf8');if(text.includes(marker))return{rel,state:'ALREADY_APPLIED'};if(!text.includes(from))throw new Error(`${rel}: ranking discrimination anchor not found: ${marker}`);text=text.replace(from,to);fs.writeFileSync(file,text,'utf8');return{rel,state:'APPLIED'}}
const results=[];
results.push(patch(
  'scripts/v20/build-full-market-native-selection.cjs',
  'V20_SAFETY_FIRST_TIE_BREAK_HELPERS',
  `const rrScore=v=>pw(v,[[0,0],[.25,20],[.5,35],[1,55],[1.5,70],[2,82],[3,95],[4,100]]),tier=(s,t)=>n(s)===null?'UNRATED':s>=t.RESEARCH_A?'RESEARCH_A':s>=t.RESEARCH_B?'RESEARCH_B':s>=t.RESEARCH_C?'RESEARCH_C':'RESEARCH_D';`,
  `const rrScore=v=>pw(v,[[0,0],[.25,20],[.5,35],[1,55],[1.5,70],[2,82],[3,95],[4,100]]),tier=(s,t)=>n(s)===null?'UNRATED':s>=t.RESEARCH_A?'RESEARCH_A':s>=t.RESEARCH_B?'RESEARCH_B':s>=t.RESEARCH_C?'RESEARCH_C':'RESEARCH_D';\n// V20_SAFETY_FIRST_TIE_BREAK_HELPERS\nfunction rankingTieBreakMeta(r,p){const tp=r.evidence?.researchTradePlan||{},state=tp.alignment?.state||'UNKNOWN',priorities=p.rankingDiscrimination?.alignmentPriority||{IN_ENTRY_RANGE:0,BELOW_ENTRY_RANGE_WAITING:1,ABOVE_ENTRY_RANGE_DO_NOT_CHASE:2,UNKNOWN:3},price=n(r.price),lo=n(tp.entryLow),hi=n(tp.entryHigh);let distance=null;if(state==='IN_ENTRY_RANGE')distance=0;else if(state==='ABOVE_ENTRY_RANGE_DO_NOT_CHASE')distance=n(tp.alignment?.distanceAboveEntryHighPct)??(price!==null&&hi>0&&price>hi?(price-hi)/hi*100:null);else if(state==='BELOW_ENTRY_RANGE_WAITING')distance=price!==null&&lo>0&&price<lo?(lo-price)/lo*100:null;return{contract:p.rankingDiscrimination?.contract||'V20_SAFETY_FIRST_LEXICOGRAPHIC_TIE_BREAK_V1',appliesOnlyOnExactScoreTie:true,mutatesNativeResearchScore:false,canOverrideHigherNativeResearchScore:false,alignmentState:state,alignmentSafetyPriority:Number(priorities[state]??priorities.UNKNOWN??3),entryDistancePct:round(distance,3),netRiskReward:n(tp.netRiskReward),liquidity2Score:n(r.evidence?.liquidity?.score),srConfluenceScore:n(r.evidence?.supportResistance?.score),technicalScore:n(r.evidence?.technical?.score),discoveryScore:n(r.discovery?.score)}}\nfunction compareEligible(a,b,p){let d=(n(b.nativeResearch?.score)??-1)-(n(a.nativeResearch?.score)??-1);if(d)return d;const x=rankingTieBreakMeta(a,p),y=rankingTieBreakMeta(b,p);d=x.alignmentSafetyPriority-y.alignmentSafetyPriority;if(d)return d;d=(n(x.entryDistancePct)??Infinity)-(n(y.entryDistancePct)??Infinity);if(d)return d;for(const k of ['netRiskReward','liquidity2Score','srConfluenceScore','technicalScore','discoveryScore']){d=(n(y[k])??-Infinity)-(n(x[k])??-Infinity);if(d)return d}return a.ticker.localeCompare(b.ticker)};`
));
results.push(patch(
  'scripts/v20/build-full-market-native-selection.cjs',
  'V20_SAFETY_FIRST_TIE_BREAK_SORT',
  `.sort((a,b)=>(n(b.nativeResearch.score)??-1)-(n(a.nativeResearch.score)??-1)||(n(b.discovery.score)??-1)-(n(a.discovery.score)??-1)||a.ticker.localeCompare(b.ticker)),ranking=eligible.map`,
  `.sort((a,b)=>compareEligible(a,b,p)),/* V20_SAFETY_FIRST_TIE_BREAK_SORT */ranking=eligible.map`
));
results.push(patch(
  'scripts/v20/build-full-market-native-selection.cjs',
  'V20_SAFETY_FIRST_TIE_BREAK_FIELDS',
  `alignmentState:r.evidence.researchTradePlan.alignment?.state||null,wasInLegacySeedUniverse:r.wasInLegacySeedUniverse`,
  `alignmentState:r.evidence.researchTradePlan.alignment?.state||null,entryDistancePct:rankingTieBreakMeta(r,p).entryDistancePct,rankingTieBreaker:rankingTieBreakMeta(r,p),/* V20_SAFETY_FIRST_TIE_BREAK_FIELDS */wasInLegacySeedUniverse:r.wasInLegacySeedUniverse`
));
results.push(patch(
  'scripts/v20/build-full-market-native-selection.cjs',
  'V20_ELIGIBLE_FULL_RANKING_PERSISTED',
  `top5:ranking.slice(0,5),top10:ranking.slice(0,10),recommendationRanking:ranking.slice(0,p.maximumPublishedResearchCandidates),discoveryRanking`,
  `top5:ranking.slice(0,5),top10:ranking.slice(0,10),eligibleResearchRanking:ranking,/* V20_ELIGIBLE_FULL_RANKING_PERSISTED */recommendationRanking:ranking.slice(0,p.maximumPublishedResearchCandidates),discoveryRanking`
));
results.push(patch(
  'scripts/v20/build-full-market-native-selection.cjs',
  'V20_RANKING_DISCRIMINATION_CONTRACT_EXPOSED',
  `missingComponentPolicy:'NO_FINAL_RECOMMENDATION_UNLESS_ALL_NON_LEGACY_COMPONENTS_AVAILABLE'},summary:`,
  `missingComponentPolicy:'NO_FINAL_RECOMMENDATION_UNLESS_ALL_NON_LEGACY_COMPONENTS_AVAILABLE',rankingDiscrimination:{...p.rankingDiscrimination,scoreMutation:false,executionInfluence:false}},/* V20_RANKING_DISCRIMINATION_CONTRACT_EXPOSED */summary:`
));
results.push(patch(
  'scripts/v20/full-market-native-regression.cjs',
  'V20_RANKING_DISCRIMINATION_REGRESSION',
  `check((selection.top5||[]).every((r,i)=>r.ticker===ranking[i]?.ticker),'NATIVE_TOP5_NOT_PREFIX');`,
  `// V20_RANKING_DISCRIMINATION_REGRESSION\nconst eligibleRanking=selection.eligibleResearchRanking||[],rd=policy.rankingDiscrimination||{};\ncheck(rd.contract==='V20_SAFETY_FIRST_LEXICOGRAPHIC_TIE_BREAK_V1','NATIVE_TIE_BREAK_POLICY_DRIFT');\ncheck(rd.appliesOnlyWhenNativeResearchScoreExactlyTied===true&&rd.mutatesNativeResearchScore===false&&rd.canOverrideHigherNativeResearchScore===false,'NATIVE_TIE_BREAK_SCORE_MUTATION_POLICY_DRIFT');\ncheck(eligibleRanking.length===Number(selection.summary?.nativeResearchRecommendationCount||0),'NATIVE_FULL_ELIGIBLE_RANKING_COUNT_MISMATCH');\ncheck(ranking.every((r,i)=>r.ticker===eligibleRanking[i]?.ticker),'NATIVE_PUBLISHED_NOT_PREFIX_OF_FULL_ELIGIBLE_RANKING');\nconst cmpTie=(a,b)=>{const ax=a.rankingTieBreaker||{},bx=b.rankingTieBreaker||{};let d=Number(ax.alignmentSafetyPriority??99)-Number(bx.alignmentSafetyPriority??99);if(d)return d;d=Number(ax.entryDistancePct??Infinity)-Number(bx.entryDistancePct??Infinity);if(d)return d;for(const k of ['netRiskReward','liquidity2Score','srConfluenceScore','technicalScore','discoveryScore']){d=Number(bx[k]??-Infinity)-Number(ax[k]??-Infinity);if(d)return d}return String(a.ticker).localeCompare(String(b.ticker))};\nlet tieBreakPairCount=0;for(let i=0;i<eligibleRanking.length;i++){const r=eligibleRanking[i],tb=r.rankingTieBreaker||{};check(Number(r.rank)===i+1,\`NATIVE_ELIGIBLE_RANK_SEQUENCE_\${r.ticker}\`);check(tb.contract===rd.contract&&tb.mutatesNativeResearchScore===false&&tb.canOverrideHigherNativeResearchScore===false,\`NATIVE_TIE_BREAK_METADATA_\${r.ticker}\`);if(i===0)continue;const prev=eligibleRanking[i-1],ps=finite(prev.nativeResearchScore),cs=finite(r.nativeResearchScore);check(ps===null||cs===null||ps>=cs,\`NATIVE_PRIMARY_SCORE_ORDER_\${r.ticker}\`);if(ps!==null&&cs!==null&&ps===cs){tieBreakPairCount++;check(cmpTie(prev,r)<=0,\`NATIVE_TIE_BREAK_ORDER_\${prev.ticker}_\${r.ticker}\`)}}\ncheck(tieBreakPairCount>0,'NATIVE_TIE_BREAK_NOT_EXERCISED');\ncheck((eligibleRanking||[]).filter(r=>r.alignmentState==='ABOVE_ENTRY_RANGE_DO_NOT_CHASE').every(r=>finite(r.nativeResearchScore)<=Number(policyRoot.defensiveCaps?.aboveEntryRangeDoNotChaseMaxScore||55)),'NATIVE_TIE_BREAK_WEAKENED_DO_NOT_CHASE_CAP');\ncheck((selection.top5||[]).every((r,i)=>r.ticker===ranking[i]?.ticker),'NATIVE_TOP5_NOT_PREFIX');`
));
results.push(patch(
  'scripts/v20/full-market-native-regression.cjs',
  'V20_RANKING_DISCRIMINATION_REPORT',
  `conservativeCostAwareNetRrRequired:true,minimumNetRiskRewardPreserved:true,v17ExecutionAuthorityPreserved:true`,
  `conservativeCostAwareNetRrRequired:true,minimumNetRiskRewardPreserved:true,safetyFirstTieBreakPreserved:true,tieBreakCannotMutateScore:true,tieBreakCannotOverrideHigherScore:true,/* V20_RANKING_DISCRIMINATION_REPORT */v17ExecutionAuthorityPreserved:true`
));
results.push(patch(
  'scripts/v20/build-native-explainability.cjs',
  'V20_EXPLAINABILITY_SELECTION_RANK_MAP',
  `const legacySeed=new Set((profiles.profiles||[]).map(x=>sym(x.ticker))),legacyRank=new Map((profiles.researchDecisionRanking||[]).map(x=>[sym(x.ticker),n(x.rank)]));`,
  `const legacySeed=new Set((profiles.profiles||[]).map(x=>sym(x.ticker))),legacyRank=new Map((profiles.researchDecisionRanking||[]).map(x=>[sym(x.ticker),n(x.rank)])),selectionRankByTicker=new Map((selection.eligibleResearchRanking||[]).map(x=>[sym(x.ticker),x]));/* V20_EXPLAINABILITY_SELECTION_RANK_MAP */`
));
results.push(patch(
  'scripts/v20/build-native-explainability.cjs',
  'V20_EXPLAINABILITY_TIE_BREAK_FIELDS',
  `alignmentState:tp.alignment?.state||null,tradePlan:`,
  `alignmentState:tp.alignment?.state||null,entryDistancePct:n(selectionRankByTicker.get(ticker)?.entryDistancePct),rankingTieBreaker:selectionRankByTicker.get(ticker)?.rankingTieBreaker||null,/* V20_EXPLAINABILITY_TIE_BREAK_FIELDS */tradePlan:`
));
results.push(patch(
  'scripts/v20/build-native-explainability.cjs',
  'V20_EXPLAINABILITY_EXACT_SELECTION_ORDER',
  `const eligible=[...rows].filter(r=>r.recommendationEligible).sort((a,b)=>(n(b.nativeResearchScore)??-1)-(n(a.nativeResearchScore)??-1)||(n(b.discoveryScore)??-1)-(n(a.discoveryScore)??-1)||a.ticker.localeCompare(b.ticker));`,
  `const eligible=[...rows].filter(r=>r.recommendationEligible).sort((a,b)=>(n(selectionRankByTicker.get(a.ticker)?.rank)??9999)-(n(selectionRankByTicker.get(b.ticker)?.rank)??9999));/* V20_EXPLAINABILITY_EXACT_SELECTION_ORDER */if(eligible.length!==selectionRankByTicker.size||eligible.some((r,i)=>n(selectionRankByTicker.get(r.ticker)?.rank)!==i+1))throw new Error('Explainability ranking order mismatch');`
));
results.push(patch(
  'scripts/v20/build-native-explainability.cjs',
  'V20_EXPLAINABILITY_SELECTION_RANK_ASSIGNED',
  `eligible.forEach((r,i)=>{r.eligibleRank=i+1;`,
  `eligible.forEach((r,i)=>{r.eligibleRank=n(selectionRankByTicker.get(r.ticker)?.rank)??i+1;/* V20_EXPLAINABILITY_SELECTION_RANK_ASSIGNED */`
));
console.log(JSON.stringify({schemaVersion:'20.0.0-native-ranking-discrimination-patch-1',contract:'V20_SAFETY_FIRST_LEXICOGRAPHIC_TIE_BREAK_V1',researchOnly:true,scoreMutation:false,executionInfluence:false,results},null,2));
