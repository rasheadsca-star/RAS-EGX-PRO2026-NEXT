#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);

function replaceExact(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Expected ${label} pattern not found; refusing broad patch`);
  return source.replace(before, after);
}

function patchBuilder() {
  const file = P('scripts/v20/build-integrated-decision-snapshot.cjs');
  let source = fs.readFileSync(file, 'utf8');

  source = replaceExact(
    source,
    "const sourceHealth = read('data/v20/source-health.json');",
    "const sourceHealth = read('data/v20/source-health.json');\nconst currentMarketRegime = read('data/v20/market-regime.json');",
    'market regime input',
  );

  source = replaceExact(
    source,
    "const marketRegime = v17?.market?.regime || 'UNVERIFIED_CURRENT_REGIME';\nconst marketVerified = !String(marketRegime).startsWith('UNVERIFIED');",
    "const marketRegimeSessionAligned = currentMarketRegime?.asOfSessionDate === sessionDate;\nconst marketVerified = currentMarketRegime?.verified === true && marketRegimeSessionAligned;\nconst marketRegime = marketVerified ? currentMarketRegime.regime : 'UNVERIFIED_CURRENT_REGIME';",
    'market regime authority',
  );

  source = replaceExact(
    source,
    "const marketConfidencePct = marketVerified\n  ? round(Math.min(gateCoveragePct, gateFreshnessPct, gateCriticalFieldsPct), 1)\n  : 0;",
    "const marketConfidencePct = marketVerified ? clamp(currentMarketRegime?.marketConfidencePct ?? 0, 0, 100) : 0;",
    'market confidence calculation',
  );

  source = replaceExact(
    source,
    "  ...(!marketVerified ? ['CURRENT_MARKET_REGIME_UNVERIFIED'] : []),\n  'V18_EXTERNAL_REFERENCE_BROWSER_AUDIT_PENDING',",
    "  ...(!marketVerified ? ['CURRENT_MARKET_REGIME_UNVERIFIED'] : []),\n  ...(currentMarketRegime?.asOfSessionDate && !marketRegimeSessionAligned ? ['MARKET_REGIME_EVIDENCE_SESSION_MISMATCH'] : []),\n  ...((currentMarketRegime?.warnings || []).map(w => `MARKET_REGIME_${w}`)),\n  'V18_EXTERNAL_REFERENCE_BROWSER_AUDIT_PENDING',",
    'market regime warnings',
  );

  source = replaceExact(
    source,
    "  marketStatus: {\n    regime: marketRegime,\n    labelAr: v17?.market?.labelAr || null,\n    verified: marketVerified,\n    marketConfidencePct,\n  },",
    "  marketStatus: {\n    regime: marketRegime,\n    labelAr: marketVerified ? (currentMarketRegime?.labelAr || null) : 'حالة السوق الحالية غير متحققة بتغطية تاريخية متزامنة كافية',\n    verified: marketVerified,\n    marketConfidencePct,\n    evidenceCoveragePct: finite(currentMarketRegime?.metrics?.participationPct),\n    classificationScore: finite(currentMarketRegime?.classificationScore),\n    diagnosticRegime: currentMarketRegime?.diagnosticRegime || null,\n    volatilityOverlay: currentMarketRegime?.volatilityOverlay || null,\n    evidenceSessionAligned: marketRegimeSessionAligned,\n    evidenceSource: 'data/v20/market-regime.json',\n    productionRiskBudgetInfluence: false,\n    executionGateInfluence: false,\n  },",
    'market status output',
  );

  source = replaceExact(
    source,
    "      sourceHealth: 'data/v20/source-health.json',\n    },",
    "      sourceHealth: 'data/v20/source-health.json',\n      marketRegime: 'data/v20/market-regime.json',\n    },",
    'market regime provenance',
  );

  source = replaceExact(
    source,
    "      sourceHealthGeneratedAt: sourceHealth?.generatedAt || null,\n      policySchema: policy?.schemaVersion || null,",
    "      sourceHealthGeneratedAt: sourceHealth?.generatedAt || null,\n      marketRegimeGeneratedAt: currentMarketRegime?.generatedAt || null,\n      marketRegimeAsOfSessionDate: currentMarketRegime?.asOfSessionDate || null,\n      policySchema: policy?.schemaVersion || null,",
    'market regime source hash',
  );

  fs.writeFileSync(file, source, 'utf8');
}

function patchPolicy() {
  const file = P('data/v20/policy-registry.json');
  const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
  policy.schemaVersion = '20.0.0-policy-registry-6';
  policy.marketRegime = {
    scope: 'V20_MASTER_UNIVERSE',
    methodologyReference: 'EGX_PRO_MARKET_REGIME_BREADTH_1.0_V16_REFERENCE',
    outputRegimes: ['BULLISH', 'NEUTRAL', 'BEARISH'],
    minimumVerifiedParticipationPct: 60,
    approvedPrimarySources: ['yahoo', 'starta_ohlc_api'],
    currentSnapshotCrossCheckRequired: true,
    currentSnapshotSemanticCompletenessRequired: true,
    currentSessionAlignmentRequired: true,
    currentPriceReconciliationRequired: true,
    maximumCurrentPriceDifferencePct: 5,
    minimumTrustedSessionsPerSymbol: 50,
    pointInTimeCutoffRequired: true,
    futureRowsAllowed: false,
    missingOhlcSynthesisAllowed: false,
    derivedSnapshotHistoryAllowed: false,
    sectorInputsAllowed: false,
    staleV16RegimeMayBePromotedToCurrent: false,
    productionRiskBudgetInfluence: false,
    executionGateInfluence: false,
    decisionUse: 'CURRENT_MARKET_CONTEXT_OR_RESEARCH_DIAGNOSTIC_ONLY',
    note: 'V20 reuses the frozen V16 breadth/trend/volatility methodology as a reference, but current regime status requires at least 60% full-universe participation with same-session trusted history and current-price reconciliation. A stale V16 regime is never promoted to current evidence.',
  };
  fs.writeFileSync(file, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
}

patchBuilder();
patchPolicy();
console.log(JSON.stringify({
  patched: true,
  files: ['scripts/v20/build-integrated-decision-snapshot.cjs', 'data/v20/policy-registry.json'],
  policySchemaVersion: '20.0.0-policy-registry-6',
}, null, 2));
