'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const QE=require('./index');
const {buildIndependentSnapshot}=require('./feed');
const {collectPublicBrokerResearch,attachBrokerCollection}=require('./broker-collector');
const {validateIndependentSnapshot,toUniverse,hashSnapshot}=require('./data-boundary');
const {buildWalkForwardCalibration,calibratorFromReport}=require('./walk-forward');
const {buildComparison}=require('./compare-main');
const {updateShadowJournal}=require('./shadow-journal');

function writeJson(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj,null,2)+'\n');return file}
function readJson(file,d=null){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return d}}
function hashFile(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}

function blockedCalibration(snapshot){
  return {
    method:'BLOCKED_STALE_OR_INCOMPLETE_FEED',
    snapshotAsOf:snapshot.asOf,
    requiredSession:snapshot.diagnostics?.requiredSession,
    totalCompletedSignals:0,
    trainSignals:0,
    validationSignals:0,
    validatedBuckets:0,
    calibrationReady:false,
    productionBuckets:[],
    validation:{},
    blocked:true
  };
}

function makeManifest({snapshot,brokerCollection,calibration,quantResult,comparison,journal,paths}){
  return {
    schemaVersion:2,
    generatedAt:new Date().toISOString(),
    asOf:snapshot.asOf,
    engine:QE.config.engine.name,
    engineVersion:QE.config.engine.version,
    mode:'SHADOW',
    executionAllowed:false,
    blocked:Boolean(quantResult.blocked),
    blockReason:quantResult.blockReason||null,
    freshness:snapshot.diagnostics?.freshness||null,
    independence:{signalGenerationReadsMain:false,comparisonReadsMain:Boolean(comparison),comparisonFedBackIntoQuant:false},
    outputs:{
      snapshot:{path:path.relative(process.cwd(),paths.snapshotPath),sha256:hashFile(paths.snapshotPath)},
      brokers:{path:path.relative(process.cwd(),paths.brokerPath),sha256:hashFile(paths.brokerPath)},
      calibration:{path:path.relative(process.cwd(),paths.calibrationPath),sha256:hashFile(paths.calibrationPath)},
      shadow:{path:path.relative(process.cwd(),paths.quantPath),sha256:hashFile(paths.quantPath)},
      comparison:paths.comparisonPath?{path:path.relative(process.cwd(),paths.comparisonPath),sha256:hashFile(paths.comparisonPath)}:null,
      journal:{path:path.relative(process.cwd(),paths.journalPath),signals:journal.summary}
    },
    summary:{
      universeDiscovered:snapshot.diagnostics?.discoveredSymbols||0,
      universeAnalyzed:snapshot.diagnostics?.usableSymbols||snapshot.symbols?.length||0,
      recommendations:quantResult.recommendationCount||0,
      calibrationReady:Boolean(calibration.calibrationReady),
      brokerRecommendations:brokerCollection.recommendations?.length||0,
      comparisonCounts:comparison?.counts||null
    }
  };
}

