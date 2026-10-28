'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {copiedBarReasons}=require('../../scripts/independent/stale-bar-detector.cjs');
const bar=(date,close=10,volume=100)=>({date,open:9,high:11,low:8,close,volume});
test('same OHLC and positive volume flagged',()=>assert.equal(copiedBarReasons([bar('2026-10-27'),bar('2026-10-28')])[0].reason,'REPEATED_OHLC'));
test('same OHL with changed close is flagged',()=>assert.equal(copiedBarReasons([bar('2026-10-27'),bar('2026-10-28',10.5)])[0].reason,'REPEATED_OHL'));
test('genuine zero volume rows are not presumed copied',()=>assert.equal(copiedBarReasons([bar('2026-10-27',10,0),bar('2026-10-28',10,0)]).length,0));
test('changed high or low is not flagged',()=>{const x=bar('2026-10-28');x.high=12;assert.equal(copiedBarReasons([bar('2026-10-27'),x]).length,0)});
