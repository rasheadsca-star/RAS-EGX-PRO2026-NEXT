'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('../../scripts/history/adapters/g11-approved-current-source-adapter.cjs');
const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));

test('strict current row validation requires expected session and valid OHLCV', () => {
  const good = A.validateCurrentRow({sessionDate:'2026-09-16',open:10,high:11,low:9,close:10.5,volume:100}, '2026-09-16');
  const stale = A.validateCurrentRow({sessionDate:'2026-09-15',open:10,high:11,low:9,close:10.5,volume:100}, '2026-09-16');
  const bad = A.validateCurrentRow({sessionDate:'2026-09-16',open:10,high:9,low:8,close:10,volume:100}, '2026-09-16');
  assert.equal(good.ok,true); assert.equal(stale.ok,false); assert.equal(bad.ok,false);
});

test('approved-source registry never promotes candidate/research/legacy sources to current truth', () => {
  const r = read('docs/astra/G11_APPROVED_SOURCE_REGISTRY.json');
  const allowed = new Set(['APPROVED_EXISTING','APPROVED_FALLBACK']);
  assert.ok(r.records.some((x)=>x.sourceId==='starta_egx_exact'&&x.classification==='APPROVED_EXISTING'));
  assert.ok(r.records.some((x)=>x.sourceId==='mubasher_public_stock_pages'&&x.classification==='APPROVED_FALLBACK'));
  assert.ok(r.records.some((x)=>x.classification==='HISTORICAL_ONLY'));
  assert.ok(r.records.some((x)=>x.classification==='LEGACY_DECISION_SOURCE_FORBIDDEN'));
  for (const x of r.records.filter((x)=>x.currentSessionCapability===true && x.currentAvailability===true && !['optional_licensed_eod_provider'].includes(x.sourceId))) {
    if (x.sourceId !== 'approved_reviewed_import') assert.ok(allowed.has(x.classification));
  }
});

test('source precedence is deterministic and has a hard unavailable terminal state', () => {
  const p = read('docs/astra/G11_SOURCE_PRECEDENCE.json');
  const priorities = p.rules.map((x)=>x.priority);
  assert.deepEqual(priorities,[...priorities].sort((a,b)=>a-b));
  assert.equal(p.rules[0].sourceId,'starta_egx_exact');
  assert.equal(p.rules.at(-1).sourceId,'UNAVAILABLE');
  assert.equal(p.sourceMixing.allowed,false);
});

test('approved fallback resolution requires exact current evidence or exact reviewed-import canonical parity', () => {
  const run = read('docs/astra/G11_APPROVED_SOURCE_CLOSURE_RUN.json');
  const expected = run.expectedSession;
  const registry = read('docs/astra/G11_APPROVED_SOURCE_REGISTRY.json');
  const staged = read('data/history-fallback-import.json');
  const reviewedSource = registry.records.find((x)=>x.sourceId==='approved_reviewed_import');
  const resolved = [
    ...(run.noncoverage?.records||[]).filter((x)=>x.finalDisposition==='RESOLVED_APPROVED_FALLBACK'),
    ...(run.invalidSource?.records||[]).filter((x)=>x.finalDisposition==='RESOLVED_APPROVED_FALLBACK'),
    ...(run.stale?.records||[]).filter((x)=>x.finalDisposition==='RESOLVED_FRESH_APPROVED_FALLBACK'),
  ];
  for (const rec of resolved) {
    const attempts = rec.sourceProvenance?.fallbackAttempts || rec.fallbackAttempts || [];
    const exactCurrentAttempts = attempts.filter((a)=>a.ok&&a.row&&a.row.sessionDate===expected);
    const nonReviewedExactCurrent = exactCurrentAttempts.some((a)=>
      a.sourceId!=='approved_reviewed_import' && a.row.sourceId!=='approved_reviewed_import'
    );
    if (nonReviewedExactCurrent) continue;

    const reviewedAttempt = exactCurrentAttempts.find((a)=>
      a.sourceId==='approved_reviewed_import' || a.row.sourceId==='approved_reviewed_import'
    );
    assert.ok(reviewedAttempt,`${rec.ticker} resolved without exact current source row or approved_reviewed_import evidence`);

    assert.ok(reviewedSource, 'approved_reviewed_import registry entry missing');
    assert.equal(reviewedSource.classification,'APPROVED_FALLBACK');
    assert.equal(reviewedSource.currentAvailability,true);
    assert.ok(Number(reviewedSource.approvedRecordCount||0)>0);

    const stagedRecord = (staged.records||[]).find((x)=>
      String(x.ticker||'').trim().toUpperCase()===String(rec.ticker||'').trim().toUpperCase()
      && x.approved===true
      && x.symbolVerified===true
    );
    assert.ok(stagedRecord,`${rec.ticker} approved_reviewed_import lacks staged approved row for the same ticker`);

    const stagedRow = (stagedRecord.sessions||[]).find((row)=>
      String(row.date||row.sessionDate||'').slice(0,10)===expected
    );
    assert.ok(stagedRow,`${rec.ticker} staged approved reviewed-import row missing expected session ${expected}`);

    const canonical = read(`data/history/${rec.ticker}.json`);
    const canonicalRow = (canonical.sessions||[]).find((row)=>
      String(row.date||row.sessionDate||'').slice(0,10)===expected
    );
    assert.ok(canonicalRow,`${rec.ticker} canonical history missing expected session ${expected}`);
    assert.equal(canonicalRow.validationStatus,'approved_fallback_import',`${rec.ticker} canonical row is not an approved_fallback_import`);
    for (const field of ['open','high','low','close','volume']) {
      assert.strictEqual(canonicalRow[field],stagedRow[field],`${rec.ticker} ${field} differs literally between staged approved reviewed import and canonical row`);
    }
  }
  assert.equal(run.safety.previousSessionCarryForward,false);
  assert.equal(run.safety.syntheticMarketData,false);
  assert.equal(run.safety.legacyDecisionOutputUsed,false);
});

