import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler, { runtimeSourceCommit } from '../api/index.js';
import { DATA_SOURCES } from '../src/repository.js';

function makeRes() {
  const headers = new Map();
  return {
    statusCode: 0,
    body: '',
    setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    end(value = '') { this.body = String(value); },
    headers,
  };
}

test('health exposes real runtime commit provenance when Vercel SHA is present', async () => {
  const before = process.env.VERCEL_GIT_COMMIT_SHA;
  process.env.VERCEL_GIT_COMMIT_SHA = 'abc123-review-sha';
  try {
    const res = makeRes();
    await handler({ url: '/api/index?route=health', headers: { host: 'localhost' } }, res);
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(runtimeSourceCommit(), 'abc123-review-sha');
    assert.equal(res.getHeader('x-tfe-source-commit'), 'abc123-review-sha');
    assert.equal(body.sourceCommit, 'abc123-review-sha');
    assert.equal(body.policy.permissions.executionAllowed, false);
  } finally {
    if (before === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = before;
  }
});

test('unexpected API exceptions never expose stack traces to clients', async () => {
  const res = makeRes();
  const original = console.error;
  console.error = () => {};
  try {
    await handler({ url: '/api/index?route=health', headers: { host: '[' } }, res);
  } finally {
    console.error = original;
  }
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 500);
  assert.equal(body.error, 'INTERNAL_SERVER_ERROR');
  assert.doesNotMatch(res.body, /at\s+\S+\s+\(|api\/index\.js|src\//i);
});

test('Alpha market history and overlays have explicit separate source branches', () => {
  assert.equal(DATA_SOURCES.alphaDataBranch, 'main');
  assert.equal(DATA_SOURCES.overlayBranch, 'develop/v20-integrated-decision-platform');
  assert.equal(DATA_SOURCES.cacheTtlMs, 300000);
  assert.equal(DATA_SOURCES.timeoutMs, 10000);
  assert.equal(DATA_SOURCES.retries, 2);
});

test('repository never falls back to overlay branch for Alpha history', () => {
  const source = readFileSync(new URL('../src/repository.js', import.meta.url), 'utf8');
  assert.match(source, /rawUrl\(ALPHA_DATA_BRANCH, `data\/history\/\$\{ticker\}\.json`\)/);
  assert.doesNotMatch(source, /rawUrl\(OVERLAY_BRANCH, `data\/history\//);
  assert.match(source, /TFE-V20-FUSION-RC2/);
});

test('API source has no client response path containing e.stack', () => {
  const source = readFileSync(new URL('../api/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /error\s*:\s*e\.stack/);
  assert.match(source, /error:\s*'INTERNAL_SERVER_ERROR'/);
  assert.match(source, /x-tfe-source-commit/);
});
