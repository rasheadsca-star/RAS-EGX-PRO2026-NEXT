'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const WRITE=process.argv.includes('--write');
const SOURCE_HEAD=process.env.G17_SOURCE_HEAD||'';
const WORKFLOW_RUN_ID=Number(process.env.G17_WORKFLOW_RUN_ID||0);
const read=r=>JSON.parse(fs.readFileSync(path.join(ROOT,r),'utf8'));
const write=(r,v)=>fs.writeFileSync(path.join(ROOT,r),JSON.stringify(v,null,2)+'\n');
const gates=read('04_ACCEPTANCE_GATES.json');
const primary=read('05_WORK_STATE.json'),docsState=read('docs/astra/WORK_STATE.json');
const evidence=read('docs/astra/G17_LIVE_PRODUCTION_EVIDENCE.json');
const g16=read('docs/astra/G16_CERTIFICATION.json');
const by=new Map((gates.gates||[]).map(g=>[g.id,g.status]));
const priorGreen=Array.from({length:16},(_,i)=>'G'+String(i+1).padStart(2,'0')).every(id=>by.get(id)==='GREEN');
const checks={
  sourceHeadProvided:Boolean(SOURCE_HEAD),
  evidenceMatchesSourceHead:evidence.sourceHead===SOURCE_HEAD,
  workflowRunMatches:!WORKFLOW_RUN_ID||evidence.workflowRunId===WORKFLOW_RUN_ID,
  g01ThroughG16Green:priorGreen,
  g17PendingBeforePromotion:by.get('G17')==='PENDING',
  laterGatesPending:by.get('G18')==='PENDING'&&by.get('G19')==='PENDING',
  stateAlignedBeforePromotion:primary.current_gate==='G17'&&primary.last_green_gate==='G16'&&primary.current_phase==='G17_PENDING'&&docsState.current_gate==='G17'&&docsState.last_green_gate==='G16'&&docsState.current_phase==='G17_PENDING',
  g16CertifiedGreen:g16.status==='GREEN'&&g16.productionCutover===false&&g16.runtimeLegacyDependencyCount===0&&g16.runtimeExternalReferences===0,
  liveVerificationPassed:evidence.status==='PASS'&&Array.isArray(evidence.failedChecks)&&evidence.failedChecks.length===0,
  realChromium:evidence.browser?.engine==='Chromium'&&Boolean(evidence.browser?.version),
  productionRootPassed:evidence.scenarios?.root?.status==='PASS',
  desktopPassed:evidence.scenarios?.desktop?.status==='PASS',
  mobilePassed:evidence.scenarios?.mobile?.status==='PASS',
  failClosedPassed:evidence.scenarios?.failClosed?.status==='PASS',
  liveRuntimeByteExact:evidence.liveBytes?.runtimeAllExact===true,
  livePersistedTruthByteExact:evidence.liveBytes?.truthAllExact===true,
  deploymentManifestSafe:evidence.liveBytes?.manifestValid===true,
  zeroExternalRequests:evidence.checks?.zeroExternalRequests===true,
  renderedDecisionTruthMatches:evidence.checks?.renderedDecisionTruthMatches===true,
  strictZeroLegacy:evidence.strictLegacyScan?.clean===true&&evidence.strictLegacyScan?.runtimeLegacyDependencyCount===0&&evidence.strictLegacyScan?.matches===0,
  productionCutoverDisabled:evidence.productionCutover===false&&g16.productionCutover===false
};
const failedChecks=Object.entries(checks).filter(([,ok])=>!ok).map(([k])=>k);
if(failedChecks.length){console.error(JSON.stringify({status:'FAIL',failedChecks},null,2));process.exit(1)}
const now=new Date().toISOString();
const certification={
  schemaVersion:'astra-g17-certification-1',generatedAt:now,status:'GREEN',sourceHead:SOURCE_HEAD,
  workflowRunId:WORKFLOW_RUN_ID||evidence.workflowRunId||null,checks,failedChecks:[],
  deployment:{provider:'GITHUB_PAGES',productionUrl:evidence.target.productionUrl,runtimeUrl:evidence.target.runtimeUrl,isolatedPath:evidence.target.isolatedPath},
  browser:{engine:evidence.browser.engine,version:evidence.browser.version,profiles:evidence.browser.profiles},
  decisionSnapshotId:evidence.persistedTruth.decisionSnapshotId,
  semanticDecisionHash:evidence.persistedTruth.semanticDecisionHash,
  liveRuntimeByteExact:true,livePersistedTruthByteExact:true,externalRequests:0,failClosedScenario:'PASS',
  runtimeLegacyDependencyCount:0,regressionBoundary:'G01-G16 GREEN PRESERVED',productionCutover:false,nextGate:'G18',nextGateStatus:'PENDING'
};
if(WRITE){
  write('docs/astra/G17_CERTIFICATION.json',certification);
  const gate=(gates.gates||[]).find(g=>g.id==='G17');if(!gate)throw Error('Missing G17');
  gate.status='GREEN';gate.evidence=['docs/astra/G17_CERTIFICATION.json','docs/astra/G17_LIVE_PRODUCTION_EVIDENCE.json','docs/astra/G17_LIVE_PRODUCTION_REPORT.md','astra/certification/g17-live-production.cjs','astra/certification/g17-certify.cjs','.github/workflows/astra-g17-live-production-verification.yml'];
  gates.updated_at=now;write('04_ACCEPTANCE_GATES.json',gates);
  for(const state of [primary,docsState]){
    state.current_phase='G18_PENDING';state.current_gate='G18';state.last_green_gate='G17';state.blocking_issues=[];
    state.blocked_gates=(state.blocked_gates||[]).filter(x=>x!=='G17');state.failed_gates=(state.failed_gates||[]).filter(x=>x!=='G17');
    state.completed_gates=Array.from(new Set([...(state.completed_gates||[]),'G17']));state.clean_review_streak=0;
    state.next_action='Begin G18 legacy-off cutover simulation only. Do not perform a real legacy/public cutover.';
    state.last_updated=now;
    state.g17_certification={status:'GREEN',workflowRunId:certification.workflowRunId,sourceCommit:SOURCE_HEAD,provider:'GITHUB_PAGES',productionUrl:certification.deployment.productionUrl,runtimeUrl:certification.deployment.runtimeUrl,browserVersion:certification.browser.version,profiles:certification.browser.profiles,decisionSnapshotId:certification.decisionSnapshotId,semanticDecisionHash:certification.semanticDecisionHash,liveRuntimeByteExact:true,livePersistedTruthByteExact:true,externalRequests:0,failClosedScenario:'PASS',runtimeLegacyDependencyCount:0,g01ThroughG16Regression:'PASS',productionCutover:false};
    const finding='G17 GREEN: the isolated Astra GitHub Pages production surface passed live Chromium verification on production root, desktop and mobile; runtime and persisted decision truth remained byte-exact, requests remained same-origin only, and the live resource-outage scenario failed closed without any public/legacy cutover.';
    state.material_findings=state.material_findings||[];if(!state.material_findings.includes(finding))state.material_findings.push(finding);
  }
  write('05_WORK_STATE.json',primary);write('docs/astra/WORK_STATE.json',docsState);
}
console.log(JSON.stringify(certification,null,2));
