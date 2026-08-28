import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('shell injects the date sidecar into same-origin /core iframe', async()=>{
  const html=await readFile(new URL('index.html',root),'utf8');
  assert.match(html,/src="\/core\/"/);
  assert.match(html,/script\.src = '\/snapshot-date-fix\.js\?v=20260828-safe2'/);
});

test('snapshot sidecar is display-only and does not fetch or rewrite RC2 state', async()=>{
  const js=await readFile(new URL('snapshot-date-fix.js',root),'utf8');
  assert.doesNotMatch(js,/\bfetch\s*\(/);
  assert.doesNotMatch(js,/__RC2_UI_SCAN__\s*=/);
  assert.doesNotMatch(js,/recommendations\s*\.\s*(push|splice|pop|shift|unshift)\s*\(/);
  assert.match(js,/جلسة السوق الحالية:/);
  assert.match(js,/آخر Snapshot توصيات محفوظ:/);
});

test('proxy never points to the mutable production alias', async()=>{
  const js=await readFile(new URL('api/_proxy.js',root),'utf8');
  assert.doesNotMatch(js,/DEFAULT_RC2_ORIGIN\s*=\s*'https:\/\/egx-tfe-v20-fusion-rc2\.vercel\.app'/);
  assert.match(js,/VERCEL_AUTOMATION_BYPASS_SECRET/);
});
