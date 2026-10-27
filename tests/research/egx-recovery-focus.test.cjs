'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {focusFromPersistent}=require('../../scripts/research/egx-recovery-focus.cjs');
const universe={
 BONY:{ticker:'BONY',active:true},
 CFGH:{ticker:'CFGH',active:true},
 GTWL:{ticker:'GTWL',active:true},
 COMI:{ticker:'COMI',active:true},
 BLOCKS:{ticker:'BLOCKS',active:false}
};
const hist={symbols:[
 {ticker:'BONY',availableSessions:0,lastSession:null,symbolVerified:false,lastUpdateError:'Yahoo failed HTTP 404'},
 {ticker:'CFGH',availableSessions:19,lastSession:'2026-10-26',symbolVerified:true},
 {ticker:'GTWL',availableSessions:162,lastSession:'2026-10-26',symbolVerified:true},
 {ticker:'COMI',availableSessions:162,lastSession:'2026-10-25',symbolVerified:true}
]};
test('zero-row failed live truth does not erase real missing historic identities',()=>{
 const rows=focusFromPersistent({truth:{ready:false,acceptedRows:0,missingHistoryFiles:[]},historySummary:hist,symbolMap:universe,expectedSession:'2026-10-26'});
 assert.deepEqual(rows.map(x=>x.ticker),['BONY','CFGH','COMI']);
 assert.ok(rows.find(x=>x.ticker==='BONY').reasons.includes('YAHOO_HTTP_404'));
 assert.ok(rows.find(x=>x.ticker==='COMI').reasons.includes('EXPECTED_SESSION_HISTORY_GAP'));
 assert.ok(rows.find(x=>x.ticker==='CFGH').reasons.includes('LESS_THAN_60_VALID_BARS_REQUIRES_SOURCE_AUDIT'));
 assert.ok(rows.every(x=>x.autoPromote===false));
});
test('live false report may supply additive missing identities but never includes quarantined schema tokens',()=>{
 const rows=focusFromPersistent({truth:{ready:false,missingHistoryFiles:['BLOCKS','BONY']},historySummary:hist,symbolMap:universe,expectedSession:'2026-10-26'});
 assert.equal(rows.some(x=>x.ticker==='BLOCKS'),false);
 assert.ok(rows.some(x=>x.ticker==='BONY'));
});
test('historically sound current canonical symbol does not populate missing data queue',()=>{
 const rows=focusFromPersistent({truth:{ready:true,acceptedRows:200,missingHistoryFiles:[]},historySummary:hist,symbolMap:universe,expectedSession:'2026-10-26'});
 assert.equal(rows.some(x=>x.ticker==='GTWL'),false);
});
