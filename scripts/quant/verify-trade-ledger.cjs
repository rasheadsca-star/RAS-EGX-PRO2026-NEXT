'use strict';
const fs=require('node:fs');
const p=process.argv[2]||'data/quant/walk-forward-trade-ledger.json';
const x=JSON.parse(fs.readFileSync(p,'utf8'));
if(x.liveExecutionEnabled!==false||x.performanceCertified!==false)throw Error('Unsafe flags');
if(x.count!==x.trades.length)throw Error('Count mismatch');
const seen=new Set();
for(const t of x.trades){
 if(!t.signalDate||!t.entryDate||!t.exitDate||!t.strategyId||!t.ticker||!Number.isFinite(t.netReturnPct)||!Number.isFinite(t.rMultiple))throw Error('Incomplete trade');
 if(t.entryDate<t.signalDate||t.exitDate<t.entryDate)throw Error('Chronology failure');
 if(t.signalDate<t.foldTestStart||t.signalDate>t.foldTestEnd)throw Error('Future fold leakage');
 const key=[t.fold,t.strategyId,t.ticker,t.variantId,t.signalDate,t.entryDate].join('|');
 if(seen.has(key))throw Error('Repeated trade '+key);seen.add(key);
}
console.log('Trade audit PASS: '+x.count+' closed research trades; not a certified portfolio');
