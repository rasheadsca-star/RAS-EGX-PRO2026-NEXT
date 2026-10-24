'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {verifyDoc}=require('../../scripts/research/egx-central-long-history-restore-audit-v1.cjs');
const sessions=Array.from({length:260},(_,i)=>{const d=new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10);return {date:d,open:10,high:11,low:9,close:10,adjustedClose:10,volume:1000}});
function doc(){return {ticker:'COMI',source:'YAHOO_CHART_API',sourceSymbol:'COMI.CA',dataQualityStatus:'VALID',symbolIdentity:{verified:true},sessions}}
test('250+ actual daily OHLCV rows are distinguishable from counted sessions without bars',()=>{const r=verifyDoc(doc());assert.equal(r.uniqueValidDays,260);assert.equal(r.researchHistoryCandidate,true);assert.equal(r.fullProductionCertification,false)});
test('large mismatch with current canonical price never silently upgrades history',()=>{const r=verifyDoc(doc(),[{date:sessions[0].date,close:20}]);assert.equal(r.researchHistoryCandidate,false);assert.ok(r.problems.includes('RECONCILE_MAIN_CLOSE_PRICE_MISMATCH'))});
test('unverified identity remains quarantined even with long history',()=>{const d=doc();d.symbolIdentity.verified=false;const r=verifyDoc(d);assert.equal(r.researchHistoryCandidate,false)});
test('10-year headline sessionCount without corresponding raw candles does not pass',()=>{const d={...doc(),sessionCount:2465,sessions:[]};assert.equal(verifyDoc(d).uniqueValidDays,0)});
