import test from 'node:test';
import assert from 'node:assert/strict';
import { scanMarket } from '../src/engine.js';

const bars=(seed=0)=>Array.from({length:300},(_,i)=>{
  const close=20+seed+i*0.08+(i%17===0?0.25:0);
  return {date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),open:close*0.995,high:close*1.01,low:close*0.99,close,volume:2_000_000+i*5000,valueTraded:close*(2_000_000+i*5000),adjustmentFactor:1};
});
class MockProvider{
  async loadContext(){return {};}
  buildUniverse(){return [
    {ticker:'AAA',companyNameEn:'Alpha',sector:'INDUSTRIAL',summary:{lastSession:bars().at(-1).date},fundamentals:null,news:null,longHistory:null},
    {ticker:'BBB',companyNameEn:'Beta',sector:'INDUSTRIAL',summary:{lastSession:bars(2).at(-1).date},fundamentals:null,news:null,longHistory:null},
    {ticker:'ERR',companyNameEn:'Broken',sector:'OTHER',summary:{lastSession:'2025-10-27'},fundamentals:null,news:null,longHistory:null},
  ];}
  async loadStock(entry){
    if(entry.ticker==='ERR')throw new Error('SYNTHETIC_PROVIDER_FAILURE');
    const rows=bars(entry.ticker==='BBB'?2:0);
    return {entry,rows,errors:[],meta:{priceDataAsOf:rows.at(-1).date,fundamentalsAsOf:null,expectedSessionDate:entry.summary.lastSession}};
  }
  async loadBenchmark(){return bars(100);}
}
test('full market scan integration attempts the entire eligible universe and records failures',async()=>{
  const scan=await scanMarket({provider:new MockProvider()});
  assert.equal(scan.market_coverage.TotalEligible,3);
  assert.equal(scan.market_coverage.SuccessfullyAnalyzed,2);
  assert.equal(scan.market_coverage.Errors,1);
  assert.equal(scan.market_coverage.SuccessfullyAnalyzed+scan.market_coverage.Errors,3);
  assert.equal(scan.sourceIsolation.rc2RuntimeImports,0);
  assert.equal(scan.permissions.executionAllowed,false);
  assert.ok(scan.all.every(x=>x.audit_stages?.data_integrity));
  assert.ok(scan.errors.some(x=>x.symbol==='ERR'&&x.engine_stage==='ANALYSIS'));
});
