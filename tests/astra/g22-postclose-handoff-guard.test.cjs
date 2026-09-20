'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateHandoff } = require('../../scripts/astra/g22-postclose-handoff-guard.cjs');

function fixture(overrides = {}) {
  const fp = 'a'.repeat(64);
  const head = 'b'.repeat(40);
  const base = {
    eventName:'workflow_run',
    upstream:{conclusion:'success',headBranch:'main',headRepo:'o/r',repository:'o/r',runId:'123'},
    marker:{
      schemaVersion:'g22-main-app-final-handoff-1',
      producerRunId:'123',
      canonicalDataHead:head,
      final:true,sourceReady:true,currentSessionReady:true,executionGrade:true,
      pagesPublished:true,pagesPublishedAt:'2026-09-20T14:00:00Z',
      sessionDate:'2026-09-20',expectedSession:'2026-09-20',
      acceptedRows:207,sourceSessionEvidenceCoveragePct:95,
      materialFingerprint:fp,sourceSessionDataHash:'c'.repeat(64)
    },
    canonicalStatus:{
      final:true,sourceReady:true,currentSessionReady:true,executionGrade:true,
      sessionDate:'2026-09-20',materialFingerprint:fp
    },
    price:{
      expectedSession:'2026-09-20',ready:true,executionGrade:true,acceptedRows:207,
      source:{sourceSessionEvidenceCoveragePct:95}
    },
    primary:{
      sessionDate:'2026-09-20',currentSessionReady:true,basketPlan:{sourceSessionReady:true}
    },
    canonicalAvailable:true,
    audit:{session:{decision:'2026-09-19'},upstream:{}},
    now:{date:'2026-09-20',hour:16,minute:30,dow:0}
  };
  const out = structuredClone(base);
  for (const [k,v] of Object.entries(overrides)) out[k] = v;
  return out;
}

test('workflow_run accepts immutable final published handoff', () => {
  const r=evaluateHandoff(fixture());
  assert.equal(r.run,true);
  assert.equal(r.reason,'FINAL_MAIN_APP_HANDOFF_READY');
});

test('fails closed when upstream workflow failed', () => {
  const x=fixture(); x.upstream.conclusion='failure';
  const r=evaluateHandoff(x);
  assert.equal(r.run,false);
  assert.ok(r.reasons.includes('UPSTREAM_WORKFLOW_NOT_SUCCESS'));
});

test('fails closed before MAIN APP Pages publication', () => {
  const x=fixture(); x.marker.pagesPublished=false; x.marker.pagesPublishedAt=null;
  const r=evaluateHandoff(x);
  assert.equal(r.run,false);
  assert.ok(r.reasons.includes('HANDOFF_PAGES_NOT_PUBLISHED'));
});

test('fails closed below G22 source evidence threshold', () => {
  const x=fixture(); x.marker.sourceSessionEvidenceCoveragePct=89.9;
  const r=evaluateHandoff(x);
  assert.equal(r.run,false);
  assert.ok(r.reasons.includes('HANDOFF_SOURCE_EVIDENCE_BELOW_90'));
});

test('fails closed below G22 200 accepted-row floor', () => {
  const x=fixture(); x.marker.acceptedRows=199;
  const r=evaluateHandoff(x);
  assert.equal(r.run,false);
  assert.ok(r.reasons.includes('HANDOFF_ACCEPTED_ROWS_BELOW_200'));
});

test('fails closed when canonical snapshot fingerprint differs from marker', () => {
  const x=fixture(); x.canonicalStatus.materialFingerprint='d'.repeat(64);
  const r=evaluateHandoff(x);
  assert.equal(r.run,false);
  assert.ok(r.reasons.includes('CANONICAL_STATUS_FINGERPRINT_MISMATCH'));
});

test('fails closed when immutable canonical commit is unavailable', () => {
  const x=fixture(); x.canonicalAvailable=false;
  const r=evaluateHandoff(x);
  assert.equal(r.run,false);
  assert.ok(r.reasons.includes('CANONICAL_SNAPSHOT_UNAVAILABLE'));
});

test('automatic trigger skips fingerprint already processed for same session', () => {
  const x=fixture();
  x.audit={session:{decision:'2026-09-20'},upstream:{mainAppMaterialFingerprint:'a'.repeat(64)}};
  x.upstream.runId='999';
  const r=evaluateHandoff(x);
  assert.equal(r.run,false);
  assert.equal(r.reason,'ALREADY_PROCESSED_MAIN_APP_FINGERPRINT');
});

test('manual dispatch can deliberately rebuild same finalized fingerprint', () => {
  const x=fixture({eventName:'workflow_dispatch'});
  x.audit={session:{decision:'2026-09-20'},upstream:{mainAppMaterialFingerprint:'a'.repeat(64)}};
  const r=evaluateHandoff(x);
  assert.equal(r.run,true);
});

test('schedule is accepted only inside Cairo post-close fallback window', () => {
  const ok=fixture({eventName:'schedule'});
  assert.equal(evaluateHandoff(ok).run,true);
  const early=fixture({eventName:'schedule',now:{date:'2026-09-20',hour:14,minute:30,dow:0}});
  const r=evaluateHandoff(early);
  assert.equal(r.run,false);
  assert.ok(r.reasons.includes('OUTSIDE_POST_CLOSE_FALLBACK_WINDOW'));
});

test('stale handoff session never passes', () => {
  const x=fixture(); x.now={date:'2026-09-21',hour:16,minute:0,dow:1};
  const r=evaluateHandoff(x);
  assert.equal(r.run,false);
  assert.ok(r.reasons.includes('SESSION_NOT_CAIRO_TODAY'));
});

test('first workflow_run requires marker producer run identity', () => {
  const x=fixture(); x.marker.producerRunId='777';
  const r=evaluateHandoff(x);
  assert.equal(r.run,false);
  assert.ok(r.reasons.includes('HANDOFF_PRODUCER_RUN_MISMATCH'));
});
