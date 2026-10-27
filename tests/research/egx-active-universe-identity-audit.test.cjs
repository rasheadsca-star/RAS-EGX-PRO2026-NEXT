'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assess}=require('../../scripts/research/egx-active-universe-identity-audit.cjs');
test('five watchlist schema keys are review-only while a real security remains active',()=>{
 const names=['BLOCKS','BUCKETS','FOLLOW','RISK','RULES'];
 const map=Object.fromEntries([...names,'GTEX'].map(t=>[t,{
  ticker:t,active:true,companyNameEn:t==='GTEX'?'GTEX For Commercial':null,companyNameAr:null,
  discoverySources:t==='GTEX'?['data/universe-index.json']:['data/actionable-watchlist.json'],currency:'EGP'}]));
 const j=assess({map,history:{symbols:[{ticker:'GTEX',symbolVerified:false,availableSessions:0}]},
  search:{stocks:[]},market:{rows:[]},truth:{expectedSession:'2026-10-26',missingHistoryFiles:[]}});
 assert.equal(j.summary.mappedActive,6);
 assert.equal(j.summary.apparentStructuralKeys,5);
 assert.equal(j.structuralReview.some(x=>x.ticker==='GTEX'),false);
 assert.equal(j.structuralReview.every(x=>x.automaticallyExclude===false),true);
});
test('real mapped security with strong dated price evidence must never be suggested for structural review',()=>{
 const j=assess({map:{RISK:{ticker:'RISK',active:true,companyNameEn:'Example Stock',isin:'EG123',discoverySources:['data/actionable-watchlist.json']}},
 history:{symbols:[{ticker:'RISK',sourceFile:'data/history/RISK.json',availableSessions:100,symbolVerified:true,lastSession:'2026-10-26'}]},
 search:{stocks:[{ticker:'RISK'}]},market:{rows:[{symbol:'RISK'}]},truth:{expectedSession:'2026-10-26'}});
 assert.equal(j.summary.apparentStructuralKeys,0);
 assert.equal(j.summary.unverifiedIdentity,0);
});
