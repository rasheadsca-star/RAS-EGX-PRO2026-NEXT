'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {candle,auditArray,collectArrays}=require('../../scripts/research/egx-central-history-cross-repo-inventory-v1.cjs');
const ok=(date,override={})=>({date,open:10,high:12,low:9,close:11,volume:100,...override});
test('accept valid complete dated daily OHLCV, no invented candles',()=>{assert.equal(candle(ok('2026-10-22')).date,'2026-10-22');assert.equal(candle({date:'2026-10-22',close:5}),null)});
test('quarantine derived source snapshots and zero-volume reference bars',()=>{const a=auditArray([ok('2026-10-21',{sourceQuality:'recovered_from_repository_snapshot_using_git_commit_date'}),ok('2026-10-22',{volume:0})],'ABC','legacy');assert.equal(a.researchUsable,0);assert.equal(a.referenceOrReview,2)});
test('two disagreeing candles for same date cannot count as extra observations',()=>{const a=auditArray([ok('2026-10-22'),ok('2026-10-22',{close:10})],'ABC','legacy');assert.equal(a.researchUsable,0);assert.equal(a.conflictDates,1)});
test('read stock-keyed price arrays, not summary-only sessionCount',()=>{const v=collectArrays({sessionsBySymbol:{ABC:[ok('2026-10-22')],DEF:[{sessionCount:2465}]}});assert.equal(v.length,1);assert.equal(v[0].ticker,'ABC')});
test('reject inconsistent candle geometry',()=>assert.equal(candle(ok('2026-10-22',{open:13})),null));
