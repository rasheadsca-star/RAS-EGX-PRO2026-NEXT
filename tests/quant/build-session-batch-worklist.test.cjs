'use strict';
const assert=require('node:assert/strict');
const {build}=require('../../scripts/quant/build-session-batch-worklist.cjs');
const x=build([
 ['20000-low',{missingMarkDetails:[{ticker:'ARCC',date:'2026-06-01'},{ticker:'ARCC',date:'2026-06-01'},{ticker:'ELSH',date:'2026-06-01'}]}],
 ['20000-high',{missingMarkDetails:[{ticker:'ARCC',date:'2026-06-01'},{ticker:'FWRY',date:'2026-05-10'}]}]
]);
assert.equal(x.missingMarks,5);assert.equal(x.distinctPairs,3);assert.equal(x.topTenDatesMarks,5);
assert.equal(x.dates[0].date,'2026-06-01');
assert.equal(x.dates[0].stocks[0].ticker,'ARCC');
assert.equal(x.dates[0].stocks[0].scenarioCount,2);
assert.equal(x.productionImportCount,0);assert.equal(x.marketDataLicensed,false);
assert.throws(()=>build([['bad',{missingMarkDetails:[{ticker:'ARCC',date:'NODATE'}]}]]));
console.log('Session-first worklist: PASS');
