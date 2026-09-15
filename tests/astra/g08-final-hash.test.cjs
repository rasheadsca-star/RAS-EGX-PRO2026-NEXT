'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const{executeStrategy,crossSectionIdentity}=require('../../astra/strategies/g08-final-overlay.cjs');
function history(n=260){return Array.from({length:n},(_,i)=>({sessionDate:`2026-${String(1+Math.floor(i/28)).padStart(2,'0')}-${String(1+i%28).padStart(2,'0')}`,close:100+i*.1,volume:1000000+i,validationStatus:'VALID',migrationValidationStatus:'VALID'}))}
function base(){return{snapshot:{snapshotId:'HASH',ticker:'COMI',sessionDate:'2026-09-15',validationStatus:'VALID',migrationValidationStatus:'VALID'},history:history()}}
function sessions(count=50,size=60){return Array.from({length:count},(_,d)=>Array.from({length:size},(_,i)=>({ticker:`T${i}`,xNew:[1,(i-size/2)/size,(d%5)/5],yTop10:i<10?1:0,yNetPositive:(i+d)%2===0?1:0,yLargeLoss:(i+d)%17===0?1:0})))}
function current(size=60){return Array.from({length:size},(_,i)=>({ticker:`T${i}`,xNew:[1,(i-size/2)/size,.4],momentumFailureRisk:.1,effectiveSupport:1,turnover20:30000000,rsi14:60,ret20:10,ret5:2,breakout20:0,atr14:2,close:100+i*.1}))}
test('cross-sectional identity is deterministic',()=>{const x=base();x.trainingSessions=sessions();x.currentRows=current();assert.equal(crossSectionIdentity(x),crossSectionIdentity(structuredClone(x)))});
test('V16 execution hash binds exact cross-sectional training identity',()=>{const x=base();x.trainingSessions=sessions();x.currentRows=current();const a=executeStrategy('V16_TWO_STAGE_TOP_GAINER',x),same=executeStrategy('V16_TWO_STAGE_TOP_GAINER',structuredClone(x));assert.equal(a.executionHash,same.executionHash);const y=structuredClone(x);y.trainingSessions[0][0].xNew[1]+=0.000001;const b=executeStrategy('V16_TWO_STAGE_TOP_GAINER',y);assert.notEqual(a.executionHash,b.executionHash)});
