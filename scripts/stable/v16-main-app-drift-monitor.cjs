#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const P=r=>path.join(ROOT,r);
const ENGINE='V16_9_EQUAL_WEIGHT_BASKET';
const OUT=P('data/stable/v16-main-app-drift-monitor.json');
function read(rel,f={}){try{return JSON.parse(fs.readFileSync(P(rel),'utf8'));}catch{return f;}}
function write(file,v){fs.mkdirSync(path.dirname(file),{recursive:true});const t=`${file}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n');JSON.parse(fs.readFileSync(t,'utf8'));fs.renameSync(t,file);}
function n(v,d=null){const x=Number(v);return Number.isFinite(x)?x:d;}
function round(v,d=3){if(!Number.isFinite(Number(v)))return null;const f=10**d;return Math.round(Number(v)*f)/f;}
function metrics(values){const a=values.filter(Number.isFinite);const gains=a.reduce((s,v)=>s+Math.max(0,v),0);const losses=Math.abs(a.reduce((s,v)=>s+Math.min(0,v),0));let eq=1,peak=1,dd=0;for(const v of a){eq*=1+v/100;peak=Math.max(peak,eq);dd=Math.min(dd,(eq/peak-1)*100);}return{sessions:a.length,averageNetReturnPct:round(a.length?a.reduce((s,v)=>s+v,0)/a.length:0,4),winningSessionPct:round(a.length?a.filter(v=>v>0).length/a.length*100:0,2),profitFactor:round(losses>0?gains/losses:null,3),maximumDrawdownPct:round(dd,3)};}
function sha(v){return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');}
const live=read('data/stable/v16-v169-live-evaluation.json');
const basket=read('data/research/v16-v169-basket-engine.json');
const current=read('data/stable/v16-main-app-current.json');
if((live.engine||current?.governance?.activeEngine)!==ENGINE)throw new Error('MAIN APP engine mismatch');
const resolved=(live.sessions||[]).filter(s=>s.status==='RESOLVED'&&Number.isFinite(Number(s.netReturnPct)));
const all=metrics(resolved.map(s=>Number(s.netReturnPct)));
const recent5=metrics(resolved.slice(-5).map(s=>Number(s.netReturnPct)));
const recent3=metrics(resolved.slice(-3).map(s=>Number(s.netReturnPct)));
const wf=basket.blockedWalkForwardMetrics||{};
const gates={positiveAverage:n(all.averageNetReturnPct,0)>0,profitFactor:n(all.profitFactor,0)>=1.2,winRate:n(all.winningSessionPct,0)>=45,drawdown:n(all.maximumDrawdownPct,-100)>=-15};
const warnings=[];
if(recent5.sessions>=3&&n(recent5.averageNetReturnPct,0)<=0)warnings.push('RECENT5_AVERAGE_NON_POSITIVE');
if(recent5.sessions>=3&&n(recent5.profitFactor,0)<1)warnings.push('RECENT5_PF_BELOW_1');
if(recent5.sessions>=3&&n(recent5.winningSessionPct,0)<40)warnings.push('RECENT5_WIN_RATE_BELOW_40');
if(n(all.maximumDrawdownPct,0)<=-10)warnings.push('LIVE_DRAWDOWN_BELOW_MINUS_10');
const hardDeterioration=Object.values(gates).some(v=>!v);
const status=hardDeterioration?'ALERT':warnings.length?'WATCH':'STABLE';
const out={schemaVersion:'16.9.2-drift-monitor-v1',generatedAt:new Date().toISOString(),engine:ENGINE,sessionDate:current.sessionDate||null,status,statusAr:status==='STABLE'?'مستقر':status==='WATCH'?'مراقبة انحراف':'تنبيه انحراف',productionEffect:'NONE',immutableMethodology:{changesAlphaOrRanking:false,changesEntryStopTargetAllocation:false,changesExecutionGrant:false,advisoryOnly:true},liveAll:all,recent5,recent3,walkForwardReference:{sessions:n(wf.sessions,0),averageNetReturnPct:n(wf.averageNetReturnPct,0),winningSessionPct:n(wf.sessionWinRatePct,0),profitFactor:n(wf.profitFactor,0),maximumDrawdownPct:n(wf.maximumDrawdownPct,0)},deltasVsWalkForward:{averageNetReturnPct:round(n(all.averageNetReturnPct,0)-n(wf.averageNetReturnPct,0),4),winningSessionPct:round(n(all.winningSessionPct,0)-n(wf.sessionWinRatePct,0),2),profitFactor:round(n(all.profitFactor,0)-n(wf.profitFactor,0),3),maximumDrawdownPct:round(n(all.maximumDrawdownPct,0)-n(wf.maximumDrawdownPct,0),3)},promotionSafetyChecks:gates,warnings,interpretationAr:'المراقب يرصد الانحراف فقط ولا يغير ترتيب الأسهم أو التوصيات أو السماح بالتنفيذ. أي تغيير في الاستراتيجية يتطلب نسخة Challenger مستقلة واختبارًا منفصلًا.'};
out.monitorHash=sha({engine:out.engine,sessionDate:out.sessionDate,status:out.status,liveAll:out.liveAll,recent5:out.recent5,warnings:out.warnings});
write(OUT,out);console.log(JSON.stringify({output:path.relative(ROOT,OUT),status:out.status,resolvedSessions:all.sessions,recent5,warnings,changesAlphaOrRanking:false},null,2));