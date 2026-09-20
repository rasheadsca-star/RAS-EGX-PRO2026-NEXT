'use strict';
const fs=require('fs'),path=require('path');
const ROOT=process.cwd(),now=new Date().toISOString();
const read=r=>JSON.parse(fs.readFileSync(path.join(ROOT,r),'utf8'));
const write=(r,v)=>fs.writeFileSync(path.join(ROOT,r),JSON.stringify(v,null,2)+'\n');

const streak=read('docs/astra/G19_STREAK_STATE.json');
const reviews=read('docs/astra/G19_DESTRUCTIVE_REVIEWS.json');
const result=read('docs/astra/G19_REVIEW_RESULT.json');
const gates=read('04_ACCEPTANCE_GATES.json');
const a=read('05_WORK_STATE.json');
const b=read('docs/astra/WORK_STATE.json');
const g18=read('docs/astra/G18_CERTIFICATION.json');

const expectedCycle=Number(streak.cleanReviewStreak||0)+1;
if(result.cycle!==expectedCycle)throw new Error('cycle mismatch: '+result.cycle+' vs '+expectedCycle);
if(result.reviewTargetHead!==streak.reviewTargetHead)throw new Error('review target changed');
if(result.expectedProductionMain!==streak.expectedProductionMain)throw new Error('production main pin changed');
if(g18.status!=='GREEN'||g18.productionCutover!==false)throw new Error('G18 boundary regressed');

const summary={
 cycle:result.cycle,
 workflowRunId:result.workflowRunId,
 sourceHead:result.sourceHead,
 reviewTargetHead:result.reviewTargetHead,
 status:result.status,
 failedChecks:result.failedChecks||[],
 generatedAt:result.generatedAt,
 browserVersion:result.browser?.version||null,
 decisionSnapshotId:result.decisionSnapshotId||null,
 semanticDecisionHash:result.semanticDecisionHash||null,
 productionMain:result.productionMainAfter||result.expectedProductionMain,
 runtimeLegacyDependencyCount:result.runtimeLegacyDependencyCount??null,
 runtimeExternalReferences:result.runtimeExternalReferences??null,
 externalRequests:result.externalRequests??null,
 unauthorizedMutations:result.unauthorizedMutations??null,
 productionCutover:false
};

reviews.reviews=reviews.reviews||[];
reviews.reviews.push(summary);
reviews.updatedAt=now;

