import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEgxCategorySets,describeEgxCategoryTopology,classifyEgxListedSecurity,classifyEgxListedUniverse} from '../src/egx-listed-security-classification.js';

const cats={data:{
  categoryA:[{symboL_CODE:'EGS000000011'}],
  categoryB:[{symboL_CODE:'EGS000000022'}],
  categoryC:[],
  categoryD:[{symboL_CODE:'EGS000000033'},{symboL_CODE:'EGS000000044'}],
  shortSelling:[{symboL_CODE:'EGS000000011'}],
  sme:[{symboL_CODE:'EGS000000044'},{symboL_CODE:'EGS000000066'}]
}};
const stock=(isin,schedule='Egyptian securities-Stocks',extra={})=>({isin,reuters:'AAA.CA',name:'A',schedule,intraday:'Y',...extra});

test('official category sets normalize ISIN membership',()=>{
  const s=buildEgxCategorySets(cats);
  assert.equal(s.mostActive.has('EGS000000011'),true);
  assert.equal(s.medium.has('EGS000000022'),true);
  assert.equal(s.inactive.has('EGS000000033'),true);
  assert.equal(s.sme.has('EGS000000044'),true);
});

test('category topology reports overlaps instead of allowing naive additive totals',()=>{
  const t=describeEgxCategoryTopology(buildEgxCategorySets(cats));
  assert.equal(t.membershipCounts.INACTIVE,2);
  assert.equal(t.membershipCounts.SME,2);
  assert.equal(t.hasOverlaps,true);
  assert.deepEqual(t.overlaps.find(x=>x.left==='INACTIVE'&&x.right==='SME').members,['EGS000000044']);
});

test('A/B Egyptian stocks become tradable-equity candidates without production authority',()=>{
  const sets=buildEgxCategorySets(cats);
  const a=classifyEgxListedSecurity(stock('EGS000000011'),sets);
  const b=classifyEgxListedSecurity(stock('EGS000000022'),sets);
  assert.equal(a.listingState,'TRADABLE_MOST_ACTIVE');
  assert.equal(b.listingState,'TRADABLE_MEDIUM_ACTIVITY');
  assert.equal(a.productionTradableEquityCandidate,true);
  assert.equal(a.productionAuthority,false);
});

test('inactive stock is never tradable production candidate',()=>{
  const r=classifyEgxListedSecurity(stock('EGS000000033','Egyptian securities-Stocks',{intraday:'N'}),buildEgxCategorySets(cats));
  assert.equal(r.listingState,'INACTIVE_LISTED_EQUITY');
  assert.equal(r.productionTradableEquityCandidate,false);
});

test('unsegmented ordinary stock fails closed until temporary-listing evidence is bound',()=>{
  const row=stock('EGS000000055','Egyptian securities-Stocks',{intraday:'N'});
  const sets=buildEgxCategorySets(cats);
  assert.equal(classifyEgxListedSecurity(row,sets).listingState,'UNSEGMENTED_NONTRADING_LISTING_CANDIDATE');
  assert.equal(classifyEgxListedSecurity(row,sets,{temporaryListingEvidence:new Set(['EGS000000055'])}).listingState,'TEMPORARY_LISTING_CONFIRMED');
});

test('rights fund ETF and foreign equity cannot be silently counted as Egyptian common equities',()=>{
  const sets=buildEgxCategorySets(cats);
  assert.equal(classifyEgxListedSecurity(stock('R','Trading Rights issue'),sets).instrumentClass,'RIGHTS_ISSUE');
  assert.equal(classifyEgxListedSecurity(stock('F','Egyptian securities-Funds'),sets).instrumentClass,'FUND_CERTIFICATE');
  assert.equal(classifyEgxListedSecurity(stock('E','ETF'),sets).instrumentClass,'ETF');
  assert.equal(classifyEgxListedSecurity(stock('X','Foreign securities-Stocks'),sets).instrumentClass,'FOREIGN_EQUITY');
});

test('SME category members absent from stock-info stay identity-only instead of being fabricated into stock-info rows',()=>{
  const r=classifyEgxListedUniverse({data:[stock('EGS000000011')]},cats);
  assert.equal(r.smeOnly.length,2);
  assert.equal(r.smeOnly[0].productionAuthority,false);
  assert.equal(r.smeOnly.every(x=>x.listingState==='SME_IDENTITY_ONLY_FROM_CATEGORY_FEED'),true);
});

test('SME TAMAYUZ evidence is explicit and NILE complement remains research inference only',()=>{
  const r=classifyEgxListedUniverse({data:[stock('EGS000000011')]},cats,{
    smeTamayuzEvidence:['EGS000000044'],inferSmeNileFromComplement:true
  });
  const a=r.smeOnly.find(x=>x.isin==='EGS000000044');
  const b=r.smeOnly.find(x=>x.isin==='EGS000000066');
  assert.equal(a.smeSegment,'TAMAYUZ_INDEPENDENT_EVIDENCE');
  assert.deepEqual(a.marketMemberships,['SME','INACTIVE']);
  assert.equal(b.smeSegment,'NILE_INFERRED_FROM_OFFICIAL_SME_MINUS_TAMAYUZ');
  assert.deepEqual(r.smeSegmentCounts,{TAMAYUZ_INDEPENDENT_EVIDENCE:1,NILE_INFERRED_FROM_OFFICIAL_SME_MINUS_TAMAYUZ:1});
  assert.equal(r.productionAuthority,false);
});

test('TAMAYUZ evidence outside the official SME set is visible and blocks complement inference',()=>{
  const r=classifyEgxListedUniverse({data:[stock('EGS000000011')]},cats,{
    smeTamayuzEvidence:['EGS999999999'],inferSmeNileFromComplement:true
  });
  assert.deepEqual(r.invalidTamayuzEvidence,['EGS999999999']);
  assert.equal(r.smeOnly.every(x=>x.smeSegment==='UNRESOLVED'),true);
});

test('universe partition accepts object evidence records and reports confirmed temporary rows',()=>{
  const r=classifyEgxListedUniverse({data:[stock('EGS000000055','Egyptian securities-Stocks',{intraday:'N'})]},cats,{
    temporaryListingEvidence:[{isin:'EGS000000055'}]
  });
  assert.equal(r.temporaryListingConfirmedCount,1);
  assert.equal(r.unresolvedTemporaryEvidenceCount,0);
  assert.equal(r.stockInfoEquityPartition.TEMPORARY_LISTING_CONFIRMED,1);
});
