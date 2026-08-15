#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => fs.readFileSync(P(rel), 'utf8');
const json = rel => JSON.parse(read(rel));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function schemaRevision(value, prefix) {
  const match = String(value || '').match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([0-9]+)$`));
  return match ? Number(match[1]) : null;
}

const builder = read('scripts/v20/build-integrated-decision-snapshot.cjs');
const index = read('v20/index.html');
const app = read('v20/app.js');
const styles = read('v20/styles.css');
const uiValidator = read('scripts/v20/validate-ui.cjs');
const policy = json('data/v20/policy-registry.json');
const marketRegime = json('data/v20/market-regime.json');

const policyRevision = schemaRevision(policy.schemaVersion, '20.0.0-policy-registry-');
const uiSchemaMatch = uiValidator.match(/schemaVersion:\s*['"]20\.0\.0-ui-validation-([0-9]+)['"]/);
const uiRevision = uiSchemaMatch ? Number(uiSchemaMatch[1]) : null;

const requiredUiIds = [
  'marketRegimePanel',
  'marketRegimeBadge',
  'marketRegimeTitle',
  'marketRegimeCoverage',
  'marketRegimeConfidence',
  'marketRegimeScore',
  'marketRegimeBreadth',
  'marketRegimeSma20',
  'marketRegimeSma50',
  'marketRegimeMomentum5',
  'marketRegimeMomentum20',
  'marketRegimeVolatility',
  'marketRegimeWarning',
];

const checks = {
  builderReadsCurrentMarketRegime: builder.includes("read('data/v20/market-regime.json')"),
  builderUsesCurrentRegimeEvidence: builder.includes("evidenceSource: 'data/v20/market-regime.json'") && builder.includes('marketRegimeGeneratedAt'),
  policyNotDowngraded: policyRevision !== null && policyRevision >= 7,
  policyMarketRegimePresent: policy.marketRegime?.scope === 'V20_MASTER_UNIVERSE',
  policyNoFutureLeakage: policy.marketRegime?.futureRowsAllowed === false && policy.marketRegime?.missingOhlcSynthesisAllowed === false,
  policyNoSectorInference: policy.marketRegime?.sectorInputsAllowed === false,
  policyNoExecutionInfluence: policy.marketRegime?.productionRiskBudgetInfluence === false && policy.marketRegime?.executionGateInfluence === false,
  marketRegimeEvidencePresent: marketRegime?.methodology?.fullUniverseScope === true && marketRegime?.methodology?.futureRowsAllowed === false,
  indexMarketRegimePanelPresent: requiredUiIds.every(id => index.includes(`id="${id}"`)),
  appMarketRegimeStatePresent: app.includes('marketRegime: null'),
  appMarketRegimeFetchPresent: app.includes("json('../data/v20/market-regime.json')"),
  appMarketRegimeRendererPresent: app.includes('function renderMarketRegime()'),
  appExecutionSeparationCopyPresent: app.includes('لا تفتح بوابة التنفيذ') && app.includes('لا تغيّر أوزان الإنتاج'),
  stylesMarketRegimePresent: styles.includes('.market-regime-panel{'),
  uiValidatorNotDowngraded: uiRevision !== null && uiRevision >= 7,
  uiValidatorChecksRegimeWiring: uiValidator.includes('MARKET_REGIME_NOT_WIRED') && uiValidator.includes('MARKET_REGIME_RENDERER_MISSING'),
  uiValidatorChecksExecutionSeparation: uiValidator.includes('marketRegimeExecutionGateSeparated: true'),
  uiValidatorChecksBreadthConflictDisclosure: uiValidator.includes('marketRegimeBreadthConflictDisclosure: true'),
};

const failures = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name);
assert(failures.length === 0, `V20 Market Regime semantic integration incomplete: ${failures.join(', ')}`);

console.log(JSON.stringify({
  schemaVersion: '20.0.0-market-regime-integration-guard-2',
  state: 'ALREADY_INTEGRATED_SEMANTICALLY',
  patched: false,
  policySchemaVersion: policy.schemaVersion,
  uiValidationRevision: uiRevision,
  marketRegimeSchemaVersion: marketRegime.schemaVersion || null,
  checks,
}, null, 2));
