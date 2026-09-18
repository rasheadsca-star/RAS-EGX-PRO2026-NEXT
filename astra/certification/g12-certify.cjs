'use strict';
const fs=require('fs');
const path=require('path');
const {scanLegacyDependencies}=require('./legacy-isolation.cjs');

const ROOT=path.resolve(process.cwd());
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const write=(p,v)=>{const f=path.join(ROOT,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n')};
const sourceHead=process.env.G12_SOURCE_HEAD||process.env.GITHUB_SHA||'UNKNOWN';
const workflowRunId=Number(process.env.G12_WORKFLOW_RUN_ID||process.env.GITHUB_RUN_ID||0)||null;
const regressionTests=Number(process.env.G12_REGRESSION_TESTS||0);
const regressionPass=Number(process.env.G12_REGRESSION_PASS||0);
const regressionFail=Number(process.env.G12_REGRESSION_FAIL||0);
const regressionSkipped=Number(process.env.G12_REGRESSION_SKIPPED||0);
const regressionCancelled=Number(process.env.G12_REGRESSION_CANCELLED||0);
const regressionTodo=Number(process.env.G12_REGRESSION_TODO||0);
const now=new Date().toISOString();

const gates=read('04_ACCEPTANCE_GATES.json');
const states=['05_WORK_STATE.json','docs/astra/WORK_STATE.json'];
const plan=read('docs/astra/LEGACY_REMOVAL_PLAN.json');
const g11Tests=read('docs/astra/G11_TEST_EVIDENCE.json');
const g11Issues=read('docs/astra/G11_DATA_HEALTH_ISSUES.json');
const g11Gaps=read('docs/astra/G11_CURRENT_UNIVERSE_GAPS.json');
const pipeline=read('docs/astra/G11_CURRENT_PIPELINE_RUN.json');
const eligibility=read('docs/astra/PRODUCTION_ELIGIBILITY_AUDIT.json');
const g10Parity=read('docs/astra/G10_PARITY_RESULTS.json');
const scan=scanLegacyDependencies(ROOT);

const gateMap=new Map(gates.gates.map(x=>[x.id,x]));
for(let n=1;n<=11;n++){
  const id='G'+String(n).padStart(2,'0');
  if(gateMap.get(id)?.status!=='GREEN')throw Error(id+' regression boundary is not GREEN');
}
if(scan.runtimeLegacyDependencyCount!==0||!scan.clean||scan.matches.length!==0)throw Error('G12 legacy scan is not clean');
if(plan.dependencies.length!==8||plan.dependencies.some(x=>x.status!=='CLOSED'))throw Error('R01-R08 are not all CLOSED');
if(Number(g11Tests.g11Tests)!==58||g11Tests.status!=='PASS')throw Error('G11 58/58 evidence boundary not preserved');
if(Number(g11Issues.criticalUnresolved||0)!==0)throw Error('G11 CRITICAL boundary changed');
const high=Number(g11Issues.highUnresolved??g11Issues.highProductionRelevantUnresolved??0);
if(high!==0)throw Error('G11 HIGH boundary changed');
if(Number(g11Gaps.gapCount??g11Gaps.currentUniverseGapCount??0)!==0)throw Error('G11 current-session gap boundary changed');
if(pipeline.productionCutover!==false||Number(pipeline.legacyNetworkCalls||0)!==0)throw Error('production cutover/network invariant violated');
if(g10Parity.quantEdge?.parityMode!=='OUTPUT_INTEGRITY_ONLY'||g10Parity.quantEdge?.algorithmicallyReproduced!==false)throw Error('QUANT_EDGE disposition changed');
if(eligibility.productionEligibleCount!==1||eligibility.productionEligibleStrategyIds?.[0]!=='PORTFOLIO_BASKET_EQUAL_WEIGHT')throw Error('G10 production eligibility invariant changed');
const g07State=read('05_WORK_STATE.json').g07_certification;
if(g07State?.status!=='GREEN'||g07State?.idempotency!=='PASS')throw Error('G07 persisted migration certification/idempotency not preserved');
if(!(regressionTests>0&&regressionPass+regressionSkipped===regressionTests&&regressionFail===0&&regressionCancelled===0&&regressionTodo===0))throw Error('G01-G11 regression suite evidence is not clean');
if(regressionSkipped!==11)throw Error('Unexpected regression skip count; only the 11 G07 real-migration rerun cases may be skipped');

const closedIds=plan.dependencies.map(x=>x.dependencyId);
const certification={
  schemaVersion:'astra-g12-certification-1',
  generatedAt:now,
  status:'GREEN',
  workflowRunId,
  sourceHead,
  baselineLegacyRuntimeDependencyCount:8,
  runtimeLegacyDependencyCount:0,
  activeSurfaceScan:{
    mode:scan.scanMode,
    scannedFileCount:scan.scannedFileCount,
    matches:scan.matches,
    dependencyIds:scan.dependencyIds,
    clean:scan.clean
  },
  dependencyClosure:{closed:closedIds.length,total:8,dependencyIds:closedIds,status:'PASS'},
  prohibitedRuntimeDependencies:{
    rawGitHubLoader:false,
    jsDelivrLoader:false,
    externalStrategyApi:false,
    legacyVercelProxy:false,
    crossBranchRuntimeOrBuildDependency:false,
    status:'PASS'
  },
  replacementEvidence:{
    v18:'LOCAL_DECISION_SNAPSHOT_BOUND',
    v19:'INTERNAL_G08_STRATEGY',
    v20:'INTERNAL_G08_STRATEGY',
    quantEdge:'HISTORICAL_OUTPUT_ONLY',
    sepa:'INTERNAL_G08_STRATEGY_FAIL_CLOSED',
    tfe:'INTERNAL_G08_STRATEGY_LOCAL_SERVICE',
    sepaBuild:'SOURCE_EXACT_VENDORED_PINNED_COMMIT'
  },
  blockedLegacyHostBehavior:'PASS_BY_LOCAL_ONLY_AND_FAIL_CLOSED_CONTRACT_TESTS',
  regression:{
    g01ThroughG11GateState:'GREEN',
    tests:regressionTests,
    pass:regressionPass,
    skipped:regressionSkipped,
    fail:regressionFail,
    cancelled:regressionCancelled,
    todo:regressionTodo,
    skipReason:'11 G07 real-migration rerun cases intentionally skipped to preserve the non-mutating G12 boundary; persisted G07 GREEN/idempotency evidence is revalidated.',
    status:'PASS_WITH_INTENTIONAL_NON_MUTATING_SKIPS'
  },
  g11Boundary:{
    tests:'58/58 PASS',
    criticalUnresolved:0,
    highUnresolved:0,
    currentSessionGap:0
  },
  quantEdge:{disposition:'HISTORICAL_OUTPUT_ONLY',algorithmicallyReproduced:false,liveDecisionInfluence:0},
  productionCutover:false,
  nextGate:'G13',
  nextGateStatus:gateMap.get('G13')?.status||'PENDING'
};
write('docs/astra/G12_CERTIFICATION.json',certification);
write('docs/astra/G12_REGRESSION_EVIDENCE.json',{
  schemaVersion:'astra-g12-regression-evidence-1',
  generatedAt:now,workflowRunId,sourceHead,
  scope:'NON_MUTATING_G06_G11_TEST_REGRESSION',
  tests:regressionTests,pass:regressionPass,skipped:regressionSkipped,fail:regressionFail,cancelled:regressionCancelled,todo:regressionTodo,status:'PASS_WITH_INTENTIONAL_NON_MUTATING_SKIPS',
  intentionalSkips:{count:regressionSkipped,scope:'G07_REAL_MIGRATION_RERUN',reason:'Avoid data-writing migration rerun during G12; persisted G07 GREEN/idempotency evidence revalidated.'},
  g11DataRefreshPerformed:false,productionCutover:false
});

const g12=gateMap.get('G12');
g12.status='GREEN';
delete g12.evidencePrepared;
g12.evidence=[
  'docs/astra/G12_BASELINE_ISOLATION.json',
  'docs/astra/LEGACY_REMOVAL_PLAN.json',
  'docs/astra/G12_CERTIFICATION.json',
  'docs/astra/G12_REGRESSION_EVIDENCE.json',
  'astra/certification/legacy-isolation.cjs'
];
gates.updated_at=now;
write('04_ACCEPTANCE_GATES.json',gates);

plan.policy.G12Status='GREEN';
plan.certification={
  status:'GREEN',workflowRunId,sourceHead,
  runtimeLegacyDependencyCount:0,
  dependenciesClosed:'8/8',
  productionCutover:false
};
write('docs/astra/LEGACY_REMOVAL_PLAN.json',plan);

for(const statePath of states){
  if(!fs.existsSync(path.join(ROOT,statePath)))continue;
  const state=read(statePath);
  state.current_phase='G12_COMPLETE_G13_NOT_STARTED';
  state.current_gate='G13';
  state.last_green_gate='G12';
  state.blocking_issues=[];
  state.failed_gates=(state.failed_gates||[]).filter(x=>x!=='G12');
  state.completed_gates=[...new Set([...(state.completed_gates||[]),'G12'])];
  if(state.inventory)state.inventory.legacy_runtime_dependencies=0;
  state.g12_certification={
    status:'GREEN',workflowRunId,sourceCommit:sourceHead,
    baselineLegacyRuntimeDependencyCount:8,
    runtimeLegacyDependencyCount:0,
    dependenciesClosed:'8/8',
    g01ThroughG11Regression:`${regressionPass} pass + ${regressionSkipped} intentional skips / ${regressionTests}; 0 fail`,
    g11Tests:'58/58 PASS',
    productionCutover:false
  };
  state.next_action='Stop. G12 is GREEN. G13 and production cutover remain PENDING and require an explicit next-stage request.';
  state.last_updated=now;
  write(statePath,state);
}
process.stdout.write('ASTRA_G12_CERTIFICATION '+JSON.stringify({status:'GREEN',runtimeLegacyDependencyCount:0,dependencies:'8/8',regression:`${regressionPass} pass + ${regressionSkipped} skipped / ${regressionTests}`,workflowRunId,sourceHead,productionCutover:false})+'\n');
