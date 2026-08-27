#!/usr/bin/env node
'use strict';
const assert=require('assert');
const Fusion=require('../engine/fusion.js');
const Gann=require('../engine/gann.js');
function makeBars(n=220){const out=[];let p=20;for(let i=0;i<n;i++){const wave=Math.sin(i/9)*0.006,drift=0.0012;p=Math.max(1,p*(1+drift+wave));out.push({date:`2026-${String(Math.floor(i/28)%8+1).padStart(2,'0')}-${String(i%28+1).padStart(2,'0')}`,open:p*.995,high:p*1.012,low:p*.988,close:p,volume:1000000*(1+(i%11)/10)})}return out}
const bars=makeBars(),market=makeBars().map((b,i)=>({...b,close:100+i*.08,open:100+i*.08,high:100.3+i*.08,low:99.7+i*.08}));
const g=Gann.analyze({bars});assert(g.anchor,'Gann anchor missing');assert(Number.isFinite(g.time.score),'Gann time score invalid');assert(Number.isFinite(g.price.nearest),'Square of Nine level invalid');
const a=Fusion.analyze({ticker:'TEST',nameAr:'اختبار',bars,marketBars:market,fundamentals:{score:72},dataQuality:{fresh:true,conflict:false}});assert(a.valid,'Fusion analysis invalid');assert(a.score>=0&&a.score<=100,'Fusion score out of bounds');assert(a.plan.stopLoss<a.plan.entryHigh,'Stop must be below entry high');assert(a.plan.target1>a.plan.entryLow,'Target must be above entry low');assert(a.explanation&&a.explanation.action,'Arabic explanation missing');
const blocked=Fusion.analyze({ticker:'STALE',bars,marketBars:market,dataQuality:{fresh:false,conflict:false}});assert(blocked.classification.code==='WAIT_DATA','Stale data must fail closed');
console.log(JSON.stringify({ok:true,score:a.score,classification:a.classification,gannTime:g.time,gannPrice:g.price.nearest},null,2));