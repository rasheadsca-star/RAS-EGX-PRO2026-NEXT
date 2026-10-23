'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {stats,report}=require('../../scripts/research/egx-comparable-three-strategy-v1.cjs');
test('zero trades never count as success',()=>assert.equal(stats([]).winRatePct,null));
test('profit factor accounts only for negative outcomes',()=>assert.equal(stats([{netReturnPct:3},{netReturnPct:-2}]).profitFactor,1.5));
test('time split applies identical boundary to every strategy',()=>{const r=report({trades:[{signalDate:'2026-01-01',variant:'relative_momentum',netReturnPct:1},{signalDate:'2026-06-01',variant:'breakout_filtered',netReturnPct:-1}],unresolved:[]});assert.equal(r.byPeriod[0].variants.reduce((a,x)=>a+x.trades,0),2);assert.equal(r.byPeriod[2].variants.find(x=>x.variant==='breakout_filtered').trades,1)});
