'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {copiedBarReasons}=require('../../scripts/independent/stale-bar-detector.cjs');
const bar=(date,close=10,volume=100)=>({date,open:9,high:11,low:8,close,volume});
test('same OHLC and positive volume flagged',()=>assert.equal(copiedBarReasons([bar('2026-10-27'),bar('2026-10-28')])[0].reason,'REPEATED_OHLCV'));
test('same OHL with changed close is flagged',()=>assert.equal(copiedBarReasons([bar('2026-10-27'),bar('2026-10-28',10.5)])[0].reason,'REPEATED_OHL'));
test('genuine zero volume rows are not presumed copied',()=>assert.equal(copiedBarReasons([bar('2026-10-27',10,0),bar('2026-10-28',10,0)]).length,0));
test('changed high or low is not flagged',()=>{const x=bar('2026-10-28');x.high=12;assert.equal(copiedBarReasons([bar('2026-10-27'),x]).length,0)});

test('COMI 27 August: actual historical full OHLCV copy is detected',()=>{
 const a={date:'2026-08-26',open:140.96,high:142,low:138.01,close:139.73,volume:5780737};
 const b={...a,date:'2026-08-27'};
 assert.equal(copiedBarReasons([a,b])[0].reason,'REPEATED_OHLCV');
});
test('COMI 19 October: actual historical OHL-only copy is detected',()=>{
 const a={date:'2026-10-18',open:124.97,high:125,low:122.51,close:123.16,volume:1613169};
 const b={date:'2026-10-19',open:124.97,high:125,low:122.51,close:124.36,volume:4478515};
 assert.equal(copiedBarReasons([a,b])[0].reason,'REPEATED_OHL');
});

test('identical OHLC with different positive volumes is classified separately',()=>{
 const a=bar('2026-10-27',10,100),b=bar('2026-10-28',10,101);
 assert.equal(copiedBarReasons([a,b])[0].reason,'REPEATED_OHLC');
});

test('duplicate and out-of-order session dates are not labeled copied bars',()=>{
 const a=bar('2026-10-28'),b=bar('2026-10-28'),c=bar('2026-10-27');
 assert.equal(copiedBarReasons([a,b]).length,0);
 assert.equal(copiedBarReasons([a,c]).length,0);
});
test('ARAB low-priced identical OHLC with changed volume remains conservatively flagged for manual evidence review',()=>{
 const a={date:'2026-10-20',open:0.26,high:0.27,low:0.26,close:0.26,volume:279505454};
 const b={date:'2026-10-21',open:0.26,high:0.27,low:0.26,close:0.26,volume:210950174};
 assert.equal(copiedBarReasons([a,b])[0].reason,'REPEATED_OHLC');
});

test('malformed date strings are never classified as duplicate market days',()=>{
 const a=bar('invalid-date'),b=bar('2026-10-28');
 assert.deepEqual(copiedBarReasons([a,b]),[]);
});
