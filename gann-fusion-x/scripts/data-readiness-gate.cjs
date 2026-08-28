#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const ROOT=path.resolve(__dirname,'../..'),DATA=path.join(ROOT,'gann-fusion-x','data');
const CURRENT=path.join(DATA,'current.json'),OUT=path.join(DATA,'data-readiness-current-v1.json'),INDEX=path.join(ROOT,'data','quant','market-search-index-v13-17.json');
const read=(p,d={})=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return d}};
const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
cp.execFileSync(process.execPath,[path.join(ROOT,'gann-fusion-x','scripts','build-snapshot.cjs')],{stdio:'inherit'});
const s=read(CURRENT,{}),idx=read(INDEX,{stocks:[]}),stocks=new Map((idx.stocks||[]).map(x=>[String(x.ticker||'').toUpperCase(),x]));
const decisionDate=s.sessionDate||s.market?.decisionSession||idx.marketDate||idx.analysisSession||null;
let downgraded=0,ready=0,incomplete=0;
function forceWatch(plan,missing){
  if(!plan)return;
  if(plan.decision?.code==='ACTIONABLE')downgraded++;
  plan.eligible=false;
  plan.decision={code:'WATCH',ar:'بيانات غير مكتملة — لا دخول',tone:'warn',order:1,reasonCode:'DATA_INCOMPLETE',reasonAr:`بيانات حرجة غير مكتملة: ${missing.join(', ')}`};
  plan.reasonCode='DATA_INCOMPLETE';
  plan.reasonAr=`بيانات حرجة غير مكتملة: ${missing.join(', ')}`;
  plan.actionAr='مراقبة فقط لحين اكتمال البيانات والتحقق منها.';
  if(plan.size){plan.size.allocationPct=0;plan.size.effectiveMaxAllocationPct=0;plan.size.adjustmentsAr=[...(plan.size.adjustmentsAr||[]),'تم إيقاف التنفيذ بسبب Data Readiness Gate.'];}
}
for(const a of s.all||[]){
  const t=String(a.ticker||'').toUpperCase(),stock=stocks.get(t)||{};
  const historyFresh=a.sessionDate===decisionDate&&Number(a.historyMeta?.availableSessions||0)>=20;
  const liquidityKnown=finite(stock.liquidityPercentile);
  const riskKnown=finite(stock.riskScore);
  const moneyFlowKnown=finite(stock.momentumMoneyFlow?.moneyFlowQualityScore);
  const fundamentalsVerified=a.sepaEvidence?.fundamentals?.verified===true;
  const priceKnown=finite(stock.price)&&Number(stock.price)>0;
  const checks={priceKnown,historyFresh,liquidityKnown,riskKnown,moneyFlowKnown,fundamentalsVerified};
  const missing=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
  a.dataReadiness={status:missing.length?'DATA_INCOMPLETE':'READY',checks,missing,decisionDate,provenance:{marketIndex:'data/quant/market-search-index-v13-17.json',history:a.historyMeta||null,sepaFundamentals:a.sepaEvidence?.fundamentals||null}};
  if(missing.length){incomplete++;for(const h of ['speculative','medium','long'])forceWatch(a.decisionFunnel?.[h],missing);}else ready++;
}
function by(h,code,limit=20){return(s.all||[]).filter(x=>x.decisionFunnel?.[h]?.decision?.code===code).sort((a,b)=>Number(b.decisionFunnel?.[h]?.rankScore??b.decisionFunnel?.[h]?.score??0)-Number(a.decisionFunnel?.[h]?.rankScore??a.decisionFunnel?.[h]?.score??0)).slice(0,limit)}
s.dailyTop=by('speculative','ACTIONABLE',5);s.weeklyTop=by('medium','ACTIONABLE',5);s.watchRadar=by('speculative','WATCH',20);s.rejectedRadar=by('speculative','REJECTED',20);s.recommendations=s.dailyTop;
for(const h of ['speculative','medium','long'])s.funnelSummary[h]={actionable:by(h,'ACTIONABLE',9999).length,watch:by(h,'WATCH',9999).length,rejected:by(h,'REJECTED',9999).length};
const top=s.dailyTop[0]?.decisionFunnel?.speculative||s.watchRadar[0]?.decisionFunnel?.speculative||null;s.summary={decision:top?.decision?.code||'WATCH',decisionAr:top?.decision?.ar||'انتظار اكتمال البيانات',confidence:top?.rankScore??top?.score??0,reasonAr:top?.reasonAr||'لا توجد توصية قابلة للدخول بعد تطبيق بوابة اكتمال البيانات.'};
s.schemaVersion='gann-fusion-x-data-readiness-v1';s.generatedAt=new Date().toISOString();s.status='RESEARCH_DATA_READINESS_GATED';s.statusAr='نسخة بحثية خضعت لبوابة اكتمال البيانات قبل السماح بأي ACTIONABLE.';s.dataReadinessSummary={ready,incomplete,downgraded,actionableAfterGate:s.dailyTop.length,decisionDate};s.guardrails={...(s.guardrails||{}),dataReadinessGate:true,actionableRequiresFreshHistory:true,actionableRequiresKnownLiquidity:true,actionableRequiresKnownRisk:true,actionableRequiresKnownMoneyFlow:true,actionableRequiresVerifiedFundamentals:true,missingDataNeverNegativeEvidence:true};
write(OUT,s);console.log(JSON.stringify({decisionDate,ready,incomplete,downgraded,actionable:s.dailyTop.map(x=>x.ticker),watch:s.watchRadar.slice(0,10).map(x=>({ticker:x.ticker,missing:x.dataReadiness?.missing||[]}))},null,2));
