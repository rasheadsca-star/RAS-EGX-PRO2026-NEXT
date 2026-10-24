'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {missingDates}=require('../../scripts/research/egx-missing-market-sessions-sensitivity-v1.cjs');
test('officially closed dates do not count as missing',()=>{const universe={ABC:[{date:'2026-05-25'},{date:'2026-06-01'}]};const t={ticker:'ABC',entryDate:'2026-05-25',exitDate:'2026-06-01'};const closures=new Set(['2026-05-26','2026-05-27','2026-05-28','2026-05-31']);assert.deepEqual(missingDates(t,universe,closures),[])});
test('missing June 1 when trading resumed is flagged',()=>{const universe={ABC:[{date:'2026-05-25'},{date:'2026-06-02'}]};const t={ticker:'ABC',entryDate:'2026-05-25',exitDate:'2026-06-02'};const closures=new Set(['2026-05-26','2026-05-27','2026-05-28','2026-05-31']);assert.deepEqual(missingDates(t,universe,closures),['2026-06-01'])});
