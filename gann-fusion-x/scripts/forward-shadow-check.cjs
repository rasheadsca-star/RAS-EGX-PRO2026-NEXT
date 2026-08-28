#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const DATA=path.resolve(__dirname,'../data'),ledgerFile=path.join(DATA,'forward-shadow-ledger.json'),reportFile=path.join(DATA,'forward-shadow-report.json');
const read=(p,d={})=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return d}};
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const x=read(ledgerFile,{}),report=read(reportFile,{});
const signals=Array.isArray(x.signals)?x.signals:[],outcomes=Array.isArray(x.outcomes)?x.outcomes:[],errors=[],warnings=[];
const strict=s=>s?.engine==='GANN_FUSION_X_V1'&&s?.forwardEligibilitySchema==='v2-ready-only';
const signalKeys=new Set();
for(const s of signals){
  if(!s.key||signalKeys.has(s.key))errors.push('duplicate or missing signal key: '+String(s.key));
  signalKeys.add(s.key);
  if(!s.signalSession||!s.engine||!s.ticker)errors.push('incomplete signal identity: '+String(s.key));
  if(!(finite(s.entryLow)&&Number(s.entryLow)>0&&finite(s.entryHigh)&&Number(s.entryHigh)>0&&finite(s.stopLoss)&&Number(s.stopLoss)>0&&finite(s.target1)&&Number(s.target1)>0))errors.push('invalid plan levels: '+String(s.key));
  if(finite(s.entryLow)&&finite(s.entryHigh)&&Number(s.entryLow)>Number(s.entryHigh))errors.push('inverted entry range: '+String(s.key));
  if(finite(s.stopLoss)&&finite(s.entryHigh)&&Number(s.stopLoss)>=Number(s.entryHigh))errors.push('stop must be below entry: '+String(s.key));
  if(finite(s.target1)&&finite(s.entryLow)&&Number(s.target1)<=Number(s.entryLow))errors.push('target must be above entry: '+String(s.key));
  if(strict(s)){
    if(s.dataReadiness?.status!=='READY'||s.dataReadiness?.decisionDate!==s.signalSession)errors.push('strict GANN signal lacks coherent READY snapshot: '+String(s.key));
    if(!Array.isArray(s.dataReadiness?.missing)||s.dataReadiness.missing.length)errors.push('strict GANN signal has missing readiness checks: '+String(s.key));
    if(s.action!=='ACTIONABLE'||!(finite(s.portfolioPct)&&Number(s.portfolioPct)>0))errors.push('strict GANN signal is not actionable with positive size: '+String(s.key));
  }
}
const outcomeKeys=new Set();
for(const o of outcomes){
  if(!o.signalKey||outcomeKeys.has(o.signalKey))errors.push('duplicate or missing outcome: '+String(o.signalKey));
  outcomeKeys.add(o.signalKey);
  if(!signalKeys.has(o.signalKey))errors.push('orphan outcome: '+String(o.signalKey));
  const s=signals.find(v=>v.key===o.signalKey);
  if(o.evaluationSchema==='v2-null-safe'){
    if(o.entryDate&&String(o.entryDate)<=String(s?.signalSession))errors.push('entry is not after signal session: '+String(o.signalKey));
    if(o.exitDate&&o.entryDate&&String(o.exitDate)<String(o.entryDate))errors.push('exit precedes entry: '+String(o.signalKey));
    if(o.status==='UNFILLED'&&[o.entryPrice,o.entryDate,o.exitPrice,o.exitDate,o.grossReturnPct,o.netReturnPct].some(v=>v!==null&&v!==undefined))errors.push('v2 UNFILLED contains fabricated numeric/date outcome: '+String(o.signalKey));
  }else if(o.status==='UNFILLED'&&finite(o.netReturnPct))warnings.push('legacy UNFILLED numeric return excluded from v2 evidence: '+String(o.signalKey));
}
const strictGann=signals.filter(s=>strict(s)&&s.dataReadiness?.status==='READY'&&s.action==='ACTIONABLE'&&finite(s.portfolioPct)&&Number(s.portfolioPct)>0);
const legacyGann=signals.filter(s=>s.engine==='GANN_FUSION_X_V1'&&!strict(s));
if(legacyGann.length)warnings.push('legacy GANN signals excluded from promotion evidence: '+legacyGann.length);
const validation=report.gannForwardValidation||{},minimum=Number(x.policy?.minimumForwardSessionsForPromotion||20),evaluatedSessions=Number(validation.evaluatedForwardSessions||0);
if(evaluatedSessions<minimum){
  if(validation.status!=='COLLECTION_PENDING')errors.push('insufficient forward sample must remain COLLECTION_PENDING');
  if(validation.performanceClaimAllowed===true||validation.promotionAllowed===true)errors.push('insufficient forward sample cannot permit performance claim or promotion');
}
if(validation.automaticPromotion!==false)errors.push('automatic forward promotion must remain disabled');
const reportStrict=(report.forwardSessions||[]).length;
if(reportStrict!==new Set(strictGann.map(s=>s.signalSession)).size)errors.push('report forwardSessions does not match strict READY-only GANN evidence');
const result={ok:errors.length===0,signals:signals.length,outcomes:outcomes.length,strictGannSignals:strictGann.length,legacyGannSignalsExcluded:legacyGann.length,evaluatedForwardSessions:evaluatedSessions,minimumForwardSessions:minimum,status:validation.status||null,errors,warnings};
console.log(JSON.stringify(result,null,2));
if(errors.length)process.exit(1);
