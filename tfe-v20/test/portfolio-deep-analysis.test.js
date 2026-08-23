import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const deep=readFileSync(new URL('../public/portfolio-deep-analysis.js',import.meta.url),'utf8');
const wrapper=readFileSync(new URL('../public/portfolio-manager.js',import.meta.url),'utf8');
const core=readFileSync(new URL('../public/portfolio-manager-core.js',import.meta.url));

function gitBlobSha(buffer){
  const header=Buffer.from(`blob ${buffer.length}\0`);
  return createHash('sha1').update(header).update(buffer).digest('hex');
}

test('wrapper preserves original portfolio manager and loads deep display module',()=>{
  assert.match(wrapper,/export \* from '\.\/portfolio-manager-core\.js/);
  assert.match(wrapper,/import '\.\/portfolio-deep-analysis\.js/);
  assert.equal(gitBlobSha(core),'c22a8f8e7c3c4291fd2ea0fb42af432d008ea947');
});

test('deep portfolio layer is read-only and cannot import Alpha or enable execution',()=>{
  assert.match(deep,/egx-tfe-rc2-v169-eod-manager/);
  assert.match(deep,/route,\.\.\.params/);
  assert.equal(/src\/(engine|policy|confidence|originalScore|originalIndicators|repository)/.test(deep),false);
  assert.equal(/executionAllowed\s*[:=]\s*true/i.test(deep),false);
  assert.equal(/automaticOrders\s*[:=]\s*true/i.test(deep),false);
});

test('deep portfolio layer includes charts Fibonacci and walk-forward horizons',()=>{
  assert.match(deep,/Fibonacci/);
  assert.match(deep,/EMA20/);
  assert.match(deep,/MACD/);
  assert.match(deep,/Walk‑Forward|Walk-Forward/);
  assert.match(deep,/horizon\(1\)/);
  assert.match(deep,/horizon\(3\)/);
  assert.match(deep,/horizon\(5\)/);
  assert.match(deep,/portfolioDeepAnalysis/);
});
