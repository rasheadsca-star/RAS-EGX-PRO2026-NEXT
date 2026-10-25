'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {auditReplayCoverage}=require('../../scripts/stable/history-replay-coverage-audit.cjs');
test('derived prediction observations never qualify as canonical OHLCV',()=>{
 const out=auditReplayCoverage({tickers:['BONY','ADIB'],snapshots:[{schemaVersion:'astra-replay-snapshot/v1',session:'2026-10-22',predictions:[{ticker:'ADIB',currentPrice:45.99}]}]});
 assert.equal(out[0].classification,'NOT_PRESENT_IN_REPLAY_PREDICTIONS');
 assert.equal(out[1].classification,'DERIVED_RESEARCH_ONLY_NO_CANONICAL_IMPORT');
 assert.equal(out[1].canonicalOHLCVEligible,false);
});
test('unknown snapshot schema cannot be silently treated as price truth',()=>{
 assert.throws(()=>auditReplayCoverage({tickers:['BONY'],snapshots:[{schemaVersion:'other',session:'2026-10-22'}]}),/UNKNOWN_REPLAY_SCHEMA/);
});
