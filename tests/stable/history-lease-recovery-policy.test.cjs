'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessRecovery}=require('../../scripts/stable/history-lease-recovery-policy.cjs');
const own='a'.repeat(40),other='b'.repeat(40);
const base={expectedOwnerSha:own,runState:'TERMINATED_CONFIRMED',publicationState:'NOT_STARTED'};
test('missing lease must not authorize restoring or acquiring on behalf of previous owner',()=>{
 const x=assessRecovery({...base,readRef:()=>null});assert.equal(x.action,'STOP');
});
test('changed owner cannot be released or recovered by stale owner',()=>{
 const x=assessRecovery({...base,readRef:()=>other});assert.equal(x.reason,'LEASE_OWNED_BY_DIFFERENT_COMMIT');
});
test('living owner means wait, not lock theft',()=>{
 const x=assessRecovery({...base,readRef:()=>own,runState:'RUNNING'});assert.equal(x.action,'WAIT');
});
test('unknown termination fails closed',()=>{
 const x=assessRecovery({...base,readRef:()=>own,runState:'UNKNOWN'});assert.equal(x.action,'STOP');
});
test('uncertain publication blocks attempted recovery even with confirmed termination',()=>{
 const x=assessRecovery({...base,readRef:()=>own,publicationState:'PUBLISH_UNCERTAIN'});
 assert.equal(x.reason,'REMOTE_PUBLICATION_RECONCILIATION_REQUIRED');
});
test('confirmed termination with no publication is manual review, never auto release',()=>{
 const x=assessRecovery({...base,readRef:()=>own});assert.equal(x.action,'MANUAL_REVIEW');
 assert.equal(x.reason,'OWNER_TERMINATED_BUT_PERSISTENT_JOURNAL_REQUIRED');
});
