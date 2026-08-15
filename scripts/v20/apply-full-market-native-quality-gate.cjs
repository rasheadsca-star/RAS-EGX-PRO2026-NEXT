#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r);
function patch(rel,from,to,label){const f=P(rel);let text=fs.readFileSync(f,'utf8');if(text.includes(to))return{label,state:'ALREADY_APPLIED'};if(!text.includes(from))throw new Error(`${rel}: ${label} source pattern not found`);text=text.replace(from,to);fs.writeFileSync(f,text,'utf8');return{label,state:'APPLIED'}}
const results=[];
results.push(patch('scripts/v20/build-full-market-native-selection.cjs',
  `eligible=struct&&tp.valid&&aw===nonLegacy&&score!==null&&score>=p.minimumFinalResearchScore;return{`,
  `eligible=struct&&tp.valid&&nr!==null&&nr>=p.minimumNetRiskReward&&aw===nonLegacy&&score!==null&&score>=p.minimumFinalResearchScore;return{`,
  'minimum-net-rr-eligibility'));
results.push(patch('scripts/v20/build-full-market-native-selection.cjs',
  `tp.valid!==true?'EVIDENCE_DERIVED_RESEARCH_TRADE_PLAN_NOT_READY':null].filter(Boolean)}});`,
  `tp.valid!==true?'EVIDENCE_DERIVED_RESEARCH_TRADE_PLAN_NOT_READY':null,nr!==null&&nr<p.minimumNetRiskReward?'NET_RR_BELOW_NATIVE_MINIMUM':null].filter(Boolean)}});`,
  'minimum-net-rr-blocker'));
results.push(patch('scripts/v20/build-full-market-native-selection.cjs',
  `nativeResearchRecommendationCount:eligible.length,nativeResearchCandidatesOutsideLegacySeedCount:outside`,
  `nativeResearchRecommendationCount:eligible.length,publishedResearchCandidateCount:Math.min(eligible.length,p.maximumPublishedResearchCandidates),nativeResearchCandidatesOutsideLegacySeedCount:outside`,
  'published-versus-eligible-count'));
results.push(patch('scripts/v20/full-market-native-regression.cjs',
  `check(Number(selection.summary?.nativeResearchRecommendationCount||0)===ranking.length,'NATIVE_RECOMMENDATION_COUNT_MISMATCH');`,
  `const expectedPublished=Math.min(Number(selection.summary?.nativeResearchRecommendationCount||0),Number(policy.maximumPublishedResearchCandidates||30));check(Number(selection.summary?.publishedResearchCandidateCount||0)===ranking.length&&ranking.length===expectedPublished,'NATIVE_RECOMMENDATION_COUNT_MISMATCH');`,
  'regression-published-count'));
results.push(patch('scripts/v20/full-market-native-regression.cjs',
  `check(d.evidence?.researchTradePlan?.valid===true&&finite(d.evidence?.researchTradePlan?.netRiskReward)>0,\`NATIVE_RECOMMENDATION_PLAN_\${r.ticker}\`);`,
  `check(d.evidence?.researchTradePlan?.valid===true&&finite(d.evidence?.researchTradePlan?.netRiskReward)>=Number(policy.minimumNetRiskReward||0.7),\`NATIVE_RECOMMENDATION_PLAN_\${r.ticker}\`);`,
  'regression-minimum-net-rr'));
results.push(patch('scripts/v20/full-market-native-regression.cjs',
  `conservativeCostAwareNetRrRequired:true,v17ExecutionAuthorityPreserved:true`,
  `conservativeCostAwareNetRrRequired:true,minimumNetRiskRewardPreserved:true,v17ExecutionAuthorityPreserved:true`,
  'regression-minimum-net-rr-report'));
console.log(JSON.stringify({schemaVersion:'20.0.0-full-market-native-quality-gate-patch-1',minimumNetRiskReward:0.7,results},null,2));
