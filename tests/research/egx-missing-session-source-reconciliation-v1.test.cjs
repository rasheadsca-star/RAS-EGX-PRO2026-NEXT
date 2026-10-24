'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {diagnose}=require('../../scripts/research/egx-missing-session-source-reconciliation-v1.cjs');
test('unobserved market weekday is market-wide and not a ticker-only gap',()=>{const u={A:[{date:'2026-01-04'},{date:'2026-01-06'}],B:[{date:'2026-01-04'},{date:'2026-01-06'}],C:[{date:'2026-01-04'},{date:'2026-01-06'}]};const r=diagnose(u,new Set());assert.equal(r.classes.marketWideDataMissing,1);assert.equal(r.classes.tickerSpecificAbsence,0)});
test('one missing ticker while others traded is separate unverified absence',()=>{const u={A:[{date:'2026-01-04'},{date:'2026-01-06'}],B:[{date:'2026-01-04'},{date:'2026-01-05'},{date:'2026-01-06'}],C:[{date:'2026-01-04'},{date:'2026-01-05'},{date:'2026-01-06'}]};const r=diagnose(u,new Set());assert.equal(r.classes.tickerSpecificAbsence,1);assert.equal(r.tickerReviewSample[0].ticker,'A')});
