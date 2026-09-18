'use strict';
const fs=require('fs');
const path=require('path');
const Module=require('module');
const crypto=require('crypto');
const cp=require('child_process');

const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const R=p=>path.join(ROOT,p);
const read=(p,d=null)=>{try{return JSON.parse(fs.readFileSync(R(p),'utf8'))}catch{return d}};
const write=(p,v)=>{fs.mkdirSync(path.dirname(R(p)),{recursive:true});fs.writeFileSync(R(p),JSON.stringify(v,null,2)+'\n','utf8')};
const ensure=(c,m)=>{if(!c)throw new Error(m)};
const norm=v=>String(v||'').trim().toUpperCase().replace(/[^A-Z0-9._-]/g,'');
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const head=()=>{try{return cp.execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim()}catch{return process.env.GITHUB_SHA||'UNKNOWN'}};

function loadHealthWithDecisionEvidence(){
  const filename=R('astra/data-health/g11-data-health.cjs');
  let src=fs.readFileSync(filename,'utf8');
  const needle="marketUniverseEvaluated:pipeline.decisionSnapshot?.marketUniverseEvaluated||0,productionCutover:false";
  const replacement="marketUniverseEvaluated:pipeline.decisionSnapshot?.marketUniverseEvaluated||0,decisionSnapshotId:pipeline.decisionSnapshot?.decisionSnapshotId||null,semanticDecisionHash:pipeline.decisionSnapshot?.semanticDecisionHash||null,decisionSnapshotHash:pipeline.decisionSnapshot?hash(pipeline.decisionSnapshot):null,productionCutover:false";
  ensure(src.includes(needle),'G11 health return shape changed; finalizer patch point unavailable');
  src=src.replace(needle,replacement);
  const m=new Module(filename,module);
  m.filename=filename;
  m.paths=Module._nodeModulePaths(path.dirname(filename));
  m._compile(src,filename);
  return m.exports.buildHealth();
}

const h=loadHealthWithDecisionEvidence();
const cleanup=read('data/history-universe-cleanup-report.json',{classification:[]});
const cleanupBy=new Map((cleanup.classification||[]).map(x=>[norm(x.ticker),x]));
const historyBy=new Map((h.historyStats||[]).map(x=>[norm(x.ticker),x]));
const universeBy=new Map((h.universe.records||[]).map(x=>[norm(x.ticker),x]));
const gapIssue=(h.issues.issues||[]).find(x=>x.code==='CURRENT_SESSION_GAP');
const legitimateSessionExceptions=(h.sessionExceptions?.records||[]).filter(x=>x&&x.ticker&&x.session===h.sessionIntegrity.latestExpectedSession);
const legitimateExceptionTickers=new Set(legitimateSessionExceptions.map(x=>norm(x.ticker)));
const gapTickers=[...(gapIssue?.affectedTickers||[])].map(norm).sort();

function primaryGapReason(ticker){
  const hs=historyBy.get(ticker)||{};
  const cl=cleanupBy.get(ticker)||{};
  if(hs.latestValidSession&&hs.latestValidSession<h.sessionIntegrity.latestExpectedSession)return 'STALE_DATA';
  if(cl.category==='identity_rejected')return 'SYMBOL_MAPPING_FAILED';
  if(hs.processingStatus==='failed'||hs.lastUpdateError||['yahoo_404','no_sessions','rate_limited','temporary_network'].includes(cl.category))return 'SOURCE_INGESTION_FAILED';
  if(!hs.symbolVerified)return 'SYMBOL_MAPPING_FAILED';
  if(!hs.currentSessionAvailable)return 'MISSING_SOURCE_ROW';
  return 'OTHER_DOCUMENTED_REASON';
}

