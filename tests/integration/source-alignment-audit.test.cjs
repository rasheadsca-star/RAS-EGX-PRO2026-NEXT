'use strict';const test=require('node:test'),assert=require('node:assert/strict'),{audit}=require('../../scripts/integration/source-alignment-audit.cjs');
const app=s=>({sourceDecision:{session:s}}),hand=(s,n=210)=>({sessionDate:s,expectedSession:s,acceptedRows:n,sourceSessionEvidenceCoveragePct:95,final:true,pagesPublished:true}),quant=s=>({sessionId:s});
test('matching verified handoff passes',()=>assert.equal(audit(app('2026-10-28'),hand('2026-10-28'),quant('2026-10-28')).status,'PASS'));
test('stale Astra blocks production',()=>{const r=audit(app('2026-10-21'),hand('2026-10-28'),quant('2026-10-28'));assert.equal(r.status,'BLOCKED');assert.equal(r.checks.astraHandoffSessionMatch,false)});
test('low accepted count remains blocked',()=>assert.equal(audit(app('2026-10-28'),hand('2026-10-28',179),quant('2026-10-28')).status,'BLOCKED'));
test('conditional 195 accepted rows pass while 179 remain blocked',()=>{const result=audit(app('2026-10-28'),hand('2026-10-28',195),quant('2026-10-28'));assert.equal(result.status,'PASS');assert.equal(result.coverageTargetRows,200);assert.equal(result.conditionalFloorRows,190)});
test('mismatched quant session blocks',()=>assert.equal(audit(app('2026-10-28'),hand('2026-10-28'),quant('2026-10-21')).status,'BLOCKED'));
