'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {scanLegacyDependencies}=require('../../astra/certification/legacy-isolation.cjs');
const root=path.resolve(__dirname,'../..');

test('R07 legacy Vercel proxy and Raw technical loader are absent',()=>{
  const files=['deploy/rc2-safe-shell/index.html','deploy/rc2-safe-shell/vercel.json','deploy/rc2-safe-shell/api/index.js'];
  const text=files.map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');
  assert.doesNotMatch(text,/egx-tfe-v20-fusion-rc2[^\s"'\`]*\.vercel\.app/i);
  assert.doesNotMatch(text,/raw\.githubusercontent\.com/i);
  assert.doesNotMatch(text,/<iframe\b/i);
  assert.equal(fs.existsSync(path.join(root,'deploy/rc2-safe-shell/api/_proxy.js')),false);
  assert.equal(fs.existsSync(path.join(root,'deploy/rc2-safe-shell/api/technical.js')),false);
});
test('R07 remains absent from cumulative G12 scan as R08 closes',()=>{
  const x=scanLegacyDependencies(root);
  assert.equal(x.dependencyIds.includes('R07_RC2_VERCEL_PROXY'),false);
  assert.ok(x.runtimeLegacyDependencyCount<=1);
});
