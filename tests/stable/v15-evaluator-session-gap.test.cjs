'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const source=fs.readFileSync(path.join(root,'scripts/stable/v15-recommendation-evaluator.cjs'),'utf8');
const calendar=JSON.parse(fs.readFileSync(path.join(root,'data/session-calendar.json'),'utf8'));
test('evaluator explicitly refuses to score unresolved market-session gaps',()=>{
 assert.ok(source.includes("evaluationStatus:'HISTORY_SESSION_GAP'"));
 assert.ok(source.includes("missingObservedMarketSessions(record.recommendationDate,assessmentEnd,sessions.map(x=>x.date))"));
});
test('vetted reference calendar excludes the announced October closure',()=>{
 assert.ok(Array.isArray(calendar.eligibleSessions));
 assert.ok(calendar.eligibleSessions.includes('2026-10-07'));
 assert.ok(!calendar.eligibleSessions.includes('2026-10-08'));
 assert.ok(calendar.eligibleSessions.includes('2026-10-11'));
});
test('evaluator requires assessed end date to exist in vetted calendar',()=>{
 assert.ok(source.includes('!MARKET_SESSION_CALENDAR.includes(throughDate)'));
});
