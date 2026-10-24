'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {audit}=require('../../scripts/research/egx-historical-trade-ledger-audit-v1.cjs');
test('flags missing entry and exit bars',()=>{const r=audit({X:[{date:'2026-01-04',open:10}]},[{ticker:'X',variant:'trend_pullback',entryDate:'2026-01-05',exitDate:'2026-01-06',netReturnPct:1}]);assert.equal(r.issues.missingEntry,1);assert.equal(r.issues.missingExit,1)});
test('accepts basic complete historical bars without certifying fills',()=>{const r=audit({X:[{date:'2026-01-04',open:10},{date:'2026-01-05',open:10}]},[{ticker:'X',entryDate:'2026-01-04',exitDate:'2026-01-05',netReturnPct:1}]);assert.equal(r.conclusion,'BASIC_LEDGER_COVERAGE_CHECKS_PASS')});
