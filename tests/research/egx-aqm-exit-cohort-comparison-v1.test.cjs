'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {pairedCohort}=require('../../scripts/research/egx-aqm-exit-cohort-comparison-v1.cjs');
const d=['2026-01-04','2026-01-05','2026-01-06','2026-01-07'];
const mk=(date,open,high,low,close)=>({date,open,high,low,close,volume:1000,executable:true});
const entry={ticker:'ABC',signalDate:'2026-01-04',dateOpened:'2026-01-05',qty:100,entry:100,atr:4,stop:94,originalCost:10030};
test('all styles use identical recorded 100-share entry and accounting cost',()=>{
 const u={ABC:[mk(d[0],100,101,99,100),mk(d[1],100,103,99,102),mk(d[2],107,112,103,111),mk(d[3],111,115,108,113)]};
 const x=['partial','full_target','trailing'].map(style=>pairedCohort(u,[entry],style));
 assert.ok(x.every(r=>r.sumInitialAllocationsEgp===10030&&r.entryCount===1));assert.equal(x[0].tradeResults[0].initialQty,100);
});
test('gap through stop incurs realistic loss for every style',()=>{
 const u={ABC:[mk(d[0],100,101,99,100),mk(d[1],100,102,99,101),mk(d[2],84,89,80,85)]};
 for(const style of ['partial','full_target','trailing']){const x=pairedCohort(u,[entry],style);assert.equal(x.exitReasons.STOP_GAP,1);assert.ok(x.sumMarkedPnlEgp<-1500)}
});
test('zero volume reference candle never triggers a trade exit',()=>{
 const u={ABC:[mk(d[0],100,101,99,100),mk(d[1],100,102,99,101),{...mk(d[2],70,71,60,70),volume:0,executable:false},mk(d[3],100,109,99,108)]};
 const x=pairedCohort(u,[entry],'full_target');
 assert.equal(x.closedCount,0);assert.equal(x.tradeResults[0].missingOrReferenceBars,1);
});
test('fixed-entry cohort never uses unexecuted planned entries',()=>{const x=pairedCohort({ABC:[]},[],'partial');assert.equal(x.entryCount,0);assert.equal(x.normalizedCohortReturnPct,null)});

test('historical depth audit reports actual executable bars, not synthetic sessions',()=>{
 const {auditHistoricalDepth}=require('../../scripts/research/egx-aqm-exit-cohort-comparison-v1.cjs');
 const bars=Array.from({length:260},(_,i)=>({date:String(i),volume:i%10===0?0:100,executable:i%10!==0}));
 const r=auditHistoricalDepth({ABC:bars});assert.equal(r.minimumBarsByThreshold['120'],1);assert.equal(r.minimumBarsByThreshold['250'],0);assert.equal(r.maximumExecutableBars,234);
});
