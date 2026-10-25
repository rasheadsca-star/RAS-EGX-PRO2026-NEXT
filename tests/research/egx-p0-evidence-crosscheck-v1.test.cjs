'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {check}=require('../../scripts/research/egx-p0-evidence-crosscheck-v1.cjs');
const investigation={schemaVersion:'egx-p0-scale-investigation-v1',cases:[{ticker:'SEIGA',conflictSessions:1,firstConflictDate:'2026-09-01',lastConflictDate:'2026-09-01',conflictingDates:[{date:'2026-09-01',sourceClose:1,mainClose:10}]}]};
const leads={schemaVersion:'egx-p0-independent-leads-v1',cases:[{ticker:'SEIGA',hypothesis:'CURRENCY',evidence:[]}]};
test('secondary source and ratio never approve correction',()=>{const r=check(investigation,leads);assert.equal(r.approvedCorrections,0);assert.equal(r.cases[0].approvedFactor,null);assert.equal(r.cases[0].officialISINConfirmed,false)});
test('distinct SEIGA and SEIG identifiers remain unverified',()=>{const r=check(investigation,leads);assert.equal(r.cases[0].identityAndCurrencyLead.distinctSecurityIdentifiers.length,2);assert.equal(r.cases[0].decision,'BLOCKED_REQUIRES_OFFICIAL_DATE_MATCHED_EVIDENCE')});
test('duplicate dated conflicts fail closed',()=>{const d=structuredClone(investigation);d.cases[0].conflictingDates.push(d.cases[0].conflictingDates[0]);assert.equal(check(d,leads).cases[0].decision,'INVALID_CONFLICT_LEDGER')});
test('invalid schemas are rejected',()=>assert.throws(()=>check({},leads),/Invalid/));
