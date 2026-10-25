'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {triage}=require('../../scripts/stable/history-legacy-candidate-triage.cjs');
test('legacy candidates with invalid OHLC never qualify',()=>{
 const source={symbols:{BONY:[{date:'2026-07-02',open:4.78,high:4.93,low:4.8,close:4.88,volume:5929934}],
 KRDI:[{date:'2026-07-02',open:.34,high:.35,low:.34,close:.34,volume:19477896}]}};
 const r=triage({missing:['BONY','KRDI','ACTF'],source});
 assert.equal(r[0].status,'REVIEW_INVALID_CANDLES');
 assert.equal(r[1].status,'STRUCTURAL_CANDIDATE_ONLY');
 assert.deepEqual(r[1].dates,['2026-07-02']);
 assert.equal(r[2].status,'NO_SOURCE_CANDIDATE');
});
test('future fake or ill-formed date is rejected',()=>{
 const row={date:'not-a-date',open:10,high:11,low:9,close:10,volume:4};
 assert.equal(triage({missing:['X'],source:{symbols:{X:[row]}}})[0].validCount,0);
});

test('historical .CA alias is recognized without inventing a current ticker series',()=>{
 const row={date:'2026-07-02',open:10,high:11,low:9,close:10,volume:40};
 const onlySuffix=triage({missing:['ACTF'],source:{symbols:{'ACTF.CA':[row]}}});
 assert.equal(onlySuffix[0].status,'STRUCTURAL_CANDIDATE_ONLY');
 assert.equal(onlySuffix[0].resolvedSymbol,'ACTF.CA');
 const aliasCollision=triage({missing:['ACTF'],source:{symbols:{ACTF:[row],'ACTF.CA':[row]}}});
 assert.equal(aliasCollision[0].status,'AMBIGUOUS_SYMBOL_ALIAS');
 const emptyAlias=triage({missing:['ACTF'],source:{symbols:{'ACTF.CA':[]}}});
 assert.equal(emptyAlias[0].status,'NO_SOURCE_CANDIDATE');
});
