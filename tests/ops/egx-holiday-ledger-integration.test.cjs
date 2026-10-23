'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { confirmedClosures, isTradingSession, sessionsBetween } = require('../../scripts/ops/egx-session-math.cjs');
const closures = confirmedClosures();
test('verified October holiday is not tradable',()=>assert.equal(isTradingSession('2026-10-08',closures),false));
test('historical Eid closure is not tradable',()=>assert.equal(isTradingSession('2026-05-27',closures),false));
test('commemorative Oct 6 remains eligible unless explicitly closed',()=>assert.equal(isTradingSession('2026-10-06',closures),true));
test('holding period skips non-sessions and Oct holiday',()=>assert.equal(sessionsBetween('2026-10-07','2026-10-11',closures),1));
