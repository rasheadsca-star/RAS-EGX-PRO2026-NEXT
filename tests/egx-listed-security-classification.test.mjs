import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEgxCategorySets,classifyEgxListedSecurity,classifyEgxListedUniverse} from '../src/egx-listed-security-classification.js';

const cats={data:{
  categoryA:[{symboL_CODE:'EGS000000011'}],
  categoryB:[{symboL_CODE:'EGS000000022'}],
  categoryC:[],
  categoryD:[{symboL_CODE:'EGS000000033'}],
  shortSelling:[{symboL_CODE:'EGS000000011'}],
  sme:[{symboL_CODE:'EGS000000044'}]
}};
const stock=(isin,schedule='Egyptian securities-Stocks',extra={})=>({isin,reuters:'AAA.CA',name:'A',schedule,intraday:'Y',...extra});

test('official category sets normalize ISIN membership',()=>{
  const s=buildEgxCategorySets(cats);
  assert.equal(s.mostActive.has('EGS000000011'),true);
  assert.equal(s.medium.has('EGS000000022'),true);
  assert.equal(s.inactive.has('EGS000000033'),true);
  assert.equal(s.sme.has('EGS000000044'),true);
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
  assert.equal(r.smeOnly.length,1);
  assert.equal(r.smeOnly[0].isin,'EGS000000044');
  assert.equal(r.smeOnly[0].productionAuthority,false);
});
