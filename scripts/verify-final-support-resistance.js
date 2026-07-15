#!/usr/bin/env node
'use strict';
const fs = require('fs');

function read(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function n(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }
function valid(r) { return n(r?.support1) > 0 && n(r?.resistance1) > 0 && n(r.support1) < n(r.resistance1); }

const market = read('data/market.json');
const report = read('data/support-resistance-verification.json');
const decision = read('data/today-decision-center.json');

const rows = Array.isArray(market.rows) ? market.rows : [];
const validRows = rows.filter(valid);
const coverage = rows.length ? validRows.length / rows.length * 100 : 0;
const badExecutable = (decision.rankedOpportunities || []).filter(r =>
  r.opportunityState === 'EXECUTABLE' && r.srVerified !== true
);

if (!report.ok) throw new Error('support-resistance-verification.json is not OK');
if (coverage < Number(process.env.EGX_SR_MIN_COVERAGE || 60)) {
  throw new Error(`Coverage too low: ${coverage.toFixed(2)}%`);
}
if (badExecutable.length) {
  throw new Error(`Executable opportunities without verified S/R: ${badExecutable.map(x => x.symbol).join(', ')}`);
}
console.log('FINAL SR VERIFICATION PASSED', {
  marketRows: rows.length,
  validSupportResistanceRows: validRows.length,
  coveragePct: Number(coverage.toFixed(2)),
  ranked: decision.summary?.rankedCount || 0,
  executable: decision.summary?.executionCount || 0
});
