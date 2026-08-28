#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const file=path.resolve(__dirname,'../data/forward-shadow-ledger.json');
const x=JSON.parse(fs.readFileSync(file,'utf8'));
const signals=Array.isArray(x.signals)?x.signals:[];
const outcomes=Array.isArray(x.outcomes)?x.outcomes:[];
const errors=[];
const warnings=[];
const signalKeys=new Set();
for(const s of signals){
  if(!s.key||signalKeys.has(s.key)) errors.push('duplicate or missing signal key: '+String(s.key));
  signalKeys.add(s.key);
  if(!s.signalSession||!s.engine||!s.ticker) errors.push('incomplete signal identity: '+String(s.key));
  if(!(Number(s.entryLow)>0&&Number(s.entryHigh)>0&&Number(s.stopLoss)>0&&Number(s.target1)>0)) errors.push('invalid plan levels: '+String(s.key));
  if(Number(s.entryLow)>Number(s.entryHigh)) errors.push('inverted entry range: '+String(s.key));
  if(Number(s.stopLoss)>=Number(s.entryHigh)) errors.push('stop must be below entry: '+String(s.key));
  if(Number(s.target1)<=Number(s.entryLow)) errors.push('target must be above entry: '+String(s.key));
}
const outcomeKeys=new Set();
for(const o of outcomes){
  if(!o.signalKey||outcomeKeys.has(o.signalKey)) errors.push('duplicate or missing outcome: '+String(o.signalKey));
  outcomeKeys.add(o.signalKey);
  if(!signalKeys.has(o.signalKey)) errors.push('orphan outcome: '+String(o.signalKey));
}
const sessions=new Set(signals.map(s=>s.signalSession));
const minimum=Number(x.policy?.minimumForwardSessionsForPromotion||20);
if(sessions.size<minimum) warnings.push('forward evidence below promotion minimum: '+sessions.size+'/'+minimum+' sessions');
const report={ok:errors.length===0,signals:signals.length,outcomes:outcomes.length,distinctSignalSessions:sessions.size,errors,warnings};
console.log(JSON.stringify(report,null,2));
if(errors.length) process.exit(1);
