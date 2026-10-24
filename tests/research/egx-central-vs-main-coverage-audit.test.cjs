'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {compare}=require('../../scripts/research/egx-central-vs-main-coverage-audit.cjs');
test('quarantined research never eligible for executable backtest',()=>{const r=compare({symbolsMapped:242,symbolsRuntimeVerified:200,symbolsComplete100:196,officiallyVerifiedSymbols:0},{v4a_eligible:0,promoted_count:0},{evidence_rows:2706,distinct_symbols:15,distinct_symbol_sessions:2232,unique_providers:['yahoo_chart']},{count:2706,trading_eligible:false});assert.equal(r.canUseCentralForExecutableBacktest,false);assert.equal(r.centralEvidence.distinctSymbols,15)});
