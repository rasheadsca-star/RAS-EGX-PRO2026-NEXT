#!/usr/bin/env node
'use strict';
// Read-only, fail-closed Astra recovery gate. Never inserts or modifies market prices.
const fs=require('node:fs'), path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const get=(name)=>{try{return JSON.parse(fs.readFileSync(path.join(root,name),'utf8'))}catch{return null}};
const gates=get('04_ACCEPTANCE_GATES.json');
const m=get('docs/astra/G11_DATA_HEALTH_METRICS.json');
const g=get('docs/astra/G11_CURRENT_UNIVERSE_GAPS.json');
const truth=get('data/stable/v15-price-truth.json');
const gate=(id)=>gates?.gates?.find(x=>x.id===id)?.status||'UNKNOWN';
const active=m?.activeUniverse?.count??null,canonical=m?.currentCanonicalSecurities?.numerator??null,ready=m?.decisionPipeline?.pipelineReadySecurities??null;
const session=m?.latestExpectedSession??null,truthSession=truth?.expectedSession??null;
const blockers=[];
if(!m)blockers.push('MISSING_G11_METRICS');
if(!gates)blockers.push('MISSING_ACCEPTANCE_GATES');
if(!truth)blockers.push('MISSING_PRICE_TRUTH');
if(active===null||canonical===null||ready===null)blockers.push('COVERAGE_UNVERIFIABLE');
if(!session||!truthSession||session!==truthSession)blockers.push('SESSION_MISMATCH');
if(active!==null&&canonical!==null&&canonical<active)blockers.push('CANONICAL_GAP');
if(active!==null&&ready!==null&&ready<active)blockers.push('STRATEGY_READINESS_GAP');
if(g&&(g.expectedSession!==session||g.gapCount!==active-canonical))blockers.push('GAP_EVIDENCE_MISMATCH');
if(gate('G09')!=='GREEN')blockers.push('G09_NOT_GREEN');
if(gate('G11')!=='GREEN')blockers.push('G11_NOT_GREEN');
if(gates?.certified!==true)blockers.push('ASTRA_NOT_CERTIFIED');
const report={schemaVersion:'egx-recovery-gate-1',readOnly:true,generatedAt:new Date().toISOString(),session,truthSession,active,canonical,ready,canonicalGap:active===null||canonical===null?null:active-canonical,readinessGap:active===null||ready===null?null:active-ready,gates:{G09:gate('G09'),G11:gate('G11'),G12:gate('G12'),G19:gate('G19')},blockers,verdict:blockers.length?'BLOCKED':'PASS',paperExecutionAuthorized:false};
if(process.env.EGX_RECOVERY_OUT){fs.mkdirSync(process.env.EGX_RECOVERY_OUT,{recursive:true});fs.writeFileSync(path.join(process.env.EGX_RECOVERY_OUT,'egx-recovery-gate.json'),JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify(report,null,2));
if(blockers.length)process.exitCode=2;
