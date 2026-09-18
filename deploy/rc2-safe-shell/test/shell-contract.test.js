import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);

test('shell is local-only and contains no iframe/core proxy',async()=>{
  const html=await readFile(new URL('index.html',root),'utf8');
  assert.doesNotMatch(html,/<iframe\b/i);
  assert.doesNotMatch(html,/\/core\//);
  assert.doesNotMatch(html,/vercel\.app|raw\.githubusercontent\.com/i);
  assert.match(html,/\/api\/index\?route=health/);
});
test('vercel config contains no remote rewrites',async()=>{
  const text=await readFile(new URL('vercel.json',root),'utf8');
  assert.doesNotMatch(text,/rewrites/i);
  assert.doesNotMatch(text,/vercel\.app|raw\.githubusercontent\.com/i);
});
test('technical asset is served locally as a static module',async()=>{
  const js=await readFile(new URL('technical-analysis-tools.js',root),'utf8');
  assert.match(js,/TECHNICAL_VISUALIZATION_CONTRACT/);
});
