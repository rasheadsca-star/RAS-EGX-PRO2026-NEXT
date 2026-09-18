'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const bridge=require('../../astra/runtime/bridges/v19-local.cjs');
const root=path.resolve(__dirname,'../..');

function history(n=260){return Array.from({length:n},(_,i)=>({sessionDate:`2026-${String(1+Math.floor(i/28)).padStart(2,'0')}-${String(1+i%28).padStart(2,'0')}`,close:100+i*.1,volume:1000000+i,validationStatus:'VALID',migrationValidationStatus:'VALID'}))}
function feature(i=0){return{ret1:1,ret3:2,ret5:3,ret10:4,ret20:8,rs1:1,rs5:2,rs20:3,rsi:58,atrPct:2+(i%4),volumeRatio20:1.2,turnover20:2e7,sma5Dist:1,sma10Dist:2,sma20Dist:3,range20:.7,breakout20:0,volatility20:2,closePosition:.7,bodyPct:1,gapPct:0,distSupportAtr:1,distResistanceAtr:2,market1:.5,market5:1,market20:2,breadth:.55}}
function input(){
  return{
    snapshot:{snapshotId:'G12-R03-PARITY',ticker:'COMI',sessionDate:'2026-09-15',validationStatus:'VALID',migrationValidationStatus:'VALID'},
    history:history(),
    priorLossStreak:2,
    trainingSessions:Array.from({length:50},(_,d)=>Array.from({length:60},(_,i)=>({ticker:`V${i}`,feature:feature(i),yTop10:i<10?1:0}))),
    currentRows:Array.from({length:60},(_,i)=>({ticker:`V${i}`,feature:feature(i)}))
  };
}
test('R03 V19 bridge executes the internally reconstructed V6 contract deterministically',()=>{
  const cap=bridge.capability();
  assert.equal(cap.engineId,'V19_CHAT_GPT_NATIVE_CHALLENGER_V6');
  assert.equal(cap.canExecuteInternally,true);
  assert.equal(cap.productionEligible,false);
  const a=bridge.executeV19(input()),b=bridge.executeV19(input());
  assert.equal(a.strategyExecution.eligibility,'ELIGIBLE');
  assert.equal(a.strategyExecution.componentScores.portfolioExposurePct,40);
  assert.equal(a.current.selectedTickers.length,3);
  assert.deepEqual(a,b);
});
test('R03 V19 parity is backed by G10 exact pinned policy evidence',()=>{
  const g10=JSON.parse(fs.readFileSync(path.join(root,'docs/astra/G10_PARITY_RESULTS.json'),'utf8'));
  const rows=(g10.results||g10.cases||[]).filter(x=>x.strategyId==='V19_TOP10_PROBABILITY_INV_VOL_3');
  assert.ok(rows.length>=2);
  const policy=rows.find(x=>x.caseId==='CONFIG-V19-POLICY');
  assert.ok(policy);
  assert.equal(policy.comparisonStatus,'EXACT_MATCH');
  const map=Object.fromEntries((policy.fields||[]).map(x=>[x.field,x]));
  assert.equal(map.basePolicy.actual,'S0.00|R0|A8|INV_VOL|N3');
  assert.deepEqual(map.riskProfile.actual,{'0':1,'1':.65,'2':.4,'3':.25});
});
test('R03 historical V19 target-stop evidence is local provenance only',()=>{
  const a=JSON.parse(fs.readFileSync(path.join(root,'data/archive/v19/target-stop-audit-v6.json'),'utf8'));
  assert.equal(a.schemaVersion,'19.5.0-target-stop-audit-v1');
  assert.equal(a.engineId,'V19_CHAT_GPT_NATIVE_CHALLENGER_V6');
  assert.equal(a.changesRanking,false);
  assert.equal(a.changesExecutionPermission,false);
  const source=fs.readFileSync(path.join(root,'astra/runtime/bridges/v19-local.cjs'),'utf8');
  assert.doesNotMatch(source,/https?:\/\/|raw\.githubusercontent\.com|cdn\.jsdelivr\.net/i);
});