async function runPipeline(options={}){
  QE.assertShadowSafety();
  const outDir=options.outDir||process.env.QE_OUT_DIR||path.join(__dirname,'data');
  fs.mkdirSync(outDir,{recursive:true});

  let snapshot=await buildIndependentSnapshot(options.feedOptions||{});
  const snapshotPath=writeJson(path.join(outDir,'independent-snapshot.json'),snapshot);
  const journalPath=path.join(outDir,'shadow-journal.json');
  const mainPath=options.mainPath||process.env.QE_MAIN_COMPARISON_FILE||path.resolve(__dirname,'../../data/recommendations.json');

  if(snapshot.sourceGrade!=='ANALYSIS_GRADE'){
    const brokerCollection={
      generatedAt:new Date().toISOString(),
      asOf:snapshot.asOf,
      recommendations:[],
      diagnostics:[],
      skipped:true,
      reason:'STALE_OR_INCOMPLETE_EGX_SESSION'
    };
    const brokerPath=writeJson(path.join(outDir,'broker-collection.json'),brokerCollection);
    const calibration=blockedCalibration(snapshot);
    const calibrationPath=writeJson(path.join(outDir,'calibration.json'),calibration);
    const quantResult={
      engine:QE.config.engine.name,
      engineVersion:QE.config.engine.version,
      mode:'SHADOW',
      executionAllowed:false,
      blocked:true,
      blockReason:'STALE_OR_INCOMPLETE_EGX_SESSION',
      source:{origin:snapshot.origin,sourceGrade:snapshot.sourceGrade,asOf:snapshot.asOf,requiredSession:snapshot.diagnostics?.requiredSession},
      feedDiagnostics:snapshot.diagnostics,
      calibration:{ready:false,totalCompletedSignals:0,validatedBuckets:0,validation:{}},
      brokerCollectionSummary:{recommendations:0,diagnostics:[]},
      recommendationCount:0,
      recommendations:[],
      rejectedCount:snapshot.diagnostics?.historicalSymbols||0
    };
    const quantPath=writeJson(path.join(outDir,'shadow-latest.json'),quantResult);
    const journal=updateShadowJournal({journalPath,snapshot,quantResult});
    let comparison=null,comparisonPath=null;
    if(fs.existsSync(mainPath)){
      comparison=buildComparison(readJson(mainPath,{}),quantResult);
      comparisonPath=writeJson(path.join(outDir,'vs-main-latest.json'),comparison);
    }
    const manifest=makeManifest({snapshot,brokerCollection,calibration,quantResult,comparison,journal,paths:{snapshotPath,brokerPath,calibrationPath,quantPath,comparisonPath,journalPath}});
    writeJson(path.join(outDir,'manifest.json'),manifest);
    return{snapshot,brokerCollection,calibration,quantResult,comparison,journal,manifest};
  }

  const brokerCollection=await collectPublicBrokerResearch({asOf:snapshot.asOf,authorizedJsonPath:options.authorizedJsonPath||process.env.QE_BROKER_AUTHORIZED_JSON,fetchImpl:options.feedOptions?.fetchImpl});
  snapshot=attachBrokerCollection(snapshot,brokerCollection);
  validateIndependentSnapshot(snapshot);
  writeJson(snapshotPath,snapshot);

  const brokerPath=writeJson(path.join(outDir,'broker-collection.json'),brokerCollection);
  const calibration=buildWalkForwardCalibration(snapshot,options.walkForwardOptions||{});
  const calibrationPath=writeJson(path.join(outDir,'calibration.json'),calibration);
  const calibrator=calibration.calibrationReady?calibratorFromReport(calibration):null;
  const ranked=QE.rankMarket(toUniverse(snapshot),{calibrator});
  const quantResult={...ranked,engineVersion:QE.config.engine.version,executionAllowed:false,blocked:false,source:{origin:snapshot.origin,sourceGrade:snapshot.sourceGrade,asOf:snapshot.asOf,requiredSession:snapshot.diagnostics?.requiredSession,snapshotSha256:hashSnapshot(snapshot)},feedDiagnostics:snapshot.diagnostics,brokerCollectionSummary:{recommendations:brokerCollection.recommendations.length,diagnostics:brokerCollection.diagnostics},calibration:{ready:calibration.calibrationReady,totalCompletedSignals:calibration.totalCompletedSignals,validatedBuckets:calibration.validatedBuckets,validation:calibration.validation}};
  const quantPath=writeJson(path.join(outDir,'shadow-latest.json'),quantResult);
  const journal=updateShadowJournal({journalPath,snapshot,quantResult});
  let comparison=null,comparisonPath=null;
  if(fs.existsSync(mainPath)){
    comparison=buildComparison(readJson(mainPath,{}),quantResult);
    comparisonPath=writeJson(path.join(outDir,'vs-main-latest.json'),comparison);
  }
  const manifest=makeManifest({snapshot,brokerCollection,calibration,quantResult,comparison,journal,paths:{snapshotPath,brokerPath,calibrationPath,quantPath,comparisonPath,journalPath}});
  writeJson(path.join(outDir,'manifest.json'),manifest);
  return{snapshot,brokerCollection,calibration,quantResult,comparison,journal,manifest};
}

if(require.main===module)runPipeline().then(r=>console.log(JSON.stringify({ok:!r.quantResult.blocked,blocked:Boolean(r.quantResult.blocked),blockReason:r.quantResult.blockReason||null,asOf:r.snapshot.asOf,requiredSession:r.snapshot.diagnostics?.requiredSession,sourceGrade:r.snapshot.sourceGrade,analyzed:r.snapshot.diagnostics?.usableSymbols||0,recommendations:r.quantResult.recommendationCount,calibrationReady:r.calibration.calibrationReady,brokerRecommendations:r.brokerCollection.recommendations?.length||0,comparison:r.comparison?.counts||null},null,2))).catch(err=>{console.error(err.stack||err);process.exit(1)});
module.exports={runPipeline,writeJson,readJson,hashFile,blockedCalibration};
