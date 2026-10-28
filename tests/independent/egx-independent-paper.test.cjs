'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluate,validBar}=require('../../scripts/independent/egx-independent-paper.cjs');
const session='2026-10-27';
const sample=Array.from({length:61},(_,i)=>({date:i===60?session:'2026-08-'+String((i%28)+1).padStart(2,'0'),
 sourceSessionDate:i===60?session:'2026-08-'+String((i%28)+1).padStart(2,'0'),
 open:100+i,high:102+i,low:99+i,close:101+i,volume:20000,
 validationStatus:'precise_public_source_session_confirmed'}));
function run(changes={}){
 return evaluate({session,price:{expectedSession:session,ready:true,executionGrade:true,acceptedRows:190,sampleAccepted:[{ticker:'TEST'}]},
 handoff:{sessionDate:session,acceptedRows:190},symbols:[{ticker:'TEST',active:true}],
 loadHistory:()=>({symbolVerified:true,isin:'EG0000000000',sessions:sample}),...changes});
}
test('failed fresh source cannot release stale or inferred paper recommendations',()=>{
 const x=run({price:{expectedSession:session,ready:false,executionGrade:false,acceptedRows:0}});
 assert.equal(x.status,'BLOCKED');assert.deepEqual(x.recommendations,[]);assert.deepEqual(x.watchlist,[]);
});
test('handoff mismatch blocks execution',()=>{
 const x=run({handoff:{sessionDate:session,acceptedRows:189}});assert.ok(x.blockers.includes('HANDOFF_NOT_ALIGNED'));
});
test('suspicious reconstructed bar is rejected',()=>{
 assert.equal(validBar({...sample.at(-1),warnings:['partial_ohlc_reconstructed_from_close_or_previous_close']},session),false);
});
test('valid data may create research candidates but never executable recommendations',()=>{
 const x=run();assert.equal(x.executable,false);assert.equal(x.recommendations.length,0);
 assert.equal(x.status,'RESEARCH_READY_PAPER_VALIDATION_REQUIRED');
 assert.ok(x.blockers.includes('NO_INDEPENDENT_OUT_OF_SAMPLE_PERFORMANCE_CERTIFICATION'));
});
