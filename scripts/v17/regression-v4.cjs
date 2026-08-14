#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r),OUT='data/v17/regression.json';
const read=(r,d={})=>{try{return JSON.parse(fs.readFileSync(P(r),'utf8'))}catch{return d}},text=r=>{try{return fs.readFileSync(P(r),'utf8')}catch{return''}};
function write(r,v){const f=P(r);fs.mkdirSync(path.dirname(f),{recursive:true});const t=f+'.tmp';fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n','utf8');JSON.parse(fs.readFileSync(t,'utf8'));fs.renameSync(t,f)}
const base=cp.spawnSync(process.execPath,[P('scripts/v17/regression-v3.cjs')],{cwd:root,encoding:'utf8'}),baseReport=read(OUT,{tests:[]});
const workflow=text('.github/workflows/update-market-data.yml'),buildReview=text('.github/workflows/v17-build-review.yml');
const v4Market=workflow.includes('destructive-critic-v4.cjs'),v4Build=buildReview.includes('destructive-critic-v4.cjs');
const supersededNames=new Set();if(v4Market)supersededNames.add('workflow:market:critic-v3');if(v4Build)supersededNames.add('workflow:build:critic-v3');
const baseTests=Array.isArray(baseReport.tests)?baseReport.tests:[];
const tests=baseTests.map(t=>supersededNames.has(t.name)&&t.ok!==true?{...t,ok:true,message:`Superseded by mandatory Critic V4; original check was: ${t.message||''}`}:{...t});
function test(name,ok,message,severity='CRITICAL'){tests.push({name,ok:ok===true,severity,message:String(message||'')});}
const browser=read('data/v17/browser-runtime-critic.json',null),review=read('data/v17/review.json',null),current=read('data/v17/current.json',null);
test('browser-runtime:report-present',!!browser,'data/v17/browser-runtime-critic.json');
test('browser-runtime:zero-comments',browser?.schemaVersion==='17.0.0-browser-runtime-critic-1'&&browser?.verdict==='NO_COMMENTS'&&Number(browser?.totalFindings||0)===0&&Object.values(browser?.counts||{}).every(v=>Number(v)===0),`schema=${browser?.schemaVersion}; verdict=${browser?.verdict}; findings=${browser?.totalFindings}`);
test('browser-runtime:desktop-mobile',Array.isArray(browser?.checks)&&browser.checks.some(x=>x.label==='desktop')&&browser.checks.some(x=>x.label==='mobile'),'desktop and mobile Chromium checks required');
test('workflow:market:browser-runtime',workflow.includes('browser-runtime-critic.cjs'),'market workflow runs real Chromium critic');
test('workflow:build:browser-runtime',buildReview.includes('browser-runtime-critic.cjs'),'build review runs real Chromium critic');
test('workflow:market:critic-v4',v4Market,'market workflow runs destructive critic v4');
test('workflow:build:critic-v4',v4Build,'build review runs destructive critic v4');
test('review:v5-still-clean',review?.schemaVersion==='17.0.0-review-5'&&review?.verdict==='NO_COMMENTS'&&Object.values(review?.counts||{}).every(v=>Number(v)===0),`schema=${review?.schemaVersion}; verdict=${review?.verdict}`);
test('snapshot:finalized-current-semantics',current?.finalization?.staleChampionCurrentWeightsZeroed===true&&current?.finalization?.immutableSignalHashTouched===false&&current?.finalization?.ledgerTouched===false,'snapshot finalization remains immutable and historical weights are neutralized');
const failed=tests.filter(t=>!t.ok),criticalFailed=failed.filter(t=>t.severity==='CRITICAL');
const report={schemaVersion:'17.0.0-regression-4',generatedAt:new Date().toISOString(),contract:'V17_CANONICAL_RUNTIME_SESSION_TRUTH_BROWSER_CRITIC_AND_GOVERNANCE',ok:failed.length===0,total:tests.length,passed:tests.length-failed.length,failedCount:failed.length,criticalFailedCount:criticalFailed.length,failed:failed.map(t=>t.name),tests,baseRegression:{schemaVersion:baseReport.schemaVersion||null,total:Number(baseReport.total||0),passed:Number(baseReport.passed||0),failedCount:Number(baseReport.failedCount||0),supersededFailedChecks:[...supersededNames].filter(name=>baseTests.some(t=>t.name===name&&t.ok!==true))},rule:'Regression V4 is additive. Only obsolete Critic V3 wiring checks may be superseded by mandatory Critic V4 wiring; all substantive V3 failures remain failures.'};
write(OUT,report);console.log(JSON.stringify({schemaVersion:report.schemaVersion,ok:report.ok,total:report.total,passed:report.passed,failedCount:report.failedCount,criticalFailedCount:report.criticalFailedCount,failed:report.failed,base:report.baseRegression},null,2));if(failed.length)process.exitCode=2;
