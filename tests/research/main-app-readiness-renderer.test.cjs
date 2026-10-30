'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const launcher = fs.readFileSync(path.join(root, 'preview-v16/app/v169-p2.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'preview-v16/app/main-app-professional-readiness-v2.js'), 'utf8');

test('published MAIN APP launcher executes the canonical readiness V2 module', () => {
  assert.match(launcher, /main-app-professional-readiness-v2\.js\?v=\$\{BUILD\}/);
  assert.match(launcher, /\$\{readinessModule\}/);
  assert.doesNotMatch(launcher, /\$\{inlineReadiness\}/);
  assert.match(launcher, /professionalReadinessV2Panel/);
  assert.match(renderer, /v16-main-app-professional-readiness\.json/);
});

test('readiness V2 observer cannot schedule an endless loop from its own render', () => {
  assert.match(renderer, /new MutationObserver\(\(\)=>\{if\(!document\.getElementById\('professionalReadinessV2Panel'\)\)/);
  assert.match(renderer, /if\(window\.__MAIN_APP_PROFESSIONAL_READINESS_V2__\)return/);
  assert.match(renderer, /professionalClaimAllowed/);
  new vm.Script(renderer, {filename:'main-app-professional-readiness-v2.js'});
});

test('readiness module never promotes research signals into orders', () => {
  assert.doesNotMatch(renderer, /\b(?:placeOrder|submitOrder|executeTrade)\s*\(/);
  assert.match(renderer, /Hard Gate غير مكتمل/);
});
