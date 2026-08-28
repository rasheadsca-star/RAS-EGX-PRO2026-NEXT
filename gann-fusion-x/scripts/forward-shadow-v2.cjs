#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..'),GFX=path.join(ROOT,'gann-fusion-x'),DATA=path.join(GFX,'data'),HIST=path.join(ROOT,'data','history');
const COST=.6,HOLD=3,TOPN=3,MIN_FORWARD_SESSIONS=20;
const read=(f,d=null)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}};
const write=(f,x)=>fs.writeFileSync(f,JSON.stringify(x,null,2)+'\n');
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const num=v=>finite(v)?Number(v):null;
const round=(n,d=4)=>finite(n)?Number(Number(n).toFixed(d)):null;
const pct=(a,b)=>finite(a)&&finite(b)&&Number(b)!==0?((Number(a)/Number(b))-1)*100:null;
const sum=a=>a.reduce((x,y)=>x+y,0);
function normBars(doc){
  return(doc?.sessions||[]).map(x=>{
    const close=num(x.close),adj=num(x.adjustedClose),open=num(x.open),high=num(x.high),low=num(x.low),volume=num(x.volume);
    if(!(close>0)||!(open>0)||!(high>0)||!(low>0))return null;
    const adjusted=adj>0?adj:close,factor=adjusted/close;
    return{date:x.date,open:open*factor,high:high*factor,low:low*factor,close:adjusted,volume};
  }).filter(Boolean).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
}
const universe=[];
if(fs.existsSync(HIST))for(const file of fs.readdirSync(HIST).filter(x=>x.endsWith('.json'))){
  const doc=read(path.join(HIST,file));if(!doc)continue;
  const bars=normBars(doc);if(bars.length<20)continue;
  universe.push({ticker:String(doc.ticker||file.replace(/\.json$/i,'')).trim().toUpperCase(),nameAr:doc.companyNameAr||doc.companyNameEn||'',bars});
}
const byTicker=new Map(universe.map(x=>[x.ticker,x]));
const future=(u,d,n=HOLD)=>u.bars.filter(x=>String(x.date)>String(d)).slice(0,n);
function marketInfo(){
  const x=read(path.join(ROOT,'data','quant','market-search-index-v13-17.json'),{});
  return{date:x.marketDate||x.analysisSession||null,generatedAt:x.generatedAt||null};
}
function readinessInfo(){return read(path.join(DATA,'data-readiness-current-v1.json'),{});}
function validLevels(x){
  return num(x?.entryLow)>0&&num(x?.entryHigh)>0&&num(x?.stopLoss)>0&&num(x?.target1)>0&&num(x.entryLow)<=num(x.entryHigh)&&num(x.stopLoss)<num(x.entryHigh)&&num(x.target1)>num(x.entryLow);
}
function v16Source(doc,marketDate){
  const date=doc?.sessionDate||null,fresh=Boolean(date&&date===marketDate),rows=[];
  if(fresh)for(const [i,x] of (doc?.recommendations||[]).entries()){
    if(rows.length>=TOPN)break;
    if(x.currentSessionEligible===false||x.referenceOnly)continue;
    const row={ticker:String(x.ticker||'').trim().toUpperCase(),nameAr:x.companyNameAr||'',rank:i+1,score:round(x.estimatedTop10ProbabilityPct,2),action:x.status||x.category||'PENDING_OPEN',entryLow:round(x.entryLow),entryHigh:round(x.entryHigh),stopLoss:round(x.stopLoss),target1:round(x.target1),target2:null,target3:null,portfolioPct:round(x.portfolioWeightPct,2)};
    if(row.ticker&&validLevels(row))rows.push(row);
  }
  return{engine:'V16_9_LIVE',date,generatedAt:doc?.generatedAt||null,fresh,status:fresh?'FRESH':'STALE_SESSION',rows};
}
function sepaSource(doc,marketDate){
  const date=doc?.sessionDate||doc?.meta?.marketSession||null,fresh=Boolean(date&&date===marketDate),rows=[];
  if(fresh)for(const [i,x] of (doc?.rows||doc?.views?.top||[]).entries()){
    if(rows.length>=TOPN)break;
    const ticker=String(x.symbol||x.ticker||'').trim().toUpperCase(),pivot=num(x.pivot),riskPct=num(x.risk_pct),rr=num(x.reward_risk);
    if(!ticker||!(pivot>0)||!(riskPct>0)||!(rr>0))continue;
    const stop=pivot*(1-riskPct/100),risk=pivot-stop,target=pivot+risk*rr;
    const row={ticker,nameAr:x.nameAr||x.name||'',rank:i+1,score:round(x.final_score,1),action:x.action||x.status||'WATCH_TRIGGER',entryLow:round(pivot*.995),entryHigh:round(pivot*1.005),stopLoss:round(stop),target1:round(target),target2:null,target3:null,portfolioPct:null,meta:{pivot:round(pivot),riskPct:round(riskPct,2),rewardRisk:round(rr,2),status:x.status||null}};
    if(validLevels(row))rows.push(row);
  }
  return{engine:'SEPA_X_LIVE_SHADOW',date,generatedAt:doc?.generatedAt||doc?.meta?.sourceSnapshotGeneratedAt||null,fresh,status:fresh?'FRESH':'STALE_SESSION',rows};
}
function gannSource(readiness,marketDate){
  const date=readiness?.dataReadinessSummary?.decisionDate||readiness?.sessionDate||null;
  const gated=readiness?.guardrails?.dataReadinessGate===true&&readiness?.guardrails?.nonReadyExcludedFromAllRankedOutputs===true;
  const fresh=Boolean(gated&&date&&date===marketDate),rows=[];
  if(fresh)for(const [i,x] of (readiness?.dailyTop||[]).entries()){
    if(rows.length>=TOPN)break;
    const dr=x?.dataReadiness||{},plan=x?.decisionFunnel?.speculative||{},levels=plan?.levels||{},allocation=num(plan?.size?.allocationPct);
    if(dr.status!=='READY'||dr.decisionDate!==date||plan?.decision?.code!=='ACTIONABLE'||!(allocation>0))continue;
    const row={ticker:String(x.ticker||'').trim().toUpperCase(),nameAr:x.nameAr||x.companyNameAr||'',rank:i+1,score:round(plan.rankScore??plan.score??x.score,1),action:'ACTIONABLE',entryLow:round(levels.entryLow),entryHigh:round(levels.entryHigh),stopLoss:round(levels.stopLoss),target1:round(levels.target1),target2:round(levels.target2),target3:round(levels.target3),portfolioPct:round(allocation,2),forwardEligibilitySchema:'v2-ready-only',dataReadiness:{status:'READY',decisionDate:dr.decisionDate,checks:dr.checks||{},missing:Array.isArray(dr.missing)?dr.missing:[],dataQuality:dr.dataQuality||null,provenance:dr.provenance||null},meta:{decision:plan.decision||null,reasonCode:plan.reasonCode||null,reasonAr:plan.reasonAr||null,readinessSchema:readiness.schemaVersion||null}};
    if(row.ticker&&validLevels(row)&&row.dataReadiness.missing.length===0)rows.push(row);
  }
  return{engine:'GANN_FUSION_X_V1',date,generatedAt:readiness?.generatedAt||null,fresh,status:fresh?'FRESH_READY_GATED':'BLOCKED_READINESS_OR_SESSION',rows,readinessSummary:readiness?.dataReadinessSummary||null};
}
const keyOf=(session,engine,ticker,evidenceSchema=null)=>[session,engine,ticker,evidenceSchema].filter(Boolean).join('|');
function isStrictGannSignal(s){
  return s?.engine==='GANN_FUSION_X_V1'&&s?.forwardEligibilitySchema==='v2-ready-only'&&s?.dataReadiness?.status==='READY'&&s?.dataReadiness?.decisionDate===s?.signalSession&&Array.isArray(s?.dataReadiness?.missing)&&s.dataReadiness.missing.length===0&&s?.action==='ACTIONABLE'&&num(s?.portfolioPct)>0;
}
function evaluate(s){
  const u=byTicker.get(String(s?.ticker||'').toUpperCase());if(!u||!s?.signalSession||!validLevels(s))return null;
  const win=future(u,s.signalSession,HOLD);if(win.length<HOLD)return null;
  let entered=false,entry=null,entryDate=null,exit=null,exitDate=null,status='UNFILLED';
  for(const b of win){
    if(String(b.date)<=String(s.signalSession))throw new Error(`LOOKAHEAD_GUARD_BROKEN ${s.key} ${b.date}`);
    if(!entered){
      if(b.open>=s.entryLow&&b.open<=s.entryHigh){entry=b.open;entryDate=b.date;entered=true}
      else if(b.low<=s.entryHigh&&b.high>=s.entryLow){entry=b.open>s.entryHigh?s.entryHigh:b.open<s.entryLow?s.entryLow:b.open;entryDate=b.date;entered=true}
      else continue;
    }
    const hitStop=b.low<=s.stopLoss,hitTarget=b.high>=s.target1;
    if(hitStop&&hitTarget){exit=s.stopLoss;exitDate=b.date;status='STOP_SAME_BAR';break}
    if(hitStop){exit=s.stopLoss;exitDate=b.date;status='STOP_HIT';break}
    if(hitTarget){exit=s.target1;exitDate=b.date;status='TARGET_HIT';break}
  }
  if(!entered)return{signalKey:s.key,signalSession:s.signalSession,engine:s.engine,ticker:s.ticker,status:'UNFILLED',evaluatedThrough:win.at(-1).date,entryPrice:null,entryDate:null,exitPrice:null,exitDate:null,grossReturnPct:null,netReturnPct:null,holdingSessions:HOLD,evaluationSchema:'v2-null-safe'};
  if(exit===null){exit=win.at(-1).close;exitDate=win.at(-1).date;status='TIME_EXIT'}
  const gross=pct(exit,entry),net=gross===null?null:gross-COST;
  return{signalKey:s.key,signalSession:s.signalSession,engine:s.engine,ticker:s.ticker,status,entryPrice:round(entry),entryDate,exitPrice:round(exit),exitDate,evaluatedThrough:win.at(-1).date,grossReturnPct:round(gross,3),netReturnPct:round(net,3),holdingSessions:HOLD,evaluationSchema:'v2-null-safe'};
}
function metrics(signals,outcomes){
  const keys=new Set(signals.map(s=>s.key)),outs=outcomes.filter(o=>keys.has(o.signalKey)),filled=outs.filter(o=>o.status!=='UNFILLED'&&finite(o.entryPrice)&&finite(o.netReturnPct)),nets=filled.map(o=>Number(o.netReturnPct)),pos=nets.filter(x=>x>0),neg=nets.filter(x=>x<0),posSum=sum(pos),negAbs=Math.abs(sum(neg));
  return{signalsIssued:signals.length,evaluated:outs.length,filled:filled.length,positiveRatePct:filled.length?round(pos.length/filled.length*100,1):null,averageNetPct:nets.length?round(sum(nets)/nets.length,3):null,profitFactor:negAbs>0?round(posSum/negAbs,2):null,targetHitPct:filled.length?round(filled.filter(o=>o.status==='TARGET_HIT').length/filled.length*100,1):null,stopHitPct:filled.length?round(filled.filter(o=>String(o.status).startsWith('STOP')).length/filled.length*100,1):null};
}
function summary(ledger){
  const result={},engines=[...new Set(ledger.signals.map(s=>s.engine))];
  for(const engine of engines){
    const all=ledger.signals.filter(s=>s.engine===engine),selected=engine==='GANN_FUSION_X_V1'?all.filter(isStrictGannSignal):all;
    result[engine]={...metrics(selected,ledger.outcomes),totalRecordedSignals:all.length,legacySignalsExcluded:engine==='GANN_FUSION_X_V1'?all.length-selected.length:0,evidenceScope:engine==='GANN_FUSION_X_V1'?'READY_ONLY_V2':'DIAGNOSTIC_SHADOW'};
  }
  return result;
}
function main(){
  const ledgerPath=path.join(DATA,'forward-shadow-ledger.json'),ledger=read(ledgerPath,{})||{};
  ledger.signals=Array.isArray(ledger.signals)?ledger.signals:[];ledger.outcomes=Array.isArray(ledger.outcomes)?ledger.outcomes:[];
  ledger.policy={...(ledger.policy||{}),minimumForwardSessionsForPromotion:Number(ledger.policy?.minimumForwardSessionsForPromotion||MIN_FORWARD_SESSIONS),gannPromotionEvidence:'READY_ONLY_V2',automaticPromotion:false,missingValuesRemainUnknown:true,entryStrictlyAfterSignal:true};
  const market=marketInfo(),readiness=readinessInfo(),sepaRaw=read(path.join(DATA,'sepa-x-snapshot.json'),{})||{};
  const sources=[v16Source(read(path.join(ROOT,'data','stable','v16-main-app-current.json'),{})||{},market.date),sepaSource(sepaRaw,market.date),gannSource(readiness,market.date)];
  const existing=new Set(ledger.signals.map(s=>s.key));let addedSignals=0;
  for(const src of sources.filter(s=>s.fresh))for(const r of src.rows){
    const key=keyOf(src.date,src.engine,r.ticker,r.forwardEligibilitySchema||null);if(existing.has(key))continue;
    ledger.signals.push({key,recordedAt:new Date().toISOString(),signalSession:src.date,sourceGeneratedAt:src.generatedAt||null,engine:src.engine,ticker:r.ticker,nameAr:r.nameAr||'',rank:r.rank,score:r.score??null,action:r.action||null,entryLow:r.entryLow,entryHigh:r.entryHigh,stopLoss:r.stopLoss,target1:r.target1,target2:r.target2??null,target3:r.target3??null,portfolioPct:r.portfolioPct??null,forwardEligibilitySchema:r.forwardEligibilitySchema||null,dataReadiness:r.dataReadiness||null,meta:r.meta||null});
    existing.add(key);addedSignals++;
  }
  const outKeys=new Set(ledger.outcomes.map(o=>o.signalKey));let addedOutcomes=0;
  for(const s of ledger.signals){if(outKeys.has(s.key))continue;const o=evaluate(s);if(!o)continue;ledger.outcomes.push({...o,recordedAt:new Date().toISOString()});outKeys.add(s.key);addedOutcomes++}
  const current=sources.filter(s=>s.fresh),overlap={};
  for(const src of current)for(const r of src.rows){if(!overlap[r.ticker])overlap[r.ticker]=[];overlap[r.ticker].push(src.engine)}
  const diagnosticOverlap=Object.entries(overlap).filter(([,e])=>e.length>=2).map(([ticker,engines])=>({ticker,engines,count:engines.length})).sort((a,b)=>b.count-a.count||a.ticker.localeCompare(b.ticker));
  const eligibleGann=ledger.signals.filter(isStrictGannSignal),eligibleKeys=new Set(eligibleGann.map(s=>s.key)),eligibleOutcomes=ledger.outcomes.filter(o=>eligibleKeys.has(o.signalKey)&&o.evaluationSchema==='v2-null-safe'&&finite(o.netReturnPct));
  const evaluatedSessions=new Set(eligibleOutcomes.map(o=>o.signalSession)),minimum=ledger.policy.minimumForwardSessionsForPromotion,sufficient=evaluatedSessions.size>=minimum;
  const validation={status:sufficient?'EVIDENCE_SUFFICIENT_FOR_REVIEW':'COLLECTION_PENDING',promotionAllowed:false,performanceClaimAllowed:sufficient,automaticPromotion:false,eligibleSignals:eligibleGann.length,validEvaluatedOutcomes:eligibleOutcomes.length,evaluatedForwardSessions:evaluatedSessions.size,minimumForwardSessionsRequired:minimum,legacyGannSignalsExcluded:ledger.signals.filter(s=>s.engine==='GANN_FUSION_X_V1'&&!isStrictGannSignal(s)).length,pointInTimeReadinessRequired:true};
  const currentCandidates=Object.fromEntries(sources.map(s=>[s.engine,s.rows]));
  ledger.lastRun={at:new Date().toISOString(),marketSession:market.date,sourceStatus:Object.fromEntries(sources.map(s=>[s.engine,{session:s.date,fresh:s.fresh,status:s.status,signals:s.rows.length,readinessSummary:s.readinessSummary||undefined}])),currentCandidates,diagnosticOverlap,addedSignals,addedOutcomes,summary:summary(ledger),gannForwardValidation:validation};
  write(ledgerPath,ledger);
  write(path.join(DATA,'forward-shadow-report.json'),{schemaVersion:'gann-fusion-x-forward-shadow-report-v4-ready-only-null-safe',generatedAt:ledger.lastRun.at,marketSession:market.date,sourceStatus:ledger.lastRun.sourceStatus,currentCandidates,status:validation.status,gannForwardValidation:validation,diagnosticOverlap,summary:ledger.lastRun.summary,forwardSessions:[...new Set(eligibleGann.map(s=>s.signalSession))].sort(),evaluatedForwardSessions:[...evaluatedSessions].sort(),minimumForwardSessionsForPromotion:minimum,policy:ledger.policy,notesAr:['GANN Forward يلتقط فقط dailyTop الناتج من Data Readiness Gate ولا يعيد حساب المحرك بشكل مستقل.','أي GANN signal جديد يجب أن يحمل READY snapshot في نفس signalSession وأن يكون ACTIONABLE وبحجم تنفيذ موجب.','إشارات GANN القديمة تبقى في ledger دون حذف، لكنها مستبعدة من دليل الترقية إذا لم تحمل مخطط READY_ONLY_V2.','القيم المفقودة تظل null/Unknown؛ UNFILLED لا ينتج عائدًا رقميًا، ولا يستخدم Profit Factor قيمة بديلة مصطنعة.','كل تقييم يبدأ من جلسة لاحقة فعليًا لجلسة الإشارة؛ لا تستخدم شمعة الإشارة في الدخول أو الخروج.','حتى اكتمال الحد الأدنى من جلسات Forward الحقيقية تكون الحالة COLLECTION_PENDING ولا يوجد ادعاء أداء أو ترقية تلقائية.']});
  console.log(JSON.stringify(ledger.lastRun,null,2));
}
if(require.main===module)main();
module.exports={normBars,isStrictGannSignal,evaluate,metrics,gannSource,validLevels};
