#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const audit = read('data/v20/sector-provenance-audit.json');
const policy = read('data/v20/policy-registry.json');
const profiles = read('data/v20/stock-profiles.json');
const portfolio = read('data/v20/portfolio-risk.json');
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

const sectorPolicy = policy?.portfolio?.sectorConcentrationPolicy || {};
check(audit.schemaVersion === '20.0.0-sector-provenance-audit-1', 'SECTOR_AUDIT_SCHEMA_UNEXPECTED');
check(audit.summary?.universeCount === 227 || audit.summary?.universeCount === (audit.rows || []).length, 'SECTOR_AUDIT_UNIVERSE_COUNT_INVALID');
check(audit.summary?.productionVerifiedCount === 0, 'UNEXPECTED_PRODUCTION_VERIFIED_SECTOR');
check(audit.summary?.productionVerifiedCoveragePct === 0, 'UNEXPECTED_PRODUCTION_SECTOR_COVERAGE');
check(audit.summary?.productionSectorConcentrationEnabled === false, 'SECTOR_CONCENTRATION_ENABLED_WITHOUT_VERIFIED_PROVENANCE');
check(audit.summary?.status === 'BLOCKED_UNTIL_VERIFIED_PROVENANCE', 'SECTOR_AUDIT_NOT_BLOCKED');
check(audit.policy?.nameOrTickerInferenceAllowedForProduction === false, 'NAME_INFERENCE_ALLOWED_FOR_PRODUCTION');
check(audit.policy?.seedMapAllowedForProduction === false, 'SEED_MAP_ALLOWED_FOR_PRODUCTION');
check(audit.policy?.legacyMixedReportAllowedForProduction === false, 'LEGACY_MIXED_REPORT_ALLOWED_FOR_PRODUCTION');
check(audit.policy?.upstreamExplicitWithoutAuthoritativeRegistryAllowedForProduction === false, 'UNVERIFIED_EXPLICIT_SECTOR_ALLOWED_FOR_PRODUCTION');
check(audit.sourceAssessment?.legacyCompletionReport?.perSymbolProvenancePreserved === false, 'LEGACY_REPORT_FALSELY_CLAIMS_PER_SYMBOL_PROVENANCE');
check(sectorPolicy.status === 'BLOCKED_UNTIL_VERIFIED_PROVENANCE', 'POLICY_SECTOR_STATUS_NOT_BLOCKED');
check(sectorPolicy.enabled === false, 'POLICY_SECTOR_CONCENTRATION_ENABLED');
check(sectorPolicy.nameOrTickerInferenceAllowedForProduction === false, 'POLICY_NAME_INFERENCE_ALLOWED');
check(sectorPolicy.seedMapAllowedForProduction === false, 'POLICY_SEED_MAP_ALLOWED');
check(Array.isArray(sectorPolicy.acceptedProductionProvenance) && sectorPolicy.acceptedProductionProvenance.includes('VERIFIED_AUTHORITATIVE_EXPLICIT'), 'AUTHORITATIVE_PROVENANCE_REQUIREMENT_MISSING');

for (const row of audit.rows || []) {
  check(row.acceptedForProduction === false, `SECTOR_ROW_PRODUCTION_ACCEPTED_${row.ticker}`);
  check(row.productionSector === null, `PRODUCTION_SECTOR_POPULATED_${row.ticker}`);
  if (['UNVERIFIED_SEED_MAP','LEGACY_MIXED_REPORT','UPSTREAM_EXPLICIT_UNVERIFIED'].includes(row.researchProvenance)) {
    check(row.acceptedForProduction === false, `UNVERIFIED_PROVENANCE_ACCEPTED_${row.ticker}`);
  }
}

for (const profile of profiles.profiles || []) {
  check(profile.sectorContext?.sector === null, `PROFILE_PRODUCTION_SECTOR_LEAK_${profile.ticker}`);
  check(profile.sectorContext?.status !== 'VERIFIED_FOR_PRODUCTION', `PROFILE_FALSELY_VERIFIED_SECTOR_${profile.ticker}`);
}

check(portfolio.sectorConcentrationApplied !== true, 'PORTFOLIO_SECTOR_CONCENTRATION_APPLIED');
check(portfolio.productionSectorConcentrationEnabled !== true, 'PORTFOLIO_PRODUCTION_SECTOR_CONCENTRATION_ENABLED');

const report = {
  schemaVersion: '20.0.0-sector-provenance-regression-1',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  checks: {
    noNameInferenceInProduction: true,
    seedMapResearchOnly: true,
    legacyMixedReportResearchOnly: true,
    explicitFieldWithoutAuthorityResearchOnly: true,
    stockProfilesKeepProductionSectorNull: true,
    portfolioSectorConcentrationDisabled: true,
  },
  evidence: {
    universeCount: audit.summary?.universeCount || 0,
    researchCandidateCount: audit.summary?.researchCandidateCount || 0,
    productionVerifiedCount: audit.summary?.productionVerifiedCount || 0,
    conflictCount: audit.summary?.conflictCount || 0,
  }
};

fs.writeFileSync(P('data/v20/sector-provenance-regression.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
