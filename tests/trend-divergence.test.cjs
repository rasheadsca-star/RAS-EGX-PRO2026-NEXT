'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {rsi,pivots,detect}=require('../scripts/research/trend-divergence.cjs');
const closes=Array.from({length:65},(_,i)=>120-i*.1).concat([112,110,108,105,100,95,90,91,93,97,100,103,105,103,100,97,94,92,90,89,90,92,94,96,98,100,101,99,96,94,92,90,88,89,91,93,94,95,96,103]);
const make=()=>({ticker:'TEST',symbolVerified:true,sessions:closes.map((close,i)=>({date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),close}))});
const run=d=>detect(d,d.sessions.at(-1).date);
test('RSI flat, rising and falling reference cases',()=>{assert.equal(rsi(Array(30).fill(10)).at(-1),50);assert.equal(rsi(Array.from({length:30},(_,i)=>i+1)).at(-1),100);assert.equal(rsi(Array.from({length:30},(_,i)=>30-i)).at(-1),0);});
test('confirmed descending line and bullish divergence trigger only on close breakout',()=>{const d=make();assert.equal(run(d).status,'SIGNAL');d.sessions.at(-1).close=96;assert.equal(run(d).status,'WATCH');});
test('future bars cannot change a historical signal',()=>{const d=make(),session=d.sessions.at(-1).date,before=detect(d,session);d.sessions.push({date:'2026-04-16',close:1});assert.deepEqual(detect(d,session),before);});
test('pivot needs two right-hand completed bars',()=>{assert.deepEqual(pivots([1,2,5,2,1],2,3,false),[]);assert.deepEqual(pivots([1,2,5,2,1],2,4,false),[2]);});
test('no repeated breakout on following day',()=>{const d=make();d.sessions.push({date:'2026-04-16',close:104});assert.notEqual(run(d).status,'SIGNAL');});
test('stale, malformed, discontinuous and mismatched data fail closed',()=>{let d=make();d.staleData=true;assert.equal(run(d).status,'BLOCKED');d=make();d.sessions.at(-1).close=NaN;assert.equal(run(d).status,'BLOCKED');d=make();d.sessions.at(-1).close=300;assert.equal(run(d).status,'BLOCKED');d=make();assert.equal(detect(d,'2026-04-16').status,'BLOCKED');});

test('Pages trend build preserves last snapshot when fetch session or official PDF is missing',()=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-trend-freeze-'));
 const script=path.resolve(__dirname,'../scripts/research/build-trend-divergence.cjs');
 try{
  fs.mkdirSync(path.join(root,'data/research'),{recursive:true});
  const output=path.join(root,'data/research/trend-divergence.json');
  const sentinel='{"session":"2026-10-29","mode":"RESEARCH_ONLY","rows":[]}';
  fs.writeFileSync(output,sentinel);
  fs.writeFileSync(path.join(root,'data/fetch-status.json'),JSON.stringify({ok:true,marketRows:215}));
  for(const status of [{ok:true,marketRows:215},{ok:true,expectedSession:'2026-11-01'}]){
   fs.writeFileSync(path.join(root,'data/fetch-status.json'),JSON.stringify(status));
   const result=spawnSync(process.execPath,[script],{cwd:root,encoding:'utf8'});
   assert.equal(result.status,0,result.stderr);
   assert.match(result.stdout,/TREND_DIVERGENCE_FROZEN/);
   assert.equal(fs.readFileSync(output,'utf8'),sentinel);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