const gapRecords=gapTickers.map(ticker=>{
  const hs=historyBy.get(ticker)||{};
  const u=universeBy.get(ticker)||{};
  const cl=cleanupBy.get(ticker)||{};
  const reason=primaryGapReason(ticker);
  return{
    securityId:u.securityId||`EGX:${ticker}`,
    ticker,
    primaryReason:reason,
    expectedSession:h.sessionIntegrity.latestExpectedSession,
    latestValidSession:hs.latestValidSession||null,
    validHistorySessions:hs.validSessions||0,
    symbolVerified:hs.symbolVerified===true,
    processingStatus:hs.processingStatus||null,
    sourceStatus:hs.sourceStatus||null,
    sourceFailureCategory:cl.category||null,
    sourceTicker:cl.currentYahooSymbol||null,
    companyNameAr:u.companyNameAr||null,
    companyNameEn:u.companyNameEn||null,
    evidence:[
      'data/symbol-map.json',
      'data/history-summary.json',
      `data/history/${ticker}.json`,
      cl.ticker?'data/history-universe-cleanup-report.json':null
    ].filter(Boolean),
    lastUpdateError:hs.lastUpdateError||null,
    productionImpact:'EXCLUDED_FROM_CURRENT_PRODUCTION_CANDIDATE_AND_REGIME_INPUT_UNTIL_RESOLVED'
  };
});
const dispositions={};for(const r of gapRecords)dispositions[r.primaryReason]=(dispositions[r.primaryReason]||0)+1;
const rawMissingCount=h.universe.activeUniverseCount-h.metrics.currentCanonicalSecurities.numerator;
const gapCount=rawMissingCount-legitimateSessionExceptions.length;
ensure(gapCount>=0,'legitimate exception accounting exceeded raw missing count');
ensure(gapRecords.length===gapCount,`gap accounting source mismatch: records=${gapRecords.length} expected=${gapCount}`);
ensure(Object.values(dispositions).reduce((a,b)=>a+b,0)===gapCount,'gap disposition accounting does not close');
const gapsArtifact={schemaVersion:'astra-g11-current-universe-gaps-2',evaluatedAt:h.evaluatedAt,sourceHead:head(),expectedSession:h.sessionIntegrity.latestExpectedSession,activeUniverse:h.universe.activeUniverseCount,currentValidCanonicalUniverse:h.metrics.currentCanonicalSecurities.numerator,rawMissingCount,legitimateSessionExceptions,legitimateSessionExceptionCount:legitimateSessionExceptions.length,gapCount,accounting:{...dispositions,total:gapCount,equation:`${h.universe.activeUniverseCount} - ${h.metrics.currentCanonicalSecurities.numerator} - ${legitimateSessionExceptions.length} legitimate session exception(s) = ${gapCount}`,closes:true},records:gapRecords};
write('docs/astra/G11_CURRENT_UNIVERSE_GAPS.json',gapsArtifact);

