'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {plan, validateStatus} = require('../../scripts/stable/v16-same-session-recovery-replay.cjs');

const before = {expectedSession:'2026-10-27',ready:true,executionGrade:true,acceptedRows:183,
  sampleRejected:[{ticker:'TRTO'},{ticker:'NAHO'},{ticker:'CIRA'}]};
const second = {expectedSession:'2026-10-27',records:{TRTO:{approved:true},NAHO:{approved:true},CIRA:{approved:false}}};
test('replays only approved, currently rejected tickers in the exact same session', () => {
  assert.deepEqual(plan(before,second).candidates,['TRTO','NAHO']);
  assert.equal(plan(before,{...second,expectedSession:'2026-10-26'}).skip,'SECOND_SOURCE_NOT_SAME_SESSION');
  assert.equal(plan({...before,executionGrade:false},second).skip,'PRIMARY_NOT_EXECUTION_GRADE');
});
test('does not reuse evidence if the ticker is already accepted', () => {
  assert.deepEqual(plan({...before,sampleRejected:[{ticker:'CIRA'}]},second).candidates,[]);
});
test('fetch status and recovered history must agree with exact session and real OHLCV', () => {
  const after={...before,acceptedRows:185,rejectedRows:28,droppedRows:0,source:{inputRows:213,sourceSessionEvidenceCoveragePct:91.55},
    secondSourceReconciliation:{recoveredTickersThisRun:['TRTO','NAHO']}};
  const status={expectedSession:'2026-10-27',inputRows:213,marketRows:185,currentSessionRows:185,
    rejectedCurrentSessionRows:28,coveragePct:86.85,sourceSessionEvidenceCoveragePct:91.55};
  const e={records:{TRTO:{approvedEvidence:{provider:'STOCKANALYSIS_EGX_HISTORY'}},NAHO:{approvedEvidence:{provider:'STOCKANALYSIS_EGX_HISTORY'}}}};
  const bar={date:'2026-10-27',sourceSessionDate:'2026-10-27',open:1,high:1,low:1,close:1,volume:20,
    secondSourceConfirmed:true,secondSourceProvider:'STOCKANALYSIS_EGX_HISTORY'};
  const histories={TRTO:{symbolVerified:true,isin:'EGS79072C012',sessions:[bar]},
    NAHO:{symbolVerified:true,isin:'EGS69182C011',sessions:[bar]}};
  const summary=validateStatus(before,after,status,e,histories);
  assert.equal(summary.accepted,185);
  assert.equal(summary.acceptedOverInputPct,86.85);
  assert.deepEqual(summary.recovered,['TRTO','NAHO']);
  assert.throws(()=>validateStatus(before,after,{...status,coveragePct:91.55},e,histories),/REPLAY_FETCH_STATUS_INCONSISTENT/);
  assert.throws(()=>validateStatus(before,after,status,e,{...histories,NAHO:{...histories.NAHO,sessions:[]}}),/REPLAY_RECOVERED_HISTORY_NOT_VERIFIED_NAHO/);
  assert.throws(()=>validateStatus(before,{...after,expectedSession:'2026-10-28'},status,e,histories),/REPLAY_SESSION_IDENTITY_MISMATCH/);
});
