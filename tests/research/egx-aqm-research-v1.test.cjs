'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {technical,computeSignals,replay}=require('../../scripts/research/egx-aqm-research-v1.cjs');
const makeBars=(n,start=100)=>{const arr=[];for(let i=0;i<n;i++){const d=new Date(Date.UTC(2025,0,1+i));const date=d.toISOString().slice(0,10);const close=start+i*.4;arr.push({date,open:close-.2,high:close+.4,low:close-.5,close,volume:500000,executable:true})}return arr};
test('market/financial/event proof missing means zero full AQM recommendations',()=>{
 const u={ABC:makeBars(140)};const r=computeSignals(u,{marketMode:'strict'});
 assert.equal(r.signals.length,0);assert.ok(r.asOfAudit.missing.includes('egx30History'));
});
test('even arbitrary placeholder dependencies do not bypass strict certification',()=>{
 const u={ABC:makeBars(140)};
 const r=computeSignals(u,{marketMode:'strict',indexHistory:{},pointInTimeFundamentals:{},eventCalendar:{},sectorHistory:{},haltHistory:{}});
 assert.equal(r.signals.length,0);assert.equal(r.asOfAudit.fullAsOfCertificationImplemented,false);
});
test('trend SMA and ATR computed without seeing later candles',()=>{
 const original=makeBars(135),mutated=makeBars(135);mutated[134]={...mutated[134],close:10000};
 assert.deepEqual(technical(original,130),technical(mutated,130));
});
test('zero-volume misleading reference does not distort AQM signal features',()=>{
 const a=makeBars(130),b=makeBars(130);
 b.splice(35,0,{...b[35],close:99999,high:99999,open:99999,low:99999,volume:0,executable:false});
 const left=technical(a,125),right=technical(b,126);assert.deepEqual(left,right);
});
test('entry is on next global session and max position weight is 15 percent',()=>{
 const dates=['2026-01-04','2026-01-05','2026-01-06'];
 const bars=dates.map(date=>({date,open:100,high:102,low:99,close:101,volume:10000000,executable:true}));
 const u={AAA:bars,BBB:bars,CCC:bars,DDD:bars,EEE:bars};
 const signals=Object.keys(u).map((ticker,i)=>({ticker,date:dates[0],variant:'aqm_pullback',score:90-i,atr14:4,turnover20:30000000,marketExposureMaxPct:100}));
 const r=replay(u,signals,'aqm_pullback');const day0=r.equityCurve[0],day1=r.equityCurve[1];
 assert.equal(day0.openPositions,0);assert.equal(day1.openPositions,4);
 const nominalPerPosition=(100000-day1.cashEgp)/4;assert.ok(nominalPerPosition<=15100);
});
test('gap-through-stop leads negative result including costs, not optimistic stop fill',()=>{
 const bars=[{date:'2026-01-04',open:100,high:101,low:99,close:100,volume:500000,executable:true},{date:'2026-01-05',open:100,high:102,low:99,close:101,volume:500000,executable:true},{date:'2026-01-06',open:80,high:84,low:75,close:79,volume:500000,executable:true}];
 const r=replay({AAA:bars},[{ticker:'AAA',date:'2026-01-04',variant:'aqm_pullback',score:80,atr14:5,turnover20:30000000,marketExposureMaxPct:100}],'aqm_pullback');
 assert.equal(r.closedTrades,1);assert.ok(r.tradeLedger[0].netPnlEgp<0);
});

test('a 6 percent monthly drawdown disables new entries for that month',()=>{
 const dates=['2026-01-04','2026-01-05','2026-01-06','2026-01-07'];
 const abc=dates.map((date,i)=>({date,open:i>=2?50:100,high:i>=2?51:101,low:i>=2?49:99,close:i>=2?50:100,volume:1000000,executable:true}));
 const bbb=dates.map(date=>({date,open:100,high:101,low:99,close:100,volume:1000000,executable:true}));
 const r=replay({ABC:abc,BBB:bbb},[
  {ticker:'ABC',date:dates[0],variant:'aqm_pullback',score:90,atr14:5,turnover20:30000000,marketExposureMaxPct:100},
  {ticker:'BBB',date:dates[2],variant:'aqm_pullback',score:90,atr14:5,turnover20:30000000,marketExposureMaxPct:100}
 ],'aqm_pullback');
 assert.equal(r.closedTrades,1);
 assert.equal(r.equityCurve[3].openPositions,0);
 assert.ok(r.monthlyHaltDays>=1);
});

test('an open position with no current daily quote is explicitly unqualified, not shown as certified profit',()=>{
 const dates=['2026-01-04','2026-01-05','2026-01-06'];
 const candle=date=>({date,open:100,high:102,low:99,close:100,volume:100000,executable:true});
 const u={AAA:dates.slice(0,2).map(candle),BBB:dates.map(candle)};
 const signals=[{ticker:'AAA',date:dates[0],variant:'aqm_pullback',score:80,atr14:5,turnover20:30000000,marketExposureMaxPct:100}];
 const r=replay(u,signals,'aqm_pullback');
 assert.equal(r.openPositions,1);assert.equal(r.markIntegrity.completeSessionMarks,false);
 assert.equal(r.markIntegrity.stalePositionSessions,1);
 assert.equal(r.equityCurve.at(-1).staleOpenPositions,1);
 assert.equal(r.reportableCertifiedPortfolioReturnPct,null);
 assert.ok(r.markIntegrity.maxStaleExposedEgp>0);
});
test('fresh prices are not stale, but price source remains unverified',()=>{
 const dates=['2026-01-04','2026-01-05','2026-01-06'];
 const rows=dates.map(date=>({date,open:100,high:102,low:99,close:100,volume:100000,executable:true}));
 const r=replay({AAA:rows},[{ticker:'AAA',date:dates[0],variant:'aqm_pullback',score:80,atr14:5,turnover20:30000000,marketExposureMaxPct:100}],'aqm_pullback');
 assert.equal(r.markIntegrity.completeSessionMarks,true);
 assert.equal(r.markIntegrity.capitalPerformanceCertified,false);
});
