#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
function fromGit(ref,file){try{return JSON.parse(cp.execFileSync('git',['show',ref+':'+file],{cwd:root,encoding:'utf8',timeout:15000}))}catch{return null}}
const truth=fromGit('origin/main','data/stable/v15-price-truth.json');
const metrics=fromGit('origin/main','docs/astra/G11_DATA_HEALTH_METRICS.json');
const gates=fromGit('origin/main','04_ACCEPTANCE_GATES.json');
const tickers=Array.isArray(truth?.missingHistoryFiles)?truth.missingHistoryFiles:null;
const gap=metrics?.activeUniverse?.count-metrics?.currentCanonicalSecurities?.numerator;
const modelGap=metrics?.activeUniverse?.count-metrics?.decisionPipeline?.pipelineReadySecurities;
const blockers=[];
if(!truth||!metrics||!gates)blockers.push('MISSING_MAIN_EVIDENCE');
if(!truth?.expectedSession||truth?.expectedSession!==metrics?.latestExpectedSession)blockers.push('SESSION_DRIFT');
if(!tickers)blockers.push('MISSING_TICKER_GAP_LIST');
if(!Number.isInteger(gap)||!Number.isInteger(modelGap)||gap<0||modelGap<0)blockers.push('INVALID_G11_COUNTS');
const gate=id=>gates?.gates?.find(x=>x.id===id)?.status||'UNKNOWN';
if(gate('G11')!=='GREEN')blockers.push('G11_NOT_GREEN');
if(gates?.certified!==true)blockers.push('ASTRA_NOT_CERTIFIED');
const report={schemaVersion:'egx-live-main-drift-audit-1',source:'origin/main',createdAt:new Date().toISOString(),priceSession:truth?.expectedSession||null,priceGeneratedAt:truth?.generatedAt||null,acceptedRows:truth?.acceptedRows??null,rejectedRows:truth?.rejectedRows??null,updatedHistoryFiles:truth?.updatedHistoryFiles??null,missingHistoryFiles:tickers,missingHistoryFileCount:tickers?.length??null,g11Session:metrics?.latestExpectedSession||null,g11Active:metrics?.activeUniverse?.count??null,g11Canonical:metrics?.currentCanonicalSecurities?.numerator??null,g11PipelineReady:metrics?.decisionPipeline?.pipelineReadySecurities??null,staleG11CanonicalGap:Number.isInteger(gap)?gap:null,staleG11ReadinessGap:Number.isInteger(modelGap)?modelGap:null,gate09:gate('G09'),gate11:gate('G11'),fullAstraCertified:gates?.certified===true,blockers,verdict:blockers.length?'BLOCKED':'EVIDENCE_SYNCHRONIZED_NOT_EXECUTION_AUTHORIZED',paperExecutionAuthorized:false};
const out=path.join(root,'artifacts/history-recovery');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'main-session-drift.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(blockers.length)process.exitCode=2;
