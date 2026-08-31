import test from 'node:test';import assert from 'node:assert/strict';import{latestCompletedSession,assessSessionDataAvailability}from'../src/session-authority.js';
const cal={version:'egx-test-v1',sessions:[{session:'2026-08-30',closeAt:'2026-08-30T14:30:00+03:00'},{session:'2026-08-31',closeAt:'2026-08-31T14:30:00+03:00'}]};
test('calendar not wall date determines completed session',()=>assert.equal(latestCompletedSession(cal,'2026-08-31T12:00:00+03:00'),'2026-08-30'));
test('latest completed session after close is current session',()=>assert.equal(latestCompletedSession(cal,'2026-08-31T15:00:00+03:00'),'2026-08-31'));
test('missing current data returns DATA_NOT_READY without stale fallback',()=>assert.deepEqual(assessSessionDataAvailability({calendar:cal,now:'2026-08-31T15:00:00+03:00',availableSessions:['2026-08-30']}),{engineState:'DATA_NOT_READY',expectedSession:'2026-08-31',latestVerifiedSession:'2026-08-30',reason:'LATEST_SESSION_DATA_MISSING'}));
