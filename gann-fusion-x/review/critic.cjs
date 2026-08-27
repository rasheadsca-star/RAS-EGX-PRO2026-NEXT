#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const ROOT=path.resolve(__dirname,'../..'),read=(p,d={})=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return d}};
const findings=[];const add=(severity,code,message)=>findings.push({severity,code,message});
const current=read(path.join(ROOT,'gann-fusion-x/data/current.json'),{}),index=read(path.join(ROOT,'data/quant/market-search-index-v13-17.json'),{}),legacy=read(path.join(ROOT,'data/stable/v16-main-app-current.json'),{});
if(!fs.existsSync(path.join(ROOT,'gann-fusion-x/engine/gann.js')))add('critical','GANN_MISSING','محرك Gann غير موجود.');
if(!fs.existsSync(path.join(ROOT,'gann-fusion-x/engine/fusion.js')))add('critical','FUSION_MISSING','محرك Fusion غير موجود.');
if(!fs.existsSync(path.join(ROOT,'gann-fusion-x/app/index-v1.html')))add('major','UI_MISSING','واجهة V1 غير موجودة.');
if(!index.summary?.withHistory)add('major','NO_HISTORY_UNIVERSE','فهرس السوق لا يعلن أسهمًا بتاريخ سعري.');
if(current.guardrails?.automaticOrders!==false)add('critical','AUTO_ORDER_RISK','يجب أن يبقى التنفيذ الآلي معطلاً.');
if(current.guardrails?.readOnlyLegacySources!==true)add('major','READ_ONLY_GUARD_MISSING','حارس القراءة فقط للمصادر القديمة غير معلن.');
if(current.sessionDate&&current.market?.decisionSession&&current.sessionDate!==current.market.decisionSession)add('critical','SESSION_MISMATCH','جلسة snapshot لا تطابق جلسة القرار.');
for(const r of current.recommendations||[]){if(r.plan&&!(r.plan.stopLoss<r.plan.entryHigh))add('major','STOP_RELATION',`${r.ticker}: وقف غير منطقي.`);if(r.plan&&!(r.plan.target1>r.plan.entryLow))add('major','TARGET_RELATION',`${r.ticker}: هدف غير منطقي.`);if(!r.explanation?.action)add('major','NO_EXPLANATION',`${r.ticker}: لا يوجد شرح مبسط.`)}
if(legacy.sessionDate&&index.marketDate&&legacy.sessionDate!==index.marketDate)add('minor','LEGACY_SESSION_DIFFERENT','جلسة EGX Pro تختلف عن جلسة Full Market؛ يجب عرضها كدليل مرجعي لا كإجماع مباشر.');
const critical=findings.filter(x=>x.severity==='critical').length,major=findings.filter(x=>x.severity==='major').length;const out={passed:critical===0&&major===0,critical,major,minor:findings.filter(x=>x.severity==='minor').length,findings};console.log(JSON.stringify(out,null,2));if(!out.passed)process.exitCode=1;