#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.');
const P=r=>path.join(root,r);
const read=(r,f=null)=>{try{return JSON.parse(fs.readFileSync(P(r),'utf8'))}catch(e){if(f!==null)return f;throw e}};
const write=(r,v)=>{const f=P(r);fs.mkdirSync(path.dirname(f),{recursive:true});const t=`${f}.tmp`;fs.writeFileSync(t,`${JSON.stringify(v,null,2)}\n`,'utf8');JSON.parse(fs.readFileSync(t,'utf8'));fs.renameSync(t,f)};
const hash=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const pick=(o,keys)=>Object.fromEntries(keys.map(k=>[k,o?.[k]??null]));
const fileHash=rel=>fs.existsSync(P(rel))?hash(fs.readFileSync(P(rel))):null;

const FREEZE_ID='V20_NATIVE_V1_METHOD_FREEZE_20260813';
const MODEL_ID='V20_FULL_MARKET_NATIVE_SELECTION';
const MODEL_VERSION='V1';
const FREEZE_SESSION='2026-08-13';
const FREEZE_SOURCE_COMMIT='9283b72305c581776b5762f04b3b9d7c7dbe6dd1';
const FROZEN_AT='2026-08-15T15:40:08Z';
const policyDoc=read('data/v20/decision-intelligence-policy.json');
const p=policyDoc.fullMarketNativeSelection||{};
if(p.engineId!=='V20_FULL_MARKET_NATIVE_SELECTION_V1')throw new Error(`Unexpected Native engine ${p.engineId}`);
if(p.legacySeedDependency!==false||p.candidateUniverseIsFullMarketIndependent!==true)throw new Error('Native V1 full-market independence drift');
if(p.rankingDiscrimination?.contract!=='V20_SAFETY_STRENGTH_LEXICOGRAPHIC_TIE_BREAK_V2')throw new Error('Native V1 ranking contract drift');
if(p.rankingDiscrimination?.mutatesNativeResearchScore!==false||p.rankingDiscrimination?.canOverrideHigherNativeResearchScore!==false)throw new Error('Native V1 ranking contract can mutate/override score');

const contracts={
  ruleset:{
    engineId:p.engineId,status:p.status,candidateUniverse:p.candidateUniverse,candidateUniverseIsFullMarketIndependent:p.candidateUniverseIsFullMarketIndependent,legacySeedDependency:p.legacySeedDependency,legacyReferenceUsedForComparisonOnly:p.legacyReferenceUsedForComparisonOnly,minimumDataEvidenceScore:p.minimumDataEvidenceScore,minimumSrMethodCount:p.minimumSrMethodCount,minimumNetRiskReward:p.minimumNetRiskReward,minimumFinalResearchScore:p.minimumFinalResearchScore,maximumPublishedResearchCandidates:p.maximumPublishedResearchCandidates,rankingDiscrimination:p.rankingDiscrimination,defensiveCaps:policyDoc.defensiveCaps,tierThresholds:policyDoc.tierThresholds
  },
  weights:{discoveryWeightsPct:p.discoveryWeightsPct,finalComponentWeightsPct:policyDoc.componentWeightsPct,legacyNativeContributionPct:0},
  liquidity:p.liquidity2,
  supportResistance:p.supportResistanceConfluence,
  technical:{pointInTimeRequired:true,currentSessionRequired:true,identityVerificationRequired:true,minimumTrustedRows:50,currentPriceReconciliationTolerancePct:5,missingOhlcSynthesisAllowed:false,futureRowsAllowed:false,providerBlendingAllowed:false},
  riskReward:{minimumNetRiskReward:p.minimumNetRiskReward,roundTripTransactionCostPct:p.tradePlan?.roundTripTransactionCostPct,defensiveCaps:policyDoc.defensiveCaps},
  tradePlan:p.tradePlan,
  riskPolicy:{researchOnly:true,executionPermission:false,productionAllocation:false,automaticPromotion:false,activeChampion:'V16_9_EQUAL_WEIGHT_BASKET',v17RemainsExecutionAuthority:true},
  universePolicy:pick(p,['candidateUniverse','candidateUniverseIsFullMarketIndependent','legacySeedDependency','legacyReferenceUsedForComparisonOnly']),
  dataPolicy:{minimumDataEvidenceScore:p.minimumDataEvidenceScore,currentSessionRequired:true,criticalSourceConflictCannotBeIgnored:true,legacySeedContributionPct:0}
};
const hashes={
  rulesetHash:hash(contracts.ruleset),weightsHash:hash(contracts.weights),liquidityPolicyHash:hash(contracts.liquidity),srPolicyHash:hash(contracts.supportResistance),technicalPolicyHash:hash(contracts.technical),rrPolicyHash:hash(contracts.riskReward),tradePlanPolicyHash:hash(contracts.tradePlan),riskPolicyHash:hash(contracts.riskPolicy),universePolicyHash:hash(contracts.universePolicy),dataPolicyHash:hash(contracts.dataPolicy)
};
const compositeModelDigest=hash({modelId:MODEL_ID,modelVersion:MODEL_VERSION,...hashes});
const materialization={
  selectionSource:'scripts/v20/build-full-market-native-selection.cjs',
  rankingFinalizerSource:'scripts/v20/finalize-native-ranking-v1.cjs',
  explainabilitySource:'scripts/v20/build-native-explainability.cjs',
  selectionSourceHash:fileHash('scripts/v20/build-full-market-native-selection.cjs'),
  rankingFinalizerSourceHash:fileHash('scripts/v20/finalize-native-ranking-v1.cjs'),
  explainabilitySourceHash:fileHash('scripts/v20/build-native-explainability.cjs'),
  note:'Source materialization hashes may change only for proven implementation fixes that preserve the frozen methodological composite digest; any methodological digest change requires a new model version and fresh evidence window.'
};
const existing=read('data/v20/native-model-freeze.json',{});
if(existing?.modelId===MODEL_ID&&existing?.modelVersion===MODEL_VERSION&&existing?.compositeModelDigest&&existing.compositeModelDigest!==compositeModelDigest){
  throw new Error(`NATIVE_V1_FREEZE_DIGEST_DRIFT: existing=${existing.compositeModelDigest} current=${compositeModelDigest}; create V2 instead of mutating V1`);
}
const out={
  schemaVersion:'20.0.0-native-model-freeze-1',
  freezeId:FREEZE_ID,
  modelId:MODEL_ID,
  modelVersion:MODEL_VERSION,
  engineId:p.engineId,
  frozenAt:FROZEN_AT,
  freezeSessionDate:FREEZE_SESSION,
  commitSHA:FREEZE_SOURCE_COMMIT,
  ...hashes,
  compositeModelDigest,
  freshEvidenceWindowStart:'AFTER_2026-08-13',
  baselineSessionCountsAsFreshEvidence:false,
  rankingContract:p.rankingDiscrimination.contract,
  governance:{immutableMethodology:true,methodologyChangeRequiresNewVersion:true,retuneV1Forbidden:true,automaticPromotion:false,executionInfluence:false,productionAllocationInfluence:false,activeChampion:'V16_9_EQUAL_WEIGHT_BASKET'},
  contracts,
  materialization
};
write('data/v20/native-model-freeze.json',out);
console.log(JSON.stringify({ok:true,freezeId:FREEZE_ID,modelId:MODEL_ID,modelVersion:MODEL_VERSION,freezeSessionDate:FREEZE_SESSION,commitSHA:FREEZE_SOURCE_COMMIT,compositeModelDigest,freshEvidenceWindowStart:out.freshEvidenceWindowStart},null,2));
