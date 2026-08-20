import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeDecisionRows, evaluateFrozenSignal, summarizeForwardEvidence } from '../sidecars/forward-evidence.js';
import { verifyOfficialSnapshot } from '../sidecars/data-verification.js';
import { auditHistoryDepth } from '../sidecars/history-depth.js';
import { classifyRegime, classifyRegimeAtDate, segmentEvidenceByRegime } from '../sidecars/regime-analysis.js';
import { validateLongHistories } from '../sidecars/long-history-validation.js';

const signalRow = {
  sessionDate:'2026-08-19', rank:1, ticker:'TEST', decision:'RESEARCH_PENDING_PULLBACK', publicationState:'RESEARCH_CANDIDATE',
  price:10.5, entryLow:10, entryHigh:10.2, stop:9.5, target1:11, target2:12, fusionRankScore:80, researchScore:80, technicalScore:82,
  sourceCommit:'abc',
};

const bars = [
  {date:'2026-08-19',open:10.4,high:10.6,low:10.3,close:10.5,volume:1000},
  {date:'2026-08-20',open:10.4,high:10.45,low:10.1,close:10.2,volume:1000},
  {date:'2026-08-23',open:10.1,high:11.2,low:9.4,close:10.8,volume:1000},
];

test('forward snapshot is immutable, hashed, and explicitly non-alpha', () => {
  const input = [structuredClone(signalRow)];
  const before = JSON.stringify(input);
  const snap = freezeDecisionRows(input,{generatedAt:'2026-08-20T00:00:00.000Z',sourceCommit:'abc'});
  assert.equal(JSON.stringify(input),before);
  assert.equal(snap.immutable,true);
  assert.equal(snap.scoringImpact,'NONE');
  assert.match(snap.snapshotHash,/^[a-f0-9]{64}$/);
  assert.match(snap.signals[0].signalHash,/^[a-f0-9]{64}$/);
  assert.throws(()=>{snap.signals.push({});});
});

test('forward evaluator never uses signal session as entry session', () => {
  const snap = freezeDecisionRows([signalRow]);
  const result = evaluateFrozenSignal(snap.signals[0],bars,{asOfDate:'2026-08-20'});
  assert.equal(result.entryDate,'2026-08-20');
  assert.notEqual(result.entryDate,signalRow.sessionDate);
  assert.equal(result.scoringImpact,'NONE');
});

test('forward evaluator applies STOP_FIRST when target and stop hit same bar', () => {
  const snap = freezeDecisionRows([signalRow]);
  const result = evaluateFrozenSignal(snap.signals[0],bars,{asOfDate:'2026-08-23'});
  assert.equal(result.status,'STOP_SAME_BAR');
  assert.equal(result.stopFirstApplied,true);
  assert.ok(result.netPct < 0);
});

test('forward summary does not invent results for unresolved signals', () => {
  const s = summarizeForwardEvidence([{status:'OPEN',resolved:false},{status:'WAITING_FOR_ENTRY',resolved:false}]);
  assert.equal(s.resolved,0);
  assert.equal(s.target1Pct,null);
  assert.equal(s.stopPct,null);
  assert.equal(s.scoringImpact,'NONE');
});

test('official verification is reporting-only and flags conflict', () => {
  const report = verifyOfficialSnapshot({
    marketRows:[{ticker:'AAA',lastSession:'2026-08-19',close:10}],
    officialRows:[{ticker:'AAA',date:'2026-08-19',close:12,official:true,source:'EGX'}],
    tolerancePct:1,
  });
  assert.equal(report.alphaMutationAllowed,false);
  assert.equal(report.scoringImpact,'NONE');
  assert.equal(report.rows[0].status,'CONFLICT');
});

test('history depth audit does not overstate short samples', () => {
  const report = auditHistoryDepth([{ticker:'AAA',availableSessions:114},{ticker:'BBB',availableSessions:800}]);
  assert.equal(report.rows[0].tier,'VERY_SHORT');
  assert.equal(report.rows[0].suitableForRobustRegimeStudy,false);
  assert.equal(report.rows[1].tier,'MULTI_YEAR_STRONG');
  assert.equal(report.scoringImpact,'NONE');
});

test('regime classifier labels short history as provisional', () => {
  const rows=[];
  for(let i=0;i<100;i++) rows.push({date:`2026-${String(Math.floor(i/28)+1).padStart(2,'0')}-${String(i%28+1).padStart(2,'0')}`,close:100+i});
  const r=classifyRegime(rows);
  assert.equal(r.regime,'BULL');
  assert.equal(r.confidence,'PROVISIONAL_SHORT_HISTORY');
  assert.equal(r.scoringImpact,'NONE');
});

test('regime classification at signal date excludes all future benchmark rows', () => {
  const rows=[];
  for(let i=0;i<100;i++) rows.push({date:`2026-${String(Math.floor(i/28)+1).padStart(2,'0')}-${String(i%28+1).padStart(2,'0')}`,close:100+i});
  const r=classifyRegimeAtDate(rows,'2026-03-04');
  assert.equal(r.futureRowsExcluded,true);
  assert.equal(r.asOfDate,'2026-03-04');
  assert.equal(r.close,159);
});

test('regime segmentation remains evidence-only', () => {
  const r=segmentEvidenceByRegime([{regime:'BULL',resolved:true,status:'TARGET1'},{regime:'BEAR',resolved:true,status:'STOP'}]);
  assert.equal(r.BULL.target1Pct,100);
  assert.equal(r.BEAR.stopPct,100);
  assert.equal(r.scoringImpact,'NONE');
});

test('long-history validation reuses frozen backtest without runtime or parameter mutation', () => {
  const rows=[];
  const start=new Date('2023-01-01T00:00:00Z');
  for(let i=0;i<520;i++){
    const d=new Date(start.getTime()+i*86400000).toISOString().slice(0,10);
    const close=10+i*0.01;
    rows.push({date:d,open:close,high:close*1.01,low:close*0.99,close,volume:1000000});
  }
  const before=JSON.stringify(rows);
  const report=validateLongHistories([{ticker:'TEST',rows}]);
  assert.equal(JSON.stringify(rows),before);
  assert.equal(report.scoringImpact,'NONE');
  assert.equal(report.productionRuntimeMutation,false);
  assert.equal(report.engineParametersModified,false);
  assert.equal(report.symbols,1);
  assert.equal(report.multiYearSymbols,1);
  assert.equal(report.totalSessions,520);
});
