#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..'),DATA=path.join(ROOT,'gann-fusion-x','data'),APP=path.join(ROOT,'gann-fusion-x','app');
const read=(p,d={})=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return d}};
const txt=p=>{try{return fs.readFileSync(p,'utf8')}catch{return''}};
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const snap=read(path.join(DATA,'live-ui-current-v1.json')),ready=read(path.join(DATA,'data-readiness-current-v1.json')),forward=read(path.join(DATA,'forward-shadow-report.json')),dataGate=read(path.join(DATA,'data-completion-destroyer-v2.json')),engineGate=read(path.join(DATA,'engine-destroyer-v1.json')),rankingGate=read(path.join(DATA,'ranking-destroyer-v1.json')),forwardGate=read(path.join(DATA,'forward-shadow-destroyer-v1.json'));
const app=txt(path.join(APP,'app.js')),index=txt(path.join(APP,'index.html')),indexV1=txt(path.join(APP,'index-v1.html'));
const findings=[],add=(severity,code,message,evidence={})=>findings.push({severity,code,message,evidence});
for(const [name,g] of [['data',dataGate],['engine',engineGate],['ranking',rankingGate],['forward',forwardGate]])if(g?.passed!==true||Number(g.critical||0)>0||Number(g.major||0)>0)add('critical','PREREQUISITE_GATE_NOT_GREEN',`${name} gate is not green.`,{name,passed:g?.passed,critical:g?.critical,major:g?.major});
if(snap.schemaVersion!=='gann-fusion-x-live-ui-v1-ready-only'||snap.publication?.status!=='PUBLISHED_READY_GATED')add('critical','SAFE_PUBLICATION_MISSING','Live UI safe publication snapshot is missing or invalid.');
if(!app.includes("../data/live-ui-current-v1.json"))add('critical','UI_SAFE_SOURCE_NOT_LOADED','app.js does not load the safe publication file.');
for(const forbidden of ['v16-main-app-current.json','market-search-index-v13-17.json','../data/current.json','GFXFusion.analyze','GFXPlanner.buildPlan'])if(app.includes(forbidden))add('critical','UI_UNGATED_SOURCE_OR_RECOMPUTE',`app.js contains forbidden ungated source/recompute: ${forbidden}`);
for(const [name,html] of [['index.html',index],['index-v1.html',indexV1]]){
  if(!html.includes('./app.js'))add('critical','ENTRYPOINT_SAFE_APP_MISSING',`${name} does not load app.js.`);
  for(const unsafe of ['./app-live.js','./features.js','./session-dashboard.js'])if(html.includes(unsafe))add('critical','ENTRYPOINT_UNSAFE_SCRIPT',`${name} still loads ${unsafe}.`);
}
const stocks=Array.isArray(snap.stocks)?snap.stocks:[],by=new Map(stocks.map(s=>[s.ticker,s])),universe=Array.isArray(ready.universeReadiness)?ready.universeReadiness:[];
if(stocks.length!==universe.length)add('critical','UI_UNIVERSE_COVERAGE_MISMATCH','Published searchable stock universe does not equal independent readiness universe.',{published:stocks.length,readiness:universe.length});
const expectedDaily=(ready.dailyTop||[]).map(x=>x.ticker),expectedRec=(ready.recommendations||[]).map(x=>x.ticker),publishedDaily=snap.lists?.dailyTop||[],publishedRec=snap.lists?.recommendations||[];
if(JSON.stringify(expectedDaily)!==JSON.stringify(expectedRec))add('critical','BACKEND_RECOMMENDATION_PARITY_BROKEN','Backend recommendations and dailyTop differ.',{expectedDaily,expectedRec});
if(JSON.stringify(expectedDaily)!==JSON.stringify(publishedDaily)||JSON.stringify(expectedRec)!==JSON.stringify(publishedRec))add('critical','UI_BACKEND_RECOMMENDATION_PARITY_BROKEN','Published UI recommendations differ from readiness-gated backend.',{expectedDaily,publishedDaily,publishedRec});
const readySet=new Set(universe.filter(x=>x.status==='READY').map(x=>x.ticker));
for(const key of ['dailyTop','weeklyTop','gannCalendar','breakoutRadar','accumulationRadar','avoidExitRadar'])for(const ticker of snap.lists?.[key]||[])if(!readySet.has(ticker))add('critical','QUARANTINED_LEAK_IN_UI_LIST',`${ticker} appears in ${key} without READY status.`,{ticker,key});
for(const s of stocks){
  if(s.status!=='READY'){
    if(s.actionable===true||Number(s.plan?.allocationPct)!==0)add('critical','NONREADY_UI_EXECUTION_LEAK',`${s.ticker} non-READY stock is executable in UI.`,{status:s.status,actionable:s.actionable,allocationPct:s.plan?.allocationPct});
    for(const k of ['entryLow','entryHigh','trigger','stopLoss','target1','target2','target3'])if(s.plan?.[k]!==null)add('major','NONREADY_UI_EXECUTION_LEVEL_VISIBLE',`${s.ticker} exposes ${k} despite DATA_INCOMPLETE.`,{value:s.plan?.[k]});
    if(finite(s.score))add('major','NONREADY_UI_RANK_SCORE_VISIBLE',`${s.ticker} exposes rank-like score despite DATA_INCOMPLETE.`,{score:s.score});
  }
}
for(const ticker of publishedDaily){const s=by.get(ticker);if(!s||s.status!=='READY'||s.actionable!==true||!(finite(s.plan?.allocationPct)&&Number(s.plan.allocationPct)>0))add('critical','PUBLISHED_RECOMMENDATION_NOT_EXECUTABLE_READY',`${ticker} recommendation lacks strict READY actionable plan.`)}
const c=snap.coverage||{},rs=ready.dataReadinessSummary||{};
for(const [k,a,b] of [['activeUniverse',c.activeUniverse,rs.activeUniverse],['ready',c.ready,rs.universeReady],['quarantined',c.quarantined,rs.quarantined],['actionable',c.actionable,rs.actionableAfterGate]])if(Number(a)!==Number(b))add('major','COVERAGE_DISCLOSURE_MISMATCH',`${k} disclosure differs from backend.`,{ui:a,backend:b});
if(!String(c.disclosureAr||'').includes(String(c.ready))||!String(c.disclosureAr||'').includes(String(c.activeUniverse)))add('major','COVERAGE_DISCLOSURE_NOT_EXPLICIT','Coverage disclosure does not explicitly show ready / active universe counts.',{disclosure:c.disclosureAr});
const fv=forward.gannForwardValidation||{};
if(snap.forward?.status!==fv.status||Boolean(snap.forward?.performanceClaimAllowed)!==Boolean(fv.performanceClaimAllowed))add('major','FORWARD_UI_STATUS_MISMATCH','Forward UI status does not match forward gate.',{ui:snap.forward,backend:fv});
if(fv.status==='COLLECTION_PENDING'&&(snap.forward?.performanceClaimAllowed===true||snap.forward?.promotionAllowed===true))add('critical','FORWARD_PENDING_PERFORMANCE_LEAK','UI allows performance/promotion claim while forward evidence is pending.');
if(snap.backtest?.fullGannHistoricalStatus!=='NOT_VALIDATED_HISTORICALLY'||snap.backtest?.performanceClaimAllowed!==false)add('critical','HISTORICAL_VALIDATION_OVERCLAIM','UI does not preserve NOT_VALIDATED_HISTORICALLY caveat.');
if(!app.includes('لا توجد fallback')&&!app.includes('fallback'))add('minor','UI_NO_FALLBACK_DISCLOSURE_TEXT','UI does not visibly disclose no-fallback behavior.');
if(!app.includes('DATA_INCOMPLETE')||!app.includes('0%'))add('major','UI_NONREADY_BLOCKING_COPY_MISSING','UI source lacks explicit DATA_INCOMPLETE / zero-size display behavior.');
const order={critical:0,major:1,minor:2};findings.sort((a,b)=>order[a.severity]-order[b.severity]||a.code.localeCompare(b.code));
const critical=findings.filter(x=>x.severity==='critical').length,major=findings.filter(x=>x.severity==='major').length,minor=findings.filter(x=>x.severity==='minor').length;
const out={schemaVersion:'live-ui-production-destroyer-v1',generatedAt:new Date().toISOString(),passed:critical===0&&major===0,critical,major,minor,findings,summary:{sessionDate:snap.sessionDate||null,activeUniverse:c.activeUniverse??null,ready:c.ready??null,quarantined:c.quarantined??null,actionable:c.actionable??null,coveragePct:c.coveragePct??null,recommendations:publishedRec,forwardStatus:snap.forward?.status||null,forwardPerformanceClaimAllowed:snap.forward?.performanceClaimAllowed??null,backtestStatus:snap.backtest?.fullGannHistoricalStatus||null},policy:{singleSafePublishedSource:true,noRawSourceFallback:true,readyOnlyRankedLists:true,nonReadyZeroSize:true,nonReadyNoExecutionLevels:true,backendUiRecommendationParity:true,coverageDisclosureRequired:true,forwardClaimGated:true,historicalOverclaimForbidden:true}};
fs.writeFileSync(path.join(DATA,'live-ui-production-destroyer-v1.json'),JSON.stringify(out,null,2)+'\n');
let md=`# Live UI / Production Destroyer V1\n\nStatus: **${out.passed?'PASS':'FAIL'}**\n\nCritical: **${critical}** — Major: **${major}** — Minor: **${minor}**\n\n`;
for(const f of findings)md+=`- **${f.severity.toUpperCase()} / ${f.code}** — ${f.message}\n`;
if(!findings.length)md+='No evidence-backed live UI / production finding remains.\n';
fs.writeFileSync(path.join(DATA,'live-ui-production-destroyer-v1.md'),md);
console.log(JSON.stringify(out,null,2));if(!out.passed)process.exitCode=1;
