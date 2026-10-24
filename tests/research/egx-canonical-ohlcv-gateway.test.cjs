'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {enforceCentralGate}=require('../../scripts/research/egx-canonical-ohlcv-gateway.cjs');
test('quarantine cannot enter executable OHLCV stream',()=>assert.equal(enforceCentralGate({centralEvidence:{quarantineOnly:true},canUseCentralForExecutableBacktest:false}).allowed,false));
test('missing report fails closed',()=>assert.equal(enforceCentralGate(null).allowed,false));
