import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOhlcvGeometry,assessProviderOhlcvSemantics,classifyMarketDataFieldRole,classifySessionObservationAvailability} from '../src/market-data-semantics.js';

test('valid completed-session OHLCV geometry is accepted structurally',()=>{
  const r=validateOhlcvGeometry({open:8.43,high:8.63,low:8.43,close:8.49,volume:4240000});
  assert.equal(r.valid,true);
  assert.equal(r.state,'VALID_OHLCV_GEOMETRY');
});

test('Mubasher observed MTIE row cannot be admitted as true OHLCV when open is below low',()=>{
  const a=assessProviderOhlcvSemantics({
    provider:'MUBASHER_PUBLIC_HISTORY',declaredFields:true,fieldSemanticsVerified:true,
    samples:[{id:'MTIE:2026-08-31',bar:{open:8.41,high:8.63,low:8.43,close:8.49,volume:4240038}}]
  });
  assert.equal(a.state,'OHLCV_SEMANTICS_CONTRADICTED');
  assert.equal(a.trueOhlcvEligible,false);
  assert.deepEqual(a.evaluated[0].reasons,['OPEN_OUTSIDE_HIGH_LOW']);
  assert.equal(classifyMarketDataFieldRole({provider:'MUBASHER_PUBLIC_HISTORY',semanticAssessment:a}).role,'CLOSE_VOLUME_OR_IDENTITY_CROSSCHECK_ONLY');
});

test('StockAnalysis-style previous-close-as-open contradiction is also blocked provider-independently',()=>{
  const a=assessProviderOhlcvSemantics({provider:'STOCKANALYSIS_PUBLIC',declaredFields:true,fieldSemanticsVerified:true,samples:[
    {id:'MTIE:2026-08-31',bar:{open:8.41,high:8.63,low:8.43,close:8.49,volume:4240000}}
  ]});
  assert.equal(a.trueOhlcvEligible,false);
});

test('coherent Investing MTIE sample is research eligible only when field semantics are verified and never gains production authority',()=>{
  const a=assessProviderOhlcvSemantics({provider:'INVESTING_PUBLIC_WEB',declaredFields:true,fieldSemanticsVerified:true,samples:[
    {id:'MTIE:2026-08-31',bar:{open:8.43,high:8.63,low:8.43,close:8.49,volume:4240000}}
  ]});
  assert.equal(a.state,'TRUE_OHLCV_RESEARCH_ELIGIBLE');
  assert.equal(a.trueOhlcvEligible,true);
  assert.equal(a.productionAuthority,false);
  assert.equal(classifyMarketDataFieldRole({provider:'INVESTING_PUBLIC_WEB',semanticAssessment:a}).role,'RESEARCH_TRUE_OHLCV_CANDIDATE');
});

test('declared field names alone are insufficient when their semantics have not been verified',()=>{
  const a=assessProviderOhlcvSemantics({provider:'UNKNOWN',declaredFields:true,fieldSemanticsVerified:false,samples:[
    {id:'x',bar:{open:10,high:12,low:9,close:11,volume:5}}
  ]});
  assert.equal(a.state,'INSUFFICIENT_SEMANTIC_EVIDENCE');
  assert.equal(a.trueOhlcvEligible,false);
});

test('undeclared fields are insufficient even when geometry happens to look valid',()=>{
  const a=assessProviderOhlcvSemantics({provider:'UNKNOWN',declaredFields:false,fieldSemanticsVerified:true,samples:[
    {id:'x',bar:{open:10,high:12,low:9,close:11,volume:5}}
  ]});
  assert.equal(a.state,'INSUFFICIENT_SEMANTIC_EVIDENCE');
  assert.equal(a.trueOhlcvEligible,false);
});

test('official EGX stock-chart synthetic last-price OHLC placeholders are rejected even when geometry is valid',()=>{
  const a=assessProviderOhlcvSemantics({
    provider:'EGX_FRONTEND_STOCK_CHART_ADAPTER',
    declaredFields:true,
    fieldSemanticsVerified:false,
    syntheticFieldEvidence:true,
    samples:[{id:'synthetic-placeholder',bar:{open:10,high:10,low:10,close:10,volume:100}}]
  });
  assert.equal(a.evaluated[0].valid,true);
  assert.equal(a.state,'SYNTHETIC_OHLC_FIELDS_REJECTED');
  assert.equal(a.trueOhlcvEligible,false);
  assert.equal(a.productionAuthority,false);
  assert.equal(classifyMarketDataFieldRole({provider:'EGX_FRONTEND_STOCK_CHART_ADAPTER',semanticAssessment:a}).role,'CLOSE_VOLUME_OR_IDENTITY_CROSSCHECK_ONLY');
});

test('zero official volume is classified as no-trade evidence and never causes a synthetic flat OHLC bar',()=>{
  const r=classifySessionObservationAvailability({officialVolume:0,independentBar:null});
  assert.equal(r.state,'NO_TRADE_SESSION_EVIDENCE');
  assert.equal(r.trueTradeBarExpected,false);
  assert.equal(r.liquidityBand,'NO_TRADE');
  assert.equal(r.maySynthesizeOhlc,false);
  assert.equal(r.productionAuthority,false);
});

test('positive micro-volume with no independent bar remains a missing true traded-session bar',()=>{
  const r=classifySessionObservationAvailability({officialVolume:3,independentBar:null});
  assert.equal(r.state,'TRADED_SESSION_BAR_MISSING');
  assert.equal(r.trueTradeBarExpected,true);
  assert.equal(r.liquidityBand,'MICRO_TRADE');
  assert.deepEqual(r.reasons,['POSITIVE_OFFICIAL_VOLUME_REQUIRES_TRUE_SESSION_BAR']);
  assert.equal(r.maySynthesizeOhlc,false);
});

test('positive official volume with a public row is present but not semantically certified by availability alone',()=>{
  const r=classifySessionObservationAvailability({officialVolume:1216953,independentBar:{close:17}});
  assert.equal(r.state,'TRADED_SESSION_BAR_PRESENT_UNVERIFIED');
  assert.equal(r.trueTradeBarExpected,true);
  assert.equal(r.liquidityBand,'TRADED');
  assert.equal(r.productionAuthority,false);
});
