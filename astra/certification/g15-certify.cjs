'use strict';

const fs=require('fs');
const path=require('path');

const ROOT=path.resolve(__dirname,'../..');
const WRITE=process.argv.includes('--write');
const SOURCE_HEAD=process.env.G15_SOURCE_HEAD||'';
const WORKFLOW_RUN_ID=Number(process.env.G15_WORKFLOW_RUN_ID||0);

function readJson(rel){return JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8'))}
function writeJson(rel,value){fs.writeFileSync(path.join(ROOT,rel),JSON.stringify(value,null,2)+'\n')}
function statuses(g){return new Map((g.gates||[]).map(x=>[x.id,x.status]))}
function updateGate(gates,id,patch){
  const gate=(gates.gates||[]).find(x=>x.id===id);
  if(!gate)throw new Error('Missing gate '+id);
  Object.assign(gate,patch);
}

const gates=readJson('04_ACCEPTANCE_GATES.json');
const primary=readJson('05_WORK_STATE.json');
const docsState=readJson('docs/astra/WORK_STATE.json');
const evidence=readJson('docs/astra/G15_BROWSER_SMOKE_EVIDENCE.json');
const g14=readJson('docs/astra/G14_CERTIFICATION.json');
const map=statuses(gates);

const priorGreen=Array.from({length:14},(_,i)=>'G'+String(i+1).padStart(2,'0')).every(id=>map.get(id)==='GREEN');
const checks={
  sourceHeadProvided:Boolean(SOURCE_HEAD),
  evidenceMatchesSourceHead:evidence.sourceHead===SOURCE_HEAD,
  workflowRunMatches:!WORKFLOW_RUN_ID||evidence.workflowRunId===WORKFLOW_RUN_ID,
  g01ThroughG14Green:priorGreen,
  g15PendingBeforePromotion:map.get('G15')==='PENDING',
  g16Pending:map.get('G16')==='PENDING',
  evidencePassed:evidence.status==='PASS'&&Array.isArray(evidence.failedChecks)&&evidence.failedChecks.length===0,
  realChromium:Boolean(evidence.browser?.version)&&evidence.browser?.engine==='Chromium',
  desktopAndMobile:Array.isArray(evidence.browser?.profiles)&&evidence.browser.profiles.includes('chromium-desktop')&&evidence.browser.profiles.includes('chromium-mobile'),
  desktopPassed:evidence.scenarios?.desktop?.status==='PASS',
  mobilePassed:evidence.scenarios?.mobile?.status==='PASS',
  localBootstrapPassed:evidence.scenarios?.bootstrap?.status==='PASS',
  failClosedPassed:evidence.scenarios?.failClosed?.status==='PASS',
  zeroExternalRequests:evidence.checks?.zeroExternalRequests===true,
  renderedDecisionTruthMatches:evidence.checks?.renderedDecisionTruthMatches===true,
  strictZeroLegacy:evidence.strictLegacyScan?.clean===true&&evidence.strictLegacyScan?.runtimeLegacyDependencyCount===0&&evidence.strictLegacyScan?.matches===0,
  g14CertifiedGreen:g14.status==='GREEN'&&g14.productionCutover===false,
  productionCutoverDisabled:evidence.productionCutover===false&&g14.productionCutover===false,
  stateAlignedBeforePromotion:
    primary.current_gate==='G15'&&primary.last_green_gate==='G14'&&primary.current_phase==='G15_PENDING'&&
    docsState.current_gate==='G15'&&docsState.last_green_gate==='G14'&&docsState.current_phase==='G15_PENDING'
};
const failedChecks=Object.entries(checks).filter(([,ok])=>!ok).map(([k])=>k);
if(failedChecks.length){
  console.error(JSON.stringify({status:'FAIL',failedChecks},null,2));
  process.exit(1);
}

const now=new Date().toISOString();
const certification={
  schemaVersion:'astra-g15-certification-1',
  generatedAt:now,
  status:'GREEN',
  sourceHead:SOURCE_HEAD,
  workflowRunId:WORKFLOW_RUN_ID||evidence.workflowRunId||null,
  checks,
  failedChecks:[],
  browser:{
    engine:evidence.browser.engine,
    version:evidence.browser.version,
    profiles:evidence.browser.profiles,
    desktop:evidence.scenarios.desktop.status,
    mobile:evidence.scenarios.mobile.status
  },
  runtimeSurface:evidence.target.surface,
  bootstrapSurface:evidence.target.bootstrap,
  decisionSnapshotId:evidence.persistedTruth.decisionSnapshotId,
  semanticDecisionHash:evidence.persistedTruth.semanticDecisionHash,
  externalRequests:0,
  failClosedScenario:'PASS',
  runtimeLegacyDependencyCount:evidence.strictLegacyScan.runtimeLegacyDependencyCount,
  regressionBoundary:'G01-G14 GREEN PRESERVED',
  productionCutover:false,
  nextGate:'G16',
  nextGateStatus:'PENDING'
};

if(WRITE){
  writeJson('docs/astra/G15_CERTIFICATION.json',certification);
  updateGate(gates,'G15',{
    status:'GREEN',
    evidence:[
      'docs/astra/G15_CERTIFICATION.json',
      'docs/astra/G15_BROWSER_SMOKE_EVIDENCE.json',
      'docs/astra/G15_BROWSER_SMOKE_REPORT.md',
      'astra/certification/g15-browser-smoke.cjs',
      'astra/certification/g15-certify.cjs',
      '.github/workflows/astra-g15-chromium-smoke.yml'
    ]
  });
  gates.updated_at=now;
  writeJson('04_ACCEPTANCE_GATES.json',gates);

  for(const state of [primary,docsState]){
    state.current_phase='G16_PENDING';
    state.current_gate='G16';
    state.last_green_gate='G15';
    state.blocking_issues=[];
    state.blocked_gates=Array.isArray(state.blocked_gates)?state.blocked_gates.filter(x=>x!=='G15'):[];
    state.failed_gates=Array.isArray(state.failed_gates)?state.failed_gates.filter(x=>x!=='G15'):[];
    state.completed_gates=Array.from(new Set([...(state.completed_gates||[]),'G15']));
    state.clean_review_streak=0;
    state.next_action='Begin G16 production deployment. Keep production cutover disabled until its dedicated acceptance boundary permits it.';
    state.last_updated=now;
    state.g15_certification={
      status:'GREEN',
      workflowRunId:certification.workflowRunId,
      sourceCommit:SOURCE_HEAD,
      browserVersion:certification.browser.version,
      profiles:certification.browser.profiles,
      runtimeSurface:certification.runtimeSurface,
      decisionSnapshotId:certification.decisionSnapshotId,
      semanticDecisionHash:certification.semanticDecisionHash,
      externalRequests:0,
      failClosedScenario:'PASS',
      runtimeLegacyDependencyCount:certification.runtimeLegacyDependencyCount,
      g01ThroughG14Regression:'PASS',
      productionCutover:false
    };
    const finding='G15 GREEN: real Chromium desktop/mobile smoke passed on the standalone Astra local decision surface with persisted DecisionSnapshot truth, same-origin-only requests, zero legacy runtime dependencies and an explicit fail-closed outage scenario.';
    state.material_findings=Array.isArray(state.material_findings)?state.material_findings:[];
    if(!state.material_findings.includes(finding))state.material_findings.push(finding);
  }
  writeJson('05_WORK_STATE.json',primary);
  writeJson('docs/astra/WORK_STATE.json',docsState);
}

console.log(JSON.stringify(certification,null,2));
