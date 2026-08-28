#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..'),DATA=path.join(ROOT,'gann-fusion-x','data'),SCRIPT=path.join(ROOT,'gann-fusion-x','scripts','forward-shadow-v2.cjs');
const read=(p,d={})=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return d}};
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const src=fs.existsSync(SCRIPT)?fs.readFileSync(SCRIPT,'utf8'):'',ledger=read(path.join(DATA,'forward-shadow-ledger.json'),{}),report=read(path.join(DATA,'forward-shadow-report.json'),{}),dataReview=read(path.join(DATA,'data-completion-destroyer-v2.json'),{}),engineReview=read(path.join(DATA,'engine-destroyer-v1.json'),{}),rankingReview=read(path.join(DATA,'ranking-destroyer-v1.json'),{});
const findings=[],add=(severity,code,message,evidence={})=>findings.push({severity,code,message,evidence});
for(const [name,r] of [['data',dataReview],['engine',engineReview],['ranking',rankingReview]])if(r.passed!==true||Number(r.critical||0)>0||Number(r.major||0)>0)add('critical','PREREQUISITE_GATE_NOT_GREEN',`${name} prerequisite gate is not green.`,{gate:name,critical:r.critical,major:r.major});
if(!report.generatedAt)add('critical','FORWARD_REPORT_MISSING','forward-shadow-report.json is missing.');
if(/volume\s*:\s*Number\([^)]*\|\|\s*0/.test(src)||/volume\s*:\s*[^,\n]*\|\|\s*0/.test(src))add('critical','FORWARD_MISSING_VOLUME_COERCED','Forward source converts missing volume to zero.');
if(/profitFactor[^\n]*999/.test(src))add('major','FORWARD_PROFIT_FACTOR_SENTINEL_999','Forward source uses 999 as a profit-factor sentinel.');
if(/status\s*:\s*['"]UNFILLED['"][^}]*netReturnPct\s*:\s*0/s.test(src))add('major','UNFILLED_RETURN_FABRICATED','Forward source assigns numeric zero return to an unfilled trade.');
if(/Fusion\.analyze|function\s+gannRows\s*\(/.test(src))add('critical','FORWARD_GANN_RECOMPUTED_INDEPENDENTLY','Forward GANN evidence is recomputed independently instead of consuming the readiness-gated dailyTop.');
if(!/data-readiness-current-v1\.json/.test(src)||!/dailyTop/.test(src)||!/v2-ready-only/.test(src))add('critical','READY_ONLY_CAPTURE_CONTRACT_MISSING','Forward source does not prove capture from readiness-gated dailyTop with the v2 READY-only marker.');
if(!/keyOf\(src\.date\s*,\s*src\.engine\s*,\s*r\.ticker\s*,\s*r\.forwardEligibilitySchema/.test(src))add('major','EVIDENCE_SCHEMA_NOT_IN_SIGNAL_KEY','Forward signal identity does not include the evidence schema; legacy rows can suppress strict READY-only capture.');
const signals=Array.isArray(ledger.signals)?ledger.signals:[],outcomes=Array.isArray(ledger.outcomes)?ledger.outcomes:[],signalMap=new Map(signals.map(s=>[s.key,s])),strict=s=>s?.engine==='GANN_FUSION_X_V1'&&s?.forwardEligibilitySchema==='v2-ready-only';
const strictSignals=signals.filter(strict),legacyGann=signals.filter(s=>s.engine==='GANN_FUSION_X_V1'&&!strict(s));
for(const s of strictSignals){
  if(s.dataReadiness?.status!=='READY'||s.dataReadiness?.decisionDate!==s.signalSession)add('critical','STRICT_GANN_NOT_READY_POINT_IN_TIME',`${s.key}: strict GANN signal lacks point-in-time READY proof.`,{status:s.dataReadiness?.status,decisionDate:s.dataReadiness?.decisionDate,signalSession:s.signalSession});
  if(!Array.isArray(s.dataReadiness?.missing)||s.dataReadiness.missing.length)add('critical','STRICT_GANN_HAS_MISSING_DATA',`${s.key}: strict GANN signal contains missing readiness fields.`,{missing:s.dataReadiness?.missing});
  if(s.action!=='ACTIONABLE'||!(finite(s.portfolioPct)&&Number(s.portfolioPct)>0))add('critical','STRICT_GANN_NOT_EXECUTABLE',`${s.key}: strict GANN evidence must be ACTIONABLE with positive size.`,{action:s.action,portfolioPct:s.portfolioPct});
}
for(const o of outcomes.filter(x=>x.evaluationSchema==='v2-null-safe')){
  const s=signalMap.get(o.signalKey);
  if(!s){add('critical','V2_ORPHAN_OUTCOME',`${o.signalKey}: v2 outcome has no signal.`);continue}
  if(o.entryDate&&String(o.entryDate)<=String(s.signalSession))add('critical','FORWARD_ENTRY_NOT_AFTER_SIGNAL',`${o.signalKey}: entry is not strictly after signal session.`,{signalSession:s.signalSession,entryDate:o.entryDate});
  if(o.exitDate&&o.entryDate&&String(o.exitDate)<String(o.entryDate))add('critical','FORWARD_EXIT_BEFORE_ENTRY',`${o.signalKey}: exit precedes entry.`,{entryDate:o.entryDate,exitDate:o.exitDate});
  if(o.status==='UNFILLED'&&finite(o.netReturnPct))add('major','V2_UNFILLED_NUMERIC_RETURN',`${o.signalKey}: unfilled v2 outcome has numeric return.`,{netReturnPct:o.netReturnPct});
}
const validation=report.gannForwardValidation||{},minimum=Number(report.minimumForwardSessionsForPromotion||ledger.policy?.minimumForwardSessionsForPromotion||20),evaluatedSessions=Number(validation.evaluatedForwardSessions||0);
if(validation.automaticPromotion!==false||validation.promotionAllowed===true)add('critical','AUTOMATIC_PROMOTION_NOT_FORBIDDEN','Forward evidence must never auto-promote the model.',{validation});
if(evaluatedSessions<minimum){
  if(validation.status!=='COLLECTION_PENDING')add('major','INSUFFICIENT_SAMPLE_NOT_PENDING','Forward sample below minimum is not labeled COLLECTION_PENDING.',{evaluatedSessions,minimum,status:validation.status});
  if(validation.performanceClaimAllowed===true)add('critical','PERFORMANCE_CLAIM_WITH_INSUFFICIENT_FORWARD_SAMPLE','Performance claim is allowed before enough real forward sessions exist.',{evaluatedSessions,minimum});
}
const gannSummary=report.summary?.GANN_FUSION_X_V1||null;
if(gannSummary&&Number(gannSummary.signalsIssued||0)===0)for(const k of ['positiveRatePct','averageNetPct','profitFactor','targetHitPct','stopHitPct'])if(finite(gannSummary[k]))add('major','EMPTY_FORWARD_SAMPLE_NUMERIC_METRIC',`GANN summary ${k} is numeric with zero eligible signals.`,{key:k,value:gannSummary[k]});
if(Number(validation.legacyGannSignalsExcluded||0)!==legacyGann.length)add('major','LEGACY_EXCLUSION_COUNT_MISMATCH','Reported legacy GANN exclusion count does not match ledger.',{reported:validation.legacyGannSignalsExcluded,actual:legacyGann.length});
const currentGann=report.currentCandidates?.GANN_FUSION_X_V1||[];
for(const r of currentGann){
  if(r.forwardEligibilitySchema!=='v2-ready-only'||r.dataReadiness?.status!=='READY'||r.action!=='ACTIONABLE'||!(finite(r.portfolioPct)&&Number(r.portfolioPct)>0))add('critical','CURRENT_GANN_CANDIDATE_NOT_STRICT_READY','Current GANN candidate violates READY-only capture.',{ticker:r.ticker});
  const captured=strictSignals.some(s=>s.signalSession===report.marketSession&&s.ticker===r.ticker&&s.forwardEligibilitySchema==='v2-ready-only');
  if(!captured)add('major','CURRENT_READY_SIGNAL_NOT_CAPTURED',`${r.ticker}: current READY-only GANN candidate was not persisted as strict forward evidence.`,{marketSession:report.marketSession,ticker:r.ticker});
}
if(Number(validation.eligibleSignals||0)!==strictSignals.length)add('major','ELIGIBLE_SIGNAL_COUNT_MISMATCH','Reported eligible GANN signal count does not equal strict ledger evidence.',{reported:validation.eligibleSignals,actual:strictSignals.length});
if(legacyGann.length)add('minor','LEGACY_GANN_EVIDENCE_EXCLUDED','Legacy GANN signals remain immutable and are explicitly excluded from promotion evidence.',{count:legacyGann.length});
if(validation.status==='COLLECTION_PENDING')add('minor','FORWARD_COLLECTION_PENDING','Real point-in-time forward evidence has not yet reached the configured promotion sample.',{evaluatedSessions,minimum,eligibleSignals:validation.eligibleSignals});
const order={critical:0,major:1,minor:2};findings.sort((a,b)=>order[a.severity]-order[b.severity]||a.code.localeCompare(b.code));
const critical=findings.filter(x=>x.severity==='critical').length,major=findings.filter(x=>x.severity==='major').length,minor=findings.filter(x=>x.severity==='minor').length;
const out={schemaVersion:'forward-shadow-destroyer-v1.1-capture-completeness',generatedAt:new Date().toISOString(),passed:critical===0&&major===0,critical,major,minor,findings,summary:{marketSession:report.marketSession||null,status:validation.status||null,eligibleGannSignals:Number(validation.eligibleSignals||0),validEvaluatedOutcomes:Number(validation.validEvaluatedOutcomes||0),evaluatedForwardSessions:evaluatedSessions,minimumForwardSessions:minimum,legacyGannSignalsExcluded:legacyGann.length,currentReadyCandidates:currentGann.length},policy:{readyOnlyGannCapture:true,currentReadyCandidatesMustBePersisted:true,evidenceSchemaPartOfSignalIdentity:true,pointInTimeReadinessRequired:true,missingNeverZero:true,unfilledReturnUnknown:true,entryStrictlyAfterSignal:true,legacyEvidenceExcludedNotRewritten:true,noAutomaticPromotion:true,noPerformanceClaimBeforeMinimumForwardSample:true}};
fs.writeFileSync(path.join(DATA,'forward-shadow-destroyer-v1.json'),JSON.stringify(out,null,2)+'\n');
let md=`# Forward Shadow Destroyer V1\n\nStatus: **${out.passed?'PASS':'FAIL'}**\n\nCritical: **${critical}** — Major: **${major}** — Minor: **${minor}**\n\n`;
for(const f of findings)md+=`- **${f.severity.toUpperCase()} / ${f.code}** — ${f.message}\n`;
if(!findings.length)md+='No evidence-backed forward-shadow finding remains.\n';
fs.writeFileSync(path.join(DATA,'forward-shadow-destroyer-v1.md'),md);
console.log(JSON.stringify(out,null,2));if(!out.passed)process.exitCode=1;
