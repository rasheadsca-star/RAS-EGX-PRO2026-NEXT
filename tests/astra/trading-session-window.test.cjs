'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {sessionWindow,validateWindow}=require('../../astra/market-calendar/trading-session-window.cjs');
const calendar=['2026-10-18','2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-25','2026-10-26','2026-10-27','2026-10-28'];
test('weekend does not consume a session',()=>{
 assert.deepEqual(sessionWindow(calendar,'2026-10-25',3).sessions,['2026-10-21','2026-10-22','2026-10-25']);
});
test('an observed exchange holiday does not consume session window',()=>{
 const sessions=['2026-10-18','2026-10-19','2026-10-21','2026-10-22'];
 assert.deepEqual(sessionWindow(sessions,'2026-10-22',3).sessions,['2026-10-19','2026-10-21','2026-10-22']);
});
test('cannot replace missing observed exchange session with calendar arithmetic',()=>{
 assert.equal(validateWindow(calendar,'2026-10-28',4,[{date:'2026-10-22'},{date:'2026-10-25'},{date:'2026-10-28'}]).reason,'MARKET_SESSION_GAP');
});
test('a session missing market wide from the observed calendar cannot be invented',()=>{
 assert.equal(sessionWindow(calendar,'2026-10-23',2).reason,'END_SESSION_NOT_OBSERVED');
});
test('duplicate market or symbol sessions fail closed',()=>{
 assert.throws(()=>sessionWindow([...calendar,'2026-10-28'],'2026-10-28',2),/DUPLICATE/);
 assert.equal(validateWindow(calendar,'2026-10-28',2,['2026-10-28','2026-10-28']).reason,'DUPLICATE_OBSERVATION_SESSION');
});
test('20 sessions may span more than 20 calendar days',()=>{
 const dates=[];for(let i=0;i<42;i++){const d=new Date(Date.UTC(2026,8,1+i));if(![5,6].includes(d.getUTCDay()))dates.push(d.toISOString().slice(0,10));}
 const w=sessionWindow(dates,dates.at(-1),20);
 assert.equal(w.sessions.length,20);
 assert.ok((Date.parse(w.sessions.at(-1))-Date.parse(w.sessions[0]))/86400000>=25);
});

test('exactly 20 exchange sessions passes even when elapsed calendar time exceeds 20 days',()=>{
 const dates=[];for(let i=0;i<36;i++){
   const d=new Date(Date.UTC(2026,8,1+i));
   if(![5,6].includes(d.getUTCDay()))dates.push(d.toISOString().slice(0,10));
 }
 const end=dates[dates.length-1];
 const expected=sessionWindow(dates,end,20);
 assert.equal(expected.ready,true);
 assert.equal(validateWindow(dates,end,20,expected.sessions).ready,true);
 const twentyCalendarDaysAgo=new Date(Date.parse(end+'T00:00:00Z')-20*86400000).toISOString().slice(0,10);
 assert.ok(expected.sessions[0]<twentyCalendarDaysAgo);
});
test('20 dated rows cannot pass if one required observed market session is missing',()=>{
 const dates=[];for(let i=0;i<36;i++){
   const d=new Date(Date.UTC(2026,8,1+i));
   if(![5,6].includes(d.getUTCDay()))dates.push(d.toISOString().slice(0,10));
 }
 const expected=sessionWindow(dates,dates.at(-1),20).sessions;
 const staleReplacement=dates[dates.length-21];
 const corrupted=[staleReplacement,...expected.filter((_,i)=>i!==9)];
 assert.equal(corrupted.length,20);
 assert.equal(validateWindow(dates,dates.at(-1),20,corrupted).reason,'MARKET_SESSION_GAP');
});
