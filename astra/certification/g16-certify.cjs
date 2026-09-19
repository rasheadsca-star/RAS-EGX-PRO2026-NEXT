'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const WRITE=process.argv.includes('--write');
const SOURCE_HEAD=process.env.G16_SOURCE_HEAD||'';
const WORKFLOW_RUN_ID=Number(process.env.G16_WORKFLOW_RUN_ID||0);
const read=r=>JSON.parse(fs.readFileSync(path.join(ROOT,r),'utf8'));
const write=(r,v)=>fs.writeFileSync(path.join(ROOT,r),JSON.stringify(v,null,2)+'\n');
const gates=read('04_ACCEPTANCE_GATES.json');
const primary=read('05_WORK_STATE.json'),docsState=read('docs/astra/WORK_STATE.json');
const evidence=read('docs/astra/G16_DEPLOYMENT_EVIDENCE.json');
const g15=read('docs/astra/G15_CERTIFICATION.json');
const by=new Map((gates.gates||[]).map(g=>[g.id,g.status]));
const priorGreen=Array.from({length:15},(_,i)=>'G'+String(i+1).padStart(2,'0')).every(id=>by.get(id)==='GREEN');
const checks={
 sourceHeadProvided:Boolean(SOURCE_HEAD),
 evidenceMatchesSourceHead:evidence.sourceHead===SOURCE_HEAD,
 workflowRunMatches:!WORKFLOW_RUN_ID||evidence.workflowRunId===WORKFLOW_RUN_ID,
 g01ThroughG15Green:priorGreen,
 g16PendingBeforePromotion:by.get('G16')==='PENDING',
 laterGatesPending:['G17','G18','G19'].every(id=>by.get(id)==='PENDING'),
 stateAlignedBeforePromotion:primary.current_gate==='G16'&&primary.last_green_gate==='G15'&&primary.current_phase==='G16_PENDING'&&docsState.current_gate==='G16'&&docsState.last_green_gate==='G15'&&docsState.current_phase==='G16_PENDING',
 g15CertifiedGreen:g15.status==='GREEN'&&g15.productionCutover===false&&g15.runtimeLegacyDependencyCount===0,
 deploymentPassed:evidence.status==='PASS'&&Array.isArray(evidence.failedChecks)&&evidence.failedChecks.length===0,
 productionTargetReady:evidence.deployment?.provider==='GITHUB_PAGES'&&evidence.deployment?.status==='READY'&&evidence.deployment?.target==='production',
 isolatedProductionPath:evidence.deployment?.isolatedPath==='astra-prod/'&&evidence.deployment?.publicEntrypointChanged===false,
 pagesWorkflowGreen:evidence.deployment?.pagesWorkflowConclusion==='success',
 productionRootReachable:evidence.http?.productionRoot?.ok===true,
 runtimeReachable:evidence.http?.runtime?.ok===true,
 runtimeAssetsExact:evidence.runtime?.allHashesMatch===true,
 persistedTruthByteExact:evidence.persistedTruth?.allHashesMatch===true,
 vendoredPagesBuild:evidence.buildIsolation?.vendoredSepa===true&&evidence.buildIsolation?.crossBranchBuildDependency===false,
 noLegacyRuntimeDependencies:evidence.runtimeLegacyDependencyCount===0,
 noExternalRuntimeReferences:evidence.runtimeExternalReferences===0,
 productionCutoverDisabled:evidence.productionCutover===false
};
const failedChecks=Object.entries(checks).filter(([,ok])=>!ok).map(([k])=>k);
if(failedChecks.length){console.error(JSON.stringify({status:'FAIL',failedChecks},null,2));process.exit(1)}
const now=new Date().toISOString();
const certification={
 schemaVersion:'astra-g16-certification-2',generatedAt:now,status:'GREEN',sourceHead:SOURCE_HEAD,
 workflowRunId:WORKFLOW_RUN_ID||evidence.workflowRunId||null,checks,failedChecks:[],
 deployment:{provider:'GITHUB_PAGES',productionCommit:evidence.deployment.productionCommit,pagesWorkflowRunId:evidence.deployment.pagesWorkflowRunId,productionUrl:evidence.deployment.productionUrl,runtimeUrl:evidence.deployment.runtimeUrl,status:'READY',target:'production',isolatedPath:'astra-prod/',publicEntrypointChanged:false},
 bundle:{runtimeFiles:evidence.runtime.files.length,persistedTruthFiles:evidence.persistedTruth.files.length,runtimeHashesMatch:true,persistedTruthHashesMatch:true},
 buildIsolation:evidence.buildIsolation,runtimeLegacyDependencyCount:0,runtimeExternalReferences:0,
 regressionBoundary:'G01-G15 GREEN PRESERVED',productionCutover:false,nextGate:'G17',nextGateStatus:'PENDING'
};
if(WRITE){
 write('docs/astra/G16_CERTIFICATION.json',certification);
 const gate=(gates.gates||[]).find(g=>g.id==='G16');if(!gate)throw Error('Missing G16');
 gate.status='GREEN';gate.evidence=['docs/astra/G16_CERTIFICATION.json','docs/astra/G16_DEPLOYMENT_EVIDENCE.json','docs/astra/G16_DEPLOYMENT_REPORT.md','astra/certification/g16-certify.cjs','.github/workflows/astra-g16-production-deployment.yml'];gates.updated_at=now;write('04_ACCEPTANCE_GATES.json',gates);
 for(const state of [primary,docsState]){
  state.current_phase='G17_PENDING';state.current_gate='G17';state.last_green_gate='G16';state.blocking_issues=[];
  state.blocked_gates=(state.blocked_gates||[]).filter(x=>x!=='G16');state.failed_gates=(state.failed_gates||[]).filter(x=>x!=='G16');
  state.completed_gates=Array.from(new Set([...(state.completed_gates||[]),'G16']));state.clean_review_streak=0;
  state.next_action='Begin G17 live production verification against the isolated Astra Pages deployment. Do not perform legacy/public cutover.';
  state.last_updated=now;state.g16_certification={status:'GREEN',workflowRunId:certification.workflowRunId,sourceCommit:SOURCE_HEAD,provider:'GITHUB_PAGES',productionCommit:certification.deployment.productionCommit,pagesWorkflowRunId:certification.deployment.pagesWorkflowRunId,productionUrl:certification.deployment.productionUrl,runtimeUrl:certification.deployment.runtimeUrl,target:'production',isolatedPath:'astra-prod/',publicEntrypointChanged:false,runtimeHashesMatch:true,persistedTruthByteExact:true,runtimeLegacyDependencyCount:0,runtimeExternalReferences:0,g01ThroughG15Regression:'PASS',productionCutover:false};
  const finding='G16 GREEN: standalone Astra runtime deployed to an isolated GitHub Pages production path; runtime and persisted decision truth verified byte-exact, Pages build uses vendored SEPA-X with no cross-branch build dependency, and no public/legacy cutover occurred.';
  state.material_findings=state.material_findings||[];if(!state.material_findings.includes(finding))state.material_findings.push(finding);
 }
 write('05_WORK_STATE.json',primary);write('docs/astra/WORK_STATE.json',docsState);
}
console.log(JSON.stringify(certification,null,2));
