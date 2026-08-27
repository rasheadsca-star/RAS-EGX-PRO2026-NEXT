import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyV3Ledger, updateV3ForwardLedger } from '../src/forward-shadow-v3.js';

const v3={pass:true,raw:{plan:{entryZone:{from:10,to:10.2},referenceEntry:10.1,stopLoss:9.5,riskPct:5.94,precisionTarget:{r:.8,price:10.58}},sourceSignal:{reclaimDate:'2026-08-26'},definition:{id:'FULL_STRUCTURE_V3'}}};
const scan=(date,bar,pass=true)=>({generatedAt:`${date}T14:00:00Z`,all:[{symbol:'TEST',strategy_lab:{full_structure_v3:pass?v3:{pass:false}},last_session:{date,...bar},market_regime:'BULL'}]});

test('shadow signal starts prospectively and cannot enter on observation bar',()=>{
  let l=updateV3ForwardLedger(emptyV3Ledger(),scan('2026-08-27',{open:10.1,high:11,low:9,close:10.5}));
  assert.equal(l.signals.length,1);assert.equal(l.signals[0].state,'WAIT_ENTRY');assert.equal(l.signals[0].entryDate,undefined);
});

test('STOP_FIRST applies when stop and target touch on entry bar',()=>{
  let l=updateV3ForwardLedger(emptyV3Ledger(),scan('2026-08-27',{open:10.4,high:10.5,low:10.3,close:10.4}));
  l=updateV3ForwardLedger(l,scan('2026-08-30',{open:10.1,high:10.8,low:9.4,close:10.4},false));
  assert.equal(l.signals[0].state,'STOP');assert.equal(l.summary.stop,1);assert.equal(l.summary.target,0);
});

test('entry expires after three future observed sessions',()=>{
  let l=updateV3ForwardLedger(emptyV3Ledger(),scan('2026-08-27',{open:11,high:11.2,low:10.8,close:11}));
  for(const d of ['2026-08-30','2026-08-31','2026-09-01'])l=updateV3ForwardLedger(l,scan(d,{open:11,high:11.2,low:10.8,close:11},false));
  assert.equal(l.signals[0].state,'EXPIRED');
});
