'use strict';

const fs=require('fs');
const path=require('path');
const {scan}=require('./g13-architecture-baseline.cjs');
const {scanLegacyDependencies}=require('./legacy-isolation.cjs');

const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const write=(p,v)=>fs.writeFileSync(path.join(ROOT,p),JSON.stringify(v,null,2)+'\n');

function gateMap(gates){return new Map(gates.gates.map(x=>[x.id,x.status]))}
function buildCertification(){
  const generatedAt=new Date().toISOString();
  const gates=read('04_ACCEPTANCE_GATES.json');
  const map=gateMap(gates);
  const baseline=scan();
  const legacy=scanLegacyDependencies(ROOT);
  const g12=read('docs/astra/G12_CERTIFICATION.json');
  const plan=read('docs/astra/LEGACY_REMOVAL_PLAN.json');
  const modules=baseline.moduleIsolation||[];
  const dedicated=modules.filter(x=>x.status==='DEDICATED_ZONE');
  const priorGreen=[...Array(12)].every((_,i)=>map.get('G'+String(i+1).padStart(2,'0'))==='GREEN');
  const g13PreState=map.get('G13');
  const g14State=map.get('G14');
  const regressionStatus=process.env.G13_REGRESSION_STATUS||'NOT_RUN';
  const checks={
    g01ThroughG12Green:priorGreen,
    g13PreCertificationPending:g13PreState==='PENDING',
    g14RemainsPending:g14State==='PENDING',
    findingsTotalZero:baseline.findings.total===0,
    highZero:baseline.findings.high===0,
    mediumZero:baseline.findings.medium===0,
    allLogicalModulesDedicated:modules.length===30&&dedicated.length===30,
    noLegacyRuntimeDependencies:legacy.runtimeLegacyDependencyCount===0&&legacy.clean===true,
    g12CertifiedGreen:g12.status==='GREEN'&&g12.runtimeLegacyDependencyCount===0,
    g12DependenciesClosed:g12.dependencyClosure?.closed===8&&g12.dependencyClosure?.total===8&&plan.dependencies?.length===8&&plan.dependencies.every(x=>x.status==='CLOSED'),
    productionCutoverDisabled:baseline.productionCutover===false&&g12.productionCutover===false,
    regressionBarriersPassed:regressionStatus==='PASS'
  };
  const failed=Object.entries(checks).filter(([,ok])=>!ok).map(([k])=>k);
  const sourceHead=process.env.G13_SOURCE_HEAD||process.env.GITHUB_SHA||'UNKNOWN';
  return{
    schemaVersion:'astra-g13-certification-1',
    generatedAt,
    status:failed.length?'BLOCKED':'GREEN',
    sourceHead,
    workflowRunId:Number(process.env.GITHUB_RUN_ID)||null,
    checks,
    failedChecks:failed,
    architecture:{
      logicalModules:modules.length,
      dedicatedModules:dedicated.length,
      findingsTotal:baseline.findings.total,
      highFindings:baseline.findings.high,
      mediumFindings:baseline.findings.medium,
      dependencyGraphNodes:baseline.dependencyGraph.nodeCount,
      dependencyGraphEdges:baseline.dependencyGraph.edgeCount,
      allModules:modules.map(x=>({module:x.module,status:x.status,dedicatedFiles:x.dedicatedFiles}))
    },
    g12Boundary:{
      status:g12.status,
      runtimeLegacyDependencyCount:g12.runtimeLegacyDependencyCount,
      dependenciesClosed:g12.dependencyClosure?.closed,
      dependenciesTotal:g12.dependencyClosure?.total,
      strictScanClean:legacy.clean,
      strictScanMatches:legacy.matches?.length||0
    },
    regressionBarriers:{
      overall:regressionStatus,
      nonMutatingOnly:true,
      g06Contracts:'PASS_REQUIRED_BY_WORKFLOW',
      g08StrategyReconstruction:'PASS_REQUIRED_BY_WORKFLOW',
      g09SemanticRegression:'PASS_REQUIRED_BY_WORKFLOW',
      g10PersistedRegression:'PASS_REQUIRED_BY_WORKFLOW',
      g11CarryForwardGuard:'PASS_REQUIRED_BY_WORKFLOW',
      g12RuntimeIsolation:'PASS_REQUIRED_BY_WORKFLOW',
      g13ArchitectureRegression:'PASS_REQUIRED_BY_WORKFLOW'
    },
    productionCutover:false,
    nextGate:'G14',
    nextGateStatus:g14State
  };
}
function writeCertification(){
  const cert=buildCertification();
  if(cert.status!=='GREEN')throw new Error('G13_CERTIFICATION_BLOCKED '+cert.failedChecks.join(','));
  const gates=read('04_ACCEPTANCE_GATES.json');
  const g13=gates.gates.find(x=>x.id==='G13');
  const g14=gates.gates.find(x=>x.id==='G14');
  if(!g13||!g14)throw new Error('G13_OR_G14_GATE_MISSING');
  g13.status='GREEN';
  g13.evidence=[
    'docs/astra/G13_CERTIFICATION.json',
    'docs/astra/G13_ARCHITECTURE_BASELINE.json',
    'docs/astra/G13_DEPENDENCY_GRAPH.json',
    'docs/astra/G13_ARCHITECTURE_BASELINE.md',
    'docs/astra/ARCHITECTURE_BOUNDARIES.json',
    'astra/certification/g13-architecture-baseline.cjs',
    'astra/certification/g13-certify.cjs',
    'tests/astra/g13-architecture-baseline.test.cjs',
    'tests/astra/g13-final-certification.test.cjs'
  ];
  g14.status='PENDING';
  gates.updated_at=cert.generatedAt;
  write('docs/astra/G13_CERTIFICATION.json',cert);
  write('04_ACCEPTANCE_GATES.json',gates);
  for(const p of ['05_WORK_STATE.json','docs/astra/WORK_STATE.json']){
    const state=read(p);
    state.current_phase='G14_PENDING';
    state.current_gate='G14';
    state.last_green_gate='G13';
    state.blocking_issues=[];
    state.completed_gates=[...new Set([...(state.completed_gates||[]),'G13'])];
    state.next_action='Begin G14 unit/integration/regression suite. Keep production cutover disabled.';
    state.last_updated=cert.generatedAt;
    state.g13_baseline={
      ...(state.g13_baseline||{}),
      status:'ZERO_FINDINGS_CERTIFIED',
      sourceCommit:cert.sourceHead,
      logicalModules:cert.architecture.logicalModules,
      highFindings:0,
      mediumFindings:0,
      productionCutover:false
    };
    state.g13_certification={
      status:'GREEN',
      workflowRunId:cert.workflowRunId,
      sourceCommit:cert.sourceHead,
      findingsTotal:0,
      highFindings:0,
      mediumFindings:0,
      logicalModules:'30/30 DEDICATED_ZONE',
      runtimeLegacyDependencyCount:0,
      dependenciesClosed:'8/8',
      regressionBarriers:'PASS',
      productionCutover:false
    };
    write(p,state);
  }
  return cert;
}

if(require.main===module){
  const cert=process.argv.includes('--write')?writeCertification():buildCertification();
  process.stdout.write('ASTRA_G13_CERTIFICATION '+JSON.stringify({status:cert.status,sourceHead:cert.sourceHead,findings:cert.architecture.findingsTotal,dedicated:cert.architecture.dedicatedModules,productionCutover:cert.productionCutover})+'\n');
  if(cert.status!=='GREEN')process.exitCode=1;
}
module.exports={buildCertification,writeCertification};