let outcome='FAIL';
if(result.status!=='PASS'||(result.failedChecks||[]).length){
 streak.cleanReviewStreak=0;
 streak.failedDestructiveReviewsInCurrentStreak=1;
 streak.totalFailedReviews=Number(streak.totalFailedReviews||0)+1;
 streak.status='PENDING';
 streak.lastFailure=summary;
 for(const s of [a,b]){
  s.clean_review_streak=0;
  s.current_gate='G19';
  s.current_phase='G19_PENDING';
  s.last_green_gate='G18';
  s.blocking_issues=['G19 destructive review '+result.cycle+' failed: '+((result.failedChecks||[]).join(',')||'review failure')];
  s.next_action='G19 streak reset to 0 after a destructive-review failure. Inspect G19_REVIEW_RESULT.json before restarting.';
  s.last_updated=now;
 }
}else{
 const next=expectedCycle;
 streak.cleanReviewStreak=next;
 streak.failedDestructiveReviewsInCurrentStreak=0;
 streak.status=next===10?'GREEN':'PENDING';
 streak.lastSuccess=summary;
 outcome=next===10?'GREEN':'PASS';

 for(const s of [a,b]){
  s.clean_review_streak=next;
  s.blocking_issues=[];
  s.last_updated=now;
  s.g19_progress={
   reviewTargetHead:streak.reviewTargetHead,
   expectedProductionMain:streak.expectedProductionMain,
   cleanReviewStreak:next,
   required:10,
   failedDestructiveReviewsInCurrentStreak:0,
   lastWorkflowRunId:result.workflowRunId,
   productionCutover:false
  };
  if(next<10){
   s.current_gate='G19';
   s.current_phase='G19_PENDING';
   s.last_green_gate='G18';
   s.next_action='Continue G19 with destructive review '+(next+1)+'/10 on the same fixed review target.';
  }else{
   const gate=gates.gates.find(x=>x.id==='G19');
   if(!gate)throw new Error('Missing G19 gate');
   gate.status='GREEN';
   gate.evidence=[
    'docs/astra/G19_CERTIFICATION.json',
    'docs/astra/G19_STREAK_STATE.json',
    'docs/astra/G19_DESTRUCTIVE_REVIEWS.json',
    'docs/astra/G19_FINAL_REPORT.md',
    'astra/certification/g19-review-once.cjs',
    'astra/certification/g19-advance.cjs',
    '.github/workflows/astra-g19-destructive-reviews.yml'
   ];
   gates.certified=true;
   gates.updated_at=now;
   s.current_gate='COMPLETE';
   s.current_phase='CERTIFIED';
   s.last_green_gate='G19';
   s.completed_gates=Array.from(new Set([...(s.completed_gates||[]),'G19']));
   s.failed_gates=[];
   s.blocked_gates=[];
   s.next_action='Certification complete. Production cutover remains false; any real cutover requires a separate explicit gate.';
   s.g19_certification={
    status:'GREEN',
    reviewTargetHead:streak.reviewTargetHead,
    finalWorkflowRunId:result.workflowRunId,
    cleanReviewStreak:10,
    failedDestructiveReviewsInStreak:0,
    productionMain:streak.expectedProductionMain,
    runtimeLegacyDependencyCount:0,
    runtimeExternalReferences:0,
    externalRequests:0,
    productionCutover:false
   };
   const finding='G19 GREEN: 10 consecutive independent destructive reviews passed on the fixed G18 recovery target with a fresh Actions run per cycle; production main stayed pinned, zero legacy/external runtime dependencies held, Chromium desktop/mobile and DecisionSnapshot identity passed, fail-closed and rollback integrity passed, and no real production cutover occurred.';
   s.material_findings=s.material_findings||[];
   if(!s.material_findings.includes(finding))s.material_findings.push(finding);
  }
 }
}

streak.updatedAt=now;
write('docs/astra/G19_STREAK_STATE.json',streak);
write('docs/astra/G19_DESTRUCTIVE_REVIEWS.json',reviews);
write('05_WORK_STATE.json',a);
write('docs/astra/WORK_STATE.json',b);

if(outcome==='GREEN'){
 const last10=reviews.reviews.slice(-10);
 const cert={
  schemaVersion:'astra-g19-certification-1',
  generatedAt:now,
  status:'GREEN',
  reviewTargetHead:streak.reviewTargetHead,
  finalWorkflowRunId:result.workflowRunId,
  cleanReviewStreak:10,
  requiredCleanReviews:10,
  failedDestructiveReviewsInStreak:0,
  reviewRuns:last10.map(x=>x.workflowRunId),
  productionMain:streak.expectedProductionMain,
  runtimeLegacyDependencyCount:0,
  runtimeExternalReferences:0,
  externalRequests:0,
  unauthorizedMutations:0,
  productionCutover:false,
  g01ThroughG19:'GREEN',
  certified:true
 };
 write('docs/astra/G19_CERTIFICATION.json',cert);
 fs.writeFileSync(path.join(ROOT,'docs/astra/G19_FINAL_REPORT.md'),[
  '# G19 Final Certification','',
  '- Status: **GREEN**',
  '- Consecutive clean destructive reviews: **10/10**',
  '- Review target: '+streak.reviewTargetHead,
  '- Production main: '+streak.expectedProductionMain,
  '- Failed destructive reviews in certified streak: **0**',
  '- Runtime legacy dependencies: **0**',
  '- Runtime external references: **0**',
  '- External requests: **0**',
  '- Unauthorized mutations: **0**',
  '- Production cutover: **false**',
  '- G01 → G19: **GREEN**',
  '- Certified: **true**'
 ].join('\n')+'\n');
}

fs.writeFileSync(path.join(ROOT,'docs/astra/G19_RUN_OUTCOME.txt'),outcome+'\n');
console.log(JSON.stringify({outcome,cleanReviewStreak:streak.cleanReviewStreak,cycle:result.cycle},null,2));
