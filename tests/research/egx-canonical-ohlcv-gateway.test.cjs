'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {enforceCentralGate}=require('../../scripts/research/egx-canonical-ohlcv-gateway.cjs');
test('quarantine cannot enter executable OHLCV stream',()=>assert.equal(enforceCentralGate({centralEvidence:{quarantineOnly:true},canUseCentralForExecutableBacktest:false}).allowed,false));
test('missing report fails closed',()=>assert.equal(enforceCentralGate(null).allowed,false));

test('zero-volume candles keep chronological reference but cannot be filled',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {build}=require('../../scripts/research/egx-canonical-ohlcv-gateway.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'egx-ohlcv-'));
 try{
  fs.mkdirSync(path.join(dir,'data','history'),{recursive:true});
  fs.writeFileSync(path.join(dir,'data','egx-exchange-closures.json'),JSON.stringify({closures:[]}));
  const dates=[];for(let d=new Date('2026-01-04T12:00:00Z');dates.length<66;d.setUTCDate(d.getUTCDate()+1)){if(d.getUTCDay()!==5&&d.getUTCDay()!==6)dates.push(d.toISOString().slice(0,10))}
  const sessions=dates.map((date,i)=>({date,open:10,high:11,low:9,close:10,volume:i===34?0:100}));
  fs.writeFileSync(path.join(dir,'data','history','TEST.json'),JSON.stringify({ticker:'TEST',sessions}));
  const out=build(dir);assert.equal(out.audit.zeroVolumeReferenceBars,1);
  assert.equal(out.universe.TEST.length,66);assert.equal(out.universe.TEST[34].executable,false);
  assert.equal(out.universe.TEST[35].executable,true);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
