'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {qualify}=require('../../scripts/research/egx-aqm-single-trading-readiness-gate-v1.cjs');
function sample(stale){
 return {research:{schemaVersion:'egx-aqm-central-long-history-research-1',coverage:{usableSymbols:29},results:[{
  minimumTurnoverEgp:10000000,strategies:[{variant:'aqm_pullback',signals:100,closedTrades:50,
   diagnosticReturnPct:22,maximumDiagnosticDrawdownPct:2,markIntegrity:{completeSessionMarks:!stale,stalePositionSessions:stale?95:0}}]}]},
 conflicts:{schemaVersion:'egx-central-price-conflict-attribution-v1',totals:{stocksWithConflicts:153,conflictDays:503}},
 sourceQuality:{schemaVersion:'egx-central-long-history-restore-quality-1',summary:{examined:242,retrievedWith250Bars:196,structurallyCandidate:33}}};
}
test('even a 22% exploratory positive return cannot bypass price provenance and future OOS',()=>{
 const r=qualify(sample(false));assert.equal(r.canIssueExecutableBuyRecommendations,false);
 assert.equal(r.scenarios[0].capitalEligible,false);assert.ok(r.scenarios[0].blockers.includes('INDEPENDENT_UNTOUCHED_OOS_NOT_OBSERVED'));
});
test('stale marks add a separately traceable blocking reason',()=>{
 const r=qualify(sample(true));assert.ok(r.scenarios[0].blockers.includes('STALE_DAILY_VALUATIONS'));
});
test('invalid or substituted research report schema must fail closed',()=>{
 const x=sample(true);x.research.schemaVersion='faked';assert.throws(()=>qualify(x),/Unexpected AQM report schema/);
});
test('historical data source volume is not a trade readiness vote',()=>{
 const r=qualify(sample(false));assert.equal(r.evidence.sourceFilesWith250CleanBars,196);
 assert.equal(r.approvedStrategies,0);assert.equal(r.status,'BLOCKED_RESEARCH_ONLY');
});
