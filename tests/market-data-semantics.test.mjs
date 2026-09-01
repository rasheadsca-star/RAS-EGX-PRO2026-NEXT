import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOhlcvGeometry,assessProviderOhlcvSemantics,classifyMarketDataFieldRole} from '../src/market-data-semantics.js';

test('valid completed-session OHLCV geometry is accepted structurally',()=>{
  const r=validateOhlcvGeometry({open:8.43,high:8.63,low:8.43,close:8.49,volume:4240000});
  assert.equal(r.valid,true);
  assert.equal(r.state,'VALID_OHLCV_GEOMETRY');
});

test('Mubasher observed MTIE row cannot be admitted as true OHLCV when open is below low',()=>{
  const a=assessProviderOhlcvSemantics({
    provider:'MUBASHER_PUBLIC_HISTORY',declaredFields:true,
    samples:[{id:'MTIE:2026-08-31',bar:{open:8.41,high:8.63,low:8.43,close:8.49,volume:4240038}}]
  });
  assert.equal(a.state,'OHLCV_SEMANTICS_CONTRADICTED');
  assert.equal(a.trueOhlcvEligible,false);
  assert.deepEqual(a.evaluated[0].reasons,['OPEN_OUTSIDE_HIGH_LOW']);
  assert.equal(classifyMarketDataFieldRole({provider:'MUBASHER_PUBLIC_HISTORY',semanticAssessment:a}).role,'CLOSE_VOLUME_OR_IDENTITY_CROSSCHECK_ONLY');
});

test('StockAnalysis-style previous-close-as-open contradiction is also blocked provider-independently',()=>{
  const a=assessProviderOhlcvSemantics({provider:'STOCKANALYSIS_PUBLIC',declaredFields:true,samples:[
    {id:'MTIE:2026-08-31',bar:{open:8.41,high:8.63,low:8.43,close:8.49,volume:4240000}}
  ]});
  assert.equal(a.trueOhlcvEligible,false);
});

test('coherent Investing MTIE sample is research eligible but never gains production authority',()=>{
  const a=assessProviderOhlcvSemantics({provider:'INVESTING_PUBLIC_WEB',declaredFields:true,samples:[
    {id:'MTIE:2026-08-31',bar:{open:8.43,high:8.63,low:8.43,close:8.49,volume:4240000}}
  ]});
  assert.equal(a.state,'TRUE_OHLCV_RESEARCH_ELIGIBLE');
  assert.equal(a.trueOhlcvEligible,true);
  assert.equal(a.productionAuthority,false);
  assert.equal(classifyMarketDataFieldRole({provider:'INVESTING_PUBLIC_WEB',semanticAssessment:a}).role,'RESEARCH_TRUE_OHLCV_CANDIDATE');
});

test('declared field semantics are mandatory even when geometry happens to look valid',()=>{
  const a=assessProviderOhlcvSemantics({provider:'UNKNOWN',declaredFields:false,samples:[
    {id:'x',bar:{open:10,high:12,low:9,close:11,volume:5}}
  ]});
  assert.equal(a.state,'INSUFFICIENT_SEMANTIC_EVIDENCE');
  assert.equal(a.trueOhlcvEligible,false);
});
