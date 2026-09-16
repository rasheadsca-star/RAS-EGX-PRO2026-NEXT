#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const G = require('./g11-carry-forward-guard.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const sourcePath = path.join(ROOT, 'astra', 'data-health', 'g11-source-data-repair.cjs');
const outputPath = path.join(ROOT, 'docs', 'astra', 'G11_GUARD37_EVIDENCE.json');
const source = fs.readFileSync(sourcePath, 'utf8');
const selfTests = G.runGuardSelfTests();
const implementationFindings = G.analyzeCarryForwardSource(source);
const status = selfTests.failed === 0 && implementationFindings.length === 0 ? 'PASS' : 'FAIL';

const evidence = {
  schemaVersion: 'astra-g11-guard37-evidence-1',
  generatedAt: new Date().toISOString(),
  status,
  guard: 'G11_NO_CARRY_FORWARD_BEHAVIOR',
  previousFalsePositive: {
    reason: 'The previous guard searched for the raw token carryForward and therefore matched the explicit safety declaration carryForwardForbidden: true.',
    unsafeBehaviorObserved: false,
  },
  correctedDetectionRule: {
    principle: 'Detect executable/configured previous-session-as-current behavior, not terminology that prohibits or diagnoses it.',
    unsafeRuleIds: G.UNSAFE_RULES.map((x) => x.id),
    explicitlySafeExamples: [
      'carryForwardForbidden: true',
      'noCarryForward: true',
      'comments or diagnostic strings stating carry forward is forbidden',
    ],
  },
  selfTests,
  implementationCheck: {
    path: 'astra/data-health/g11-source-data-repair.cjs',
    capsRowsAtExpectedSession: /fetched\.sessions\.filter\(\(row\) => row\.date <= expected\)/.test(source),
    findings: implementationFindings,
    pass: implementationFindings.length === 0,
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
console.log('ASTRA_G11_GUARD37 ' + JSON.stringify({ status, selfTests: `${selfTests.passed}/${selfTests.total}`, findings: implementationFindings.length }));
if (status !== 'PASS') process.exit(1);
