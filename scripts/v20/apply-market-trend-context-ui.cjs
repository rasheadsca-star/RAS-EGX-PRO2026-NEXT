#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const file = path.join(root, 'v20/app.js');
let text = fs.readFileSync(file, 'utf8');

function replaceExact(from, to, label) {
  if (text.includes(to)) return {label, state:'ALREADY_APPLIED'};
  if (!text.includes(from)) throw new Error(`Market trend UI patch expected pattern missing: ${label}`);
  text = text.replace(from, to);
  return {label, state:'APPLIED'};
}

const results = [];
results.push(replaceExact(
  `    $('marketCurrentCoverage').textContent = pct(s.currentSessionCoveragePct); $('marketTechnicalCurrent').textContent = \`${'${num(s.currentTechnicalReadyCount, 0)}'} حالي\`; $('marketTechnicalCoverage').textContent = \`${'${pct(s.technicalCurrentCoverageOfOpportunityUniversePct)}'} من نطاق الفرص\`;`,
  `    $('marketCurrentCoverage').textContent = pct(s.currentSessionCoveragePct); $('marketTechnicalCurrent').textContent = \`${'${num(s.currentTechnicalReadyCount, 0)}'} Full Technical\`; $('marketTechnicalCoverage').textContent = \`${'${pct(s.technicalCurrentCoverageOfOpportunityUniversePct)}'} من الفرص • سياق اتجاه موثوق ${'${pct(s.marketTrendContextCoverageOfUniversePct)}'} من السوق\`;`,
  'market-summary-trend-context'
));

results.push(replaceExact(
  `  function technicalTag(row) { const value = row.technical?.state; const klass = value === 'CURRENT_READY' ? 'tech-current' : value === 'HISTORICAL_CONTEXT_ONLY' ? 'tech-historical' : value === 'NOT_EVALUATED_IN_CURRENT_TECHNICAL_SCOPE' ? 'tech-not-evaluated' : 'tech-unavailable'; return \`<span class="technical-tag ${'${klass}'}">${'${esc(technicalAr(value))}'}</span>\`; }`,
  `  function technicalTag(row) {\n    const value = row.technical?.state;\n    if (value === 'NOT_EVALUATED_IN_CURRENT_TECHNICAL_SCOPE' && row.marketTrendContext?.available === true) {\n      return '<span class="technical-tag tech-historical">سياق اتجاه حالي موثوق</span>';\n    }\n    const klass = value === 'CURRENT_READY' ? 'tech-current' : value === 'HISTORICAL_CONTEXT_ONLY' ? 'tech-historical' : value === 'NOT_EVALUATED_IN_CURRENT_TECHNICAL_SCOPE' ? 'tech-not-evaluated' : 'tech-unavailable';\n    return \`<span class="technical-tag ${'${klass}'}">${'${esc(technicalAr(value))}'}</span>\`;\n  }`,
  'market-row-trend-context-tag'
));

fs.writeFileSync(file, text, 'utf8');
console.log(JSON.stringify({schemaVersion:'20.0.0-market-trend-context-ui-patch-1',results}, null, 2));
