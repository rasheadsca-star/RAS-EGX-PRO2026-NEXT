'use strict';const assert=require('node:assert/strict');const {reconcile}=require('../../scripts/quant/batch-daily-evidence.cjs');
const gaps=[{ticker:'ARCC',date:'2026-06-01',missingMarkFrequency:'12'},{ticker:'ELSH',date:'2026-06-01',missingMarkFrequency:'1'}];
function row(ticker,family,close,lic='LICENSED_INTERNAL_RESEARCH'){return {ticker,date:'2026-06-01',isin:'EGS123456789',close:String(close),volume:'1000',source_family:family,source_url:'https://example.org/'+family,price_basis:'RAW_UNADJUSTED',license_scope:lic};}
const a=reconcile(gaps,[row('ARCC','vendor',9),row('ARCC','broker',9),row('ELSH','vendor',7,'UNKNOWN'),row('ELSH','broker',7,'UNKNOWN')]);
assert.equal(a.summary.gapPairs,2);assert.equal(a.summary.missingMarks,13);assert.equal(a.summary.matchedCloses,2);assert.equal(a.summary.licenceBlocked,1);assert.equal(a.summary.eligibleResearchMarks,12);assert.equal(a.canonicalImports,0);
assert.equal(reconcile(gaps,[row('ARCC','vendor',9),row('ARCC','vendor',9)]).summary.matchedCloses,0);
assert.equal(reconcile(gaps,[row('ARCC','vendor',9),row('ARCC','broker',9.03)]).summary.matchedCloses,0);
assert.equal(reconcile(gaps,[row('ARCC','vendor',9),{...row('ARCC','broker',9),isin:'EGS000000000'}]).summary.eligibleResearchMarks,0);
assert.equal(reconcile([{...gaps[0],corporateActionRisk:'true'}],[row('ARCC','vendor',9),row('ARCC','broker',9)]).summary.eligibleResearchMarks,0);
console.log('Batch licence and price reconciliation: PASS');