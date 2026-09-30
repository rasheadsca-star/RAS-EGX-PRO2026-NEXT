'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('legacy mobile hotfix cannot overwrite canonical V16 scan status', () => {
  const workflow = read('.github/workflows/mobile-hotfix-deploy.yml');
  assert.doesNotMatch(
    workflow,
    /writeFileSync\(['"]data\/stable\/v16-immediate-scan-status\.json['"]/,
    'legacy workflow must not write the canonical scan-status file',
  );
  assert.match(
    workflow,
    /data\/stable\/v16-mobile-hotfix-scan-status\.json/,
    'legacy workflow must use its isolated sidecar status file',
  );
});

test('governance preserves published state when a non-canonical writer omits fields', () => {
  const governance = read('scripts/stable/v16-main-app-governance.cjs');
  assert.match(governance, /const previousSnapshot = readJson\(FILES\.snapshot, \{\}\);/);
  assert.match(governance, /typeof scanStatus\.final === 'boolean'/);
  assert.match(governance, /previousSnapshot\?\.scanCycle\?\.final === true/);
  assert.match(governance, /typeof scanStatus\.pagesPublished === 'boolean'/);
  assert.match(governance, /previousSnapshot\?\.scanCycle\?\.pagesPublished === true/);
});

test('market-data health is independent from production recommendation count', () => {
  const governance = read('scripts/stable/v16-main-app-governance.cjs');
  assert.match(governance, /const marketDataHealth = \(!sessionAligned \|\| !executionGrade \|\| !sourceSessionReady\)/);
  assert.match(governance, /const modelProductionHealth = recommendations\.length >= 3/);
  assert.match(governance, /researchCandidateCount: researchCandidates\.length/);
  assert.match(governance, /productionGateBlockers/);
});
