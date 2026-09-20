'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..'),WRITE=process.argv.includes('--write');
const SOURCE_HEAD=process.env.G22_SOURCE_HEAD||'',RUN=Number(process.env.G22_WORKFLOW_RUN_ID||0);
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const write=(p,v)=>fs.writeFileSync(path.join(ROOT,p),JSON.stringify(v,null,2)+'\n');

const gates=read('04_ACCEPTANCE_GATES.json');
const a=read('05_WORK_STATE.json');
const b=read('docs/astra/WORK_STATE.json');
const e=read('docs/astra/G22_PRODUCTION_EVIDENCE.json');
const baseline=read('docs/astra/G22_BASELINE.json');
const trigger=read('docs/astra/G22_TRIGGER.json');
const g21=read('docs/astra/G21_CERTIFICATION.json');
const m=new Map(gates.gates.map(x=>[x.id,x.status]));

const checks={
  sourceHeadProvided:Boolean(SOURCE_HEAD),
  evidenceMatchesSource:e.sourceHead===SOURCE_HEAD,
  workflowRunMatches:!RUN||e.workflowRunId===RUN,
  g01ThroughG21Green:Array.from({length:21},(_,i)=>m.get('G'+String(i+1).padStart(2,'0'))).every(x=>x==='GREEN'),
  g22Pending:m.get('G22')==='PENDING',
  g21Preserved:g21.status==='GREEN'&&g21.productionCutover===true,
  stateAligned:a.current_gate==='G22'&&a.current_phase==='G22_PENDING'&&a.last_green_gate==='G21'&&b.current_gate==='G22'&&b.current_phase==='G22_PENDING'&&b.last_green_gate==='G21',
  triggerMatchesBaseline:trigger.previousProductionMain===baseline.productionMainAtAuthorization&&trigger.rollbackProductionMain===baseline.rollbackProductionMain&&trigger.rollbackBranch===baseline.rollbackBranch,
  verificationPassed:e.status==='PASS'&&Array.isArray(e.failedChecks)&&e.failedChecks.length===0,
  bundleExact:e.checks.fullAppBundleByteExact===true,
  rootCutover:e.checks.rootTargetsFullApp===true,
  manifestValid:e.checks.productionManifestValid===true,
  desktopPass:e.browser.desktop.status==='PASS',
  mobilePass:e.browser.mobile.status==='PASS',
  decisionIdentityPreserved:e.decisionSnapshotId===baseline.decisionSnapshotId&&e.semanticDecisionHash===baseline.semanticDecisionHash,
  zeroLegacy:e.runtimeLegacyDependencyCount===0,
  zeroExternal:e.runtimeExternalReferences===0&&e.externalRequests===0,
  noUnauthorized:e.unauthorizedMutations===0,
  cutoverTrue:e.productionCutover===true
};
const failedChecks=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
if(failedChecks.length){console.error(JSON.stringify({status:'FAIL',failedChecks},null,2));process.exit(1)}

const now=new Date().toISOString();
const cert={
  schemaVersion:'astra-g22-certification-1',
  generatedAt:now,
  status:'GREEN',
  sourceHead:SOURCE_HEAD,
  workflowRunId:RUN||e.workflowRunId||null,
  checks,
  failedChecks:[],
  productionMain:trigger.cutoverCommit,
  previousProductionMain:trigger.previousProductionMain,
  rollbackProductionMain:trigger.rollbackProductionMain,
  rollbackBranch:trigger.rollbackBranch,
  pagesWorkflowRunId:trigger.pagesWorkflowRunId,
  publicRoot:trigger.publicRoot,
  fullAppUrl:trigger.fullAppUrl,
  browserVersion:e.browser.version,
  desktop:e.browser.desktop.status,
  mobile:e.browser.mobile.status,
  recommendationCount:e.recommendations,
  decisionSnapshotId:e.decisionSnapshotId,
  semanticDecisionHash:e.semanticDecisionHash,
  runtimeLegacyDependencyCount:0,
  runtimeExternalReferences:0,
  externalRequests:0,
  unauthorizedMutations:0,
  productionCutover:true,
  g01ThroughG22:'GREEN'
};

if(WRITE){
  write('docs/astra/G22_CERTIFICATION.json',cert);
  const gate=gates.gates.find(x=>x.id==='G22');if(!gate)throw new Error('Missing G22');
  gate.status='GREEN';
  gate.evidence=[
    'docs/astra/G22_CERTIFICATION.json',
    'docs/astra/G22_BASELINE.json',
    'docs/astra/G22_TRIGGER.json',
    'docs/astra/G22_LOCAL_UI_EVIDENCE.json',
    'docs/astra/G22_PRODUCTION_EVIDENCE.json',
    'docs/astra/G22_PRODUCTION_REPORT.md',
    'deploy/g22-full-app/index.html',
    'deploy/g22-full-app/app.js',
    'deploy/g22-full-app/data.json',
    'scripts/g22/live-verify.cjs',
    'scripts/g22/certify.cjs',
    '.github/workflows/astra-g22-full-app.yml'
  ];
  gates.certified=true;
  gates.certified_through='G22';
  gates.releaseCutoverCertified=true;
  gates.g22Started=true;
  gates.updated_at=now;
  write('04_ACCEPTANCE_GATES.json',gates);

  for(const s of [a,b]){
    s.current_phase='PRODUCTION_FULL_APP_CERTIFIED';
    s.current_gate='COMPLETE';
    s.last_green_gate='G22';
    s.blocking_issues=[];
    s.failed_gates=[];
    s.blocked_gates=[];
    s.completed_gates=Array.from(new Set([...(s.completed_gates||[]),'G22']));
    s.productionCutover=true;
    s.g22Started=true;
    s.last_updated=now;
    s.next_action='G22 complete. Full Astra application is the public production entrypoint; no further gate is open.';
    s.g22_certification={
      status:'GREEN',
      workflowRunId:cert.workflowRunId,
      sourceCommit:SOURCE_HEAD,
      productionMain:cert.productionMain,
      previousProductionMain:cert.previousProductionMain,
      rollbackProductionMain:cert.rollbackProductionMain,
      rollbackBranch:cert.rollbackBranch,
      pagesWorkflowRunId:cert.pagesWorkflowRunId,
      publicRoot:cert.publicRoot,
      fullAppUrl:cert.fullAppUrl,
      browserVersion:cert.browserVersion,
      desktop:'PASS',
      mobile:'PASS',
      recommendationCount:cert.recommendationCount,
      decisionSnapshotId:cert.decisionSnapshotId,
      semanticDecisionHash:cert.semanticDecisionHash,
      runtimeLegacyDependencyCount:0,
      runtimeExternalReferences:0,
      externalRequests:0,
      unauthorizedMutations:0,
      productionCutover:true
    };
    const finding='G22 GREEN: the public production root now opens the full Astra application with current Astra recommendations, full-market search/stock detail, local-only portfolio, recommendation history and system health; desktop/mobile production verification passed with exact DecisionSnapshot identity and zero legacy/external runtime dependency.';
    s.material_findings=s.material_findings||[];
    if(!s.material_findings.includes(finding))s.material_findings.push(finding);
  }
  write('05_WORK_STATE.json',a);
  write('docs/astra/WORK_STATE.json',b);
}
console.log(JSON.stringify(cert,null,2));
