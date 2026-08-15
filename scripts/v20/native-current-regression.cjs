#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r);
const read=r=>JSON.parse(fs.readFileSync(P(r),'utf8'));
const write=(r,v)=>{const f=P(r);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,`${JSON.stringify(v,null,2)}\n`,'utf8')};
const n=v=>{if(v===null||v===undefined||v==='')return null;const x=Number(v);return Number.isFinite(x)?x:null};
const failures=[],check=(ok,code)=>{if(!ok)failures.push(code)};
const native=read('data/v20/native-current.json'),selection=read('data/v20/full-market-native-selection.json'),explain=read('data/v20/native-explainability.json'),policy=read('data/v20/decision-intelligence-policy.json'),freeze=read('data/v20/native-model-freeze.json');
const rd=policy.fullMarketNativeSelection?.rankingDiscrimination||{};
check(native.schemaVersion==='20.0.0-native-current-1','NATIVE_CURRENT_SCHEMA');
check(native.engineId==='V20_FULL_MARKET_NATIVE_SELECTION_V1','NATIVE_CURRENT_ENGINE');
check(native.sessionDate===selection.sessionDate&&native.sessionDate===explain.sessionDate,'NATIVE_CURRENT_SESSION');
check(native.candidateUniverseIsFullMarketIndependent===true&&native.legacySeedDependency===false,'NATIVE_CURRENT_FULL_MARKET_INDEPENDENCE');
check(Number(native.legacyScoringContributionPct)===0,'NATIVE_CURRENT_LEGACY_CONTRIBUTION');
check(native.status==='SHADOW_RESEARCH_ONLY_UNCALIBRATED','NATIVE_CURRENT_RESEARCH_ONLY_STATUS');
check(native.notAuthoritativeFor?.includes('EXECUTION_PERMISSION')&&native.notAuthoritativeFor?.includes('PRODUCTION_ALLOCATION'),'NATIVE_CURRENT_EXECUTION_SEPARATION');
check(native.rankingContract==='V20_SAFETY_STRENGTH_LEXICOGRAPHIC_TIE_BREAK_V2','NATIVE_CURRENT_TIE_CONTRACT');
check(freeze.rankingContract===native.rankingContract,'NATIVE_CURRENT_FREEZE_CONTRACT');
check((native.publishedCandidates||[]).length===Number(policy.fullMarketNativeSelection?.maximumPublishedResearchCandidates||30),'NATIVE_CURRENT_PUBLISHED_COUNT');
const pub=native.publishedCandidates||[];for(let i=0;i<pub.length;i++){const r=pub[i];check(Number(r.rank)===i+1,`NATIVE_CURRENT_RANK_${r.ticker}`);check(n(r.nativeResearchScore)!==null,`NATIVE_CURRENT_SCORE_${r.ticker}`);check(r.researchOnly===true&&r.grantsExecutionPermission===false,`NATIVE_CURRENT_ROW_GOV_${r.ticker}`);check(r.rankingTieBreaker?.contract===native.rankingContract,`NATIVE_CURRENT_ROW_TIE_${r.ticker}`);check(n(r.tradePlan?.roundTripTransactionCostPct)===0.6,`NATIVE_CURRENT_COST_${r.ticker}`);check(n(r.netRiskReward)>=Number(policy.fullMarketNativeSelection?.minimumNetRiskReward||0.7),`NATIVE_CURRENT_RR_${r.ticker}`);if(i>0){const prev=pub[i-1],ps=n(prev.nativeResearchScore),cs=n(r.nativeResearchScore);check(ps===null||cs===null||ps>=cs,`NATIVE_CURRENT_SCORE_ORDER_${r.ticker}`);}}
const eligible=selection.eligibleResearchRanking||[];check(eligible.length===Number(selection.summary?.nativeResearchRecommendationCount||0),'NATIVE_CURRENT_ELIGIBLE_COUNT');check(pub.every((r,i)=>r.ticker===eligible[i]?.ticker),'NATIVE_CURRENT_NOT_PREFIX');
const exMap=new Map((explain.rows||[]).map(r=>[r.ticker,r]));for(const r of pub){const x=exMap.get(r.ticker);check(!!x,`NATIVE_CURRENT_EXPLAINABILITY_${r.ticker}`);check(x?.publicationState==='PUBLISHED_TOP_NATIVE',`NATIVE_CURRENT_PUBLICATION_STATE_${r.ticker}`);check(Number(x?.eligibleRank)===Number(r.rank),`NATIVE_CURRENT_EXPLAINABILITY_RANK_${r.ticker}`);}
check(rd.appliesOnlyWhenNativeResearchScoreExactlyTied===true&&rd.mutatesNativeResearchScore===false&&rd.canOverrideHigherNativeResearchScore===false,'NATIVE_CURRENT_TIE_POLICY_IMMUTABLE');
check(policy.fullMarketNativeSelection?.minimumNetRiskReward===0.7,'NATIVE_CURRENT_MIN_RR_NOT_RETUNED');
check(policy.componentWeightsPct?.liquidity===30&&policy.componentWeightsPct?.supportResistance===12,'NATIVE_CURRENT_APPROVED_WEIGHTS');
const report={schemaVersion:'20.0.0-native-current-regression-1',generatedAt:new Date().toISOString(),ok:failures.length===0,failedCount:failures.length,failures,evidence:{sessionDate:native.sessionDate,engineId:native.engineId,publishedCount:pub.length,eligibleCount:eligible.length,rankingDigest:native.rankingDigest,freezeId:freeze.freezeId,compositeModelDigest:freeze.compositeModelDigest},checks:{nativeArtifactOwnsRanking:true,regressionOwnsRanking:false,fullMarketIndependent:true,legacyContributionZero:true,exactScoreTieBreakNonMutating:true,v1Frozen:true,executionSeparated:true}};
write('data/v20/native-current-regression.json',report);console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