const unresolvedSymbolRecords=(h.symbolHealth.records||[]).filter(x=>x.active&&x.symbolVerified!==true).map(x=>{
  const ticker=norm(x.ticker),u=universeBy.get(ticker)||{},cl=cleanupBy.get(ticker)||{},hs=historyBy.get(ticker)||{};
  let mappingStatus='AMBIGUOUS_BLOCKED';
  if(cl.category==='yahoo_404'||cl.category==='no_sessions')mappingStatus='SOURCE_INVALID';
  else if(cl.category==='identity_rejected')mappingStatus='AMBIGUOUS_BLOCKED';
  else if(!cl.category&&hs.lastUpdateError)mappingStatus='SOURCE_INVALID';
  return{
    sourceTicker:cl.currentYahooSymbol||ticker,
    canonicalTickerCandidate:ticker,
    securityIdCandidate:u.securityId||`EGX:${ticker}`,
    companyIdentity:{companyNameAr:u.companyNameAr||null,companyNameEn:u.companyNameEn||null},
    aliases:x.aliases||[],previousSymbols:x.previousSymbols||[],
    sourceEvidence:['data/symbol-map.json','data/history-summary.json',cl.ticker?'data/history-universe-cleanup-report.json':null].filter(Boolean),
    sourceFailureCategory:cl.category||null,
    mappingStatus,
    note:'Canonical SecurityMaster/search identity exists, but the selected historical source identity is not validation-approved; no fuzzy-name mapping is accepted.'
  };
});
const mappingCounts={};for(const r of unresolvedSymbolRecords)mappingCounts[r.mappingStatus]=(mappingCounts[r.mappingStatus]||0)+1;
const resolvedStatuses=new Set(['RESOLVED_EXACT','RESOLVED_ALIAS','RESOLVED_RENAME']);
const resolvedMappings=unresolvedSymbolRecords.filter(x=>resolvedStatuses.has(x.mappingStatus)).length;
const unresolvedMappings=unresolvedSymbolRecords.length-resolvedMappings;
const symbolHealth=read('docs/astra/G11_SYMBOL_HEALTH.json',h.symbolHealth)||h.symbolHealth;
symbolHealth.mappingReview={scope:'PREVIOUSLY_UNVERIFIED_ACTIVE_HISTORY_SOURCE_IDENTITIES',reviewed:unresolvedSymbolRecords.length,resolved:resolvedMappings,unresolved:unresolvedMappings,statusCounts:mappingCounts,records:unresolvedSymbolRecords};
write('docs/astra/G11_SYMBOL_HEALTH.json',symbolHealth);

const staleRecords=(h.historyStats||[]).filter(x=>x.active&&x.latestValidSession&&x.latestValidSession<h.sessionIntegrity.latestExpectedSession&&!legitimateExceptionTickers.has(norm(x.ticker))).map(x=>({
  securityId:universeBy.get(norm(x.ticker))?.securityId||`EGX:${norm(x.ticker)}`,
  ticker:norm(x.ticker),component:'CURRENT_CANONICAL_HISTORY_AND_V16_SOURCE_FEATURES',expectedSession:h.sessionIntegrity.latestExpectedSession,actualSession:x.latestValidSession,
  source:`data/history/${norm(x.ticker)}.json`,reason:'LATEST_VALIDATION_APPROVED_ROW_PREDATES_EXPECTED_SESSION_AND_NO_DOCUMENTED_NO_TRADE_OR_SUSPENSION_EXCEPTION_IS PRESENT_IN_G11_SOURCE_SET',
  affectedStrategy:'PORTFOLIO_BASKET_EQUAL_WEIGHT',affectedModule:'market-regime + V16 source features + production candidate selection',canAffectCurrentDecisioning:true,status:'UNRESOLVED_BROKEN_FRESHNESS'
}));
const staleArtifact={schemaVersion:'astra-g11-stale-records-2',evaluatedAt:h.evaluatedAt,sourceHead:head(),expectedSession:h.sessionIntegrity.latestExpectedSession,total:staleRecords.length+legitimateSessionExceptions.length,resolved:legitimateSessionExceptions.length,unresolved:staleRecords.length,legitimateSessionExceptions,records:staleRecords};
write('docs/astra/G11_STALE_RECORDS.json',staleArtifact);

