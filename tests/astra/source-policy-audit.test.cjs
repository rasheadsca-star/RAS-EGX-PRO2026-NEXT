'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assess}=require('../../scripts/astra/research/source-policy-audit.cjs');
const signal={ticker:'TEST',signalDate:'2026-09-20',publishedAt:'2026-09-20T14:00:00Z',holdingSessions:1,entryLow:10,entryHigh:11,stopLoss:9,target1:12};
const bar={date:'2026-09-21',open:10.5,high:11.5,low:10,close:11};
const calendar=['2026-09-20','2026-09-21','2026-09-22'];
test('preserves the historical policy version instead of rewriting it',()=>{
 assert.equal(assess({...signal,holdingSessions:5},[bar],calendar).state,'POLICY_VERSION_MISMATCH');
});
test('cancels an above-range open even if price later enters the range',()=>{
 assert.equal(assess(signal,[{...bar,open:13,high:14}],calendar).state,'CANCELLED_AT_OPEN');
});
test('cancels an opening gap below stop even if price later recovers',()=>{
 assert.equal(assess(signal,[{...bar,open:8,low:7}],calendar).state,'CANCELLED_AT_OPEN');
});
test('a range touch cannot establish a confirmed trade or return',()=>{
 const r=assess(signal,[bar],calendar);assert.equal(r.state,'INTRADAY_EVIDENCE_REQUIRED');
 assert.equal(r.realizedNetPct,null);assert.equal(r.executionConfirmed,false);
});
test('cannot substitute a later available bar for the first market session',()=>{
 assert.equal(assess(signal,[{...bar,date:'2026-09-22'}],calendar).state,'SESSION_DATA_UNVERIFIED');
});
test('same-day publication cannot justify an earlier opening fill',()=>{
 assert.equal(assess({...signal,publishedAt:'2026-09-21T11:00:00Z'},[bar],calendar).state,'PUBLICATION_TIME_UNVERIFIED');
});
test('reconstructed OHLC is not promoted to execution evidence',()=>{
 assert.equal(assess(signal,[{...bar,warnings:['ohlc_reconstructed']}],calendar).state,'SESSION_DATA_UNVERIFIED');
});
test('missing prices do not become zero and duplicate bars are rejected',()=>{
 assert.equal(assess(signal,[{...bar,open:null}],calendar).state,'SESSION_DATA_UNVERIFIED');
 assert.equal(assess(signal,[bar,bar],calendar).state,'SESSION_DATA_UNVERIFIED');
});
