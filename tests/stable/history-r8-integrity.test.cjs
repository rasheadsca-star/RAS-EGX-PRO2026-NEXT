'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {capture,verify}=require('../../scripts/stable/history-r8-integrity.cjs');
const day='2026-10-25';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'history-r8-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'data/history');fs.mkdirSync(dir,{recursive:true});
 const prior={date:'2026-10-22',close:742.36},current={date:day,close:683.5};
 const write=(name,rows,extra={})=>fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify({sessions:rows,...extra}));
 write('MIPH',[prior,current]);write('FAIT',[{date:'2026-10-22',close:43.31}]);
 const affected=new Set(['MIPH']);
 const baseline=capture({root,expectedSession:day,affectedTickers:affected});
 return {root,write,prior,current,affected,baseline};
}
test('R8 accepts unchanged snapshot and legitimate current-session change of affected ticker',t=>{
 const f=fixture(t);f.write('MIPH',[f.prior,{...f.current,close:690}]);
 assert.equal(verify({root:f.root,baseline:f.baseline,affectedTickers:f.affected}).verifiedFiles,2);
});
test('R8 blocks changed prior session even on an affected ticker',t=>{
 const f=fixture(t);f.write('MIPH',[{...f.prior,close:740},f.current]);
 assert.throws(()=>verify({root:f.root,baseline:f.baseline,affectedTickers:f.affected}),/PREVIOUS_SESSIONS_CHANGED/);
});
test('R8 blocks any byte change in unaffected file',t=>{
 const f=fixture(t);f.write('FAIT',[{date:'2026-10-22',close:43.31}],{staleData:true});
 assert.throws(()=>verify({root:f.root,baseline:f.baseline,affectedTickers:f.affected}),/UNAFFECTED_HISTORY_FILE_CHANGED/);
});
test('R8 blocks missing or newly added files',t=>{
 const f=fixture(t);fs.rmSync(path.join(f.root,'data/history/FAIT.json'));
 assert.throws(()=>verify({root:f.root,baseline:f.baseline,affectedTickers:f.affected}),/HISTORY_FILESET_CHANGED/);
 const g=fixture(t);g.write('NEW',[{date:day,close:10}]);
 assert.throws(()=>verify({root:g.root,baseline:g.baseline,affectedTickers:g.affected}),/HISTORY_FILESET_CHANGED/);
});
test('R8 blocks malformed historical JSON',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'data/history/MIPH.json'),'{bad');
 assert.throws(()=>verify({root:f.root,baseline:f.baseline,affectedTickers:f.affected}));
});
