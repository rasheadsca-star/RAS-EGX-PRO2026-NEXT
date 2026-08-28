#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const ROOT=path.resolve(__dirname,'..');
cp.execFileSync(process.execPath,[path.join(__dirname,'build-consensus.cjs')],{cwd:ROOT,stdio:'inherit'});
const out=JSON.parse(fs.readFileSync(path.join(__dirname,'data','current.json'),'utf8'));
const fail=(m)=>{throw new Error(m)};
if(out.mode!=='RESEARCH_SHADOW_ONLY')fail('research-only lock missing');
if(out.executionLocks?.executionAllowed!==false||out.executionLocks?.automaticOrders!==false||out.executionLocks?.automaticPromotion!==false)fail('execution lock regression');
if(out.dataReadiness?.policy?.missingData!=='UNKNOWN_NEVER_ZERO')fail('missing-data policy regression');
if(out.sources?.V16_9?.source!=='data/stable/v15-practical-decision.json')fail('V16.9 source is not the live V16.9 UI source');
if(out.threeOfThree?.length&&!out.allSourcesFresh)fail('3/3 exposed while a source is stale');
if(out.allSourcesFresh){for(const s of Object.values(out.sources)){if(s.session!==out.marketSession)fail('fresh source session mismatch')}}
for(const r of out.rows||[]){if(r.ready!==true)fail('non-ready ticker entered consensus');if(!['1/3','2/3','3/3'].includes(r.consensus))fail('bad consensus label')}
console.log(JSON.stringify({ok:true,marketSession:out.marketSession,allSourcesFresh:out.allSourcesFresh,ready:out.dataReadiness.ready,quarantined:out.dataReadiness.quarantined,threeOfThree:(out.threeOfThree||[]).map(x=>x.ticker),twoOfThree:(out.twoOfThree||[]).map(x=>x.ticker)},null,2));
