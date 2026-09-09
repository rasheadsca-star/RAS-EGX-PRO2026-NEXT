#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const {execFileSync}=require('child_process');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const P=(...x)=>path.join(ROOT,...x);
const sourceFile=P('data/stable/v18-global-strategy-ensemble.json');
const ledgerFile=P('data/stable/v18-forward-ledger.json');
const runtimeGann=P('.v18-runtime/gann-forward-report.json');
const runtimeV16=P('.v18-runtime/v16-main-app-engine-performance.json');
const localGann=P('gann-fusion-x/data/forward-shadow-report.json');
const localV16=P('data/stable/v16-main-app-engine-performance.json');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const optional=(files,d={})=>{for(const f of files){if(f&&fs.existsSync(f)){try{return read(f)}catch{}}}return d};
const n=v=>Number.isFinite(Number(v))?Number(v):null;
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const rnd=(v,d=1)=>n(v)==null?null:Number(Number(v).toFixed(d));
const mean=a=>{const x=a.filter(v=>n(v)!=null).map(Number);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null};
const uniq=a=>[...new Set((a||[]).filter(Boolean))];
const same=(a,b)=>String(a||'')===String(b||'');
if(!fs.existsSync(sourceFile))throw new Error('Missing V18 unified source');
const data=read(sourceFile);
if(data.schemaVersion!=='18.2.0-shadow')throw new Error(`V18.2.1 expects 18.2.0-shadow, got ${data.schemaVersion}`);
if(!Array.isArray(data.allCandidates))throw new Error('Missing allCandidates');
const currentSession=data.sessionId;
function loadMainReports(){
  if(process.env.V18_DISABLE_MAIN_PERFORMANCE_SYNC==='1')return{};
  try{
    execFileSync('git',['fetch','--no-tags','--depth=1','origin','main:refs/remotes/origin/main'],{cwd:ROOT,stdio:'ignore',timeout:30000});
    const show=repoPath=>JSON.parse(execFileSync('git',['show',`refs/remotes/origin/main:${repoPath}`],{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:10000}));
    return{gann:show('gann-fusion-x/data/forward-shadow-report.json'),v16:show('data/stable/v16-main-app-engine-performance.json')};
  }catch{return{}}
}
function fileReport(f){if(!f||!fs.existsSync(f))return null;try{return{source:path.relative(ROOT,f),data:read(f)}}catch{return null}}
function chooseSessionReport(entries,sessionField){
  const reports=entries.filter(Boolean);
  return reports.find(x=>same(x.data?.[sessionField],currentSession))||reports[0]||{source:null,data:{}};
}
const mainReports=loadMainReports();
const gannChoice=chooseSessionReport([fileReport(process.env.V18_GANN_FORWARD_REPORT),mainReports.gann?{source:'git:main/gann-fusion-x/data/forward-shadow-report.json',data:mainReports.gann}:null,fileReport(runtimeGann),fileReport(localGann)],'marketSession');
const v16Choice=chooseSessionReport([fileReport(process.env.V18_V16_PERFORMANCE_REPORT),mainReports.v16?{source:'git:main/data/stable/v16-main-app-engine-performance.json',data:mainReports.v16}:null,fileReport(runtimeV16),fileReport(localV16)],'sessionDate');
const gann=gannChoice.data,v16=v16Choice.data;
const ledger=optional([ledgerFile],{entries:[]});
const league=Array.isArray(data.enginePerformanceLeague?.engines)?data.enginePerformanceLeague.engines:[];
const promotionSessions=Math.max(20,Number(gann.minimumForwardSessionsForPromotion||20));

