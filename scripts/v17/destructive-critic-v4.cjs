#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r),OUT='data/v17/destructive-critic.json';
const read=(r,d={})=>{try{return JSON.parse(fs.readFileSync(P(r),'utf8'))}catch{return d}},text=r=>{try{return fs.readFileSync(P(r),'utf8')}catch{return''}};
function write(r,v){const f=P(r);fs.mkdirSync(path.dirname(f),{recursive:true});const t=f+'.tmp';fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n');JSON.parse(fs.readFileSync(t,'utf8'));fs.renameSync(t,f)}
const workflow=text('.github/workflows/update-market-data.yml'),buildReview=text('.github/workflows/v17-build-review.yml');
const v4Market=workflow.includes('destructive-critic-v4.cjs'),v4Build=buildReview.includes('destructive-critic-v4.cjs');
const base=cp.spawnSync(process.execPath,[P('scripts/v17/destructive-critic-v3.cjs')],{cwd:root,encoding:'utf8'}),baseReport=read(OUT,{findings:[{severity:'CRITICAL',code:'CRITIC_V3_NO_REPORT',message:'Critic V3 produced no report'}]});
const inherited=Array.isArray(baseReport.findings)?baseReport.findings:[];
const supersededCodes=new Set(['CRITIC_V3_NOT_MANDATORY_MARKET','CRITIC_V3_NOT_MANDATORY_BUILD_REVIEW']);
const ignored=inherited.filter(f=>supersededCodes.has(f?.code)&&((f.code==='CRITIC_V3_NOT_MANDATORY_MARKET'&&v4Market)||(f.code==='CRITIC_V3_NOT_MANDATORY_BUILD_REVIEW'&&v4Build)));
const findings=inherited.filter(f=>!ignored.includes(f));
const add=(severity,code,message,location=null)=>findings.push({severity,code,message:String(message||''),location});
const browser=read('data/v17/browser-runtime-critic.json',null);
if(!browser)add('CRITICAL','BROWSER_RUNTIME_REPORT_MISSING','data/v17/browser-runtime-critic.json missing','browser-runtime');
else {
  if(browser.schemaVersion!=='17.0.0-browser-runtime-critic-1')add('CRITICAL','BROWSER_RUNTIME_SCHEMA_UNEXPECTED',browser.schemaVersion,'browser-runtime');
  if(browser.verdict!=='NO_COMMENTS'||Number(browser.totalFindings||0)!==0||Object.values(browser.counts||{}).some(v=>Number(v)!==0))add('CRITICAL','BROWSER_RUNTIME_NOT_CLEAN',`verdict=${browser.verdict}; findings=${browser.totalFindings}`,'browser-runtime');
  for(const f of browser.findings||[])add(f.severity||'MAJOR',`BROWSER_${f.code||'FINDING'}`,f.message||'browser finding',f.location||'browser-runtime');
  const desktop=(browser.checks||[]).find(x=>x.label==='desktop'),mobile=(browser.checks||[]).find(x=>x.label==='mobile');
  if(!desktop||!mobile)add('CRITICAL','BROWSER_REQUIRED_VIEWPORT_MISSING',`desktop=${!!desktop}; mobile=${!!mobile}`,'browser-runtime');
}
for(const [label,content] of [['market',workflow],['build-review',buildReview]]){
  if(!content.includes('browser-runtime-critic.cjs'))add('MAJOR','BROWSER_RUNTIME_NOT_MANDATORY',`${label} does not run real Chromium critic`,label);
  if(!content.includes('destructive-critic-v4.cjs'))add('MAJOR','CRITIC_V4_NOT_MANDATORY',`${label} does not run Critic V4`,label);
  if(!content.includes('playwright@1.62.0'))add('MINOR','PINNED_BROWSER_TOOLING_MISSING',`${label} does not pin Playwright 1.62.0`,label);
}
const materialBase=Number(baseReport.totalFindings||0)-ignored.length;if(base.status!==0&&materialBase===0&&ignored.length===0)add('CRITICAL','CRITIC_V3_PROCESS_FAILURE',`exit=${base.status}; ${base.stderr||base.stdout||''}`.slice(0,500),'critic-v3');
const counts=findings.reduce((a,f)=>(a[f.severity]=(a[f.severity]||0)+1,a),{CRITICAL:0,MAJOR:0,MINOR:0,INFO:0});
const report={schemaVersion:'17.0.0-destructive-critic-4',generatedAt:new Date().toISOString(),critic:'V17_DESTRUCTIVE_ADVERSARIAL_REVIEWER_V4',verdict:findings.length===0?'NO_COMMENTS':'COMMENTS_FOUND',counts,totalFindings:findings.length,findings,baseCritic:{schemaVersion:baseReport.schemaVersion||null,verdict:baseReport.verdict||null,totalFindings:Number(baseReport.totalFindings||0),ignoredSupersededWiringFindings:ignored.map(f=>f.code)},browserRuntime:browser?{schemaVersion:browser.schemaVersion,verdict:browser.verdict,totalFindings:Number(browser.totalFindings||0),checks:browser.checks||[]}:null,coverage:{...(baseReport.coverage||{}),realChromiumJavascriptRuntime:true,desktopRuntime:true,mobileRuntime:true,consoleAndPageErrors:true,networkRuntimeFailures:true,navigationAndSearch:true},rule:'Critic V4 is additive. Every substantive V3 finding and every Chromium runtime finding is blocking; only obsolete V3 direct-wiring findings may be superseded by mandatory V4 wiring.'};
write(OUT,report);console.log(JSON.stringify(report,null,2));if(findings.length)process.exitCode=2;
