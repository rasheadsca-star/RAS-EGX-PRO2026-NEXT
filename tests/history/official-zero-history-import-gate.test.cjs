'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateOfficialBootstrap:gate}=require('../../scripts/history/official-zero-history-import-gate.cjs');
const sessions=Array.from({length:60},(_,i)=>({date:i===59?'2026-10-26':'2026-07-'+String(i+1).padStart(2,'0'),currency:'EGP'}));
const args={entry:{ticker:'BONY',active:true,isin:'EGS123',currency:'EGP'},existing:null,
 item:{ticker:'BONY',source:'egx_official',isin:'EGS123',currency:'EGP',sourceUrl:'https://egx.com.eg/example',sessions},
 latestMarketSession:'2026-10-26',review:{reviewedBy:'independent reviewer',reviewedAt:'2026-10-27'}};
test('source-provenance requirements hold on zero-existing-file bootstrap',()=>{
 assert.equal(gate(args).eligible,true);
 for(const item of [{...args.item,source:'mubasher'},{...args.item,isin:'WRONG'},
 {...args.item,sessions:sessions.slice(0,20)},{...args.item,currency:'USD'},
 {...args.item,sessions:[...sessions,{date:'2026-10-27',currency:'EGP'}]}]){
  assert.equal(gate({...args,item}).eligible,false);
 }
 assert.equal(gate({...args,review:{}}).eligible,false);
});
test('existing history does not waive security currency mismatch',()=>{
 assert.equal(gate({...args,existing:{sessions:[{date:'2026-10-20'}]},item:{...args.item,currency:'USD'}}).eligible,false);
});
test('USD stock cannot import EGP candles via defaulting or metadata substitution',()=>{
 const a={...args,entry:{ticker:'GTEX',currency:'USD',isin:'EGSUSD',active:true},
 item:{...args.item,isin:'EGSUSD',currency:'USD',sessions:sessions.map(x=>({...x,currency:'EGP'}))}};
 assert.equal(gate(a).eligible,false);
});
