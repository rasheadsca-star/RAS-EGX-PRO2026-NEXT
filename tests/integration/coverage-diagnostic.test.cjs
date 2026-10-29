'use strict';const test=require('node:test'),assert=require('node:assert/strict'),{audit}=require('../../scripts/integration/coverage-diagnostic.cjs');
const f=(n=179)=>({expectedSession:'2026-10-28',currentSessionRows:n,inputRows:211,rejectedCurrentSessionRows:211-n});
const h={symbolsComplete100:196,symbolsFailed:37,symbolsCurrentSession:178};
const health={delayed:false};
const mark=(n=179)=>({sessionDate:'2026-10-28',acceptedRows:n});
test('179 accepted cannot pass conditional 190 gate',()=>{const r=audit(f(),h,health,mark());assert.equal(r.counts.conditionalDeficit,11);assert.equal(r.counts.fullTargetDeficit,21);assert.equal(r.productionReady,false)});
test('numbers must reconcile',()=>{const r=audit({...f(190),inputRows:230},h,health,mark(190));assert.equal(r.checks.inputReconciles,false);assert.equal(r.productionReady,false)});
test('delayed source cannot be production ready',()=>assert.equal(audit(f(190),h,{delayed:true},mark(190)).productionReady,false));
test('matched vetted 190 source can clear conditional count, not target',()=>{const r=audit(f(190),h,health,mark(190));assert.equal(r.productionReady,true);assert.equal(r.checks.fullTargetMet,false)});
