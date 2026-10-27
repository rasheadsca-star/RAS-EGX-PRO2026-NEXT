'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {candle,analyze}=require('../../scripts/research/egx-pinned-session-gap-crosswalk.cjs');
const snapshot={open:5.2,high:5.4,low:5.1,last:5.3,volume:17000,
 sourceSessionDate:'2026-10-26',source:'mubasher_symbol_pages'};
const handoff={final:true,executionGrade:true,sourceReady:true,sessionDate:'2026-10-26',
 acceptedRows:204,canonicalDataHead:'f'.repeat(40)};
const truth={ready:true,executionGrade:true,expectedSession:'2026-10-26',acceptedRows:204,
 updatedHistoryFiles:180,sampleRejected:[{ticker:'BAD',reason:'EXTREME_JUMP_REQUIRES_SECOND_SOURCE'}],
 sampleAccepted:[{ticker:'GOOD'}]};
const history={symbols:[{ticker:'GOOD',availableSessions:0,symbolVerified:false},
 {ticker:'BAD',availableSessions:100,lastSession:'2026-10-22',symbolVerified:true}]};
const map={GOOD:{ticker:'GOOD',active:true,currency:'EGP'},BAD:{ticker:'BAD',active:true,currency:'EGP'},
 BLOCKS:{ticker:'BLOCKS',active:false}};
const market={rows:[{...snapshot,symbol:'GOOD'},{...snapshot,open:6.2,high:6.4,low:6.1,last:6.3,symbol:'BAD'}]};
test('a matching source date is NOT permission to promote a candle',()=>{
 const a=analyze({handoff,originalMarket:market,originalTruth:truth,currentTruth:{ready:false,acceptedRows:0},
  historySummary:history,symbolMap:map});
 assert.equal(a.counts.focus,2);assert.equal(a.counts.pinnedComplete,2);
 assert.equal(a.counts.withoutAnyHistoryButDated,1);assert.equal(a.counts.pinnedRejected,1);
 assert.ok(a.records.every(x=>x.promotionApproved===false));
 assert.equal(a.tradingAllowed,false);
 assert.equal(a.records.find(x=>x.ticker==='BAD').classification,'PRICE_TRUTH_REJECTED_NEEDS_INDEPENDENT_CAUSE_REVIEW');
});
test('never accept next-day, invalid-low or fractional-volume pseudo candles',()=>{
 assert.equal(candle({...snapshot,sourceSessionDate:'2026-10-27'},'2026-10-26'),null);
 assert.equal(candle({...snapshot,low:5.25},'2026-10-26'),null);
 assert.equal(candle({...snapshot,volume:102.2},'2026-10-26'),null);
 assert.deepEqual(candle(snapshot,'2026-10-26'),{open:5.2,high:5.4,low:5.1,close:5.3,volume:17000});
});
test('tampered G22 handoff or original session fails closed',()=>{
 assert.throws(()=>analyze({handoff:{...handoff,sessionDate:'2026-10-25'},
  originalTruth:truth,originalMarket:market,historySummary:history,symbolMap:map}),/Pinned original price truth/);
 assert.throws(()=>analyze({handoff:{...handoff,final:false},originalTruth:truth,
  originalMarket:market,historySummary:history,symbolMap:map}),/G22 handoff not certified/);
});
