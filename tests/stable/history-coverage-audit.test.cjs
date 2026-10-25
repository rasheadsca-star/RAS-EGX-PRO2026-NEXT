'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {audit}=require('../../scripts/stable/history-coverage-audit.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-coverage-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'data/stable'),{recursive:true});fs.mkdirSync(path.join(root,'data/history'),{recursive:true});
 const report={expectedSession:'2026-10-25',source:{inputRows:3},acceptedRows:2,rejectedRows:1,droppedRows:0,
  updatedHistoryFiles:1,missingHistoryFiles:['BONY']};
 fs.writeFileSync(path.join(root,'data/stable/v15-price-truth.json'),JSON.stringify(report));
 fs.writeFileSync(path.join(root,'data/history/MIPH.json'),JSON.stringify({sessions:[{date:'2026-10-22',close:1}]}));
 return {root,report};
}
test('missing ticker yields a source-required gap, never a fabricated history',t=>{
 const {root}=fixture(t),result=audit({root});
 assert.equal(result.gaps[0].ticker,'BONY');assert.equal(result.missingHistoryCount,1);
 assert.equal(result.executionReady,false);assert.equal(fs.existsSync(path.join(root,'data/history/BONY.json')),false);
 assert.equal(result.writtenDeficit,199);
});
test('report row totals and split must conserve exact counts',t=>{
 const {root,report}=fixture(t);report.updatedHistoryFiles=2;
 fs.writeFileSync(path.join(root,'data/stable/v15-price-truth.json'),JSON.stringify(report));
 assert.throws(()=>audit({root}),/COVERAGE_WRITTEN_MISSING_MISMATCH/);
});
test('suddenly existing previously missing file must be independently reclassified',t=>{
 const {root}=fixture(t);fs.writeFileSync(path.join(root,'data/history/BONY.json'),JSON.stringify({sessions:[]}));
 assert.deepEqual(audit({root}).unexpectedlyPresent,['BONY']);
});
test('broken existing history is explicitly reported, not silently skipped',t=>{
 const {root}=fixture(t);fs.writeFileSync(path.join(root,'data/history/MIPH.json'),'{invalid');
 assert.deepEqual(audit({root}).malformedHistoryFiles,['MIPH.json']);
});
