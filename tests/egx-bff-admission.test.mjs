import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectEgxMarketWatchPage,certifyEgxMarketWatchPagination,inspectEgxPriceVolumePoints} from '../src/egx-bff-admission.js';

function page({page=1,pageSize=10,total=2,totalPages=1,rows=[]}={}){
  return {data:{data:rows,totalCount:total,pageNumber:page,pageSize,totalPages},success:true,message:`Retrieved ${rows.length} records out of ${total} in 9ms`,totalCount:total,pageNumber:page,pageSize,totalPages};
}

test('exact observed market-watch contradiction fails closed',()=>{
  const payload={data:{data:[],totalCount:1,pageNumber:1,pageSize:10,totalPages:1},success:true,message:'Retrieved 0 records out of 0 in 9ms',totalCount:1,pageNumber:1,pageSize:10,totalPages:1};
  const r=inspectEgxMarketWatchPage(payload,{requestedPage:1,requestedPageSize:10});
  assert.equal(r.state,'SCHEMA_OR_RESPONSE_INCOHERENT');
  assert.ok(r.reasons.includes('EMPTY_PAGE_WITH_POSITIVE_TOTAL_COUNT'));
  assert.ok(r.reasons.includes('MESSAGE_TOTAL_COUNT_MISMATCH'));
  assert.equal(r.universeAuthorityEligible,false);
});

test('coherent market-watch page is only ready for result-set pagination',()=>{
  const r=inspectEgxMarketWatchPage(page({rows:[{isin:'EGS000000001',reuters:'AAA.CA'},{isin:'EGS000000002',reuters:'BBB.CA'}]}),{requestedPage:1,requestedPageSize:10});
  assert.equal(r.state,'READY_FOR_RESULT_SET_PAGINATION');
  assert.equal(r.scopeClassification,'UNRESOLVED_BFF_RESULT_SET');
  assert.equal(r.allListedEquitiesProven,false);
  assert.equal(r.tradedSessionUniverseProven,false);
});

test('complete BFF pagination still cannot self-certify universe scope',()=>{
  const r=certifyEgxMarketWatchPagination([page({rows:[{isin:'EGS000000001',reuters:'AAA.CA'},{isin:'EGS000000002',reuters:'BBB.CA'}]})]);
  assert.equal(r.state,'READY_FOR_BFF_RESULT_SET_RECONCILIATION');
  assert.equal(r.totalCount,2);
  assert.equal(r.independentScopeCrossCheckRequired,true);
  assert.equal(r.universeAuthorityEligible,false);
  assert.equal(r.productionAuthority,false);
});

test('incomplete pagination is blocked even when individual pages are coherent',()=>{
  const p1=page({page:1,total:3,totalPages:2,rows:[{isin:'EGS000000001',reuters:'AAA.CA'},{isin:'EGS000000002',reuters:'BBB.CA'}]});
  const r=certifyEgxMarketWatchPagination([p1]);
  assert.equal(r.state,'BLOCKED');
  assert.ok(r.reasons.includes('PAGINATION_INCOMPLETE'));
  assert.ok(r.reasons.includes('FULL_ROW_COUNT_MISMATCH'));
});

test('duplicate identity across pages blocks market-watch certification',()=>{
  const p1=page({page:1,pageSize:1,total:2,totalPages:2,rows:[{isin:'EGS000000001',reuters:'AAA.CA'}]});
  const p2=page({page:2,pageSize:1,total:2,totalPages:2,rows:[{isin:'EGS000000001',reuters:'AAA.CA'}]});
  const r=certifyEgxMarketWatchPagination([p1,p2],{requestedPageSize:1});
  assert.equal(r.state,'BLOCKED');
  assert.ok(r.reasons.includes('DUPLICATE_ROW_IDENTITY'));
});

test('price-volume-points is close-volume history and not OHLCV authority',()=>{
  const payload={data:[{isinCode:'EGS21351C019',tradeDate:'2026-08-30T00:00:00',closePrice:0.499,tradeVolume:1000}],success:true,message:'ok',totalCount:1};
  const r=inspectEgxPriceVolumePoints(payload);
  assert.equal(r.state,'READY_FOR_CLOSE_VOLUME_HISTORY_VALIDATION');
  assert.equal(r.capability,'CLOSE_VOLUME_HISTORY');
  assert.equal(r.ohlcvComplete,false);
  assert.equal(r.ohlcvAuthorityEligible,false);
});
