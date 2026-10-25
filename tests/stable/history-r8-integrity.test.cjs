'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {capture,verify}=require('../../scripts/stable/history-r8-integrity.cjs');
const day='2026-10-25';
const assessment={sourceEligible:true,expectedSession:day,manifest:[{ticker:'MIPH'}],rejected:new Map()};
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'history-r8-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'data/history');fs.mkdirSync(dir,{recursive:true});
 const prior={date:'2026-10-22',close:742.36},current={date:day,close:683.5};
 const write=(name,rows,extra={})=>fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify({sessions:rows,...extra}));
 write('MIPH',[prior,current]);write('FAIT',[{date:'2026-10-22',close:43.31}]);
 const affected=new Set(['MIPH']);
 const baseline=capture({root,expectedSession:day,affectedTickers:affected,assessment});
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

test('R11 rejects changing affected set at verification even if file bytes changed',t=>{
 const f=fixture(t);f.write('FAIT',[{date:'2026-10-22',close:43.31}],{staleData:true});
 assert.throws(()=>verify({root:f.root,baseline:f.baseline,affectedTickers:new Set(['MIPH','FAIT'])}),/AFFECTED_SET_CHANGED/);
 assert.throws(()=>verify({root:f.root,baseline:f.baseline,affectedTickers:new Set(['MIPH','FAIT','OTHER'])}),/AFFECTED_SET_CHANGED/);
});
test('R12 checks lowercase files, backups, nested files and dot triggers',t=>{
 for(const relative of ['miph.json','MIPH.json.bak','nested/MIPH.json','.v169-target-audit-trigger']){
  const f=fixture(t),file=path.join(f.root,'data/history',relative);
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'new');
  assert.throws(()=>verify({root:f.root,baseline:f.baseline,affectedTickers:f.affected}),/HISTORY_FILESET_CHANGED/);
 }
});
test('R12 catches modified preexisting nonstandard nested and dot files',t=>{
 const f=fixture(t),dir=path.join(f.root,'data/history');
 fs.mkdirSync(path.join(dir,'nested'));fs.writeFileSync(path.join(dir,'nested/other.txt'),'original');
 fs.writeFileSync(path.join(dir,'.v169-target-audit-trigger'),'original');
 const baseline=capture({root:f.root,expectedSession:day,affectedTickers:f.affected,assessment});
 fs.writeFileSync(path.join(dir,'nested/other.txt'),'mutated');
 assert.throws(()=>verify({root:f.root,baseline,affectedTickers:f.affected}),/UNAFFECTED_HISTORY_FILE_CHANGED/);
 fs.writeFileSync(path.join(dir,'nested/other.txt'),'original');
 fs.writeFileSync(path.join(dir,'.v169-target-audit-trigger'),'mutated');
 assert.throws(()=>verify({root:f.root,baseline,affectedTickers:f.affected}),/UNAFFECTED_HISTORY_FILE_CHANGED/);
});
test('R13 future-dated added candle on affected ticker is rejected',t=>{
 const f=fixture(t);f.write('MIPH',[f.prior,f.current,{date:'2026-10-26',close:700}]);
 assert.throws(()=>verify({root:f.root,baseline:f.baseline,affectedTickers:f.affected}),/FUTURE_SESSIONS_CHANGED/);
});
test('R8 rejects invalid expectedSession and altered schema',t=>{
 const f=fixture(t);
 assert.throws(()=>capture({root:f.root,expectedSession:'2026-02-30',affectedTickers:f.affected,assessment}),/INVALID_HISTORY_BASELINE_ARGS/);
 assert.throws(()=>verify({root:f.root,baseline:{...f.baseline,schemaVersion:1},affectedTickers:f.affected}),/INVALID_HISTORY_BASELINE/);
});
test('R8 protects prior sessions whose only date field is sessionDate',t=>{
 const f=fixture(t),before={sessionDate:'2026-10-22',close:742.36};
 f.write('MIPH',[before,f.current]);
 const baseline=capture({root:f.root,expectedSession:day,affectedTickers:f.affected,assessment});
 f.write('MIPH',[{...before,close:740},f.current]);
 assert.throws(()=>verify({root:f.root,baseline,affectedTickers:f.affected}),/PREVIOUS_SESSIONS_CHANGED/);
});

test('R16 rejects symlink replacing untouched file and symlinked directory',t=>{
 const f=fixture(t),dir=path.join(f.root,'data/history');
 const outside=path.join(f.root,'outside.json');fs.writeFileSync(outside,JSON.stringify({sessions:[]}));
 fs.rmSync(path.join(dir,'FAIT.json'));fs.symlinkSync(outside,path.join(dir,'FAIT.json'));
 assert.throws(()=>verify({root:f.root,baseline:f.baseline,affectedTickers:f.affected}),/HISTORY_SYMLINK_FORBIDDEN/);
 const g=fixture(t),gdir=path.join(g.root,'data/history');
 fs.symlinkSync(g.root,path.join(gdir,'linkdir'),'dir');
 assert.throws(()=>verify({root:g.root,baseline:g.baseline,affectedTickers:g.affected}),/HISTORY_SYMLINK_FORBIDDEN/);
});
test('R17 denies absent ticker in affected set and unapproved expansion at capture',t=>{
 const f=fixture(t);
 assert.throws(()=>capture({root:f.root,expectedSession:day,affectedTickers:new Set(['MIPH','GHOST']),
  assessment:{...assessment,manifest:[{ticker:'MIPH'},{ticker:'GHOST'}]}}),/AFFECTED_TICKER_HISTORY_MISSING/);
 assert.throws(()=>capture({root:f.root,expectedSession:day,affectedTickers:new Set(['MIPH','FAIT']),assessment}),/UNAUTHORIZED_AFFECTED_SET/);
 assert.throws(()=>capture({root:f.root,expectedSession:day,affectedTickers:new Set(['MIPH'])}),/AFFECTED_ASSESSMENT_REQUIRED/);
});

test('R18 rejected ticker without target candle stays byte-protected and cannot be marked affected',t=>{
 const f=fixture(t),assessmentWithReject={...assessment,rejected:new Map([['FAIT','REPORTED_CHANGE_MISMATCH']])};
 assert.throws(()=>capture({root:f.root,expectedSession:day,affectedTickers:new Set(['MIPH','FAIT']),
   assessment:assessmentWithReject}),/UNAUTHORIZED_AFFECTED_SET/);
 const baseline=capture({root:f.root,expectedSession:day,affectedTickers:new Set(['MIPH']),assessment:assessmentWithReject});
 f.write('FAIT',[{date:'2026-10-22',close:43.31}],{staleData:true});
 assert.throws(()=>verify({root:f.root,baseline,affectedTickers:new Set(['MIPH'])}),/UNAFFECTED_HISTORY_FILE_CHANGED/);
});
test('R18 rejected ticker with exact removable candle must join affected set',t=>{
 const f=fixture(t),assessmentWithReject={...assessment,rejected:new Map([['FAIT','REPORTED_CHANGE_MISMATCH']])};
 f.write('FAIT',[{date:'2026-10-22',close:43.31},{date:day,source:'v16_session_aware_price_truth',close:42}]);
 assert.throws(()=>capture({root:f.root,expectedSession:day,affectedTickers:new Set(['MIPH']),assessment:assessmentWithReject}),/UNAUTHORIZED_AFFECTED_SET/);
 const base=capture({root:f.root,expectedSession:day,affectedTickers:new Set(['MIPH','FAIT']),assessment:assessmentWithReject});
 assert.deepEqual(base.affected,['FAIT','MIPH']);
});
