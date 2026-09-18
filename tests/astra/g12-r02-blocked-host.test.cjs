'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const boot=require('../../v18-live/bootstrap.js');

test('R02 parity: blocked CDN does not matter when local replacement is healthy',async()=>{
  const calls=[];let navigated=null,written=false,status='';
  const result=await boot.resolve({
    fetchFn:async url=>{
      calls.push(url);
      if(url===boot.R02_FALLBACK)throw new Error('HOST_BLOCKED');
      return{ok:true,status:200,text:async()=>'<title>Astra Local Decision Surface</title>'};
    },
    navigate:url=>{navigated=url},
    writeHtml:()=>{written=true},
    setStatus:value=>{status=value}
  });
  assert.equal(result,'LOCAL');
  assert.equal(navigated,boot.LOCAL);
  assert.equal(written,false);
  assert.deepEqual(calls,[boot.LOCAL]);
  assert.equal(calls.includes(boot.R02_FALLBACK),false);
  assert.equal(status,'');
});

test('R02 remains an explicit fallback before its cut step',async()=>{
  const calls=[];let written='';
  const result=await boot.resolve({
    fetchFn:async url=>{
      calls.push(url);
      if(url===boot.LOCAL)throw new Error('LOCAL_BLOCKED');
      return{ok:true,status:200,text:async()=>'<html>legacy fallback</html>'};
    },
    navigate:()=>{},
    writeHtml:html=>{written=html},
    setStatus:()=>{}
  });
  assert.equal(result,'R02_FALLBACK');
  assert.deepEqual(calls,[boot.LOCAL,boot.R02_FALLBACK]);
  assert.match(written,/legacy fallback/);
});
