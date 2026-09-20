'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..'),WRITE=process.argv.includes('--write');
const SOURCE_HEAD=process.env.G18_SOURCE_HEAD||'',RUN=Number(process.env.G18_WORKFLOW_RUN_ID||0);
const read=r=>JSON.parse(fs.readFileSync(path.join(ROOT,r),'utf8'));
const write=(r,v)=>fs.writeFileSync(path.join(ROOT,r),JSON.stringify(v,null,2)+'\n');
const gates=read('04_ACCEPTANCE_GATES.json'),a=read('05_WORK_STATE.json'),b=read('docs/astra/WORK_STATE.json');
const e=read('docs/astra/G18_CUTOVER_SIMULATION_EVIDENCE.json'),g17=read('docs/astra/G17_CERTIFICATION.json');
const m=new Map(gates.gates.map(x=>[x.id,x.status]));
const checks={
 sourceHeadProvided:Boolean(SOURCE_HEAD),
 evidenceMatchesSource:e.sourceHead===SOURCE_HEAD,
 workflowRunMatches:!RUN||e.workflowRunId===RUN,
 g01ThroughG17Green:Array.from({length:17},(_,i)=>m.get('G'+String(i+1).padStart(2,'0'))).every(x=>x==='GREEN'),
 g18Pending:m.get('G18')==='PENDING',
 g19Pending:m.get('G19')==='PENDING',
 stateAligned:a.current_gate==='G18'&&a.last_green_gate==='G17'&&a.current_phase==='G18_PENDING'&&b.current_gate==='G18'&&b.last_green_gate==='G17'&&b.current_phase==='G18_PENDING',
 g17Green:g17.status==='GREEN'&&g17.productionCutover===false,
 simulationPassed:e.status==='PASS'&&e.failedChecks.length===0,
 legacyFamiliesDisabled:e.cutoverSimulation?.legacyDependencyIds?.length===8&&e.cutoverSimulation?.legacyRoutes?.every(x=>x.disabled),
 desktopPass:e.cutoverSimulation?.desktop?.status==='PASS',
 mobilePass:e.cutoverSimulation?.mobile?.status==='PASS',
 failClosedPass:e.cutoverSimulation?.failClosed?.status==='PASS',
 rollbackExact:e.rollback?.checks?.baselineHashRestored===true,
 mainUnmutated:e.production?.mutated===false&&e.production?.mainHeadBefore===e.production?.expectedMainHead,
 zeroLegacy:e.runtimeLegacyDependencyCount===0&&e.strictLegacyScan?.clean===true,
 zeroExternal:e.externalRequests===0&&e.runtimeExternalReferences===0,
 noRealCutover:e.productionCutover===false,
 g19NotIncremented:e.g19Increment===0
};
const failedChecks=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
if(failedChecks.length){console.error(JSON.stringify({status:'FAIL',failedChecks},null,2));process.exit(1)}
const now=new Date().toISOString();
const c={
 schemaVersion:'astra-g18-certification-1',generatedAt:now,status:'GREEN',sourceHead:SOURCE_HEAD,
 workflowRunId:RUN||e.workflowRunId||null,checks,failedChecks:[],
 simulationMode:'IN_MEMORY_LOCAL_ROUTING_ONLY',productionMain:e.production.mainHeadBefore,
 legacyFamiliesDisabled:'8/8',decisionSnapshotId:e.decisionSnapshotId,semanticDecisionHash:e.semanticDecisionHash,
 desktop:'PASS',mobile:'PASS',failClosedScenario:'PASS',rollbackByteExact:true,externalRequests:0,
 runtimeLegacyDependencyCount:0,runtimeExternalReferences:0,productionCutover:false,g19Increment:0,
 nextGate:'G19',nextGateStatus:'PENDING'
};
if(WRITE){
 write('docs/astra/G18_CERTIFICATION.json',c);
 const gate=gates.gates.find(x=>x.id==='G18');if(!gate)throw Error('Missing G18');
 gate.status='GREEN';gate.evidence=['docs/astra/G18_CERTIFICATION.json','docs/astra/G18_CUTOVER_SIMULATION_EVIDENCE.json','docs/astra/G18_CUTOVER_SIMULATION_REPORT.md','astra/certification/g18-cutover-simulation.cjs','astra/certification/g18-certify.cjs','.github/workflows/astra-g18-cutover-simulation.yml'];
 gates.updated_at=now;write('04_ACCEPTANCE_GATES.json',gates);
 for(const s of [a,b]){
  s.current_phase='G19_PENDING';s.current_gate='G19';s.last_green_gate='G18';s.blocking_issues=[];
  s.completed_gates=Array.from(new Set([...(s.completed_gates||[]),'G18']));
  s.failed_gates=(s.failed_gates||[]).filter(x=>x!=='G18');s.blocked_gates=(s.blocked_gates||[]).filter(x=>x!=='G18');
  s.clean_review_streak=0;
  s.next_action='Begin G19 only: execute 10 consecutive clean destructive reviews. Do not perform a real production cutover.';
  s.last_updated=now;
  s.g18_certification={status:'GREEN',workflowRunId:c.workflowRunId,sourceCommit:SOURCE_HEAD,simulationMode:c.simulationMode,productionMain:c.productionMain,legacyFamiliesDisabled:'8/8',decisionSnapshotId:c.decisionSnapshotId,semanticDecisionHash:c.semanticDecisionHash,desktop:'PASS',mobile:'PASS',failClosedScenario:'PASS',rollbackByteExact:true,externalRequests:0,runtimeLegacyDependencyCount:0,runtimeExternalReferences:0,productionCutover:false,g19Increment:0};
  const finding='G18 GREEN: legacy-off cutover was simulated only in an in-memory local routing harness; all 8 legacy families were disabled, Astra passed desktop/mobile and fail-closed checks, rollback restored the baseline root byte-exactly, main was unchanged, and no production cutover occurred.';
  s.material_findings=s.material_findings||[];if(!s.material_findings.includes(finding))s.material_findings.push(finding);
 }
 write('05_WORK_STATE.json',a);write('docs/astra/WORK_STATE.json',b);
}
console.log(JSON.stringify(c,null,2));
