#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const V1610 = path.join(ROOT, 'data/research/v16-v1610-exposure-challenger.json');
const V169 = path.join(ROOT, 'data/stable/v16-v169-primary-decision.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function resolveEngineDecision() {
  const challenger = readJson(V1610);

  if (challenger && challenger.schemaVersion && challenger.engine) {
    const guardPassed = challenger.currentRiskGuard?.passed === true;
    const basket = guardPassed ? challenger.currentExecutableShadowBasket : [];

    return {
      source: 'V16_10_EXPOSURE_AWARE_DEGRADATION_GUARD_SHADOW',
      selectedModel: {
        id: 'V16_10_EXPOSURE_AWARE_DEGRADATION_GUARD_SHADOW',
        profile: guardPassed ? 'SHADOW_ACTIVE' : 'CASH_MODE',
      },
      status: guardPassed ? 'V16_10_READY' : 'V16_10_CASH_MODE',
      recommendations: basket,
      riskGuard: challenger.currentRiskGuard || null,
      generatedAt: challenger.generatedAt || null,
      originalRecommendationCount: basket.length,
      productionGateBlockers: guardPassed ? [] : ['DEGRADATION_GUARD_ACTIVE'],
    };
  }

  const fallback = readJson(V169) || {};
  return {
    source: 'V16_9_EQUAL_WEIGHT_BASKET_FALLBACK',
    ...fallback,
  };
}

if (require.main === module) {
  process.stdout.write(JSON.stringify(resolveEngineDecision(), null, 2));
}

module.exports = { resolveEngineDecision };
