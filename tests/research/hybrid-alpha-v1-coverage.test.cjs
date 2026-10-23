'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspect}=require('../../scripts/research/hybrid-alpha-v1-coverage-v2.cjs');
const bars=[{date:'2026-10-07',open:10,high:12,low:9,close:11,volume:100},{date:'2026-10-08',open:11,high:12,low:10,close:11,volume:100},{date:'2026-10-11',open:11,high:14,low:10,close:12,volume:200}];
test('removes holiday bar from historical coverage',()=>assert.equal(inspect({sessions:bars},new Set(['2026-10-08'])).bars,2));
test('de-duplicates identical session dates',()=>assert.equal(inspect({sessions:[bars[0],bars[0]]},new Set()).bars,1));
test('rejects inverted OHLC',()=>assert.equal(inspect({sessions:[{...bars[0],high:8}]},new Set()).bars,0));
test('rejects source conflicts',()=>assert.equal(inspect({sessions:[{...bars[0],validationStatus:'source_conflict'}]},new Set()).bars,0));
