'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../../scripts/stable/v16-session-aware-price-truth.cjs'),'utf8');
const start=src.indexOf('const MONTHS = new Map(');
const end=src.indexOf('\nasync function fetchText(',start);
assert.ok(start>=0 && end>start,'session parser present');
const parse=vm.runInNewContext(src.slice(start,end)+';parseSourceSessionDate', {});
for(const [input,expected] of [
 ['Last update: 28/10/2026 09:49 AM market time','2026-10-28'],
 ['Last update: 27-10-2026','2026-10-27'],
 ['28 October 2026 09:49 AM market time','2026-10-28'],
 ['October 28 2026','2026-10-28'],
 ['2026-10-27','2026-10-27'],
 ['31/02/2026',null],
 ['2026-02-31',null],
 ['09:49 AM market time',null],
 ['28 October 09:49 AM market time',null]
]) {
 test('explicit source session: '+input,()=>assert.equal(parse(input,'2026-10-28'),expected));
}
