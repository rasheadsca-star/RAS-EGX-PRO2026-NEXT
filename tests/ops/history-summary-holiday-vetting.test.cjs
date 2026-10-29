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
