#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r),OUT='data/v17/regression.json';
const read=(r,d={})=>{try{return JSON.parse(fs.readFileSync(P(r),'utf8'))}catch{return d}},text=r=>{try{return fs.readFileSync(P(r),'utf8')}catch{return''}};
function write(r,v){const f=P(r);fs.mkdirSync(path.dirname(f),{recursive:true});const t=f+'.tmp';fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n','utf8');JSON.parse(fs.readFileSync(t,'utf8'));fs.renameSync(t,f)}
function executableGitLines(content,verb){return String(content||'').split('\n').map(line=>line.trim()).filter(line=>{if(!new RegExp(`\\bgit\\s+${verb}\\b`).test(line))return false;if(/^pattern=/.test(line)||/^violations=/.test(line)||/grep\s+-[A-Za-z]*[ER]/.test(line)||line.includes('dangerousPushLines')||line.includes('matchAll('))return false;return true;});}
const base=cp.spawnSync(process.execPath,[P('scripts/v17/regression-v4.cjs')],{cwd:root,encoding:'utf8'}),baseReport=read(OUT,{tests:[]});
const market=text('.github/workflows/update-market-data.yml'),build=text('.github/workflows/v17-build-review.yml');
const marketReg5=market.includes('regression-v5.cjs'),buildReg5=build.includes('regression-v5.cjs'),marketCrit5=market.includes('destructive-critic-v5.cjs'),buildCrit5=build.includes('destructive-critic-v5.cjs');
const obsolete=new Set();
if(marketReg5){obsolete.add('workflow:market:regression-v3');obsolete.add('workflow:market:regression-v4');}
if(buildReg5){obsolete.add('workflow:build:regression-v3');obsolete.add('workflow:build:regression-v4');}
if(marketCrit5){obsolete.add('workflow:market:critic-v3');obsolete.add('workflow:market:critic-v4');}
if(buildCrit5){obsolete.add('workflow:build:critic-v3');obsolete.add('workflow:build:critic-v4');}
const baseTests=Array.isArray(baseReport.tests)?baseReport.tests:[];
const tests=baseTests.map(t=>obsolete.has(t.name)&&t.ok!==true?{...t,ok:true,message:`Superseded only at workflow-wiring level by mandatory V5; original: ${t.message||''}`}:{...t});
function test(name,ok,message,severity='CRITICAL'){tests.push({name,ok:ok===true,severity,message:String(message||'')});}
const buildWrite=/permissions:\s*[\s\S]{0,160}?contents:\s*write\b/m.test(build),buildPush=executableGitLines(build,'push'),buildCommit=executableGitLines(build,'commit'),buildCanonical=/git add\s+data\/v17\/|Commit V17 evidence|zero-comment runtime evidence/i.test(build);
test('publication:build-review-read-only',!buildWrite&&!buildPush.length&&!buildCommit.length&&!buildCanonical,`write=${buildWrite}; push=${buildPush.join(' | ')}; commit=${buildCommit.join(' | ')}; canonical=${buildCanonical}`);
const pushes=executableGitLines(market,'push');
test('publication:market-sole-v17-publisher',pushes.some(line=>/HEAD:develop\/v17-rebuild/.test(line))&&!pushes.some(line=>/\bmain\b/.test(line)),pushes.join(' | '));
test('publication:market-write-permission',/permissions:\s*[\s\S]{0,160}?contents:\s*write\b/m.test(market),'market contents write required');
test('workflow:market:regression-v5',marketReg5,'market workflow regression v5');test('workflow:build:regression-v5',buildReg5,'build workflow regression v5');test('workflow:market:critic-v5',marketCrit5,'market workflow critic v5');test('workflow:build:critic-v5',buildCrit5,'build workflow critic v5');
const coherentV5=marketReg5&&buildReg5&&marketCrit5&&buildCrit5&&!buildWrite&&!buildPush.length&&!buildCommit.length&&pushes.some(line=>/HEAD:develop\/v17-rebuild/.test(line))&&!pushes.some(line=>/\bmain\b/.test(line));
const releaseWiringFingerprint=crypto.createHash('sha256').update(JSON.stringify({marketReg5,buildReg5,marketCrit5,buildCrit5,buildReadOnly:!buildWrite&&!buildPush.length&&!buildCommit.length,marketPushes:pushes})).digest('hex');
test('publication:dual-workflow-v5-coherent',coherentV5,`fingerprint=${releaseWiringFingerprint}`);
test('actions:current-runtime-contract',market.includes('actions/checkout@v6')&&market.includes('actions/setup-node@v6')&&market.includes('actions/upload-artifact@v7')&&build.includes('actions/checkout@v6')&&build.includes('actions/setup-node@v6'),'current GitHub Actions runtime contract');
const browser=read('data/v17/browser-runtime-critic.json',{}),review=read('data/v17/review.json',{}),current=read('data/v17/current.json',{}),truth=read('data/v17/market-session-truth.json',{});
test('runtime:browser-still-clean',browser.schemaVersion==='17.0.0-browser-runtime-critic-1'&&browser.verdict==='NO_COMMENTS'&&Number(browser.totalFindings||0)===0,'real Chromium remains clean');
test('review:v5-still-clean',review.schemaVersion==='17.0.0-review-5'&&review.verdict==='NO_COMMENTS'&&Object.values(review.counts||{}).every(v=>Number(v)===0),'review v5 remains clean');
test('snapshot:verified-session-still-canonical',truth.executionSafe===true&&current.sessionDate===truth.selectedSessionDate&&current?.sessionTruth?.verifiedSessionDate===truth.selectedSessionDate,`current=${current.sessionDate}; truth=${truth.selectedSessionDate}`);
const failed=tests.filter(t=>!t.ok),critical=failed.filter(t=>t.severity==='CRITICAL');
const report={schemaVersion:'17.0.0-regression-5',generatedAt:new Date().toISOString(),contract:'V17_CANONICAL_RUNTIME_AND_SINGLE_PUBLISHER_STABILITY',ok:failed.length===0,total:tests.length,passed:tests.length-failed.length,failedCount:failed.length,criticalFailedCount:critical.length,failed:failed.map(t=>t.name),tests,releaseWiring:{coherentV5,fingerprint:releaseWiringFingerprint},baseRegression:{schemaVersion:baseReport.schemaVersion||null,total:Number(baseReport.total||0),passed:Number(baseReport.passed||0),failedCount:Number(baseReport.failedCount||0),supersededFailedChecks:[...obsolete].filter(name=>baseTests.some(t=>t.name===name&&t.ok!==true))},rule:'Regression V5 is additive. Only lower-version workflow-wiring checks (V3/V4 critic/regression invocation names) may be superseded by mandatory V5 wiring. All substantive lower-version tests remain unchanged and blocking. Build Review must remain read-only; Market Workflow is the sole canonical publisher; both workflows must enforce the same V5 contract and current Actions runtimes.'};
write(OUT,report);console.log(JSON.stringify({schemaVersion:report.schemaVersion,ok:report.ok,total:report.total,passed:report.passed,failedCount:report.failedCount,criticalFailedCount:report.criticalFailedCount,failed:report.failed,releaseWiring:report.releaseWiring,base:report.baseRegression},null,2));if(failed.length)process.exitCode=2;
