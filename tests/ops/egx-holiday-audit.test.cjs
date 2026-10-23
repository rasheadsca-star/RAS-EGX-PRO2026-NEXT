'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {audit}=require('../../scripts/ops/audit-egx-holidays.cjs');
const closed={closures:[{date:'2026-10-08',status:'confirmed_exchange_closure',source:'exchange_notice'}]};
test('retrospective closure excludes misclassified trading day',()=>{const r=audit({sessions:['2026-10-06','2026-10-08','2026-10-11']},closed);assert.equal(r.pass,false);assert.deepEqual(r.quarantinedDates,['2026-10-08']);assert.equal(r.eligibleSessionCount,2);});
test('no holiday inferred from original commemorative date',()=>{const r=audit({sessions:['2026-10-06','2026-10-11']},closed);assert.equal(r.pass,true);});
test('unconfirmed government holiday does not suppress a session',()=>{const r=audit({sessions:['2026-10-08']},{closures:[{date:'2026-10-08',status:'pending_exchange_confirmation'}]});assert.equal(r.pass,true);});
test('verified closures require sources',()=>assert.throws(()=>audit({sessions:[]},{closures:[{date:'2026-10-08',status:'confirmed_exchange_closure'}]})));
