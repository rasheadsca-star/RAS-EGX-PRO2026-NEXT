#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const read=f=>JSON.parse(fs.readFileSync(path.join(ROOT,f),'utf8'));const fail=m=>{throw new Error(m)};
const policy=read('data/ops/v13-20-policy.json'),out=read('data/research/v13-20-multi-session-results.json');
if(policy.schemaVersion!=='13.20.0'||out.schemaVersion!=='13.20.0')fail('Schema mismatch');
if(policy.safety.automaticBrokerOrders!==false||out.safety.automaticBrokerOrders!==false)fail('Automatic broker orders must remain disabled');
if(out.methodology.walkForward!==true||out.methodology.futureLeakageForbidden!==true)fail('Walk-forward/future leakage gate missing');
for(const s of out.sessions||[]){for(const r of s.recommendations||[]){if(r.tier==='TIER_B_PRIORITY_WATCH')fail('Tier B entered top recommendations');if(r.trainingThrough&&r.trainingThrough>=s.sessionDate)fail(`Future leakage ${s.sessionDate} ${r.ticker}`)}}
for(const list of [[...(out.currentSession?.recommendations||[])],...(out.sessions||[]).map(s=>s.recommendations||[])]){const ranks=list.map(x=>x.recommendationRank);if(new Set(ranks).size!==ranks.length)fail('Duplicate recommendation rank');for(let i=1;i<list.length;i++){const a=list[i-1],b=list[i];const ta=a.tier==='STRICT_PAPER'?0:1,tb=b.tier==='STRICT_PAPER'?0:1;if(ta>tb)fail('Strict must precede A');if(ta===tb&&Number(a.targetProbabilityPct)<Number(b.targetProbabilityPct))fail('Probability ordering broken')}}
const html=fs.readFileSync(path.join(ROOT,'preview-v13/app/unified-decision-center.html'),'utf8');for(const x of ['V13_20_MULTI_SESSION_PRIORITY','التوصية الأولى','التوصية الثانية','التوصية الثالثة','نتائج الاختبار المستمر V13.20'])if(!html.includes(x))fail(`UI marker missing: ${x}`);
console.log('V13.20 MULTI-SESSION PRIORITY ACCEPTANCE PASSED');
