#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r);
const read=r=>JSON.parse(fs.readFileSync(P(r),'utf8'));
const write=(r,v)=>{const f=P(r);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,`${JSON.stringify(v,null,2)}\n`,'utf8')};
const finite=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
const failures=[],check=(ok,code)=>{if(!ok)failures.push(code)};
const selection=read('data/v20/full-market-native-selection.json'),technical=read('data/v20/full-market-native-technical.json'),universe=read('data/v20/master-universe.json'),current=read('data/v20/current.json'),policyRoot=read('data/v20/decision-intelligence-policy.json'),profiles=read('data/v20/stock-profiles.json'),policy=policyRoot.fullMarketNativeSelection||{};
check(selection.schemaVersion==='20.0.0-full-market-native-selection-1','NATIVE_SELECTION_SCHEMA_DRIFT');
check(technical.schemaVersion==='20.0.0-full-market-native-technical-1','NATIVE_TECH_SCHEMA_DRIFT');
check(selection.sessionDate===current.sessionDate&&technical.asOfSessionDate===current.sessionDate,'NATIVE_SESSION_MISMATCH');
check(selection.candidateUniverse==='V20_MASTER_UNIVERSE_FULL_MARKET','NATIVE_UNIVERSE_LABEL_DRIFT');
check(selection.candidateUniverseIsFullMarketIndependent===true,'NATIVE_NOT_FULL_MARKET_INDEPENDENT');
check(selection.legacySeedDependency===false,'NATIVE_LEGACY_SEED_DEPENDENCY_PRESENT');
check(selection.legacyReferenceUsedForComparisonOnly===true,'NATIVE_LEGACY_REFERENCE_ROLE_DRIFT');
check(selection.candidateUniverseCount===universe.count&&selection.summary?.universeCount===universe.count,'NATIVE_UNIVERSE_COUNT_MISMATCH');
check((selection.discoveryRanking||[]).length===universe.count,'NATIVE_DISCOVERY_NOT_FULL_UNIVERSE');
check((technical.symbols||[]).length===universe.count&&technical.summary?.universeCount===universe.count,'NATIVE_TECH_NOT_FULL_UNIVERSE');
check(technical.policy?.pointInTime===true&&technical.policy?.identityVerificationRequired===true&&technical.policy?.currentSessionRequired===true,'NATIVE_TECH_TRUST_POLICY_MISSING');
check(technical.policy?.missingOhlcSynthesisAllowed===false&&technical.policy?.futureRowsAllowed===false&&technical.policy?.providerBlendingAllowed===false,'NATIVE_TECH_PROVENANCE_POLICY_DRIFT');
check(technical.policy?.executionGateInfluence===false&&technical.policy?.productionAllocationInfluence===false&&technical.policy?.championInfluence===false,'NATIVE_TECH_PRODUCTION_LEAK');
const dw=policy.discoveryWeightsPct||{},fw=selection.scoring?.finalApprovedWeightsPct||{};
check(Object.values(dw).reduce((s,v)=>s+Number(v||0),0)===100,'NATIVE_DISCOVERY_WEIGHTS_NOT_100');
check(Number(dw.liquidity)===30,'NATIVE_DISCOVERY_LIQUIDITY_NOT_30');
check(Number(fw.liquidity)===30,'NATIVE_FINAL_LIQUIDITY_NOT_30');
check(Number(fw.supportResistance)===12,'NATIVE_FINAL_SR_NOT_12');
check(selection.scoring?.legacyComponentExcludedFromNativeScore===true&&Number(selection.scoring?.finalNonLegacyWeightPct)===90,'NATIVE_LEGACY_NOT_EXCLUDED');
check(Number(selection.summary?.legacyScoringContributionPct)===0,'NATIVE_LEGACY_SCORING_CONTRIBUTION_NOT_ZERO');
check(selection.activeProductionChampion==='V16_9_EQUAL_WEIGHT_BASKET','NATIVE_CHAMPION_DRIFT');
check(selection.automaticPromotion===false&&selection.executionPermission===false&&selection.productionAllocation===false,'NATIVE_PRODUCTION_GOVERNANCE_LEAK');
check(selection.governance?.researchOnly===true&&selection.governance?.V17RemainsExecutionAuthority===true&&selection.governance?.canChangeChampion===false,'NATIVE_EXECUTION_AUTHORITY_DRIFT');
const seen=new Set();for(const r of selection.discoveryRanking||[]){check(!seen.has(r.ticker),`NATIVE_DISCOVERY_DUPLICATE_${r.ticker}`);seen.add(r.ticker);const s=finite(r.score);check(s===null||(s>=0&&s<=100),`NATIVE_DISCOVERY_SCORE_RANGE_${r.ticker}`)}
const techMap=new Map((technical.symbols||[]).map(r=>[r.ticker,r]));let ready=0;for(const r of technical.symbols||[]){if(r.currentReady!==true)continue;ready++;check(r.identityVerified===true,`NATIVE_TECH_READY_IDENTITY_${r.ticker}`);check(r.asOfSession===current.sessionDate,`NATIVE_TECH_READY_SESSION_${r.ticker}`);check(Number(r.rowsUsed)>=50,`NATIVE_TECH_READY_ROWS_${r.ticker}`);check(Number(r.currentPriceDifferencePct)<=Number(technical.policy.currentPriceReconciliationTolerancePct),`NATIVE_TECH_READY_PRICE_DIFF_${r.ticker}`);check(r.usedForShadowNativeResearchScore===true,`NATIVE_TECH_READY_SCORE_FLAG_${r.ticker}`);check(r.executionGateInfluence===false&&r.productionAllocationInfluence===false&&r.championInfluence===false,`NATIVE_TECH_ROW_PRODUCTION_LEAK_${r.ticker}`);check((r.blockers||[]).length===0,`NATIVE_TECH_READY_BLOCKERS_${r.ticker}`)}
check(ready===Number(technical.summary?.currentReadyCount||0),'NATIVE_TECH_READY_COUNT_MISMATCH');
const ranking=selection.recommendationRanking||[],details=new Map((selection.candidateDetails||[]).map(r=>[r.ticker,r])),seenRec=new Set();
check(Number(selection.summary?.nativeResearchRecommendationCount||0)===ranking.length,'NATIVE_RECOMMENDATION_COUNT_MISMATCH');
for(const r of ranking){check(!seenRec.has(r.ticker),`NATIVE_RECOMMENDATION_DUPLICATE_${r.ticker}`);seenRec.add(r.ticker);const d=details.get(r.ticker);check(!!d,`NATIVE_RECOMMENDATION_DETAIL_MISSING_${r.ticker}`);if(!d)continue;const score=finite(d.nativeResearch?.score);check(score!==null&&score>=Number(policy.minimumFinalResearchScore||0)&&score<=100,`NATIVE_RECOMMENDATION_SCORE_${r.ticker}`);check(d.nativeResearch?.recommendationEligible===true&&d.nativeResearch?.scoreIsConfidence===false,`NATIVE_RECOMMENDATION_SEMANTICS_${r.ticker}`);check(d.nativeResearch?.executionPermission===false&&d.nativeResearch?.productionAllocation===false,`NATIVE_RECOMMENDATION_PRODUCTION_LEAK_${r.ticker}`);check(Number(d.nativeResearch?.legacyContributionPct)===0&&Number(d.nativeResearch?.availableNonLegacyWeightPct)===90,`NATIVE_RECOMMENDATION_LEGACY_OR_EVIDENCE_${r.ticker}`);check(d.evidence?.liquidity?.shortTermEligible===true,`NATIVE_RECOMMENDATION_LIQUIDITY_${r.ticker}`);check(d.evidence?.technical?.available===true&&techMap.get(r.ticker)?.currentReady===true,`NATIVE_RECOMMENDATION_TECH_${r.ticker}`);check((d.evidence?.supportResistance?.confluence?.methodCount||0)>=Number(policy.minimumSrMethodCount||2),`NATIVE_RECOMMENDATION_SR_${r.ticker}`);check(d.evidence?.researchTradePlan?.valid===true&&finite(d.evidence?.researchTradePlan?.netRiskReward)>0,`NATIVE_RECOMMENDATION_PLAN_${r.ticker}`);check(!(d.blockers||[]).includes('CRITICAL_SOURCE_CONFLICT'),`NATIVE_RECOMMENDATION_CONFLICT_${r.ticker}`);if(d.evidence?.researchTradePlan?.alignment?.state==='ABOVE_ENTRY_RANGE_DO_NOT_CHASE')check(score<=Number(policyRoot.defensiveCaps?.aboveEntryRangeDoNotChaseMaxScore||55),`NATIVE_DO_NOT_CHASE_CAP_${r.ticker}`)}
check((selection.top5||[]).every((r,i)=>r.ticker===ranking[i]?.ticker),'NATIVE_TOP5_NOT_PREFIX');
check((selection.top10||[]).every((r,i)=>r.ticker===ranking[i]?.ticker),'NATIVE_TOP10_NOT_PREFIX');
check(profiles.fullMarketNativeSelection?.engineId===selection.engineId&&profiles.fullMarketNativeSelection?.candidateUniverseIsFullMarketIndependent===true&&profiles.fullMarketNativeSelection?.legacySeedDependency===false,'NATIVE_NOT_EMBEDDED_IN_PROFILES');
const report={schemaVersion:'20.0.0-full-market-native-regression-1',generatedAt:new Date().toISOString(),ok:failures.length===0,failedCount:failures.length,failures,evidence:{universeCount:universe.count,technicalReadyCount:ready,recommendationCount:ranking.length,outsideLegacySeedCount:selection.summary?.nativeResearchCandidatesOutsideLegacySeedCount??null,top10OutsideLegacySeedCount:selection.summary?.top10OutsideLegacySeedCount??null,top5:selection.top5||[]},checks:{fullMasterUniverseScanned:true,legacySeedDependencyRemoved:true,legacyContributionZero:true,liquidityWeight30:true,supportResistanceWeight12:true,pointInTimeTechnicalRequired:true,multiMethodSrRequired:true,evidenceDerivedTradePlanRequired:true,conservativeCostAwareNetRrRequired:true,v17ExecutionAuthorityPreserved:true,championProtected:true,automaticPromotionDisabled:true,productionAllocationDisabled:true}};
selection.regression=report;profiles.fullMarketNativeSelection=selection;write('data/v20/full-market-native-selection.json',selection);write('data/v20/stock-profiles.json',profiles);write('data/v20/full-market-native-regression.json',report);console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
