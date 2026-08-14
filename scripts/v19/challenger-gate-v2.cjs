#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.');
const input=JSON.parse(fs.readFileSync(path.join(root,'data/v19/native-challenger-v2.json'),'utf8'));
const out=path.join(root,'data/v19/challenger-status-v2.json');
const h=input.independentHoldout?.metrics||{};const b=input.independentHoldout?.internalTop10BaselineSameWindow?.metrics||{};const c=input.championReference?.publishedBlockedWalkForwardMetrics||{};
const f=(x,d=0)=>Number.isFinite(Number(x))?Number(x):d;
const checks={
 engineIdentity:input.engineId==='V19_CHAT_GPT_NATIVE_CHALLENGER_V2',shadowOnly:input.status==='SHADOW_RESEARCH_ONLY',noAutomaticPromotion:input.methodology?.automaticPromotion===false,
 developmentOosAtLeast30:f(input.coverage?.developmentOosSessions)>=30,holdoutAtLeast20:f(input.coverage?.holdoutSessions)>=20,holdoutFrozen:input.independentHoldout?.frozen===true&&input.independentHoldout?.labelsNeverUsedForRefit===true,
 averageBeatsPublishedChampionBy015pp:f(h.averageNetReturnPct,-99)>=f(c.averageNetReturnPct,99)+.15,
 profitFactorNotWorseThanChampion:f(h.profitFactor,-99)>=f(c.profitFactor,99),winRateNotWorseThanChampion:f(h.sessionWinRatePct,-99)>=f(c.sessionWinRatePct,99),drawdownNotWorseThanChampion:f(h.maximumDrawdownPct,-99)>=f(c.maximumDrawdownPct,99),
 averageBeatsInternalTop10By010pp:f(h.averageNetReturnPct,-99)>=f(b.averageNetReturnPct,99)+.10,positiveHoldoutAverage:f(h.averageNetReturnPct)<=99&&f(h.averageNetReturnPct)>0,positiveHoldoutCompounded:f(h.compoundedNetReturnPct)>0,v16Untouched:input.isolation?.v16Untouched===true,v17Untouched:input.isolation?.v17Untouched===true
};
const failed=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);const gatePassed=failed.length===0;
const report={schemaVersion:'19.1.0-challenger-gate-v2',generatedAt:new Date().toISOString(),champion:'V16_9_EQUAL_WEIGHT_BASKET',v17Reference:'V17 currently governs the same V16_9 champion ranking',challenger:input.engineId,status:gatePassed?'CHALLENGER_ELIGIBLE_FOR_RELEASE_REVIEW':'SHADOW_RESEARCH_CONTINUES',gatePassed,promotionAllowed:false,automaticPromotion:false,explicitReleaseReviewRequired:true,comparison:{publishedChampion:c,internalTop10SameWindow:b,v19Holdout:h,averageVsChampionPp:input.championReference?.holdoutAverageVsPublishedChampionPp,averageVsInternalTop10Pp:input.championReference?.holdoutAverageVsInternalTop10BaselinePp},checks,failedChecks:failed,disclosureAr:'حتى عند اجتياز البوابة لا تحدث ترقية تلقائية. النجاح يعني فقط أن V19 v2 تفوق وفق معايير البحث المحددة ويستحق مراجعة إصدار مستقلة.'};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
