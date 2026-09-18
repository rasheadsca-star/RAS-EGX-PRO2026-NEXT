'use strict';
const fs=require('fs');
const path=require('path');
const {scanText}=require('./legacy-isolation.cjs');
const root=path.resolve(process.argv[2]||process.cwd());
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const text=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=text('astra/runtime/v18/index.html');
const app=text('astra/runtime/v18/app.js');
const pipeline=read('docs/astra/G11_CURRENT_PIPELINE_RUN.json');
const metrics=read('docs/astra/G11_DATA_HEALTH_METRICS.json');
const issues=read('docs/astra/G11_DATA_HEALTH_ISSUES.json');
const guard=read('docs/astra/G11_GUARD37_EVIDENCE.json');
const testEvidence=read('docs/astra/G11_TEST_EVIDENCE.json');
const violations=[...scanText(html,'astra/runtime/v18/index.html'),...scanText(app,'astra/runtime/v18/app.js')];
const remote=/https?:\/\//i.test(html+app);
const checks={
  localSurfaceExists:html.includes('Astra Local Decision Surface')&&app.includes('G11_CURRENT_PIPELINE_RUN.json'),
  noLegacyRuleViolation:violations.length===0,
  noAbsoluteRemoteUrl:remote===false,
  decisionSnapshotReady:pipeline.status==='DECISION_SNAPSHOT_READY',
  decisionSnapshotBound:Boolean(pipeline.decisionSnapshotId&&pipeline.semanticDecisionHash),
  currentSessionMatches:metrics.latestExpectedSession===pipeline.session&&metrics.latestAvailableSession===pipeline.session,
  noLegacyNetworkCalls:pipeline.legacyNetworkCalls===0,
  noProductionCutover:pipeline.productionCutover===false,
  noMaterialG11Blocker:Number(issues.criticalUnresolved||0)===0&&Number(issues.highProductionRelevantUnresolved||0)===0,
  guard37:guard.status==='PASS'&&guard.selfTests?.passed===guard.selfTests?.total,
  g11Tests:Number(testEvidence.g11Tests)>=58&&testEvidence.status==='PASS',
  opportunitiesAgree:Number(metrics.decisionPipeline?.validOpportunities)===Number(pipeline.opportunities),
  decisionReadyAgree:Number(metrics.decisionPipeline?.pipelineReadySecurities)===Number(pipeline.decisionReadyUniverse)
};
const pass=Object.values(checks).every(Boolean);
const out={
  schemaVersion:'astra-g12-r01-parity-1',
  dependencyId:'R01_V18_REMOTE_SHELL_RAW',
  replacement:'astra/runtime/v18/index.html',
  sourceDecisionSnapshot:{session:pipeline.session,decisionSnapshotId:pipeline.decisionSnapshotId,semanticDecisionHash:pipeline.semanticDecisionHash},
  checks,
  violations,
  result:pass?'PASS':'FAIL',
  productionCutover:false
};
process.stdout.write('ASTRA_G12_R01_PARITY '+JSON.stringify(out)+'\n');
if(!pass)process.exitCode=1;
