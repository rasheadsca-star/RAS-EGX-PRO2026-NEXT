'use strict';

const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..'),WRITE=process.argv.includes('--write');
const SOURCE_HEAD=process.env.G21_SOURCE_HEAD||'',RUN=Number(process.env.G21_WORKFLOW_RUN_ID||0);
const read=r=>JSON.parse(fs.readFileSync(path.join(ROOT,r),'utf8'));
const write=(r,v)=>fs.writeFileSync(path.join(ROOT,r),JSON.stringify(v,null,2)+'\n');

const gates=read('04_ACCEPTANCE_GATES.json');
const a=read('05_WORK_STATE.json');
const b=read('docs/astra/WORK_STATE.json');
const e=read('docs/astra/G21_POST_CUTOVER_EVIDENCE.json');
const baseline=read('docs/astra/G21_BASELINE.json');
const g20=read('docs/astra/G20_CERTIFICATION.json');
const m=new Map(gates.gates.map(x=>[x.id,x.status]));

const checks={
  sourceHeadProvided:Boolean(SOURCE_HEAD),
  evidenceMatchesSource:e.sourceHead===SOURCE_HEAD,
  workflowRunMatches:!RUN||e.workflowRunId===RUN,
  g01ThroughG20Green:Array.from({length:20},(_,i)=>m.get('G'+String(i+1).padStart(2,'0'))).every(x=>x==='GREEN'),
  g21Pending:m.get('G21')==='PENDING',
  priorCertificationPreserved:g20.status==='GREEN'&&g20.productionCutover===true&&g20.productionMain===baseline.expectedProductionMain,
  stateAligned:a.current_gate==='G21'&&a.current_phase==='G21_PENDING'&&a.last_green_gate==='G20'&&a.productionCutover===true&&b.current_gate==='G21'&&b.current_phase==='G21_PENDING'&&b.last_green_gate==='G20'&&b.productionCutover===true,
  verificationPassed:e.status==='PASS'&&Array.isArray(e.failedChecks)&&e.failedChecks.length===0,
  threeProbeRounds:e.checks.threeIndependentProbeRounds===true,
  mainBytesExact:e.checks.allLiveBytesMatchProductionMain===true&&e.checks.liveBytesStableAcrossRounds===true,
  browserPassed:e.browser.desktop.status==='PASS'&&e.browser.mobile.status==='PASS'&&e.browser.failClosed.status==='PASS',
  decisionIdentityPreserved:e.checks.decisionIdentityPreserved===true,
  publisherExclusive:e.checks.canonicalPublisherActive===true&&e.checks.retiredPublishersDisabled===true,
  rollbackPreserved:e.production.rollbackBranch===baseline.rollbackBranch&&e.production.previousMain===baseline.previousProductionMain,
  zeroLegacy:e.runtimeLegacyDependencyCount===0,
  zeroExternal:e.runtimeExternalReferences===0&&e.externalRequests===0,
  noUnauthorized:e.unauthorizedMutations===0,
  cutoverTrue:e.productionCutover===true
};
const failedChecks=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
if(failedChecks.length){console.error(JSON.stringify({status:'FAIL',failedChecks},null,2));process.exit(1)}

const now=new Date().toISOString();
const cert={
  schemaVersion:'astra-g21-certification-1',
  generatedAt:now,
  status:'GREEN',
  sourceHead:SOURCE_HEAD,
  workflowRunId:RUN||e.workflowRunId||null,
  checks,
  failedChecks:[],
  productionMain:baseline.expectedProductionMain,
  previousProductionMain:baseline.previousProductionMain,
  rollbackBranch:baseline.rollbackBranch,
  latestPagesWorkflowRunId:e.latestPagesWorkflowRunId,
  publicRoot:baseline.publicRoot,
  runtimeUrl:baseline.runtimeUrl,
  liveProbeRounds:e.liveProbes.length,
  browserVersion:e.browser.version,
  desktop:e.browser.desktop.status,
  mobile:e.browser.mobile.status,
  failClosed:e.browser.failClosed.status,
  decisionSnapshotId:e.decisionSnapshotId,
  semanticDecisionHash:e.semanticDecisionHash,
  runtimeLegacyDependencyCount:0,
  runtimeExternalReferences:0,
  externalRequests:0,
  unauthorizedMutations:0,
  productionCutover:true,
  g01ThroughG21:'GREEN'
};

if(WRITE){
  write('docs/astra/G21_CERTIFICATION.json',cert);
  const gate=gates.gates.find(x=>x.id==='G21');if(!gate)throw new Error('Missing G21');
  gate.status='GREEN';
  gate.evidence=[
    'docs/astra/G21_CERTIFICATION.json',
    'docs/astra/G21_BASELINE.json',
    'docs/astra/G21_POST_CUTOVER_EVIDENCE.json',
    'docs/astra/G21_POST_CUTOVER_REPORT.md',
    'astra/certification/g21-post-cutover-verify.cjs',
    'astra/certification/g21-certify.cjs',
    '.github/workflows/astra-g21-post-cutover-verification.yml'
  ];
  gates.certified=true;
  gates.certified_through='G21';
  gates.releaseCutoverCertified=true;
  gates.g21Started=true;
  gates.updated_at=now;
  write('04_ACCEPTANCE_GATES.json',gates);

  for(const s of [a,b]){
    s.current_phase='PRODUCTION_POST_CUTOVER_VERIFIED';
    s.current_gate='COMPLETE';
    s.last_green_gate='G21';
    s.blocking_issues=[];
    s.failed_gates=[];
    s.blocked_gates=[];
    s.completed_gates=Array.from(new Set([...(s.completed_gates||[]),'G21']));
    s.productionCutover=true;
    s.g21Started=true;
    s.last_updated=now;
    s.next_action='G21 complete. Production cutover remains active and verified; no further gate is open.';
    s.g21_certification={
      status:'GREEN',
      workflowRunId:cert.workflowRunId,
      sourceCommit:SOURCE_HEAD,
      productionMain:cert.productionMain,
      rollbackBranch:cert.rollbackBranch,
      latestPagesWorkflowRunId:cert.latestPagesWorkflowRunId,
      liveProbeRounds:cert.liveProbeRounds,
      browserVersion:cert.browserVersion,
      desktop:'PASS',mobile:'PASS',failClosed:'PASS',
      decisionSnapshotId:cert.decisionSnapshotId,
      semanticDecisionHash:cert.semanticDecisionHash,
      runtimeLegacyDependencyCount:0,
      runtimeExternalReferences:0,
      externalRequests:0,
      unauthorizedMutations:0,
      productionCutover:true
    };
    const finding='G21 GREEN: post-cutover production remained pinned to the certified G20 main across three independent live byte probes; fresh desktop/mobile Chromium, fail-closed behavior, DecisionSnapshot identity, publisher exclusivity, rollback pin, zero legacy/external runtime references and zero unauthorized mutations all passed without redeploying production.';
    s.material_findings=s.material_findings||[];
    if(!s.material_findings.includes(finding))s.material_findings.push(finding);
  }
  write('05_WORK_STATE.json',a);
  write('docs/astra/WORK_STATE.json',b);
}
console.log(JSON.stringify(cert,null,2));
