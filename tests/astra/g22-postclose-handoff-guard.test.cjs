'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateHandoff } = require('../../scripts/astra/g22-postclose-handoff-guard.cjs');

function fixture(overrides = {}) {
  const fp = 'a'.repeat(64);
  const base = {
    eventName:'workflow_run',
    upstream:{conclusion:'success',headBranch:'main',headRepo:'o/r',repository:'o/r'},
    scan:{
      final:true,sourceReady:true,currentSessionReady:true,executionGrade:true,
      pagesPublished:true,pagesPublishedSession:'2026-09-20',
      sessionDate:'2026-09-20',expectedSession:'2026-09-20',materialFingerprint:fp
    },
    price:{
      expectedSession:'2026-09-20',ready:true,executionGrade:true,acceptedRows:207,
      source:{sourceSessionEvidenceCoveragePct:95}
    },
    primary:{
      sessionDate:'2026-09-20',currentSessionReady:true,basketPlan:{sourceSessionReady:true}
    },
    audit:{session:{decision:'2026-09-19'},upstream:{}},
    now:{date:'2026-09-20',hour:16,minute:30,dow:0}
  };
  const out = structuredClone(base);
  for (const [k,v] of Object.entries(overrides)) out[k] = v;
  return out;
}

test('workflow_run accepts exact final published current session', () => {
  const r=evaluateHandoff(fixture());
  assert.equal(r.run,true);
  assert.equal(r.reason,'FINAL_MAIN_APP_SESSION_READY');
});

test('fails closed when upstream workflow failed', () => {
  const x=fixture(); x.upstream.conclusion='failure';
  const r=evaluateHandoff(x);
  assert.equal(r.run,false);
  assert.ok(r.reasons.includes('UPSTREAM_WORKFLOW_NOT_SUCCESS'));
});

test('fails closed before MAIN APP Pages publication', () => {
  const x=fixture(); x.scan.pagesPublished=false; x.scan.pagesPublishedSession=null;
  const r=evaluateHandoff(x);
  assert.equal(r.run,false);
  assert.ok(r.reasons.includes('MAIN_APP_PAGES_NOT_PUBLISHED'));
});

test('fails closed below G22 source evidence threshold even if MAIN APP is final', () => {
  const x=fixture(); x.price.source.sourceSessionEvidenceCoveragePct=89.9;
  const r=evaluateHandoff(x);
  assert.equal(r.run,false);
  assert.ok(r.reasons.includes('SOURCE_SESSION_EVIDENCE_BELOW_90'));
});

test('fails closed below G22 200 accepted-row floor', () => {
  const x=fixture(); x.price.acceptedRows=199;
  const r=evaluateHandoff(x);
  assert.equal(r.run,false);
  assert.ok(r.reasons.includes('PRICE_TRUTH_ACCEPTED_ROWS_BELOW_200'));
});

test('automatic trigger skips fingerprint already processed for same session', () => {
  const x=fixture();
  x.audit={session:{decision:'2026-09-20'},upstream:{mainAppMaterialFingerprint:'a'.repeat(64)}};
  const r=evaluateHandoff(x);
  assert.equal(r.run,false);
  assert.ok(r.reasons.includes('ALREADY_PROCESSED_MAIN_APP_FINGERPRINT'));
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
  assert.equal(evaluateHandoff(early).run,false);
  assert.ok(evaluateHandoff(early).reasons.includes('OUTSIDE_POST_CLOSE_FALLBACK_WINDOW'));
});

test('stale session never passes automatic handoff', () => {
  const x=fixture(); x.now={date:'2026-09-21',hour:16,minute:0,dow:1};
  const r=evaluateHandoff(x);
  assert.equal(r.run,false);
  assert.ok(r.reasons.includes('SESSION_NOT_CAIRO_TODAY'));
});
