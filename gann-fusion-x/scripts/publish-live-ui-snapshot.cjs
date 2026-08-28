#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..'),DATA=path.join(ROOT,'gann-fusion-x','data');
const read=(name,d=null)=>{try{return JSON.parse(fs.readFileSync(path.join(DATA,name),'utf8'))}catch{return d}};
const write=(name,x)=>fs.writeFileSync(path.join(DATA,name),JSON.stringify(x,null,2)+'\n');
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const num=v=>finite(v)?Number(v):null;
const round=(v,d=2)=>finite(v)?Number(Number(v).toFixed(d)):null;
const must=(cond,msg)=>{if(!cond)throw new Error(msg)};
const ready=read('data-readiness-current-v1.json'),forward=read('forward-shadow-report.json'),dataGate=read('data-completion-destroyer-v2.json'),engineGate=read('engine-destroyer-v1.json'),rankingGate=read('ranking-destroyer-v1.json'),forwardGate=read('forward-shadow-destroyer-v1.json');
for(const [name,g] of [['data',dataGate],['engine',engineGate],['ranking',rankingGate],['forward',forwardGate]])must(g?.passed===true&&Number(g.critical||0)===0&&Number(g.major||0)===0,`LIVE_UI_BLOCKED_${name.toUpperCase()}_GATE`);
must(ready?.guardrails?.dataReadinessGate===true,'LIVE_UI_READINESS_GATE_MISSING');
must(ready?.guardrails?.nonReadyExcludedFromAllRankedOutputs===true,'LIVE_UI_NONREADY_EXCLUSION_MISSING');
const sessionDate=ready?.dataReadinessSummary?.decisionDate||ready?.sessionDate;
must(Boolean(sessionDate),'LIVE_UI_SESSION_MISSING');
const universe=Array.isArray(ready?.universeReadiness)?ready.universeReadiness:[],analyses=Array.isArray(ready?.all)?ready.all:[],byAnalysis=new Map(analyses.map(x=>[String(x.ticker||'').toUpperCase(),x]));
const compactDecision=(u)=>{
  const ticker=String(u?.ticker||'').toUpperCase(),a=byAnalysis.get(ticker)||{},dr=a.dataReadiness||u||{},spec=a?.decisionFunnel?.speculative||{},decision=spec.decision||{},levels=spec.levels||{},size=spec.size||{},isReady=dr.status==='READY',allocation=num(size.allocationPct),actionable=isReady&&decision.code==='ACTIONABLE'&&allocation>0;
  const dq=dr.dataQuality||{};
  return{
    ticker,
    nameAr:u?.companyNameAr||a?.nameAr||'',
    nameEn:u?.companyNameEn||'',
    status:isReady?'READY':'DATA_INCOMPLETE',
    decisionDate:dr.decisionDate||sessionDate,
    missing:Array.isArray(dr.missing)?dr.missing:[],
    checks:dr.checks||{},
    close:num(a.close),
    score:isReady?num(a.score):null,
    classification:isReady?(a.classification||null):null,
    decision:{code:isReady?(decision.code||'WATCH'):'WATCH',ar:isReady?(decision.ar||'مراقبة'):'بيانات غير مكتملة — لا دخول',reasonCode:isReady?(decision.reasonCode||spec.reasonCode||null):'DATA_INCOMPLETE',reasonAr:isReady?(decision.reasonAr||spec.reasonAr||''):`بيانات حرجة غير مكتملة: ${(Array.isArray(dr.missing)?dr.missing:[]).join(', ')}`},
    plan:{entryLow:actionable?num(levels.entryLow):null,entryHigh:actionable?num(levels.entryHigh):null,trigger:actionable?num(levels.trigger):null,stopLoss:actionable?num(levels.stopLoss):null,target1:actionable?num(levels.target1):null,target2:actionable?num(levels.target2):null,target3:actionable?num(levels.target3):null,allocationPct:actionable?allocation:0},
    risk:{liquidityPercentile:num(dq.liquidityPercentile),riskScore:num(dq.riskScore),riskLabelAr:dq.riskLabelAr||null},
    actionable:Boolean(actionable)
  };
};
const stocks=universe.map(compactDecision),byStock=new Map(stocks.map(x=>[x.ticker,x]));
const list=(key)=>{const src=Array.isArray(ready?.[key])?ready[key]:[],out=[];for(const x of src){const ticker=String(x?.ticker||'').toUpperCase(),s=byStock.get(ticker);must(Boolean(s),`LIVE_UI_${key.toUpperCase()}_UNKNOWN_TICKER_${ticker}`);must(s.status==='READY',`LIVE_UI_${key.toUpperCase()}_NONREADY_${ticker}`);out.push(ticker)}return out;};
const dailyTop=list('dailyTop'),recommendations=list('recommendations');
must(JSON.stringify(dailyTop)===JSON.stringify(recommendations),'LIVE_UI_RECOMMENDATION_DAILY_PARITY_BROKEN');
for(const ticker of dailyTop){const s=byStock.get(ticker);must(s.actionable===true&&s.plan.allocationPct>0,`LIVE_UI_DAILY_NOT_ACTIONABLE_${ticker}`)}
for(const s of stocks.filter(x=>x.status!=='READY'))must(s.actionable===false&&s.plan.allocationPct===0&&[s.plan.entryLow,s.plan.entryHigh,s.plan.trigger,s.plan.stopLoss,s.plan.target1,s.plan.target2,s.plan.target3].every(v=>v===null),`LIVE_UI_NONREADY_EXECUTION_LEAK_${s.ticker}`);
const summary=ready.dataReadinessSummary||{},active=Number(summary.activeUniverse||universe.length),readyCount=Number(summary.universeReady||stocks.filter(x=>x.status==='READY').length),quarantined=Number(summary.quarantined||stocks.filter(x=>x.status!=='READY').length),actionable=Number(summary.actionableAfterGate||dailyTop.length);
must(active===universe.length,'LIVE_UI_ACTIVE_UNIVERSE_MISMATCH');must(readyCount===stocks.filter(x=>x.status==='READY').length,'LIVE_UI_READY_COUNT_MISMATCH');must(quarantined===stocks.filter(x=>x.status!=='READY').length,'LIVE_UI_QUARANTINE_COUNT_MISMATCH');
const fv=forward?.gannForwardValidation||{};
if(Number(fv.evaluatedForwardSessions||0)<Number(fv.minimumForwardSessionsRequired||20)){must(fv.status==='COLLECTION_PENDING','LIVE_UI_FORWARD_PENDING_STATUS_REQUIRED');must(fv.performanceClaimAllowed!==true,'LIVE_UI_FORWARD_PERFORMANCE_CLAIM_FORBIDDEN');must(fv.promotionAllowed!==true,'LIVE_UI_FORWARD_PROMOTION_FORBIDDEN')}
const snapshot={schemaVersion:'gann-fusion-x-live-ui-v1-ready-only',generatedAt:new Date().toISOString(),sessionDate,sourceGeneratedAt:ready.generatedAt||null,publication:{status:'PUBLISHED_READY_GATED',sourceSchema:ready.schemaVersion||null,forwardGeneratedAt:forward?.generatedAt||null,gates:{data:true,engine:true,ranking:true,forward:true}},guardrails:{readinessGate:true,recommendationsReadyOnly:true,nonReadyAllocationZero:true,missingNeverZero:true,noUngatedFallback:true,forwardPerformanceClaimGated:true,coverageDisclosureRequired:true},coverage:{activeUniverse:active,ready:readyCount,quarantined,actionable,coveragePct:active?round(readyCount/active*100,2):null,disclosureAr:`التوصيات مرتبة فقط داخل الأسهم المكتملة البيانات: ${readyCount} من ${active} سهم. الأسهم غير المكتملة لا تُعامل كفرص ضعيفة ولا تدخل الترتيب.`},lists:{recommendations,dailyTop,weeklyTop:list('weeklyTop'),gannCalendar:list('gannCalendar'),breakoutRadar:list('breakoutRadar'),accumulationRadar:list('accumulationRadar'),avoidExitRadar:list('avoidExitRadar')},stocks,forward:{status:fv.status||forward?.status||'COLLECTION_PENDING',performanceClaimAllowed:fv.performanceClaimAllowed===true,promotionAllowed:fv.promotionAllowed===true,automaticPromotion:fv.automaticPromotion===true,eligibleSignals:Number(fv.eligibleSignals||0),validEvaluatedOutcomes:Number(fv.validEvaluatedOutcomes||0),evaluatedForwardSessions:Number(fv.evaluatedForwardSessions||0),minimumForwardSessionsRequired:Number(fv.minimumForwardSessionsRequired||20),noteAr:fv.performanceClaimAllowed===true?'اكتملت عينة الحد الأدنى للمراجعة؛ لا توجد ترقية تلقائية.':'الأداء المستقبلي لم يعتمد بعد؛ جمع الأدلة الحقيقية مستمر.'},backtest:{fullGannHistoricalStatus:'NOT_VALIDATED_HISTORICALLY',performanceClaimAllowed:false,noteAr:'لا توجد Fundamentals تاريخية point-in-time كافية لاعتماد Full Gann تاريخيًا.'}};
write('live-ui-current-v1.json',snapshot);
console.log(JSON.stringify({schemaVersion:snapshot.schemaVersion,sessionDate,coverage:snapshot.coverage,lists:snapshot.lists,forward:snapshot.forward},null,2));