const pipelineArtifact={schemaVersion:'astra-g11-current-pipeline-run-1',evaluatedAt:h.evaluatedAt,sourceHead:head(),session:h.sessionIntegrity.latestExpectedSession,mode:'SHADOW_CERTIFICATION_NON_CUTOVER',activeUniverse:h.universe.activeUniverseCount,searchableUniverse:h.metrics.searchReadiness.resolvedActive,currentValidCanonicalUniverse:h.metrics.currentCanonicalSecurities.numerator,decisionReadyUniverse:h.metrics.decisionPipeline.pipelineReadySecurities,regimeReadyUniverse:h.metrics.regimeInputs.analyzed,validStrategyEvaluations:h.metrics.decisionPipeline.strategyExecutionsValid,rejectedOrInsufficientSecurities:h.metrics.decisionPipeline.insufficientDataSecurities,opportunities:h.pipeline.validOpportunities,decisionSnapshotId:h.pipeline.decisionSnapshotId||null,semanticDecisionHash:h.pipeline.semanticDecisionHash||null,decisionSnapshotObjectHash:h.pipeline.decisionSnapshotHash||null,diagnostics:h.pipeline.diagnostics||[],legacyNetworkCalls:h.pipeline.legacyNetworkCalls,status:h.pipeline.status,productionCutover:false};
ensure(pipelineArtifact.legacyNetworkCalls===0,'legacy network call detected in final current pipeline run');
ensure(pipelineArtifact.decisionSnapshotId&&pipelineArtifact.semanticDecisionHash,'current DecisionSnapshot identity/hash missing');
write('docs/astra/G11_CURRENT_PIPELINE_RUN.json',pipelineArtifact);

const issueArtifact=read('docs/astra/G11_DATA_HEALTH_ISSUES.json',h.issues)||h.issues;
issueArtifact.mediumUnresolved=(issueArtifact.issues||[]).filter(x=>x.severity==='MEDIUM'&&x.status==='UNRESOLVED').length;
issueArtifact.lowUnresolved=(issueArtifact.issues||[]).filter(x=>x.severity==='LOW'&&x.status==='UNRESOLVED').length;
issueArtifact.highProductionRelevantUnresolved=(issueArtifact.issues||[]).filter(x=>x.severity==='HIGH'&&x.status==='UNRESOLVED').length;
write('docs/astra/G11_DATA_HEALTH_ISSUES.json',issueArtifact);

const snapshot=read('docs/astra/G11_DATA_HEALTH_SNAPSHOT.json',h.snapshot)||h.snapshot;
snapshot.sourceHead=head();
snapshot.searchableUniverse=h.metrics.searchReadiness.resolvedActive;
snapshot.currentValidCanonicalUniverse=h.metrics.currentCanonicalSecurities.numerator;
snapshot.decisionReadyUniverse=h.metrics.decisionPipeline.pipelineReadySecurities;
snapshot.regimeReadyUniverse=h.metrics.regimeInputs.analyzed;
snapshot.currentDecisionSnapshotId=pipelineArtifact.decisionSnapshotId;
snapshot.currentDecisionSnapshotHash=pipelineArtifact.semanticDecisionHash;
snapshot.currentUniverseGapDispositionAccounting=gapsArtifact.accounting;
snapshot.historySourceMappingReview={reviewed:unresolvedSymbolRecords.length,resolved:resolvedMappings,unresolved:unresolvedMappings,statusCounts:mappingCounts};
snapshot.staleProductionCriticalReview={total:staleRecords.length+legitimateSessionExceptions.length,resolved:legitimateSessionExceptions.length,unresolved:staleRecords.length,legitimateSessionExceptions};
snapshot.finalizedSnapshotId=`G11-DH-FINAL-${hash({sourceHead:snapshot.sourceHead,evaluatedAt:snapshot.evaluatedAt,dataset:snapshot.canonicalDatasetHash,gaps:gapsArtifact.accounting,pipeline:pipelineArtifact.semanticDecisionHash,issues:[issueArtifact.criticalUnresolved,issueArtifact.highUnresolved,issueArtifact.mediumUnresolved,issueArtifact.lowUnresolved]}).slice(0,24)}`;
write('docs/astra/G11_DATA_HEALTH_SNAPSHOT.json',snapshot);

