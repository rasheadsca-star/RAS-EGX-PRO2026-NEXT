'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const root=path.resolve(__dirname,'../..');
const manifest=require('../../docs/astra/G12_R08_VENDOR_MANIFEST.json');

function gitBlobSha(bytes){
  return crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');
}

test('R08 vendors the complete pinned SEPA source tree source-exactly',()=>{
  assert.equal(manifest.sourceCommit,'bf63dc85f515e58a7be1c6de6633eed87228a021');
  assert.equal(manifest.fileCount,80);
  assert.equal(manifest.sourceExactGitBlobs,true);
  for(const row of manifest.files){
    const file=path.join(root,row.targetPath);
    assert.equal(fs.existsSync(file),true,row.targetPath);
    const bytes=fs.readFileSync(file);
    assert.equal(bytes.length,row.size,row.targetPath+':size');
    assert.equal(gitBlobSha(bytes),row.blobSha,row.targetPath+':blob');
  }
});

test('R08 vendored SEPA engine/config match the strategy registry pin',()=>{
  const matrix=require('../../docs/astra/STRATEGY_RECONSTRUCTION_MATRIX.json');
  const strategy=matrix.strategies.find(x=>x.strategyId==='SEPA_QVUA_NEAR_FIRST_THEN_FORMING');
  assert.equal(strategy.sourceCommit,'bf63dc85f515e58a7be1c6de6633eed87228a021');
  const engine=manifest.files.find(x=>x.sourcePath==='sepa-x/src/engine.js');
  const config=manifest.files.find(x=>x.sourcePath==='sepa-x/src/config.js');
  assert.ok(engine&&config);
  assert.equal(engine.blobSha,'5d70520e2fd376d70bd428a070df8c2e0bdb636c');
  assert.equal(config.blobSha,'79005e91f28d5427a5014831bdcfa45a5eaad8dd');
});
