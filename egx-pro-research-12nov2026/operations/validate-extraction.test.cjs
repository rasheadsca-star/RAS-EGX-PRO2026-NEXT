'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildGate}=require('./validate-extraction.cjs');
const good={session:'2026-11-19',sourceSha256:'a'.repeat(64),sourcePages:56,fullTableSequence:true,publicationAllowed:false,rows:[
  {rank:1,name:'Example Issuer',currency:'EGP',referencePrice:10,high:11,low:9,close:10.5,volume:100,valueTraded:1050}
]};
const master={'EGS000000001':{name:'Example Issuer',symbol:'TEST',tickSize:0.01}};
test('official extractor cannot bypass certification even with a locally matching security record',()=>{
 const r=buildGate(good,master,{minRows:1});
 assert.equal(r.verifiedRows,1);
 assert.equal(r.publicationAllowed,false);
 assert(r.errors.includes('SOURCE_EXTRACTOR_NOT_CERTIFIED'));
});
test('missing ISIN master fails closed and reports affected issuer',()=>{
 const r=buildGate(good,{}, {minRows:1});
 assert.equal(r.verifiedRows,0);
 assert.equal(r.identityUnresolvedCount,1);
 assert(r.errors.includes('NO_VERSIONED_SECURITY_MASTER'));
 assert(r.errors.includes('UNRESOLVED_SECURITY_IDENTITIES'));
});
test('ambiguous issuer mapping is never silently resolved',()=>{
 const r=buildGate(good,{...master,'EGS000000002':{name:'Example Issuer',symbol:'TST2',tickSize:0.01}}, {minRows:1});
 assert.equal(r.verifiedRows,0);
 assert.equal(r.identitySamples[0].reason,'AMBIGUOUS_IDENTITY');
});
test('source row rank gaps prevent publication',()=>{
 const r=buildGate({...good,fullTableSequence:false},master,{minRows:1});
 assert(r.errors.includes('INCOMPLETE_SOURCE_RANK_SEQUENCE'));
 assert.equal(r.publicationAllowed,false);
});
test('corrupt close quarantines issuer',()=>{
 const r=buildGate({...good,rows:[{...good.rows[0],close:13}]},master,{minRows:1});
 assert.equal(r.verifiedRows,0);
 assert(r.errors.includes('UNRESOLVED_QUARANTINE'));
});
