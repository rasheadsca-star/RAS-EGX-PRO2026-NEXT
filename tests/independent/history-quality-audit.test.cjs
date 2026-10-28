'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {structural,streak,auditTicker,buildAudit}=require('../../scripts/independent/history-quality-audit.cjs');
const calendar=['2026-10-20','2026-10-21','2026-10-22','2026-10-25','2026-10-26','2026-10-27','2026-10-28'];
const meta={ticker:'TEST',active:true,isin:'EG0000000006',currency:'EGP',exchange:'EGX'};
const bar=(i)=>({date:calendar[i],sourceSessionDate:calendar[i],
 open:100+i,high:102+i,low:99+i,close:101+i,volume:10000,
 validationStatus:'precise_public_source_session_confirmed',
 sourceSessionEvidence:'explicit-dated-volume-confirmation',verifiedBy:['unit_fixture'],
 sourceUrls:{primary:'https://example.org/not-market-data'},fetchedAt:'2026-10-28T17:00:00Z'});
const hist=(sessions)=>({ticker:'TEST',isin:'EG0000000006',currency:'EGP',exchange:'EGX',
 symbolVerified:true,sessions});
const audit=(sessions,actions=[])=>auditTicker('TEST',meta,hist(sessions),calendar,actions,'fixture-sha','2026-10-28');
test('structural permits a numeric partial bar but strict quarantines it',()=>{
 const bars=calendar.map((_,i)=>bar(i));
 bars[3].warnings=['partial_ohlc_reconstructed_from_close'];
 assert.equal(structural(bars[3]),true);
 const x=audit(bars);
 assert.equal(x.structurallyValidRows,7);
 assert.equal(x.sourceProvenanceAcceptedRows,6);
 assert.equal(x.strictlyAcceptedRows,6);
 assert.equal(x.partialOrSyntheticRows,1);
 assert.equal(x.currentConsecutive.structural,7);
 assert.equal(x.currentConsecutive.strict,3);
 assert.equal(x.longestConsecutive.strict,3);
 assert.equal(x.eligibility.strict60,false);
});
test('copied positive-volume OHLCV quarantines both sides of the pair',()=>{
 const bars=calendar.map((_,i)=>bar(i));
 for(const k of ['open','high','low','close','volume'])bars[5][k]=bars[4][k];
 const x=audit(bars);
 assert.equal(x.copiedPairs.REPEATED_OHLCV,1);
 assert.equal(x.quarantineReasons.REPEATED_OHLCV,2);
 assert.equal(x.structurallyValidRows,7);
 assert.equal(x.currentConsecutive.strict,1);
 assert.equal(x.strictlyAcceptedRows,5);
});
test('duplicate dates cannot manufacture an observed trading-session streak',()=>{
 const bars=calendar.map((_,i)=>bar(i));
 bars.push({...bars[4]});
 const x=audit(bars);
 assert.equal(x.inputRows,8);
 assert.equal(x.quarantineReasons.DUPLICATE_SESSION,2);
 assert.equal(x.currentConsecutive.structural,2);
 assert.equal(x.currentConsecutive.strict,2);
});
test('unresolved corporate action breaks the strict streak, not structural census',()=>{
 const x=audit(calendar.map((_,i)=>bar(i)),[{ticker:'TEST',date:'2026-10-26',status:'review_required'}]);
 assert.equal(x.quarantineReasons.CORPORATE_ACTION_REVIEW_REQUIRED,1);
 assert.equal(x.currentConsecutive.structural,7);
 assert.equal(x.currentConsecutive.strict,2);
});
test('missing observed session is a gap, not a calendar-day weekend gap',()=>{
 const bars=calendar.map((_,i)=>bar(i)).filter(x=>x.date!=='2026-10-25');
 const x=audit(bars);
 assert.equal(x.missingObservedSessions,1);
 assert.deepEqual(x.missingObservedSessionsSample,['2026-10-25']);
 assert.equal(x.currentConsecutive.structural,3);
 assert.equal(x.currentConsecutive.strict,3);
});
test('source URL does not imply a redistribution license or execution approval',()=>{
 const x=audit(calendar.map((_,i)=>bar(i)));
 assert.equal(x.license.status,'NO_EXPLICIT_USAGE_RIGHTS');
 assert.equal(x.identity.strict,true);
 assert.equal(x.executionReady,false);
 assert.equal(x.eligibility.strict60,false);
});
test('invalid ISIN checksum and source evidence both block strict eligibility',()=>{
 const bars=calendar.map((_,i)=>bar(i));delete bars[2].sourceUrls;
 const x=auditTicker('TEST',meta,{...hist(bars),isin:'EG0000000000'},calendar,[],'sha','2026-10-28');
 assert.equal(x.identity.strict,false);
 assert.equal(x.strictlyAcceptedRows,0);
 assert.equal(x.sourceProvenanceAcceptedRows,6);
 assert.equal(x.structurallyValidRows,7);
});
test('report is deterministic with fixed metadata and never certifies OOS',()=>{
 const bars=calendar.map((_,i)=>bar(i));
 const args={symbols:{TEST:meta,EMPTY:{ticker:'EMPTY',active:true}},
  histories:{TEST:{data:hist(bars),sha:'sha'}},calendar,target:'2026-10-28',
  generatedAt:'2026-10-28T20:00:00Z',sourceShas:{inputsDigestSha256:'input',auditLogicSha256:'logic'}};
 const a=buildAudit(args),b=buildAudit(args);
 assert.deepEqual(a,b);
 assert.equal(a.summary.historyFiles,1);
 assert.equal(a.summary.missingHistoryFiles,1);
 assert.equal(a.summary.currentEligibility.strict60,0);
 assert.equal(a.summary.medianTrailingAtOwnLatestSourceProvenance,7);
 assert.equal(a.summary.medianLongestSourceProvenanceConsecutive,7);
 assert.equal(a.summary.medianLongestStrictConsecutive,7);
 assert.equal(a.calendar.officialExchangeCalendar,false);
 assert.equal(a.performanceCertified,false);
 assert.equal(a.executionReady,false);
 assert.deepEqual(a.orders,[]);
 assert.equal(a.top10Recovery[0].state,'RESEARCH_ONLY_NOT_EXECUTION_READY');
 assert.equal(a.top10Recovery[0].licenseStatus,'NO_EXPLICIT_USAGE_RIGHTS');
});
test('unreliable or unsorted calendar fails closed',()=>{
 assert.throws(()=>buildAudit({symbols:{},histories:{},calendar:['2026-10-28','2026-10-27'],target:'2026-10-28'}),/INVALID_OBSERVED_SESSION_CALENDAR/);
 assert.throws(()=>buildAudit({symbols:{},histories:{},calendar:['2026-10-28'],target:'2026-10-29'}),/INVALID_OBSERVED_SESSION_CALENDAR/);
});
