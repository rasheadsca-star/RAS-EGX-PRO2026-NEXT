'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {emit}=require('../../scripts/astra/g22-g11-blocker-evidence.cjs');
test('exports certified exact active universe distinct from raw symbol mapping',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'g22-universe-'));
 try{
 const report=path.join(dir,'report.json');
 emit({universe:{records:[{ticker:'BBBB',active:true},{ticker:'AAAA',active:true},{ticker:'XXXX',active:false}]},historyStats:[],strategyReadiness:{rows:[]},metrics:{currentCanonicalSecurities:{numerator:0},decisionPipeline:{pipelineReadySecurities:0}}},'2026-10-27',report);
 const obj=JSON.parse(fs.readFileSync(path.join(dir,'g22-certified-g11-active-tickers.json'),'utf8'));
 assert.deepEqual(obj,{session:'2026-10-27',tickers:['AAAA','BBBB']});
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
