'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {scanLegacyDependencies}=require('../../astra/certification/legacy-isolation.cjs');
const root=path.resolve(__dirname,'../..');
const files=[
  'scripts/stable/v16-main-app-consensus.cjs',
  'scripts/stable/v16-main-app-v19v6-consensus-enricher.cjs',
  'scripts/stable/v16-main-app-independent-consensus-audit.cjs'
];
test('R03 cut removes every V19 Raw/jsDelivr runtime fetch',()=>{
  const source=files.map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');
  assert.doesNotMatch(source,/v19-egx-chat-gpt/i);
  assert.doesNotMatch(source,/raw\.githubusercontent\.com[^\n]*v19/i);
  assert.doesNotMatch(source,/cdn\.jsdelivr\.net[^\n]*v19/i);
});
test('R03 callers use local G08 contract or archived provenance',()=>{
  const main=fs.readFileSync(path.join(root,files[0]),'utf8');
  const enrich=fs.readFileSync(path.join(root,files[1]),'utf8');
  const audit=fs.readFileSync(path.join(root,files[2]),'utf8');
  assert.match(main,/V19_LOCAL\.pendingState\(\)/);
  assert.match(enrich,/V19_LOCAL\.pendingState\(\)/);
  assert.match(audit,/data\/archive\/v19\/target-stop-audit-v6\.json/);
});
test('R03 disappears from full G12 scan',()=>{
  const x=scanLegacyDependencies(root);
  assert.equal(x.dependencyIds.includes('R03_V19_REMOTE_CHALLENGER'),false);
  assert.ok(x.runtimeLegacyDependencyCount<=5);
});
