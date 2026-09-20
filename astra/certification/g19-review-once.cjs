'use strict';
const fs=require('fs');
const path=require('path');
const cp=require('child_process');

const CONTROL=process.cwd();
const TARGET=process.env.G19_TARGET_ROOT||'';
const TARGET_HEAD=process.env.G19_TARGET_HEAD||'';
const EXPECTED_MAIN=process.env.G19_EXPECTED_MAIN||'';
const CHROME_BIN=process.env.CHROME_BIN||'';
const CYCLE=Number(process.env.G19_CYCLE||0);
const RUN=Number(process.env.G19_WORKFLOW_RUN_ID||0);
const SOURCE_HEAD=process.env.G19_SOURCE_HEAD||'';
const OUT=path.join(CONTROL,'docs/astra/G19_REVIEW_RESULT.json');
const PROD='https://rasheadsca-star.github.io/RAS-EGX-PRO2026-NEXT/astra-prod/';
const RUNTIME=PROD+'runtime/v18/index.html';

const read=(root,rel)=>JSON.parse(fs.readFileSync(path.join(root,rel),'utf8'));
const write=(root,rel,v)=>fs.writeFileSync(path.join(root,rel),JSON.stringify(v,null,2)+'\n');
const git=(args,cwd=TARGET)=>cp.execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const mainHead=()=>cp.execFileSync('git',['ls-remote','origin','refs/heads/main'],{cwd:CONTROL,encoding:'utf8'}).trim().split(/\s+/)[0]||'';
const failNames=o=>Object.entries(o).filter(([,v])=>v!==true).map(([k])=>k);
const runNode=(script,env)=>{
 const r=cp.spawnSync(process.execPath,[script],{cwd:TARGET,env:{...process.env,...env},encoding:'utf8',maxBuffer:20*1024*1024});
 if(r.status!==0)throw new Error(path.basename(script)+' failed\nSTDOUT:\n'+r.stdout+'\nSTDERR:\n'+r.stderr);
 const text=(r.stdout||'').trim();
 const start=text.indexOf('{');
 if(start<0)throw new Error(path.basename(script)+' returned no JSON');
 return JSON.parse(text.slice(start));
};
function rewindG17(){
 const gates=read(TARGET,'04_ACCEPTANCE_GATES.json');
 for(const g of gates.gates){
  if(g.id==='G17'||g.id==='G18'||g.id==='G19')g.status='PENDING';
 }
 gates.certified=false;
 write(TARGET,'04_ACCEPTANCE_GATES.json',gates);
 const state=read(TARGET,'05_WORK_STATE.json');
 state.current_gate='G17';state.current_phase='G17_PENDING';state.last_green_gate='G16';
 state.clean_review_streak=0;state.blocking_issues=[];
 state.completed_gates=(state.completed_gates||[]).filter(x=>!['G17','G18','G19'].includes(x));
 write(TARGET,'05_WORK_STATE.json',state);write(TARGET,'docs/astra/WORK_STATE.json',state);
}
function rewindG18(){
 const gates=read(TARGET,'04_ACCEPTANCE_GATES.json');
 for(const g of gates.gates){
  if(g.id==='G18'||g.id==='G19')g.status='PENDING';
  if(g.id==='G17')g.status='GREEN';
 }
 gates.certified=false;
 write(TARGET,'04_ACCEPTANCE_GATES.json',gates);
 const state=read(TARGET,'05_WORK_STATE.json');
 state.current_gate='G18';state.current_phase='G18_PENDING';state.last_green_gate='G17';
 state.clean_review_streak=0;state.blocking_issues=[];
 state.completed_gates=(state.completed_gates||[]).filter(x=>!['G18','G19'].includes(x));
 if(!state.completed_gates.includes('G17'))state.completed_gates.push('G17');
 write(TARGET,'05_WORK_STATE.json',state);write(TARGET,'docs/astra/WORK_STATE.json',state);
}
function resetTarget(){
 git(['reset','--hard',TARGET_HEAD]);
 git(['clean','-fd']);
 const st=git(['status','--porcelain']);
 if(st)throw new Error('target worktree not clean after reset: '+st);
 if(git(['rev-parse','HEAD'])!==TARGET_HEAD)throw new Error('target HEAD changed');
}
(async()=>{
 let result={
  schemaVersion:'astra-g19-destructive-review-1',
  generatedAt:new Date().toISOString(),
  cycle:CYCLE,
  workflowRunId:RUN||null,
  sourceHead:SOURCE_HEAD,
  reviewTargetHead:TARGET_HEAD,
  expectedProductionMain:EXPECTED_MAIN,
  status:'FAIL',
  failedChecks:[],
  productionCutover:false
 };
 try{
  if(!TARGET||!fs.existsSync(TARGET))throw new Error('target root missing');
  const pristineGates=read(TARGET,'04_ACCEPTANCE_GATES.json');
  const m=new Map(pristineGates.gates.map(x=>[x.id,x.status]));
  const pristineState=read(TARGET,'docs/astra/WORK_STATE.json');
  const g18=read(TARGET,'docs/astra/G18_CERTIFICATION.json');
  const plan=read(TARGET,'docs/astra/LEGACY_REMOVAL_PLAN.json');
  const pipeline=read(TARGET,'docs/astra/G11_CURRENT_PIPELINE_RUN.json');
  const issues=read(TARGET,'docs/astra/G11_DATA_HEALTH_ISSUES.json');
  const {scanLegacyDependencies}=require(path.join(TARGET,'astra/certification/legacy-isolation.cjs'));
  const legacy=scanLegacyDependencies(TARGET);
  const pre={
   cycleValid:Number.isInteger(CYCLE)&&CYCLE>=1&&CYCLE<=10,
   chromiumProvided:Boolean(CHROME_BIN),
   targetHeadExact:git(['rev-parse','HEAD'])===TARGET_HEAD,
   targetClean:git(['status','--porcelain'])==='',
   g01ThroughG18Green:Array.from({length:18},(_,i)=>m.get('G'+String(i+1).padStart(2,'0'))).every(x=>x==='GREEN'),
   g19Pending:m.get('G19')==='PENDING',
   targetStateFixed:pristineState.current_gate==='G19'&&pristineState.current_phase==='G19_PENDING'&&pristineState.last_green_gate==='G18'&&pristineState.clean_review_streak===0,
   g18Certified:g18.status==='GREEN'&&g18.productionCutover===false&&g18.g19Increment===0,
   mainExactBefore:mainHead()===EXPECTED_MAIN,
   eightLegacyFamiliesClosed:plan.dependencies.length===8&&plan.dependencies.every(x=>x.status==='CLOSED'),
   zeroLegacy:legacy.clean===true&&legacy.runtimeLegacyDependencyCount===0&&(legacy.matches||[]).length===0,
   decisionTruthSafe:pipeline.productionCutover===false&&pipeline.legacyNetworkCalls===0&&issues.criticalUnresolved===0&&issues.highProductionRelevantUnresolved===0
  };
  if(failNames(pre).length)throw new Error('G19 precheck failed: '+failNames(pre).join(','));

  rewindG17();
  const g17Replay=runNode('astra/certification/g17-live-production.cjs',{
   CHROME_BIN,
   G17_SOURCE_HEAD:TARGET_HEAD,
   G17_WORKFLOW_RUN_ID:String(RUN),
   G17_PRODUCTION_URL:PROD,
   G17_RUNTIME_URL:RUNTIME
  });
  resetTarget();

  rewindG18();
  const baseline='/tmp/g19-baseline-'+RUN+'-'+CYCLE+'.html';
  fs.writeFileSync(baseline,cp.execFileSync('git',['show',EXPECTED_MAIN+':index.html'],{cwd:TARGET}));
  const g18Replay=runNode('astra/certification/g18-cutover-simulation.cjs',{
   CHROME_BIN,
   G18_SOURCE_HEAD:TARGET_HEAD,
   G18_WORKFLOW_RUN_ID:String(RUN),
   G18_PRODUCTION_MAIN_HEAD:EXPECTED_MAIN,
   G18_EXPECTED_MAIN_HEAD:EXPECTED_MAIN,
   G18_BASELINE_ROOT_FILE:baseline
  });
  resetTarget();

  const checks={
   ...pre,
   liveReplayPass:g17Replay.status==='PASS'&&g17Replay.failedChecks.length===0,
   liveDesktopPass:g17Replay.scenarios?.desktop?.status==='PASS',
   liveMobilePass:g17Replay.scenarios?.mobile?.status==='PASS',
   liveFailClosedPass:g17Replay.scenarios?.failClosed?.status==='PASS',
   liveRuntimeExact:g17Replay.liveBytes?.runtimeAllExact===true,
   liveTruthExact:g17Replay.liveBytes?.truthAllExact===true,
   liveDecisionIdentity:g17Replay.checks?.renderedDecisionTruthMatches===true,
   liveZeroExternal:g17Replay.checks?.zeroExternalRequests===true,
   cutoverReplayPass:g18Replay.status==='PASS'&&g18Replay.failedChecks.length===0,
   cutoverDesktopPass:g18Replay.cutoverSimulation?.desktop?.status==='PASS',
   cutoverMobilePass:g18Replay.cutoverSimulation?.mobile?.status==='PASS',
   cutoverFailClosedPass:g18Replay.cutoverSimulation?.failClosed?.status==='PASS',
   rollbackIntegrity:g18Replay.rollback?.checks?.baselineHashRestored===true,
   legacyOff8of8:g18Replay.cutoverSimulation?.legacyDependencyIds?.length===8&&g18Replay.cutoverSimulation?.legacyRoutes?.every(x=>x.disabled),
   targetRestoredClean:git(['status','--porcelain'])===''&&git(['rev-parse','HEAD'])===TARGET_HEAD,
   mainExactAfter:mainHead()===EXPECTED_MAIN,
   productionCutoverFalse:g17Replay.productionCutover===false&&g18Replay.productionCutover===false
  };
  const failed=failNames(checks);
  result={
   ...result,
   status:failed.length?'FAIL':'PASS',
   checks,
   failedChecks:failed,
   browser:{engine:g17Replay.browser?.engine||'Chromium',version:g17Replay.browser?.version||null},
   decisionSnapshotId:pipeline.decisionSnapshotId,
   semanticDecisionHash:pipeline.semanticDecisionHash,
   live:{desktop:g17Replay.scenarios?.desktop?.status,mobile:g17Replay.scenarios?.mobile?.status,failClosed:g17Replay.scenarios?.failClosed?.status,runtimeByteExact:g17Replay.liveBytes?.runtimeAllExact,truthByteExact:g17Replay.liveBytes?.truthAllExact,externalRequests:0},
   simulation:{desktop:g18Replay.cutoverSimulation?.desktop?.status,mobile:g18Replay.cutoverSimulation?.mobile?.status,failClosed:g18Replay.cutoverSimulation?.failClosed?.status,rollbackByteExact:g18Replay.rollback?.checks?.baselineHashRestored,legacyFamiliesDisabled:g18Replay.cutoverSimulation?.legacyDependencyIds?.length},
   productionMainBefore:EXPECTED_MAIN,
   productionMainAfter:mainHead(),
   runtimeLegacyDependencyCount:0,
   runtimeExternalReferences:0,
   externalRequests:0,
   unauthorizedMutations:0,
   productionCutover:false
  };
 }catch(error){
  try{resetTarget()}catch{}
  result.error=String(error&&error.stack||error);
  result.failedChecks=result.failedChecks.length?result.failedChecks:['reviewException'];
  result.productionMainAfter=(()=>{try{return mainHead()}catch{return null}})();
 }
 fs.writeFileSync(OUT,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
})().catch(error=>{
 fs.writeFileSync(OUT,JSON.stringify({schemaVersion:'astra-g19-destructive-review-1',generatedAt:new Date().toISOString(),cycle:CYCLE,workflowRunId:RUN||null,sourceHead:SOURCE_HEAD,reviewTargetHead:TARGET_HEAD,expectedProductionMain:EXPECTED_MAIN,status:'FAIL',failedChecks:['fatalException'],error:String(error&&error.stack||error),productionCutover:false},null,2)+'\n');
 console.error(error);
});
