'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {buildLocalSnapshot}=require('../../gann-fusion-x/scripts/sync-sepa.cjs');
const {scanLegacyDependencies}=require('../../astra/certification/legacy-isolation.cjs');
const root=path.resolve(__dirname,'../..');

function fixture(){
  const history=[];
  for(let i=0;i<253;i++){
    const d=new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);
    history.push({sessionDate:d,open:100,high:102,low:99,close:101,volume:1000000,validationStatus:'VALID',migrationValidationStatus:'VALID'});
  }
  return{
    snapshot:{snapshotId:'R06-CUT-FIXTURE',ticker:'__MARKET__',sessionDate:'2026-09-15',validationStatus:'VALID',migrationValidationStatus:'VALID'},
    history,
    regimeContext:{regime:'SIDEWAYS'},
    candidates:[
      {symbol:'AAA',status:'NEAR PIVOT',entry_readiness_score:90,final_score:77.4,eligibleForTop:false},
      {symbol:'BBB',status:'FORMING',vcp:{score:60},entry_readiness_score:55,final_score:82,eligibleForTop:false}
    ]
  };
}

test('R06 cut uses local internal SEPA execution with no external API',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'r06-'));
  const file=path.join(dir,'input.json');
  fs.writeFileSync(file,JSON.stringify(fixture()));
  const out=buildLocalSnapshot(file,'2026-09-15T20:00:00Z');
  assert.equal(out.meta.mode,'INTERNAL_LOCAL');
  assert.equal(out.meta.source,'ASTRA_INTERNAL_SEPA_QVUA');
  assert.equal(out.rows[0].symbol,'AAA');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('R06 missing local input fails closed without network fallback',()=>{
  const out=buildLocalSnapshot(path.join(os.tmpdir(),'definitely-missing-sepa-local-input.json'),'2026-09-15T20:00:00Z');
  assert.equal(out.meta.mode,'INTERNAL_LOCAL_DISCONNECTED');
  assert.equal(out.meta.reason,'SEPA_LOCAL_INPUT_MISSING');
  assert.deepEqual(out.rows,[]);
});

test('R06 sync source contains no remote SEPA host or network primitive',()=>{
  const src=fs.readFileSync(path.join(root,'gann-fusion-x/scripts/sync-sepa.cjs'),'utf8');
  for(const token of ['sepax-strategy-stable.vercel.app','fetch(','http.request','https.request'])assert.equal(src.includes(token),false,token);
});

test('R06 remains absent from cumulative G12 scan as later dependencies close',()=>{
  const x=scanLegacyDependencies(root);
  assert.equal(x.dependencyIds.includes('R06_SEPA_X_STABLE_API'),false);
  assert.ok(x.runtimeLegacyDependencyCount<=2);
});
