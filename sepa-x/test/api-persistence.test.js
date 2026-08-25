import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const api=fs.readFileSync(path.resolve(here,'../api/index.js'),'utf8');

test('production API has persistent GitHub fallbacks for scan, history and research evidence',()=>{
  assert.match(api,/GITHUB_SCAN_URL/);
  assert.match(api,/recommendation-history\.json/);
  assert.match(api,/historical-simulator-summary\.json/);
  assert.match(api,/engine-comparison\.json/);
  assert.match(api,/loadHistory/);
  assert.match(api,/loadHistorical/);
  assert.match(api,/loadComparison/);
  assert.match(api,/GITHUB_BRANCH_SNAPSHOT/);
});

test('review queue remains execution-blocked in the combined opportunities policy',()=>{
  assert.match(api,/reviewQueueExecutionAllowed:false/);
  assert.match(api,/opportunities\/review/);
});
