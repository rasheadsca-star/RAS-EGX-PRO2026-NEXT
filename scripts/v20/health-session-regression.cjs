#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const session = '2026-09-16';
function fixture() {
  return {
    'current.json': {sessionDate:session, executionStatus:'RESEARCH_ONLY'},
    'source-health.json': {sessionDate:session},
    'resilient-session-status.json': {executionGrade:false, sessionAligned:false, priceTruth:{verifiedSessionDate:null,sourceSessionVerified:false},readiness:{researchReady:true},executionInputs:{internal:{referenceSessionDate:session},liquidity:{referenceSessionDate:session}},reasons:['PRICE_SOURCE_SESSION_UNVERIFIED']},
    'internal-ohlc-support-resistance.json': {referenceSessionDate:session,researchReady:true,researchSessionVerified:true,executionCandidateReady:false},
    'market-session-truth.json': {researchSessionDate:session,researchSessionVerified:true},
    'technical-history-status.json': {asOfSessionDate:session},
    'sector-provenance-audit.json': {},
    'market-regime.json': {asOfSessionDate:session},
    'forward-evaluation.json': {asOfSessionDate:session}
  };
}
async function render(file, data) {
  const elements = new Map(), errors = [], inserted = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id,{textContent:'',innerHTML:'',classList:{remove(){}},setAttribute(){},insertAdjacentElement(_,e){inserted.push(e)},insertAdjacentHTML(_,s){inserted.push(s)}});
    return elements.get(id);
  };
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{
    document:{getElementById:element,querySelector:element,createElement:()=>({setAttribute(){}})},
    window:{addEventListener:(_,fn)=>fn()},console:{error:(...x)=>errors.push(x)},
    fetch:async url=>{const key=url.split('/').pop();if(!Object.hasOwn(data,key)) return {ok:false,status:404};return {ok:true,json:async()=>structuredClone(data[key])}}
  },{filename:file});
  await new Promise(resolve=>setImmediate(resolve));
  return {elements,errors,inserted,failed:errors.length>0 || !!elements.get('healthError')?.textContent};
}
(async()=>{
 let count=0;
 for(const file of ['v20/health.js','v20/health-gap.js']) {
   for(const oldPriceDate of [null,'2026-08-13',session]) {
     const d=fixture();d['resilient-session-status.json'].priceTruth.verifiedSessionDate=oldPriceDate;
     const before=JSON.stringify(d),r=await render(file,d);
     assert.equal(r.failed,false,file+' coherent research must render');
     assert.equal(JSON.stringify(d),before,'render must not mutate source evidence');
     if(file.endsWith('/health.js')) {
       assert.match(r.elements.get('healthTitle').textContent,/البحث فقط/);
       assert.match(r.elements.get('blockerGrid').innerHTML,/PRICE_SOURCE_SESSION_UNVERIFIED/);
     } else assert.match(r.inserted[0].innerHTML,/Not ready/);
     count++;
   }
   for(const mutate of [
     d=>d['current.json'].sessionDate=null,
     d=>d['market-session-truth.json'].researchSessionDate='2026-08-13',
     d=>d['market-session-truth.json'].researchSessionVerified=false,
     d=>d['resilient-session-status.json'].readiness.researchReady=false,
     d=>d['resilient-session-status.json'].executionInputs.internal.referenceSessionDate='2026-08-13',
     d=>delete d['market-session-truth.json']
   ]){const d=fixture();mutate(d);assert.equal((await render(file,d)).failed,true,file+' must reject missing/mixed evidence');count++;}
 }
 for(const mutate of [
   d=>d['source-health.json'].sessionDate='2026-08-13',
   d=>d['resilient-session-status.json'].executionInputs.liquidity.referenceSessionDate='2026-08-13',
   d=>d['forward-evaluation.json'].asOfSessionDate='2026-08-13',
   d=>d['technical-history-status.json'].asOfSessionDate='2026-08-13',
   d=>d['market-regime.json'].asOfSessionDate='2026-08-13',
   d=>d['current.json'].executionStatus='EXECUTION_GRADE'
 ]) {const d=fixture();mutate(d);assert.equal((await render('v20/health.js',d)).failed,true);count++;}
 for(const mutate of [
   d=>d['internal-ohlc-support-resistance.json'].referenceSessionDate='2026-08-13',
   d=>d['internal-ohlc-support-resistance.json'].researchReady=false,
   d=>d['internal-ohlc-support-resistance.json'].researchSessionVerified=false
 ]) {const d=fixture();mutate(d);assert.equal((await render('v20/health-gap.js',d)).failed,true);count++;}
 const d=fixture();d['current.json'].executionStatus='EXECUTION_GRADE';Object.assign(d['resilient-session-status.json'],{executionGrade:true,sessionAligned:true,priceTruth:{sourceSessionVerified:true,verifiedSessionDate:session}});
 assert.equal((await render('v20/health.js',d)).failed,false);count++;
 console.log(`Health research/execution session regression PASS (${count} cases)`);
})().catch(e=>{console.error(e);process.exitCode=1});
