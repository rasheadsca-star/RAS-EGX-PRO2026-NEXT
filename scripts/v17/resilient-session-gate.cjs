#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.');
const P=r=>path.join(root,r);
function read(r,d={}){try{return JSON.parse(fs.readFileSync(P(r),'utf8'))}catch{return d}}
function write(r,v){const f=P(r);fs.mkdirSync(path.dirname(f),{recursive:true});const t=f+'.tmp';fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n');JSON.parse(fs.readFileSync(t,'utf8'));fs.renameSync(t,f)}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function age(v){if(!v)return null;const t=new Date(v).getTime();return Number.isFinite(t)?Math.round((Date.now()-t)/6000)/10:null}
const health=read('data/source-health.json'), fresh=read('data/price-freshness-report.json'), audit=read('data/price-source-audit.json');
const market=read('data/market.json'), cache=read('data/full-market-cache.json'), internal=read('data/v17/internal-ohlc-support-resistance.json'), liquidity=read('data/v17/liquidity-gate.json');
const marketRows=Array.isArray(market.rows)?market.rows.length:0, cacheRows=Array.isArray(cache.rows)?cache.rows.length:0, availableRows=Math.max(marketRows,cacheRows);
const last=fresh.lastSourceUpdate||health.lastSuccessAt||health.generatedAt||market.updatedAt||cache.updatedAt||null;
const sourceAge=n(fresh.sourceAgeMinutes)??age(last); const summary=audit.summary||{};
const marketCoveragePct=n(summary.marketCoveragePct)??n(health.universeCoveragePct)??0;
const sourceCoveragePct=n(summary.sourceCoveragePct)??n(health.coveragePct)??marketCoveragePct;
const stale=sourceAge!==null&&sourceAge>2160; const usable=availableRows>0;
const priceTruthHealthy=usable&&!stale&&marketCoveragePct>=90, researchMinimumHealthy=usable&&!stale&&marketCoveragePct>=75;
const coveragePct=n(internal.coveragePct)??0, freshnessPct=n(internal.freshnessPct)??0, criticalFieldsPct=n(internal.criticalFieldsPct)??coveragePct;
const sourceConflicts=Array.isArray(internal.sourceConflicts)?internal.sourceConflicts:[]; const missingSymbols=Array.isArray(internal.missingSymbols)?internal.missingSymbols:[];
const internalResearchReady=internal.researchReady===true; const internalExecutionCandidate=internal.executionCandidateReady===true;
const liquidityReferenceSession=liquidity.referenceSessionDate||null;
const liquidityEvidenceCoveragePct=n(liquidity.candidateEvidenceCoveragePct)??0;
const liquidityExecutionOkCount=n(liquidity.candidateExecutionOkCount)??0;
const liquidityMinimumCoveragePct=n(liquidity?.thresholds?.minimumCandidateEvidenceCoveragePct)??95;
const liquiditySessionAligned=liquidity.sessionAligned===true&&Boolean(liquidityReferenceSession);
const liquidityGatePassed=liquidity.gatePassed===true&&liquiditySessionAligned;
const sessionAligned=Boolean(internal.referenceSessionDate&&liquidityReferenceSession&&internal.referenceSessionDate===liquidityReferenceSession&&liquiditySessionAligned);
const qualityGatePassed=coveragePct>=95&&freshnessPct>=98&&criticalFieldsPct>=95&&sourceConflicts.length===0&&internalExecutionCandidate;
const executionGrade=Boolean(priceTruthHealthy&&sessionAligned&&liquidityGatePassed&&qualityGatePassed);
let status='HEALTHY'; const reasons=[];
if(!usable||stale||marketCoveragePct<75){status='BLOCKED';if(!usable)reasons.push('NO_USABLE_MARKET_DATA');if(stale)reasons.push('MARKET_SOURCE_DATA_STALE');if(marketCoveragePct<75)reasons.push('MARKET_PRICE_COVERAGE_BELOW_RESEARCH_MINIMUM');}
else if(!internalResearchReady){status='RESEARCH_ONLY';reasons.push('INTERNAL_OHLC_SR_BELOW_RESEARCH_MINIMUM');}
else if(!executionGrade){
  status='DEGRADED';
  if(!sessionAligned)reasons.push('SESSION_NOT_ALIGNED');
  if(coveragePct<95)reasons.push('INTERNAL_SR_COVERAGE_BELOW_95');
  if(freshnessPct<98)reasons.push('INTERNAL_SR_FRESHNESS_BELOW_98');
  if(criticalFieldsPct<95)reasons.push('CRITICAL_FIELDS_BELOW_95');
  if(!liquiditySessionAligned)reasons.push('LIQUIDITY_SESSION_NOT_ALIGNED');
  if(liquidityEvidenceCoveragePct<liquidityMinimumCoveragePct)reasons.push('LIQUIDITY_EVIDENCE_COVERAGE_BELOW_95');
  if(liquidityExecutionOkCount<1)reasons.push('NO_EXECUTION_LIQUID_CANDIDATES');
  if(!liquidityGatePassed)reasons.push('LIQUIDITY_GATE_NOT_PASSED');
  if(sourceConflicts.length)reasons.push('CRITICAL_SOURCE_CONFLICT');
  if(!internalExecutionCandidate)reasons.push('INTERNAL_SR_NOT_EXECUTION_CANDIDATE');
}
const mode=status==='HEALTHY'?'NORMAL':status==='BLOCKED'?'BLOCKED':'DEGRADED';
const sourcesUsed=['MANDATORY_MARKET_COLLECTOR']; if(internal.count>0)sourcesUsed.push('INTERNAL_OHLC_PIVOT');
if(Array.isArray(liquidity.rows)&&liquidity.rows.length>0)sourcesUsed.push('V11_1_LIQUIDITY_RULES_V17_CURRENT_RUN');
if((internal.externalValidationSummary?.directCurrent||internal.externalValidationSummary?.directStale)>0)sourcesUsed.push('MUBASHER_DIRECT_VALIDATION');
if((internal.externalValidationSummary?.renderedCurrent||internal.externalValidationSummary?.renderedStale)>0)sourcesUsed.push('MUBASHER_RENDERED_VALIDATION');
const confidenceCap=status==='HEALTHY'?1:status==='DEGRADED'?0.82:status==='RESEARCH_ONLY'?0.68:0;
const out={schemaVersion:'17.0.0-resilient-session-gate-5',generatedAt:new Date().toISOString(),status,mode,reasons:[...new Set(reasons)],sessionAligned,coveragePct,freshnessPct,criticalFieldsPct,sourcesUsed,sourceConflicts,missingSymbols,executionGrade,
 priceTruth:{healthy:priceTruthHealthy,researchMinimumHealthy,marketCoveragePct,sourceCoveragePct,stale,sourceAgeMinutes:sourceAge,lastSourceUpdate:last,sourceName:health.sourceName||market.source||null,contract:'MANDATORY_MARKET_COLLECTOR_IS_PRICE_TRUTH'},
 executionInputs:{ready:executionGrade,supportResistanceReady:internalResearchReady,supportResistanceMethod:'INTERNAL_OHLC_PIVOT_WITH_MUBASHER_VALIDATION',internal:{researchReady:internalResearchReady,executionCandidateReady:internalExecutionCandidate,coveragePct,freshnessPct,criticalFieldsPct,averageFreshConfidence:n(internal.averageFreshConfidence),referenceSessionDate:internal.referenceSessionDate,sessionCompletionConfirmed:internal.sessionCompletionConfirmed===true},liquidity:{gatePassed:liquidityGatePassed,sessionAligned:liquiditySessionAligned,referenceSessionDate:liquidityReferenceSession,candidateUniverseCount:n(liquidity.candidateUniverseCount),candidateEvidenceCoveragePct:liquidityEvidenceCoveragePct,candidateExecutionOkCount:liquidityExecutionOkCount,candidateExecutionOkPct:n(liquidity.candidateExecutionOkPct),thresholds:liquidity.thresholds||null,engine:liquidity.engine||null},liquidityGatePassed},
 sourceState:{availableRows,marketRows,cacheRows,lastSourceUpdate:last,sourceAgeMinutes:sourceAge,stale},
 confidencePolicy:{confidenceCap,confidenceCapPct:Math.round(confidenceCap*100),allowResearchRanking:status!=='BLOCKED'&&researchMinimumHealthy,allowAutomaticPromotion:false,allowExecutionGradeClaim:executionGrade,requireExplicitDegradedLabel:status!=='HEALTHY'},
 readiness:{researchReady:status!=='BLOCKED'&&researchMinimumHealthy&&internalResearchReady,priceTruthHealthy,executionReady:executionGrade},sourceAuditSummary:summary,
 invariant:'V16 champion and main branch are not modified or promoted by this V17 lab gate.'};
write('data/v17/resilient-session-status.json',out); console.log(JSON.stringify(out,null,2)); if(status==='BLOCKED')process.exitCode=2;