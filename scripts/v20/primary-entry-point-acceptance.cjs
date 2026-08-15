#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const index = read('v20/index.html');
const nativeCompat = read('v20/native-research.js');
const app = read('v20/app.js');
const board = read('v20/decision-board.js');

const checks = {};
const failures = [];
const check = (name, ok, detail = null) => {
  checks[name] = { ok: Boolean(ok), detail };
  if (!ok) failures.push(name);
};

const count = (text, pattern) => (text.match(pattern) || []).length;
const boardCssCount = count(index, /<link\b[^>]*href=["']\.\/decision-board\.css(?:\?[^"']*)?["'][^>]*>/gi);
const boardJsTags = index.match(/<script\b[^>]*src=["']\.\/decision-board\.js(?:\?[^"']*)?["'][^>]*><\/script>/gi) || [];
const boardJsCount = boardJsTags.length;
const boardCssTag = index.match(/<link\b[^>]*href=["']\.\/decision-board\.css(?:\?[^"']*)?["'][^>]*>/i)?.[0] || '';
const boardJsTag = boardJsTags[0] || '';

check('indexDirectDecisionBoardCss', boardCssCount === 1, { count: boardCssCount, tag: boardCssTag });
check('indexDirectDecisionBoardJs', boardJsCount === 1, { count: boardJsCount, tag: boardJsTag });
check('indexDecisionBoardJsDeferred', /\bdefer\b/i.test(boardJsTag), boardJsTag);
check('indexDirectAssetMarkers', /data-v20-decision-board-direct=["']true["']/i.test(boardCssTag) && /data-v20-decision-board-direct=["']true["']/i.test(boardJsTag));
check('decisionBoardCssInHead', index.indexOf('./decision-board.css') > 0 && index.indexOf('./decision-board.css') < index.indexOf('</head>'));
check('decisionBoardJsBeforeAppJs', index.indexOf('./decision-board.js') > 0 && index.indexOf('./decision-board.js') < index.indexOf('./app.js'));
check('legacyPanelStaticallySecondary', /class=["'][^"']*opportunities-panel[^"']*legacy-secondary-panel[^"']*["']/i.test(index) && /data-ui-role=["']secondary-reference["']/i.test(index));

check('nativeCompatDoesNotInjectDecisionBoardAssets', !/decision-board\.(?:js|css)/i.test(nativeCompat), nativeCompat.trim());
check('appDoesNotInjectDecisionBoardAssets', !/decision-board\.(?:js|css)/i.test(app));
check('noDynamicDecisionBoardAssetInjectionRequired', !/decision-board\.(?:js|css)/i.test(`${nativeCompat}\n${app}`));
check('noDuplicateDecisionBoardAssetReference', boardCssCount === 1 && boardJsCount === 1, { boardCssCount, boardJsCount });
check('decisionBoardDuplicateInitializationGuardPresent', /window\.__V20_DECISION_BOARD__/.test(board));

const requiredCanonicalSources = [
  '../data/v20/final-decision-contract.json',
  '../data/v20/v17-production-decision-core.json',
  '../data/v20/native-current.json',
  '../data/v20/native-model-freeze.json',
  '../data/v20/funded-nav.json',
  '../data/v20/performance-evidence-registry.json',
  '../data/v20/champion-challenger-registry.json',
  '../data/v20/v17-runtime-sync.json'
];
check('canonicalDecisionDataSourcesUnchanged', requiredCanonicalSources.every(source => board.includes(source)), requiredCanonicalSources.filter(source => !board.includes(source)));
check('canonicalArchitectureGuardPreserved', board.includes("contract.architecture!=='V17_CENTRIC_V20_NATIVE_DISCOVERY'"));
check('v17AuthorityGuardPreserved', board.includes('v17IsAuthoritativeForProductionEligibility'));
check('nativeExecutionSeparationGuardPreserved', board.includes('native.executionPermission!==false') && board.includes('native.legacyScoringContributionPct!==0'));
check('closedGateNoActionableGuardPreserved', board.includes("contract.sessionStatus!=='EXECUTION_GRADE'") && board.includes("finalDecisionState==='ACTIONABLE'"));
check('visibleDecisionBoardErrorStatePreserved', board.includes('decisionError') && board.includes('تعذر تحميل Canonical Decision Board'));

check('staticHostFriendlyDecisionAssets', /href=["']\.\/decision-board\.css/.test(index) && /src=["']\.\/decision-board\.js/.test(index));
check('staticHostFriendlyCanonicalJsonPaths', requiredCanonicalSources.every(source => source.startsWith('../data/v20/')));

const report = {
  schemaVersion: '20.0.0-primary-entry-point-acceptance-1',
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  entryPoint: 'v20/index.html',
  primaryUi: 'DECISION_BOARD_V17_CENTRIC',
  directDecisionBoardLoad: boardCssCount === 1 && boardJsCount === 1,
  dynamicDecisionBoardInjectionRequired: /decision-board\.(?:js|css)/i.test(`${nativeCompat}\n${app}`),
  checks
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
