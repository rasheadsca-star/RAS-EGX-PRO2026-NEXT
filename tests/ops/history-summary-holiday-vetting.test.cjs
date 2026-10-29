'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {buildSessionCalendar}=require('../../scripts/history/history-summary-builder.cjs');
test('builder preserves raw evidence but excludes confirmed closure from eligible session view',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'egx-holiday-builder-'));
 try{
  fs.mkdirSync(path.join(temp,'data','history'),{recursive:true});
  fs.writeFileSync(path.join(temp,'data','egx-exchange-closures.json'),JSON.stringify({closures:[{date:'2026-10-08',status:'confirmed_exchange_closure'}]}));
  fs.writeFileSync(path.join(temp,'data','history','TEST.json'),JSON.stringify({sessions:[{date:'2026-10-07'},{date:'2026-10-08'},{date:'2026-10-09'},{date:'2026-10-11'}]}));
  const result=buildSessionCalendar(temp,{symbols:[{sourceFile:'data/history/TEST.json'}]});
  assert.deepEqual(result.sessions,['2026-10-07','2026-10-08','2026-10-09','2026-10-11']);
  assert.deepEqual(result.eligibleSessions,['2026-10-07','2026-10-11']);
  assert.deepEqual(result.quarantinedClosedDates,['2026-10-08','2026-10-09']);
  assert.equal(result.latestEligibleSession,'2026-10-11');
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
});

test('published calendar isolates verified closures from eligible EGX sessions',()=>{
 const repo=path.resolve(__dirname,'../..');
 const calendar=JSON.parse(fs.readFileSync(path.join(repo,'data/session-calendar.json'),'utf8'));
 const evidence=JSON.parse(fs.readFileSync(path.join(repo,'data/egx-exchange-closures.json'),'utf8'));
 assert.ok(Array.isArray(calendar.eligibleSessions),'generated eligible sessions are required');
 const closed=new Set(evidence.closures.filter(x=>x.status==='confirmed_exchange_closure').map(x=>x.date));
 const expected=calendar.sessions.filter(d=>![5,6].includes(new Date(d+'T00:00:00Z').getUTCDay())&&!closed.has(d));
 assert.deepEqual(calendar.eligibleSessions,expected);
 assert.deepEqual(calendar.quarantinedClosedDates,calendar.sessions.filter(d=>!expected.includes(d)));
 assert.equal(calendar.latestEligibleSession,expected.at(-1));
});
