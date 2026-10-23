'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {analyze}=require('../../scripts/research/hybrid-alpha-v1-cohort-audit.cjs');
const t=(ticker,date,variant,netReturnPct,status)=>({ticker,signalDate:date,variant,netReturnPct,status});
test('partitions breakout into accepted and rejected without double counting',()=>{
 const x={variants:[{variant:'breakout',signals:2}],trades:[t('AAA','2026-10-01','breakout',2,'TARGET'),t('AAA','2026-10-01','hybrid',2,'TARGET'),t('BBB','2026-10-01','breakout',-4,'STOP')]};
 const r=analyze(x);assert.equal(r.accepted.trades,1);assert.equal(r.rejected.trades,1);assert.equal(r.check.pass,true);
});
test('detects duplicate ticker-day-variant data',()=>assert.throws(()=>analyze({trades:[t('AAA','2026-10-01','breakout',1,'TARGET'),t('AAA','2026-10-01','breakout',1,'TARGET')]})));
