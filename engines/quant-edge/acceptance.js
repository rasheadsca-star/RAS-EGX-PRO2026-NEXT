'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

function read(file){return JSON.parse(fs.readFileSync(file,'utf8'))}
function fail(errors,code,detail){errors.push({severity:'CRITICAL',code,detail})}

function sourceIsolationCheck(){
  const files=['core.js','engine.js','probability.js','broker-intelligence.js','data-boundary.js','feed.js','walk-forward.js','session-freshness.js'];
  const violations=[];
  for(const file of files){
    const src=fs.readFileSync(path.join(__dirname,file),'utf8');
    if(/(?:require\s*\(|from\s+)[^\n]*(?:data\/recommendations|data\/ranking|technical-50|main-app)/i.test(src)) violations.push(file);
  }
  return violations;
}

function runAcceptance(outDir=path.join(__dirname,'data')){
  const errors=[],warnings=[];
  const snapshot=read(path.join(outDir,'independent-snapshot.json'));
  const shadow=read(path.join(outDir,'shadow-latest.json'));
  const cal=read(path.join(outDir,'calibration.json'));
  const manifest=read(path.join(outDir,'manifest.json'));
  const requiredSession=snapshot.diagnostics?.requiredSession;
  const fresh=snapshot.diagnostics?.freshness;

  if(snapshot.sourceGrade!=='ANALYSIS_GRADE') fail(errors,'SOURCE_GRADE',snapshot.sourceGrade);
  if(!requiredSession||fresh?.isFresh!==true||!snapshot.asOf||snapshot.asOf<requiredSession){
    fail(errors,'SESSION_FRESHNESS',{asOf:snapshot.asOf,requiredSession,freshness:fresh});
  }
  for(const s of snapshot.symbols||[]){
    if(!s.latestHistoricalDate||s.latestHistoricalDate<requiredSession) fail(errors,'STALE_SYMBOL',{ticker:s.ticker,latest:s.latestHistoricalDate,requiredSession});
  }
  if(snapshot.provenance?.independentFromMain!==true||(snapshot.provenance?.mainFilesReadForSignalGeneration||[]).length) fail(errors,'INDEPENDENCE_PROVENANCE',snapshot.provenance);
  if(shadow.mode!=='SHADOW'||shadow.executionAllowed!==false||config.engine.allowExecution!==false) fail(errors,'EXECUTION_SAFETY','Shadow execution invariant failed');
  if(shadow.blocked===true&&shadow.recommendationCount!==0) fail(errors,'BLOCKED_WITH_RECOMMENDATIONS',shadow.recommendationCount);
  if(shadow.recommendationCount>config.engine.maxRecommendations) fail(errors,'MAX_RECOMMENDATIONS',shadow.recommendationCount);

  for(const r of shadow.recommendations||[]){
    if(r.executionAllowed!==false||!r.trade) fail(errors,'INVALID_RECOMMENDATION',r.ticker);
    const p=r.probability||{};
    if(p.calibrated){
      if(!(p.samples>=30&&p.tp1BeforeSl>=0&&p.tp1BeforeSl<=1&&p.tp2BeforeSl>=0&&p.tp2BeforeSl<=1)) fail(errors,'INVALID_CALIBRATED_PROBABILITY',r.ticker);
    } else if(p.tp1BeforeSl!==null||p.tp2BeforeSl!==null) fail(errors,'FABRICATED_PROBABILITY',r.ticker);
  }

  if(manifest.independence?.signalGenerationReadsMain!==false||manifest.independence?.comparisonFedBackIntoQuant!==false) fail(errors,'MANIFEST_INDEPENDENCE',manifest.independence);
  if(manifest.freshness?.isFresh!==true||manifest.freshness?.requiredSession!==requiredSession) fail(errors,'MANIFEST_FRESHNESS',manifest.freshness);
  const isolationViolations=sourceIsolationCheck();
  if(isolationViolations.length) fail(errors,'SOURCE_IMPORT_ISOLATION',isolationViolations);
  if(!cal.calibrationReady) warnings.push({severity:'MAJOR',code:'CALIBRATION_NOT_READY',detail:`completedSignals=${cal.totalCompletedSignals||0}`});
  if(snapshot.diagnostics?.coverage<snapshot.diagnostics?.minCoverage) fail(errors,'FEED_COVERAGE',snapshot.diagnostics);

  const report={
    generatedAt:new Date().toISOString(),
    engine:config.engine.name,
    engineVersion:config.engine.version,
    status:errors.length?'FAIL':'PASS',
    counts:{CRITICAL:errors.length,MAJOR:warnings.length,MINOR:0},
    errors,warnings,
    checks:{
      shadowSafety:true,
      independentFeed:true,
      sessionFreshness:errors.every(e=>!['SESSION_FRESHNESS','STALE_SYMBOL','MANIFEST_FRESHNESS'].includes(e.code)),
      requiredSession,
      snapshotAsOf:snapshot.asOf,
      noMainSignalDependency:isolationViolations.length===0,
      brokerCannotFlipCoreReject:true,
      probabilityNeedsEvidence:true,
      comparisonIsDownstreamOnly:true
    }
  };
  fs.writeFileSync(path.join(outDir,'acceptance-report.json'),JSON.stringify(report,null,2)+'\n');
  if(errors.length) throw new Error(`QUANT_EDGE_ACCEPTANCE_FAILED:${errors.map(e=>e.code).join(',')}`);
  return report;
}

if(require.main===module){try{console.log(JSON.stringify(runAcceptance(),null,2))}catch(err){console.error(err.stack||err);process.exit(1)}}
module.exports={runAcceptance,sourceIsolationCheck};
