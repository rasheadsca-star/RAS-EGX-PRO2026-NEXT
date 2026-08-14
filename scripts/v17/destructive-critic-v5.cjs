#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r),OUT='data/v17/destructive-critic.json';
const read=(r,d={})=>{try{return JSON.parse(fs.readFileSync(P(r),'utf8'))}catch{return d}},text=r=>{try{return fs.readFileSync(P(r),'utf8')}catch{return''}};
function write(r,v){const f=P(r);fs.mkdirSync(path.dirname(f),{recursive:true});const t=f+'.tmp';fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n');JSON.parse(fs.readFileSync(t,'utf8'));fs.renameSync(t,f)}
const marketWorkflow=text('.github/workflows/update-market-data.yml'),buildWorkflow=text('.github/workflows/v17-build-review.yml');
const marketV5=marketWorkflow.includes('destructive-critic-v5.cjs'),buildV5=buildWorkflow.includes('destructive-critic-v5.cjs');
const base=cp.spawnSync(process.execPath,[P('scripts/v17/destructive-critic-v4.cjs')],{cwd:root,encoding:'utf8'}),baseReport=read(OUT,{findings:[{severity:'CRITICAL',code:'CRITIC_V4_NO_REPORT',message:'Critic V4 produced no report'}]});
const inherited=Array.isArray(baseReport.findings)?baseReport.findings:[];
const obsolete=new Set(['CRITIC_V4_NOT_MANDATORY']);
const ignored=inherited.filter(f=>obsolete.has(f?.code)&&((f.location==='market'&&marketV5)||(f.location==='build-review'&&buildV5)));
const findings=inherited.filter(f=>!ignored.includes(f));
const add=(severity,code,message,location=null)=>findings.push({severity,code,message:String(message||''),location});
if(base.status!==0&&inherited.length-ignored.length===0&&ignored.length===0)add('CRITICAL','CRITIC_V4_PROCESS_FAILURE',`exit=${base.status}; ${base.stderr||base.stdout||''}`.slice(0,500),'critic-v4');

// Build review is validation-only. It may mutate its ephemeral workspace but must never publish canonical data.
const buildPermissionsWrite=/permissions:\s*[\s\S]{0,160}?contents:\s*write\b/m.test(buildWorkflow);
const buildHasPush=/\bgit\s+push\b/.test(buildWorkflow);
const buildHasCommit=/\bgit\s+commit\b/.test(buildWorkflow);
const buildHasCanonicalCommitStep=/Commit V17 evidence|zero-comment runtime evidence|git add\s+data\/v17\//i.test(buildWorkflow);
if(buildPermissionsWrite)add('MAJOR','BUILD_REVIEW_HAS_CONTENTS_WRITE','isolated build review must be read-only against repository contents','v17-build-review');
if(buildHasPush)add('CRITICAL','BUILD_REVIEW_CAN_PUSH','isolated build review contains git push and can race canonical publisher','v17-build-review');
if(buildHasCommit||buildHasCanonicalCommitStep)add('MAJOR','BUILD_REVIEW_PUBLISHES_CANONICAL_EVIDENCE','build review must not commit canonical data/v17 evidence','v17-build-review');

// Market workflow is the sole canonical publisher and may only publish to the isolated V17 branch.
const marketPushes=[...marketWorkflow.matchAll(/git push[^\n]*/g)].map(m=>m[0]);
if(!marketPushes.some(line=>/HEAD:develop\/v17-rebuild/.test(line)))add('MAJOR','MARKET_CANONICAL_PUBLISHER_MISSING','market workflow does not publish canonical evidence to isolated V17 branch','update-market-data');
if(marketPushes.some(line=>/\bmain\b/.test(line)))add('CRITICAL','MARKET_PUBLISHER_CAN_PUSH_MAIN',marketPushes.filter(line=>/\bmain\b/.test(line)).join(' | '),'update-market-data');
if(!/permissions:\s*[\s\S]{0,160}?contents:\s*write\b/m.test(marketWorkflow))add('MAJOR','MARKET_PUBLISHER_MISSING_CONTENTS_WRITE','canonical market publisher lacks contents write permission','update-market-data');
if(!marketWorkflow.includes('git add data/*.json data/v17/*.json'))add('MINOR','MARKET_PUBLISH_SCOPE_UNEXPECTED','canonical market publisher does not explicitly stage V17 data scope','update-market-data');

// A canonical evidence file must not look older than the current market decision after a completed market publication.
const decision=read('data/today-decision-center.json',{}),browser=read('data/v17/browser-runtime-critic.json',{}),review=read('data/v17/review.json',{}),regression=read('data/v17/regression.json',{}),current=read('data/v17/current.json',{});
function time(v){const t=new Date(v||0).getTime();return Number.isFinite(t)?t:0}
const decisionTime=time(decision.generatedAt),currentResearchTime=time(current?.currentResearch?.generatedAt||current.generatedAt);
for(const [label,obj] of [['browser',browser],['review',review],['regression',regression]]){
  const t=time(obj.generatedAt);
  if(decisionTime&&t&&t+5*60*1000<decisionTime)add('MAJOR','STALE_PUBLISHED_EVIDENCE',`${label} generatedAt=${obj.generatedAt} materially predates decision=${decision.generatedAt}`,`data/v17/${label}`);
}
if(decisionTime&&currentResearchTime&&Math.abs(currentResearchTime-decisionTime)>5*60*1000)add('MAJOR','SNAPSHOT_RESEARCH_TIMESTAMP_DRIFT',`currentResearch=${current?.currentResearch?.generatedAt}; decision=${decision.generatedAt}`,'data/v17/current.json');

if(!marketV5)add('MAJOR','CRITIC_V5_NOT_MANDATORY_MARKET','market workflow does not run Critic V5','update-market-data');
if(!buildV5)add('MAJOR','CRITIC_V5_NOT_MANDATORY_BUILD','build review does not run Critic V5','v17-build-review');
const counts=findings.reduce((a,f)=>(a[f.severity]=(a[f.severity]||0)+1,a),{CRITICAL:0,MAJOR:0,MINOR:0,INFO:0});
const report={schemaVersion:'17.0.0-destructive-critic-5',generatedAt:new Date().toISOString(),critic:'V17_DESTRUCTIVE_ADVERSARIAL_REVIEWER_V5',verdict:findings.length===0?'NO_COMMENTS':'COMMENTS_FOUND',counts,totalFindings:findings.length,findings,baseCritic:{schemaVersion:baseReport.schemaVersion||null,verdict:baseReport.verdict||null,totalFindings:Number(baseReport.totalFindings||0),ignoredSupersededWiringFindings:ignored.map(f=>({code:f.code,location:f.location}))},publicationArchitecture:{buildReviewReadOnly:!buildPermissionsWrite&&!buildHasPush&&!buildHasCommit&&!buildHasCanonicalCommitStep,marketCanonicalPublisher:marketPushes.some(line=>/HEAD:develop\/v17-rebuild/.test(line)),marketPushes},coverage:{...(baseReport.coverage||{}),canonicalPublisherRace:true,buildReviewReadOnly:true,marketSolePublisher:true,publishedEvidenceFreshness:true},rule:'Critic V5 is additive. Build Review must be read-only and Market Workflow must be the sole canonical data publisher. Only obsolete lower-version wiring findings may be superseded; all substantive findings remain blocking.'};
write(OUT,report);console.log(JSON.stringify(report,null,2));if(findings.length)process.exitCode=2;
