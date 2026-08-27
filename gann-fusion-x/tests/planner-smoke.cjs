'use strict';
const assert=require('assert');
const P=require('../engine/planner.js');
assert.equal(P.nextEgxSession('2026-08-27'),'2026-08-30','EGX weekend must skip Friday/Saturday');
const fake={ticker:'TEST',nameAr:'اختبار',close:100,score:82,classification:{code:'BREAKOUT_WATCH'},parts:{gannTime:{score:85,active:true},gannPrice:{score:78},trend:{score:80},relativeStrength:{score:72},breakout:{score:82,near:true,confirmed:false},volume:{score:75,confirmed:true},momentum:{score:70,overheated:false},fundamentals:{score:76},marketRegime:{score:80,regime:'RISK_ON'}},plan:{entryLow:99,entryHigh:101,trigger:101,stopLoss:96,target1:108,target2:112,rr:1.75,atr14:2.2},marketMeta:{liquidityPercentile:70}};
for(const h of ['speculative','medium','long']){
  const p=P.buildPlan(fake,h,{portfolioValue:100000,riskPct:.5,verifiedFundamentals:true});
  assert(p.levels.stopLoss<p.levels.referenceEntry,`${h}: stop must be below entry`);
  assert(p.levels.target1>p.levels.referenceEntry,`${h}: target1`);
  assert(p.levels.target2>p.levels.target1,`${h}: target2`);
  assert(p.levels.target3>p.levels.target2,`${h}: target3`);
  assert(p.size.allocationPct>=0&&p.size.allocationPct<=P.PROFILES[h].maxAllocationPct,`${h}: allocation cap`);
}
const s=P.positionSize({portfolioValue:100000,riskPct:.5,entry:100,stop:95,maxAllocationPct:10});
assert(s.allocationPct<=10,'position cap');
assert(s.shares>0,'shares should be calculated');
console.log('PLANNER_SMOKE_PASS',s);
