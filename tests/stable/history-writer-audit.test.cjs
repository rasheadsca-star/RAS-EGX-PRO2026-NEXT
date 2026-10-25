'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {scan,assertSafe}=require('../../scripts/stable/history-writer-audit.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-workflows-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'.github/workflows');fs.mkdirSync(dir,{recursive:true});
 return {root,dir,write:(name,contents)=>fs.writeFileSync(path.join(dir,name+'.yml'),contents)};
}
test('unsafe optimistic rebase is an explicit publication blocker',t=>{
 const f=fixture(t);f.write('danger','run: git pull --rebase -X ours origin main && git push');
 assert.deepEqual(scan({root:f.root}).active.map(x=>x.id),['OURS_REBASE']);
 assert.throws(()=>assertSafe(f.root),/HISTORY_WRITER_COVERAGE_UNPROVEN/);
});
test('direct and indirect history producer invocations are surfaced',t=>{
 const f=fixture(t);f.write('live','run: node scripts/stable/v15-live-price-truth.cjs');
 f.write('import','run: node scripts/history/history-storage.cjs');
 assert.equal(scan({root:f.root}).active.filter(x=>x.id==='HISTORY_SCRIPT').length,2);
});
test('history path writers surfaced and clean workflows allowed',t=>{
 const f=fixture(t);f.write('clean','run: echo hello');
 assert.equal(assertSafe(f.root).clear,true);
 f.write('history','run: git add data/history/');
 assert.equal(scan({root:f.root}).clear,false);
});
