'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classify,validateMarketWindow}=require('../../astra/market-calendar/egx-exchange-calendar.cjs');
test('Friday and Saturday do not require market bars',()=>{for(const d of ['2026-10-23','2026-10-24'])assert.equal(classify(d).reason,'WEEKEND')});
test('exchange announced holiday Oct 8 is closed, Oct 6 cannot be inferred closed',()=>{
 assert.equal(classify('2026-10-08').reason,'EXCHANGE_CONFIRMED_HOLIDAY');
 assert.equal(classify('2026-10-06').status,'UNCONFIRMED_OPEN');
});
test('unknown dates are not asserted exchange open',()=>assert.equal(classify('2027-01-07').status,'UNCONFIRMED_OPEN'));
test('do not permit a known closed date to enter the history calendar',()=>{
 assert.equal(validateMarketWindow(['2026-10-07','2026-10-08','2026-10-11'],'2026-10-11',2,['2026-10-07','2026-10-11']).reason,'CALENDAR_INCLUDES_CLOSED_DATE');
});
test('20 observed sessions remain independent of elapsed calendar days',()=>{
 const days=[];for(let i=0;i<40;i++){const d=new Date(Date.UTC(2026,8,1+i));const day=d.toISOString().slice(0,10);if(classify(day).status!=='CLOSED')days.push(day)}
 const w=validateMarketWindow(days,days.at(-1),20,days.slice(-20));assert.equal(w.ready,true);
});

test('EGX closure registry has valid, unique and attributed dates',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const document=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../data/egx-exchange-closures.json'),'utf8'));
 assert.equal(document.timezone,'Africa/Cairo');
 const dates=new Set();
 for(const entry of document.closures){
   assert.match(entry.date,/^\d{4}-\d{2}-\d{2}$/);
   const parsed=new Date(entry.date+'T00:00:00Z');
   assert.equal(parsed.toISOString().slice(0,10),entry.date);
   assert.equal(entry.status,'confirmed_exchange_closure');
   assert.ok(/^https:\/\//.test(entry.source),'a closure must have a source');
   assert.equal(dates.has(entry.date),false,'duplicate closed dates');
   dates.add(entry.date);
 }
});
