'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const guards=require('../research-guards.js');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const source=JSON.parse(read('official-session-latest.json'));
test('session selection uses expected date, not a fixed 2026-11-05 literal',()=>{
 assert.equal(guards.isCurrentReport({session:'2026-11-06',quotes:[{}]},'2026-11-06'),true);
 assert.equal(guards.isCurrentReport({session:'2026-11-05',quotes:[{}]},'2026-11-06'),false);
 const dashboard=read('decision-dashboard.js');
 assert.match(dashboard,/guards\.isCurrentReport\(report,expectedSession\(\)\)/);
 assert.doesNotMatch(dashboard,/report\.session\s*===?\s*['"]2026-11-05['"]/);
});
test('MANUAL_PROVISIONAL and suggested identity are never eligible, even with fabricated flags',()=>{
 for(const matching of ['MANUAL_PROVISIONAL','EVIDENCE_SUGGESTED_UNVERIFIED']){
  const row={ticker:'ZZZZ',matching,close:2.11,currency:'EGP',identityVerified:true,verifiedIsin:'X',isin:'X',ohlcvStatus:'PASS_ARITHMETIC'};
  assert.equal(guards.eligible(row),false);
  assert.equal(guards.researchRows({quotes:[row]}).length,0);
  assert.equal(guards.quarantinedRows({quotes:[row]}).length,1);
 }
 assert.equal(source.quotes.every(r=>r.matching!=='MANUAL_PROVISIONAL'||!guards.eligible(r)),true);
 assert.equal(source.approvedForRealTrading,false);
});
test('published and local official close preview are not truncated at 24',()=>{
 const ui=read('official-quotes-dashboard.js');
 assert.match(ui,/for\(const q of quotes\)/);
 assert.doesNotMatch(ui,/\.slice\(0,\s*24\)/);
});
test('official OHLC is never inserted into separate historical candles without identity evidence',()=>{
 const dashboard=read('decision-dashboard.js'),enhanced=read('decision-enhancements.js');
 assert.doesNotMatch(dashboard,/bars\.push\(\{date:official\.session/);
 assert.doesNotMatch(enhanced,/history\.push\(\{date:'2026-11-05'/);
 const a=[{date:'2026-11-03',close:10}];
 assert.deepEqual(guards.datedHistory(a,'2026-11-05'),a);
 assert.notEqual(guards.datedHistory(a,'2026-11-05'),a);
});
test('row 152 corrected ICID to EHDR, but remains explicitly unverified',()=>{
 const row=source.quotes.find(r=>r.rowNumber===152);
 assert.equal(row.close,2.11);assert.equal(row.ticker,'EHDR');
 assert.equal(row.identityVerified,false);
 assert.equal(row.matching,'EVIDENCE_SUGGESTED_UNVERIFIED');
 assert.match(row.reconciliationEvidence,/reconciliation\.csv/);
 assert.equal(guards.eligible(row),false);
 assert.equal(source.quotes.filter(r=>r.rowNumber===152&&r.ticker==='ICID').length,0);
});