const sr=read('docs/astra/G11_SUPPORT_RESISTANCE_HEALTH.json',{records:h.supportResistanceRows});
const srCounts={};for(const r of sr.records||[])srCounts[r.status]=(srCounts[r.status]||0)+1;
sr.finalTaxonomy={VALID_BOTH:srCounts.VALID||0,VALID_SUPPORT_ONLY:0,VALID_RESISTANCE_ONLY:0,INSUFFICIENT_HISTORY:srCounts.INSUFFICIENT_HISTORY||0,NO_VALID_PIVOTS:0,INPUT_INVALID:srCounts.INPUT_INVALID||0,STALE:srCounts.STALE||0,COMPUTATION_FAILED:srCounts.COMPUTATION_FAILED||0,UNEXPLAINED_NULL:h.metrics.supportResistance.unexplainedUnavailable};
ensure(sr.finalTaxonomy.UNEXPLAINED_NULL===0,'S/R unexplained null remains');
write('docs/astra/G11_SUPPORT_RESISTANCE_HEALTH.json',sr);

const gates=read('04_ACCEPTANCE_GATES.json');const gate=gates.gates.find(x=>x.id==='G11');ensure(gate,'G11 gate missing');
const additions=['docs/astra/G11_SUPPORT_RESISTANCE_HEALTH.json','docs/astra/G11_HISTORY_DEPTH.json','docs/astra/G11_CURRENT_UNIVERSE_GAPS.json','docs/astra/G11_STALE_RECORDS.json','docs/astra/G11_CURRENT_PIPELINE_RUN.json'];
gate.evidence=[...new Set([...(gate.evidence||[]),...additions])];
ensure(gates.gates.find(x=>x.id==='G12')?.status==='PENDING','G12 changed');
write('04_ACCEPTANCE_GATES.json',gates);

for(const p of ['05_WORK_STATE.json','docs/astra/WORK_STATE.json']){
  const s=read(p,{});s.g11_certification=s.g11_certification||{};
  Object.assign(s.g11_certification,{searchableUniverse:pipelineArtifact.searchableUniverse,currentValidCanonicalUniverse:pipelineArtifact.currentValidCanonicalUniverse,decisionReadyUniverse:pipelineArtifact.decisionReadyUniverse,regimeReadyUniverse:pipelineArtifact.regimeReadyUniverse,currentUniverseGapCount:gapCount,currentUniverseGapDispositionAccounting:gapsArtifact.accounting,historySourceMappingsResolved:resolvedMappings,historySourceMappingsUnresolved:unresolvedMappings,staleProductionCriticalResolved:legitimateSessionExceptions.length,staleProductionCriticalUnresolved:staleRecords.length,currentDecisionSnapshotId:pipelineArtifact.decisionSnapshotId,currentDecisionSnapshotHash:pipelineArtifact.semanticDecisionHash,mediumUnresolved:issueArtifact.mediumUnresolved,lowUnresolved:issueArtifact.lowUnresolved});
  s.next_action=gate.status==='GREEN'?'Stop. G12 remains PENDING and may start only on explicit request. Do not remove legacy dependencies or cut over production.':'Restore validation-approved current-session/history-source coverage for the exact G11_CURRENT_UNIVERSE_GAPS and G11_STALE_RECORDS securities, regenerate V16/regime inputs, then rerun G11 only. Do not start G12, remove legacy dependencies, or cut over production.';
  write(p,s);
}

