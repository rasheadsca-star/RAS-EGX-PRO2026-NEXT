#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r);
const report=JSON.parse(fs.readFileSync(P('data/v19/native-challenger.json'),'utf8'));
const out=P('data/v19/challenger-status.json');
const CHAMPION='V16_9_EQUAL_WEIGHT_BASKET',CHALLENGER='V19_CHAT_GPT_NATIVE_CHALLENGER';
const MIN_HOLDOUT=20,MIN_DEVELOPMENT_BLOCKED=30,MIN_IMPROVEMENT_PP=.15,COST=.60;
const finite=(v,d=null)=>Number.isFinite(Number(v))?Number(v):d;
const hold=report.independentHoldout?.metrics||{},dev=report.developmentBlockedWalkForward?.metrics||{},champ=report.championReference?.metrics||{};
const improvement=finite(report.championReference?.averageNetReturnImprovementPctPoints,-999);
const checks={
  engineIdentity:report.engineId===CHALLENGER&&report.championReference?.engineId===CHAMPION,
  shadowOnly:report.status==='SHADOW_RESEARCH_ONLY'&&report.current?.executionAllowed===false,
  noAutomaticPromotion:report.methodology?.automaticPromotion===false&&report.promotion?.automaticPromotion===false,
  transactionCostNotLowerThanChampion:finite(report.methodology?.transactionCostPct,0)>=COST,
  developmentBlockedSessionsAtLeast30:finite(dev.sessions,0)>=MIN_DEVELOPMENT_BLOCKED,
  independentHoldoutAtLeast20:finite(hold.sessions,0)>=MIN_HOLDOUT,
  independentHoldoutFrozen:report.independentHoldout?.frozen===true&&report.independentHoldout?.labelsNeverUsedForRefit===true,
  averageNetImprovementAtLeast015pp:improvement>=MIN_IMPROVEMENT_PP,
  profitFactorNotWorseThanChampion:finite(hold.profitFactor,0)>=finite(champ.profitFactor,0),
  winRateNotWorseThanChampion:finite(hold.sessionWinRatePct,0)>=finite(champ.sessionWinRatePct,0),
  drawdownNotWorseThanChampion:finite(hold.maximumDrawdownPct,-100)>=finite(champ.maximumDrawdownPct,-100),
  positiveHoldoutAverage:finite(hold.averageNetReturnPct,0)>0,
  positiveHoldoutCompounded:finite(hold.compoundedNetReturnPct,0)>0,
  v16UntouchedByDesign:report.isolation?.v16Untouched===true,
  v17UntouchedByDesign:report.isolation?.v17Untouched===true
};
const passed=Object.values(checks).every(Boolean);
const result={schemaVersion:'19.0.0-challenger-gate-1',generatedAt:new Date().toISOString(),champion:CHAMPION,challenger:CHALLENGER,status:passed?'CHALLENGER_ELIGIBLE_FOR_RELEASE_REVIEW':'SHADOW_RESEARCH_CONTINUES',gatePassed:passed,promotionAllowed:false,automaticPromotion:false,explicitReleaseReviewRequired:true,thresholds:{minimumDevelopmentBlockedSessions:MIN_DEVELOPMENT_BLOCKED,minimumIndependentHoldoutSessions:MIN_HOLDOUT,minimumAverageNetImprovementPctPoints:MIN_IMPROVEMENT_PP,minimumTransactionCostPct:COST},comparison:{championBlockedWalkForward:champ,challengerIndependentHoldout:hold,averageNetReturnImprovementPctPoints:improvement},checks,failedChecks:Object.entries(checks).filter(([,ok])=>!ok).map(([k])=>k),disclosureAr:passed?'اجتاز V19 بوابة البحث للمراجعة فقط؛ لا تتم أي ترقية تلقائية ولا يتغير V16 أو V17.':'V19 يظل Shadow/Research فقط. فشل أي شرط يمنع الترقية ولا يغير V16 أو V17.'};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n','utf8');console.log(JSON.stringify(result,null,2));