function sourceEngine(src){
  const s=String(src||'');
  if(/^V16_9/i.test(s))return'V16.9';
  if(/^V13_5/i.test(s))return'V13.5';
  if(/^V13_4/i.test(s))return'V13.4';
  if(/^V15/i.test(s))return'V15';
  if(/^EMA_MACD/i.test(s))return'EMA–MACD';
  if(/^V18_/i.test(s))return'V18';
  return null;
}
function sourceMatchesEngine(src,engine){
  return sourceEngine(src)===engine;
}
function ledgerSessions(engine){
  const dates=[];
  for(const e of Array.isArray(ledger.entries)?ledger.entries:[]){
    const issued=e?.issued||{};
    if((issued.sources||[]).some(s=>sourceMatchesEngine(s,engine))&&issued.sessionId)dates.push(issued.sessionId);
  }
  return uniq(dates).length;
}
function leagueRows(engine){
  const ids={
    'V16.9':['V16_9_BASKET'],
    'V13.5':['V13_5_PAPER','V13_5_WATCH'],
    'V13.4':['V13_4_PAPER','V13_4_WATCH'],
    'V15':['V15_EXTENDED'],
    'EMA–MACD':['EMA_MACD_CONTINUATION_SHADOW'],
    'V18':['V18_RS_LEADERSHIP_SHADOW','V18_VCP_SHADOW']
  }[engine]||[];
  return league.filter(x=>ids.includes(x.engineId));
}
function aggregateLeague(engine){
  const rows=leagueRows(engine);
  if(!rows.length)return null;
  const resolved=rows.reduce((s,x)=>s+Number(x.resolvedSignals||0),0);
  const issued=rows.reduce((s,x)=>s+Number(x.issuedSignals||0),0);
  const targets=rows.reduce((s,x)=>s+Number(x.target1Hits||0),0);
  const stops=rows.reduce((s,x)=>s+Number(x.stopHits||0),0);
  return{issued,evaluated:resolved,filled:null,positiveRatePct:null,averageNetPct:null,profitFactor:null,targetHitPct:resolved?targets/resolved*100:mean(rows.map(x=>x.targetHitRateResolvedPct)),stopHitPct:resolved?stops/resolved*100:mean(rows.map(x=>x.stopRateResolvedPct)),resolved};
}
function currentCandidates(key){
  const rows=gann.currentCandidates?.[key];
  return Array.isArray(rows)?rows:[];
}
function sourceFresh(key){
  const z=gann.sourceStatus?.[key]||{};
  return z.fresh===true&&same(z.session,currentSession)&&same(gann.marketSession,currentSession);
}
function gannMetrics(key){return gann.summary?.[key]||null}
function primaryV16Audit(){
  const rows=Array.isArray(v16.rows)?v16.rows:[];
  return rows.find(x=>x.id==='MAIN_APP_V16_9'&&x.evidenceComparable===true)||null;
}
function performanceRaw(m){
  if(!m)return 50;
  let score=50,used=0;
  if(n(m.profitFactor)!=null){score+=clamp((Number(m.profitFactor)-1)*30,-18,18);used++}
  if(n(m.averageNetPct)!=null){score+=clamp(Number(m.averageNetPct)*10,-14,14);used++}
  if(n(m.positiveRatePct)!=null){score+=clamp((Number(m.positiveRatePct)-50)*0.30,-12,12);used++}
  if(n(m.targetHitPct)!=null&&n(m.stopHitPct)!=null){score+=clamp((Number(m.targetHitPct)-Number(m.stopHitPct))*0.15,-10,10);used++}
  return used?clamp(score):50;
}
function makeProfile(engine){
  let fresh=true,metrics=aggregateLeague(engine),sessions=ledgerSessions(engine),evidenceSource='V18_FORWARD_LEAGUE';
  if(engine==='V16.9'){
    const gm=gannMetrics('V16_9_LIVE'),audit=primaryV16Audit();
    if(gm){metrics={...gm};evidenceSource='GANN_FORWARD_SHADOW_V16_LIVE'}
    if(audit&&same(v16.sessionDate,currentSession))sessions=Math.max(sessions,Number(audit.auditSessions||0));
    sessions=Math.max(sessions,Array.isArray(gann.forwardSessions)&&sourceFresh('V16_9_LIVE')?gann.forwardSessions.length:0);
    fresh=(sourceFresh('V16_9_LIVE')||same(v16.sessionDate,currentSession));
  }else if(engine==='GANN'){
    fresh=sourceFresh('GANN_FUSION_X_V1');metrics=gannMetrics('GANN_FUSION_X_V1');sessions=Array.isArray(gann.forwardSessions)?gann.forwardSessions.length:0;evidenceSource='GANN_FORWARD_SHADOW';
  }else if(engine==='SEPA'){
    fresh=sourceFresh('SEPA_X_LIVE_SHADOW');metrics=gannMetrics('SEPA_X_LIVE_SHADOW');sessions=Array.isArray(gann.forwardSessions)?gann.forwardSessions.length:0;evidenceSource='SEPA_FORWARD_SHADOW';
  }
  const raw=performanceRaw(metrics);
  const sampleFactor=clamp(sessions/promotionSessions,0,1);
  const shrunk=50+(raw-50)*sampleFactor;
  const explicitlyBad=Boolean(metrics)&&((n(metrics.profitFactor)!=null&&Number(metrics.profitFactor)<1)||(n(metrics.averageNetPct)!=null&&Number(metrics.averageNetPct)<0)||(n(metrics.targetHitPct)!=null&&n(metrics.stopHitPct)!=null&&Number(metrics.stopHitPct)>Number(metrics.targetHitPct)&&Number(metrics.evaluated||metrics.resolved||0)>=5));
  let state='PROVISIONAL';
  if(!fresh)state='EXCLUDED_STALE';
  else if(explicitlyBad)state='DEGRADED';
  else if(sessions>=promotionSessions&&raw>=55)state='PROMOTED';
  else if(sessions>=promotionSessions)state='ACTIVE_MONITORED';
  else if(!metrics||Number(metrics.evaluated||metrics.resolved||0)===0)state='PROVISIONAL_NO_FORWARD';
  let reliability=fresh?clamp(shrunk):0;
  if(state==='DEGRADED')reliability=Math.min(reliability,45);
  if(state==='PROVISIONAL_NO_FORWARD')reliability=50;
  const participation=fresh?(0.35+0.65*sampleFactor):0;
  const voteWeight=fresh?clamp((reliability/100)*participation,0,1):0;
  return{
    engine,state,fresh,forwardSessions:sessions,promotionThresholdSessions:promotionSessions,promotionEligible:state==='PROMOTED',sampleConfidencePct:rnd(sampleFactor*100,1),reliabilityScore:rnd(reliability,1),voteWeightPct:rnd(voteWeight*100,1),evidenceSource,
    performance:{profitFactor:rnd(metrics?.profitFactor,2),averageNetPct:rnd(metrics?.averageNetPct,3),positiveRatePct:rnd(metrics?.positiveRatePct,1),targetHitPct:rnd(metrics?.targetHitPct,1),stopHitPct:rnd(metrics?.stopHitPct,1),evaluated:Number(metrics?.evaluated??metrics?.resolved??0),filled:n(metrics?.filled)==null?null:Number(metrics.filled)}
  };
}
const profileNames=['V16.9','V13.5','V13.4','V15','EMA–MACD','V18','GANN','SEPA'];
const profiles=Object.fromEntries(profileNames.map(x=>[x,makeProfile(x)]));
function externalCandidateEngineSet(ticker){
  const out=[];
  for(const [key,name] of [['V16_9_LIVE','V16.9'],['GANN_FUSION_X_V1','GANN'],['SEPA_X_LIVE_SHADOW','SEPA']]){
    if(currentCandidates(key).some(x=>String(x.ticker||'').toUpperCase()===String(ticker||'').toUpperCase()))out.push(name);
  }
  return out;
}
function badgeFor(row){
  const raw=uniq([...(row.sources||[]).map(sourceEngine).filter(Boolean),...externalCandidateEngineSet(row.ticker)]);
  const details=raw.map(engine=>profiles[engine]||makeProfile(engine));
  const eligible=details.filter(x=>x.fresh&&Number(x.voteWeightPct||0)>0);
  const rawCount=raw.length,eligibleCount=eligible.length;
  const avgReliability=mean(eligible.map(x=>x.reliabilityScore));
  const avgVote=mean(eligible.map(x=>x.voteWeightPct));
  const diversityBonus=eligibleCount>=2?Math.min(6,(eligibleCount-1)*3):0;
  const weightedAgreement=avgVote==null?null:clamp(avgVote+diversityBonus);
  const adjustment=weightedAgreement==null?0:clamp((weightedAgreement-50)/12.5,-4,4);
  const rawShared=rawCount>=2,isShared=eligibleCount>=2;
  const labelAr=isShared?`⭐ مشتركة بين ${eligibleCount} محركات فعّالة`:eligibleCount===1?'محرك واحد فعّال':'لا توجد أصوات فعّالة';
  const rawAgreementLabelAr=rawShared?`اتفاق خام: ${rawCount} محركات`:`اتفاق خام: ${rawCount} محرك`;
  return{schemaVersion:'18.2.1-performance-weighted',engineCount:eligibleCount,engines:eligible.map(x=>x.engine),isShared,labelAr,rawEngineCount:rawCount,rawEngines:raw,rawIsShared:rawShared,rawAgreementLabelAr,eligibleEngineCount:eligibleCount,eligibleEngines:eligible.map(x=>x.engine),excludedEngines:details.filter(x=>!x.fresh||Number(x.voteWeightPct||0)<=0).map(x=>({engine:x.engine,state:x.state})),forwardReliabilityScore:rnd(avgReliability,1),effectiveVoteWeightPct:rnd(avgVote,1),weightedAgreementScore:rnd(weightedAgreement,1),decisionScoreAdjustment:rnd(adjustment,2),engineDetails:details};
}
const beforePlans=new Map(data.allCandidates.map(r=>[r.ticker,JSON.stringify(r.execution||null)]));
for(const row of data.allCandidates){
  const badge=badgeFor(row),oldScore=Number(row.decisionScore||0),adj=Number(badge.decisionScoreAdjustment||0);
  row.decisionLabelAr=String(row.decisionLabelAr||'').replace(/\s*·\s*⭐?\s*مشتركة بين\s+\d+\s+محركات(?:\s+فعّالة)?\s*$/u,'').trim();
  row.prePerformanceWeightedDecisionScore=rnd(oldScore,2);
  row.consensusAdjustment=rnd(adj,2);
  row.decisionScore=rnd(clamp(oldScore+adj),1);
  row.engineAgreementBadge=badge;
  if(badge.isShared&&!String(row.decisionLabelAr||'').includes('مشتركة بين'))row.decisionLabelAr=`${row.decisionLabelAr||''} · ${badge.labelAr}`.replace(/^ · /,'');
}
const byTicker=new Map(data.allCandidates.map(x=>[x.ticker,x]));
for(const row of data.topFiveNow||[]){const x=byTicker.get(row.ticker);if(x){row.decisionScore=x.decisionScore;row.engineAgreementBadge=x.engineAgreementBadge}}
for(const row of data.universeScreener||[]){const x=byTicker.get(row.ticker);if(x){row.engineAgreementBadge=x.engineAgreementBadge;if(row.decision)row.decision.score=x.decisionScore}}
for(const row of data.engineAgreement||[]){const x=byTicker.get(row.ticker);if(x){row.engineAgreementBadge=x.engineAgreementBadge;row.score=x.decisionScore;row.weightedAgreementScore=x.engineAgreementBadge.weightedAgreementScore;row.forwardReliabilityScore=x.engineAgreementBadge.forwardReliabilityScore}}
const planMutations=data.allCandidates.filter(r=>beforePlans.get(r.ticker)!==JSON.stringify(r.execution||null));
if(planMutations.length)throw new Error(`Performance consensus mutated execution plans: ${planMutations.map(x=>x.ticker).join(',')}`);
const badAdjustments=data.allCandidates.filter(r=>Math.abs(Number(r.consensusAdjustment||0))>4.00001);
if(badAdjustments.length)throw new Error('Consensus adjustment exceeded ±4 safeguard');
const staleWeighted=Object.values(profiles).filter(x=>!x.fresh&&Number(x.voteWeightPct||0)!==0);
if(staleWeighted.length)throw new Error('Stale engine received non-zero vote weight');
const promotedEarly=Object.values(profiles).filter(x=>x.promotionEligible&&x.forwardSessions<promotionSessions);
if(promotedEarly.length)throw new Error('Engine promoted before minimum forward sessions');
const gannProfile=profiles.GANN,sepaProfile=profiles.SEPA;
data.consensusSchemaVersion='18.2.1-performance-weighted';
data.performanceWeightedConsensus={
  schemaVersion:'18.2.1-performance-weighted',generatedAt:new Date().toISOString(),sessionId:currentSession,
  policy:{code:'PERFORMANCE_WEIGHTED_FRESH_ENGINE_CONSENSUS',promotionMinimumForwardSessions:promotionSessions,staleEngineWeight:0,maximumDecisionScoreAdjustmentAbs:4,evidenceRankMutation:false,tierMutation:false,executionPlanMutation:false,externalComparisonEnginesVote:false,missingPerformanceTreatment:'SHRINK_TO_NEUTRAL_WITH_REDUCED_PARTICIPATION'},
  sourceFreshness:{gannReportSession:gann.marketSession||null,gannRuntimePath:gannChoice.source||null,v16ReportSession:v16.sessionDate||null,v16RuntimePath:v16Choice.source||null},
  engineRegistry:Object.values(profiles),
  summary:{rawSharedCandidates:data.allCandidates.filter(x=>x.engineAgreementBadge.rawIsShared).length,effectiveSharedCandidates:data.allCandidates.filter(x=>x.engineAgreementBadge.isShared).length,staleExcludedEngines:Object.values(profiles).filter(x=>!x.fresh).map(x=>x.engine),degradedEngines:Object.values(profiles).filter(x=>x.state==='DEGRADED').map(x=>x.engine),promotedEngines:Object.values(profiles).filter(x=>x.promotionEligible).map(x=>x.engine),gannState:gannProfile.state,sepaState:sepaProfile.state},
  safeguards:{executionPlansUnchanged:planMutations.length===0,adjustmentBoundPassed:badAdjustments.length===0,staleWeightZeroPassed:staleWeighted.length===0,promotionGatePassed:promotedEarly.length===0,rankingPolicyPreserved:data.rankingPolicy?.code==='EVIDENCE_FIRST_THEN_SCORE'}
};
data.engineAgreementBadgeSummary={...(data.engineAgreementBadgeSummary||{}),schemaVersion:'18.2.1-performance-weighted',policy:'PERFORMANCE_WEIGHTED_UNIQUE_ENGINE_FAMILIES_FRESH_ONLY',rawSharedCandidates:data.performanceWeightedConsensus.summary.rawSharedCandidates,sharedCandidates:data.performanceWeightedConsensus.summary.effectiveSharedCandidates,engineRegistry:data.performanceWeightedConsensus.engineRegistry};
if(Array.isArray(data.featureManifest)&&!data.featureManifest.some(x=>x.id==='PERFORMANCE_WEIGHTED_CONSENSUS'))data.featureManifest.push({id:'PERFORMANCE_WEIGHTED_CONSENSUS',labelAr:'توافق المحركات مرجّح بأداء Forward وحداثة المصدر',provenance:'V18.2.1',enabled:true});
fs.writeFileSync(sourceFile,JSON.stringify(data,null,2)+'\n','utf8');
console.log(JSON.stringify({module:'V18.2.1 Performance-Weighted Consensus',sessionId:currentSession,summary:data.performanceWeightedConsensus.summary,profiles:Object.values(profiles).map(x=>({engine:x.engine,state:x.state,fresh:x.fresh,sessions:x.forwardSessions,reliability:x.reliabilityScore,voteWeightPct:x.voteWeightPct}))},null,2));
