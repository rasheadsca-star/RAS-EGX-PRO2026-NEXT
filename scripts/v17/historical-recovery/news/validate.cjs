#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

function validateNewsOutput(output) {
  const issues = [];
  if (!output?.researchOnly) issues.push('NOT_RESEARCH_ONLY');
  if (!Array.isArray(output?.events) || !Array.isArray(output?.results)) issues.push('ARRAYS_MISSING');
  const fingerprints = new Set();
  for (const event of output?.events || []) {
    if (fingerprints.has(event.fingerprint)) issues.push(`DUPLICATE:${event.fingerprint}`);
    fingerprints.add(event.fingerprint);
    if (event.decisionEligible && (!event.sourceUrl && !event.officialReference)) issues.push(`${event.fingerprint}:PROVENANCE_MISSING`);
    if (event.sourceTier === 'TIER_4' && (event.decisionEligible || event.newsImpactScore !== 0)) issues.push(`${event.fingerprint}:RUMOR_ALTERS_DECISION`);
  }
  return { valid: issues.length === 0, issues };
}

if (require.main === module) {
  const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
  const output = JSON.parse(fs.readFileSync(path.join(root, 'data/v17/historical-recovery/news/current.json'), 'utf8'));
  const result = validateNewsOutput(output);
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exit(1);
}

module.exports = { validateNewsOutput };
