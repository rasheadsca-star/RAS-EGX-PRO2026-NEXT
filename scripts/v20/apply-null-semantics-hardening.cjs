#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);

function replaceExact(rel, from, to) {
  const file = P(rel);
  let text = fs.readFileSync(file, 'utf8');
  if (text.includes(to)) return { rel, state: 'ALREADY_HARDENED' };
  if (!text.includes(from)) throw new Error(`${rel}: expected null-unsafe pattern not found`);
  text = text.replace(from, to);
  fs.writeFileSync(file, text, 'utf8');
  return { rel, state: 'HARDENED' };
}

const safeSimple = `function finite(value) {\n  if (value === null || value === undefined || value === '') return null;\n  const n = Number(value);\n  return Number.isFinite(n) ? n : null;\n}`;
const unsafeSimple = `function finite(value) {\n  const n = Number(value);\n  return Number.isFinite(n) ? n : null;\n}`;

const safeFallback = `function finite(value, fallback = null) {\n  if (value === null || value === undefined || value === '') return fallback;\n  const n = Number(value);\n  return Number.isFinite(n) ? n : fallback;\n}`;
const unsafeFallback = `function finite(value, fallback = null) {\n  const n = Number(value);\n  return Number.isFinite(n) ? n : fallback;\n}`;

const results = [];
for (const rel of [
  'scripts/v20/build-market-explorer.cjs',
  'scripts/v20/build-stock-profiles.cjs',
  'scripts/v20/build-trusted-technical-history.cjs',
  'scripts/v20/enrich-risk-reward.cjs',
  'scripts/v20/validate-trade-plans.cjs',
]) results.push(replaceExact(rel, unsafeSimple, safeSimple));

for (const rel of [
  'scripts/v20/build-data-truth.cjs',
  'scripts/v20/build-integrated-decision-snapshot.cjs',
  'scripts/v20/build-portfolio-risk.cjs',
]) results.push(replaceExact(rel, unsafeFallback, safeFallback));

results.push(replaceExact(
  'v20/portfolio-core.js',
  `  function finite(value) {\n    const n = Number(value);\n    return Number.isFinite(n) ? n : null;\n  }`,
  `  function finite(value) {\n    if (value === null || value === undefined || value === '') return null;\n    const n = Number(value);\n    return Number.isFinite(n) ? n : null;\n  }`
));

results.push(replaceExact(
  'scripts/v20/regression.cjs',
  `function finite(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }`,
  `function finite(value) { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }`
));

results.push(replaceExact(
  'scripts/v20/trade-plan-regression.cjs',
  `const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;`,
  `const finite = value => { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; };`
));

results.push(replaceExact(
  'v20/app.js',
  `  const num = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('ar-EG', { maximumFractionDigits: digits }) : '—';\n  const pct = value => Number.isFinite(Number(value)) ? \`${'${num(value, 1)}'}%\` : '—';\n  const money = value => Number.isFinite(Number(value)) ? num(value, 4) : '—';\n  const rr = value => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '—';`,
  `  const isMissing = value => value === null || value === undefined || value === '';\n  const numeric = value => { if (isMissing(value)) return null; const n = Number(value); return Number.isFinite(n) ? n : null; };\n  const num = (value, digits = 2) => { const n = numeric(value); return n === null ? '—' : n.toLocaleString('ar-EG', { maximumFractionDigits: digits }); };\n  const pct = value => numeric(value) === null ? '—' : \`${'${num(value, 1)}'}%\`;\n  const money = value => numeric(value) === null ? '—' : num(value, 4);\n  const rr = value => { const n = numeric(value); return n === null ? '—' : n.toFixed(2); };`
));

results.push(replaceExact(
  'v20/portfolio.js',
  `  const num = (value, digits = 2) => Number.isFinite(Number(value))\n    ? Number(value).toLocaleString('ar-EG', { maximumFractionDigits: digits })\n    : '—';\n  const pct = value => Number.isFinite(Number(value)) ? \`${'${num(value, 1)}'}%\` : '—';\n  const money = value => Number.isFinite(Number(value)) ? num(value, 4) : '—';`,
  `  const numeric = value => { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; };\n  const num = (value, digits = 2) => { const n = numeric(value); return n === null ? '—' : n.toLocaleString('ar-EG', { maximumFractionDigits: digits }); };\n  const pct = value => numeric(value) === null ? '—' : \`${'${num(value, 1)}'}%\`;\n  const money = value => numeric(value) === null ? '—' : num(value, 4);`
));

results.push(replaceExact(
  'scripts/v20/build-stock-profiles.cjs',
  `write('data/v20/stock-profiles.json', out);\nconsole.log(JSON.stringify({`,
  `write('data/v20/stock-profiles.json', out);\nrequire('./build-native-research-challenger.cjs').main();\nconsole.log(JSON.stringify({`
));

require('./apply-liquidity-decision-upgrade.cjs');
require('./apply-market-trend-context-ui.cjs');
require('./apply-full-market-native-integration.cjs');
require('./apply-native-ranking-discrimination.cjs');

// Phase 20 stores Native V2 shadow-forward evidence directly in a persistent namespace under
// signal-archive without inserting any Native row into the legacy immutable archive index.
require('./apply-native-shadow-persistent-storage.cjs');
require('./apply-native-shadow-forward-integration.cjs');

// The full-market UI acceptance must be applied before the Native-forward performance UI checks,
// because both extend the shared UI/browser acceptance scripts at runtime.
require('./apply-full-market-native-ui.cjs');
require('./apply-native-shadow-forward-ui.cjs');

const report = {
  schemaVersion: '20.0.0-null-semantics-hardening-11',
  generatedAt: new Date().toISOString(),
  hardenedFiles: results,
  liquidityDecisionUpgrade: true,
  nativeResearchChallengerWired: true,
  marketTrendContextUiIntegration: true,
  fullMarketNativeIntegration: true,
  nativeRankingDiscriminationIntegration: true,
  nativeShadowPersistentStorage: true,
  nativeShadowForwardIntegration: true,
  fullMarketNativeUiIntegration: true,
  nativeShadowForwardUiAcceptance: true,
  immutableCompatibilityExclusions: [
    'scripts/v20/archive-signal.cjs',
    'scripts/v20/phase3-regression.cjs'
  ]
};
console.log(JSON.stringify(report, null, 2));