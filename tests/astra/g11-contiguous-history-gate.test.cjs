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

test('G11 rejects a latest date not in the observed market calendar',()=>{
 assert.match(code,/expected\.at\(-1\)!==latest\)return 0/);
});
test('G11 rejects duplicate same-session bars for contiguous evidence',()=>{
 assert.match(code,/new Set\(dates\)\.size!==dates\.length\)return 0/);
});
test('G11 requires 20 contiguous sessions even when precomputed support and resistance exist',()=>{
 const start=code.indexOf('if((h?.latestContiguousHistory||0)<20)');
 const ready=code.indexOf("else if(support>0&&resistance>0&&same)",start);
 assert.ok(start>0 && ready>start,'history gate must precede VALID support/resistance');
});
test('G11 indicator diagnostics use contiguous history instead of total rows',()=>{
 assert.match(code,/insufficientHistory:active\.filter\(s=>\(historyStats\.get\(normTicker\(s\.ticker\)\)\?\.latestContiguousHistory\|\|0\)<56\)/);
});

test('G11 applies exchange-specific closure gate to expected session and lag',()=>{
 assert.ok(code.includes("classifyEGXDate(s).status!=='CLOSED'"));
 assert.ok(code.includes('return isTrading(c.date,policy)&&c.hour>='));
 assert.ok(code.includes('if(isTrading(fmt(d),policy))count++'));
});
