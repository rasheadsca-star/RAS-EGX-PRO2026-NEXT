'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..'),WRITE=process.argv.includes('--write');
const SOURCE_HEAD=process.env.G20_SOURCE_HEAD||'',RUN=Number(process.env.G20_WORKFLOW_RUN_ID||0);
const read=r=>JSON.parse(fs.readFileSync(path.join(ROOT,r),'utf8'));
const write=(r,v)=>fs.writeFileSync(path.join(ROOT,r),JSON.stringify(v,null,2)+'\n');

const gates=read('04_ACCEPTANCE_GATES.json');
const a=read('05_WORK_STATE.json');
const b=read('docs/astra/WORK_STATE.json');
const e=read('docs/astra/G20_CUTOVER_EVIDENCE.json');
const t=read('docs/astra/G20_TRIGGER.json');
const p=read('docs/astra/G20_CUTOVER_PLAN.json');
const g19=read('docs/astra/G19_CERTIFICATION.json');
const m=new Map(gates.gates.map(x=>[x.id,x.status]));

const checks={
  sourceHeadProvided:Boolean(SOURCE_HEAD),
  evidenceMatchesSource:e.sourceHead===SOURCE_HEAD,
  workflowRunMatches:!RUN||e.workflowRunId===RUN,
  g01ThroughG19Green:Array.from({length:19},(_,i)=>m.get('G'+String(i+1).padStart(2,'0'))).every(x=>x==='GREEN'),
  g20Pending:m.get('G20')==='PENDING',
  priorCertificationPreserved:g19.status==='GREEN'&&g19.certified===true&&g19.cleanReviewStreak===10,
  stateAligned:a.current_gate==='G20'&&a.current_phase==='G20_PENDING'&&a.last_green_gate==='G19'&&b.current_gate==='G20'&&b.current_phase==='G20_PENDING'&&b.last_green_gate==='G19',
  verificationPassed:e.status==='PASS'&&e.failedChecks.length===0,
  rollbackPinned:t.previousProductionMain===p.rollback.commit&&t.rollbackBranch===p.rollback.branch,
  runtimeExact:e.checks.runtimeByteExact===true,
  truthExact:e.checks.persistedTruthByteExact===true,
  desktopPass:e.browser.desktop.status==='PASS',
  mobilePass:e.browser.mobile.status==='PASS',
  zeroExternal:e.externalRequests===0&&e.runtimeExternalReferences===0,
  zeroLegacy:e.runtimeLegacyDependencyCount===0,
  noUnauthorized:e.unauthorizedMutations===0,
  cutoverTrue:e.productionCutover===true
};
const failedChecks=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
if(failedChecks.length){console.error(JSON.stringify({status:'FAIL',failedChecks},null,2));process.exit(1)}

const now=new Date().toISOString();
const cert={
  schemaVersion:'astra-g20-certification-1',
  generatedAt:now,
  status:'GREEN',
  sourceHead:SOURCE_HEAD,
  workflowRunId:RUN||e.workflowRunId||null,
  checks,
  failedChecks:[],
  previousProductionMain:t.previousProductionMain,
  productionMain:t.cutoverCommit,
  rollbackBranch:t.rollbackBranch,
  pagesWorkflowRunId:t.pagesWorkflowRunId,
  publicRoot:e.cutover.publicRoot,
  runtimeUrl:e.cutover.runtimeUrl,
  certifiedG19Target:g19.reviewTargetHead,
  decisionSnapshotId:e.decisionSnapshotId,
  semanticDecisionHash:e.semanticDecisionHash,
  runtimeByteExact:true,
  persistedTruthByteExact:true,
  externalRequests:0,
  runtimeLegacyDependencyCount:0,
  runtimeExternalReferences:0,
  unauthorizedMutations:0,
  productionCutover:true,
  g01ThroughG20:'GREEN',
  g21Started:false
};

if(WRITE){
  write('docs/astra/G20_CERTIFICATION.json',cert);
  const gate=gates.gates.find(x=>x.id==='G20');
  if(!gate)throw new Error('Missing G20');
  gate.status='GREEN';
  gate.evidence=[
    'docs/astra/G20_CERTIFICATION.json',
    'docs/astra/G20_CUTOVER_PLAN.json',
    'docs/astra/G20_TRIGGER.json',
    'docs/astra/G20_CUTOVER_EVIDENCE.json',
    'docs/astra/G20_CUTOVER_REPORT.md',
    'astra/certification/g20-verify-cutover.cjs',
    'astra/certification/g20-certify.cjs',
    '.github/workflows/astra-g20-final-production-cutover.yml'
  ];
  gates.certified=true;
  gates.certified_through='G20';
  gates.releaseCutoverCertified=true;
  gates.updated_at=now;
  write('04_ACCEPTANCE_GATES.json',gates);

  for(const s of [a,b]){
    s.current_phase='PRODUCTION_CUTOVER_CERTIFIED';
    s.current_gate='COMPLETE';
    s.last_green_gate='G20';
    s.blocking_issues=[];
    s.failed_gates=[];
    s.blocked_gates=[];
    s.completed_gates=Array.from(new Set([...(s.completed_gates||[]),'G20']));
    s.productionCutover=true;
    s.last_updated=now;
    s.next_action='G20 complete. Public production now routes to certified Astra. G21 post-cutover production verification may start only on explicit request.';
    s.g20_certification={
      status:'GREEN',
      workflowRunId:cert.workflowRunId,
      sourceCommit:SOURCE_HEAD,
      previousProductionMain:cert.previousProductionMain,
      productionMain:cert.productionMain,
      rollbackBranch:cert.rollbackBranch,
      pagesWorkflowRunId:cert.pagesWorkflowRunId,
      publicRoot:cert.publicRoot,
      runtimeUrl:cert.runtimeUrl,
      certifiedG19Target:cert.certifiedG19Target,
      runtimeByteExact:true,
      persistedTruthByteExact:true,
      externalRequests:0,
      runtimeLegacyDependencyCount:0,
      runtimeExternalReferences:0,
      unauthorizedMutations:0,
      productionCutover:true,
      g21Started:false
    };
    const finding='G20 GREEN: public GitHub Pages entrypoint was cut over to the certified Astra runtime with the prior main pinned on a dedicated rollback branch; the certified runtime and decision truth stayed byte-exact, legacy root service worker was decommissioned, and immediate desktop/mobile public-root verification passed.';
    s.material_findings=s.material_findings||[];
    if(!s.material_findings.includes(finding))s.material_findings.push(finding);
  }
  write('05_WORK_STATE.json',a);
  write('docs/astra/WORK_STATE.json',b);
}
console.log(JSON.stringify(cert,null,2));
