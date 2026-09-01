import assert from 'node:assert/strict';
await import('../technical-chart-v21-alignment.js');
const A=globalThis.EGXOneTechnicalV21;
assert.ok(A,'V2.1 alignment API missing');
assert.equal(A.CONTRACT.scoringImpact,'NONE');
assert.equal(A.CONTRACT.recommendationMutationAllowed,false);
assert.equal(A.CONTRACT.executionAllowed,false);
assert.equal(A.CONTRACT.automaticOrders,false);

const history={sessions:[
  {session:'2026-08-30',open:10,high:11,low:9.5,close:10.5,volume:1000},
  {session:'2026-08-31',open:10.5,high:11.2,low:10.1,close:11,volume:1200}
]};
const live={authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,expectedSession:'2026-09-01',targetSession:'2026-09-01',records:[{
  ticker:'AAA',state:'READY_RESEARCH',authoritativeResearch:{ticker:'AAA',session:'2026-09-01',open:11,high:12,low:10.8,close:11.7,volume:1800,researchState:'READY_RESEARCH',sourceId:'LEGACY_MARKET_IMPORT',providerGroup:'MUBASHER',verificationState:'CURRENT_SESSION_LEGACY_MUBASHER_IMPORT'}
}]};
const m=A.mergeCurrentBar(history,live,'AAA','2026-09-01');
assert.equal(m.alignment.state,'ALIGNED_APPENDED');
assert.equal(m.payload.sessions.length,3);
assert.equal(m.payload.sessions.at(-1).session,'2026-09-01');
assert.equal(m.payload.sessions.at(-1).close,11.7);

const exact={sessions:[...history.sessions,{session:'2026-09-01',open:11,high:12,low:10.8,close:11.7,volume:1800}]};
const e=A.mergeCurrentBar(exact,live,'AAA','2026-09-01');
assert.equal(e.alignment.state,'ALIGNED_EXISTING');
assert.equal(e.payload.sessions.length,3);

const conflict={sessions:[...history.sessions,{session:'2026-09-01',open:11,high:12,low:10.8,close:11.4,volume:1800}]};
const c=A.mergeCurrentBar(conflict,live,'AAA','2026-09-01');
assert.equal(c.alignment.state,'BLOCKED');
assert.equal(c.alignment.reason,'CURRENT_HISTORY_BAR_CONFLICT');
assert.equal(c.payload.sessions.length,0);

const stale={...live,records:[{ticker:'AAA',state:'STALE_RESEARCH',authoritativeResearch:null}]};
const s=A.mergeCurrentBar(history,stale,'AAA','2026-09-01');
assert.equal(s.alignment.state,'HISTORICAL_ONLY');
assert.equal(s.payload.sessions.length,2);

const invalid={...live,records:[{ticker:'AAA',state:'READY_RESEARCH',authoritativeResearch:{ticker:'AAA',session:'2026-09-01',open:11,high:10,low:10.8,close:11.7,volume:1800,researchState:'READY_RESEARCH'}}]};
const b=A.mergeCurrentBar(history,invalid,'AAA','2026-09-01');
assert.equal(b.alignment.state,'BLOCKED');
assert.equal(b.alignment.reason,'CURRENT_READY_RESEARCH_OHLCV_INVALID');

const bars=[];for(let i=0;i<25;i++){const close=100+i;bars.push({session:`2026-08-${String(i+1).padStart(2,'0')}`,open:close-1,high:close+2,low:close-2,close,volume:1000+i*20})}
assert.ok(Number.isFinite(A.atr14Pct(bars)));
assert.ok(Number.isFinite(A.relativeVolume20(bars)));
console.log('technical-chart-v21-alignment tests: PASS');