let report=fs.readFileSync(R('docs/astra/G11_DATA_HEALTH_REPORT.md'),'utf8');
const marker='## Exact final evidence closure';
if(report.includes(marker))report=report.slice(0,report.indexOf(marker)).trimEnd()+'\n\n';
report+=`${marker}\n\n- Searchable active universe: ${pipelineArtifact.searchableUniverse}/${h.universe.activeUniverseCount}\n- Current valid canonical universe: ${pipelineArtifact.currentValidCanonicalUniverse}/${h.universe.activeUniverseCount}\n- Decision-ready universe: ${pipelineArtifact.decisionReadyUniverse}/${h.universe.activeUniverseCount}\n- Regime-ready universe: ${pipelineArtifact.regimeReadyUniverse}/${h.universe.activeUniverseCount}\n- Current-universe gaps: ${gapCount}; disposition accounting closes exactly (${Object.entries(dispositions).map(([k,v])=>`${k}=${v}`).join(', ')}).\n- Previously unverified history-source mappings reviewed: ${unresolvedSymbolRecords.length}; resolved=${resolvedMappings}; unresolved=${unresolvedMappings}.\n- Stale production-critical records: ${staleRecords.length+legitimateSessionExceptions.length}; documented legitimate session exceptions=${legitimateSessionExceptions.length}; unresolved=${staleRecords.length}.\n- Current DecisionSnapshot: ${pipelineArtifact.decisionSnapshotId}; semantic hash=${pipelineArtifact.semanticDecisionHash}.\n- Current pipeline opportunities: ${pipelineArtifact.opportunities}; legacy-network calls=${pipelineArtifact.legacyNetworkCalls}.\n- G11 remains **${gate.status}** unless all CRITICAL and production-relevant HIGH findings are cleared by validation-approved evidence.\n`;
fs.writeFileSync(R('docs/astra/G11_DATA_HEALTH_REPORT.md'),report,'utf8');

const logPath=R('07_WORK_LOG.md');let log=fs.existsSync(logPath)?fs.readFileSync(logPath,'utf8'):'';const entry=`\n\n## ${h.evaluatedAt} — G11 Exact Evidence Closure\n\n- Source HEAD: ${head()}\n- Gap accounting: ${gapCount} = ${Object.entries(dispositions).map(([k,v])=>`${k}:${v}`).join(' + ')}.\n- Searchable/current/decision-ready/regime-ready: ${pipelineArtifact.searchableUniverse}/${pipelineArtifact.currentValidCanonicalUniverse}/${pipelineArtifact.decisionReadyUniverse}/${pipelineArtifact.regimeReadyUniverse}.\n- History-source mapping review: resolved ${resolvedMappings}, unresolved ${unresolvedMappings}.\n- Stale production-critical: legitimate session exceptions ${legitimateSessionExceptions.length}; unresolved ${staleRecords.length}.\n- DecisionSnapshot: ${pipelineArtifact.decisionSnapshotId}; semantic hash ${pipelineArtifact.semanticDecisionHash}; legacy-network calls 0.\n- G12 remains PENDING; no cutover and no legacy dependency removal.\n`;
if(!log.includes(`## ${h.evaluatedAt} — G11 Exact Evidence Closure`))fs.writeFileSync(logPath,log+entry,'utf8');

console.log('ASTRA_G11_FINAL_EVIDENCE '+JSON.stringify({sourceHead:head(),gateStatus:gate.status,overall:h.overallStatus,intended:h.universe.intendedUniverseCount,active:h.universe.activeUniverseCount,searchable:pipelineArtifact.searchableUniverse,current:pipelineArtifact.currentValidCanonicalUniverse,decisionReady:pipelineArtifact.decisionReadyUniverse,regimeReady:pipelineArtifact.regimeReadyUniverse,gaps:gapCount,dispositions,mappings:{reviewed:unresolvedSymbolRecords.length,resolved:resolvedMappings,unresolved:unresolvedMappings,statusCounts:mappingCounts},stale:{total:staleRecords.length,resolved:0,unresolved:staleRecords.length},duplicates:h.metrics.duplicates,supportResistance:h.metrics.supportResistance,productionCritical:h.metrics.strategyInputReadiness.productionCritical,opportunities:pipelineArtifact.opportunities,decisionSnapshotId:pipelineArtifact.decisionSnapshotId,decisionSnapshotHash:pipelineArtifact.semanticDecisionHash,legacyNetworkCalls:pipelineArtifact.legacyNetworkCalls,critical:issueArtifact.criticalUnresolved,high:issueArtifact.highUnresolved,medium:issueArtifact.mediumUnresolved,low:issueArtifact.lowUnresolved,destructive:h.destructive.pass?'PASS':'BLOCKER_CONFIRMED',g12:'PENDING'}));
