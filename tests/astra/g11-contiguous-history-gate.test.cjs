'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {sessionWindow,validateWindow}=require('../../astra/market-calendar/trading-session-window.cjs');
const code=fs.readFileSync(path.resolve(__dirname,'../../astra/data-health/g11-data-health.cjs'),'utf8');
test('Astra G11 support/resistance 20-bar gate requires contiguous observed sessions',()=>{
 assert.match(code,/\(h\?\.latestContiguousHistory\|\|0\)<20/);
 assert.doesNotMatch(code,/\(h\?\.validSessions\|\|0\)<20/);
});
test('Astra G11 strategy minimum-bars gate requires contiguous observed sessions',()=>{
 assert.match(code,/\(h\.latestContiguousHistory\|\|0\)<Number\(spec\.minimumBars\|\|0\)/);
 assert.doesNotMatch(code,/\(h\.validSessions\|\|0\)<Number\(spec\.minimumBars\|\|0\)/);
});
test('a symbol can have >=20 total unique bars but fewer than 20 contiguous expected bars',()=>{
 const calendar=[];for(let i=0;i<42;i++){const d=new Date(Date.UTC(2026,8,1+i));if(![5,6].includes(d.getUTCDay()))calendar.push(d.toISOString().slice(0,10))}
 const last=calendar.at(-1);
 const included=calendar.slice(-25).filter(x=>x!==calendar.at(-7));
 assert.ok(included.length>=20);
 const win=sessionWindow(calendar,last,20);
 assert.equal(win.ready,true);
 assert.equal(validateWindow(calendar,last,20,included).reason,'MARKET_SESSION_GAP');
});