test('material approved-source disagreement never silently resolves a security', () => {
  const run = read('docs/astra/G11_APPROVED_SOURCE_CLOSURE_RUN.json');
  const records = [...(run.noncoverage?.records||[]),...(run.invalidSource?.records||[]),...(run.stale?.records||[])];
  for (const rec of records) {
    if ((rec.sourceDisagreements||[]).length) assert.ok(!String(rec.finalDisposition).startsWith('RESOLVED_'));
  }
  const p = read('docs/astra/G11_SOURCE_PRECEDENCE.json');
  assert.match(p.disagreementPolicy.rule,/persist neither/i);
});

test('source identity dispositions are exact and alias/security-status changes carry evidence', () => {
  const run = read('docs/astra/G11_APPROVED_SOURCE_CLOSURE_RUN.json');
  const allowed = new Set(['RESOLVED_APPROVED_PRIMARY','RESOLVED_APPROVED_FALLBACK','ACTIVE_SECURITY_NO_APPROVED_CURRENT_SOURCE','LEGITIMATE_SOURCE_SCOPE_EXCLUSION','SECURITY_STATUS_CHANGED']);
  for (const rec of run.noncoverage.records) {
    assert.ok(allowed.has(rec.finalDisposition));
    if (rec.finalDisposition==='SECURITY_STATUS_CHANGED') assert.ok(rec.exactCatalogReplacement?.canonicalReplacement);
    if (rec.finalDisposition==='LEGITIMATE_SOURCE_SCOPE_EXCLUSION') assert.equal(rec.approvedCatalogDirect,false);
  }
  assert.equal(run.safety.fuzzyMatching,false);
});

test('POCO invalid-source diagnosis preserves raw validation evidence before fallback decision', () => {
  const run = read('docs/astra/G11_APPROVED_SOURCE_CLOSURE_RUN.json');
  assert.equal(run.invalidSource.total,1);
  const rec = run.invalidSource.records[0];
  assert.ok(rec.startaDiagnosis);
  assert.ok(Array.isArray(rec.startaDiagnosis.periods));
  assert.ok(rec.parserOrSourceConclusion);
});

test('V16 feature-readiness contract exposes same-session cross-section and exact focus reasons', () => {
  const v = read('docs/astra/G11_V16_FEATURE_READINESS.json');
  assert.equal(v.minimumUniverse,60);
  assert.ok(v.contracts.some((x)=>x.featureId==='RELATIVE_STRENGTH20'&&x.crossSectionalRequirement===true&&x.sameSessionRequirement===true));
  for (const ticker of ['AMES','GRCA','LUTS','PHGC']) {
    const rec = v.focusSecurities[ticker];
    assert.ok(rec,`${ticker} missing focus record`);
    if (!rec.ready) assert.ok(Array.isArray(rec.reasons)&&rec.reasons.length>0,`${ticker} missing exact readiness reason`);
  }
});

test('blocker overlap accounting uses unique-security sets instead of summing issue families', () => {
  const issues = read('docs/astra/G11_DATA_HEALTH_ISSUES.json').issues || [];
  const byCode = Object.fromEntries(issues.map((x)=>[x.code,new Set(x.affectedTickers||[])]));
  const symbol=[...(byCode.SYMBOL_IDENTITY_UNRESOLVED||new Set())];
  const current=[...(byCode.CURRENT_SESSION_GAP||new Set())];
  const regime=[...(byCode.REGIME_INPUT_INCOMPLETE||new Set())];
  const unique=[...new Set([...symbol,...current,...regime])];
  const allThree=symbol.filter((x)=>(byCode.CURRENT_SESSION_GAP||new Set()).has(x)&&(byCode.REGIME_INPUT_INCOMPLETE||new Set()).has(x));
  const graph = read('docs/astra/G11_BLOCKER_DEPENDENCY_GRAPH.json');
  const familyTotal = symbol.length + current.length + regime.length;
  assert.ok(unique.length <= familyTotal);
  assert.ok(Array.isArray(allThree));
  assert.equal(unique.length, Number(graph.uniqueAffectedSecurityCount || 0));
  assert.deepEqual([...unique].sort(), [...(graph.uniqueAffectedSecurities || [])].sort());
  if (familyTotal === 0) assert.equal(unique.length, 0);
  else assert.ok(unique.length > 0);
});

test('G12 remains pending and closure is non-cutover', () => {
  const gates = read('04_ACCEPTANCE_GATES.json').gates;
  assert.equal(gates.find((x)=>x.id==='G12').status,'PENDING');
  const p = read('docs/astra/G11_CURRENT_PIPELINE_RUN.json');
  assert.equal(p.legacyNetworkCalls,0); assert.equal(p.productionCutover,false);
});

// Trigger marker: overlap test is pre-finalizer safe; final graph is verified by the workflow honesty guard.
