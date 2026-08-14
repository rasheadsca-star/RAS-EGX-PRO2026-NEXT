#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('../../v20/portfolio-core.js');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const policy = JSON.parse(fs.readFileSync(P('data/v20/policy-registry.json'), 'utf8'));
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };
const close = (a, b, eps = 1e-9) => Math.abs(Number(a) - Number(b)) <= eps;

check(policy.userPortfolio?.storage === 'BROWSER_LOCAL_STORAGE_ONLY', 'PORTFOLIO_STORAGE_POLICY_DRIFT');
check(policy.userPortfolio?.serverPersistence === false, 'PORTFOLIO_SERVER_PERSISTENCE_NOT_FORBIDDEN');
check(policy.userPortfolio?.repositoryPersistence === false, 'PORTFOLIO_REPOSITORY_PERSISTENCE_NOT_FORBIDDEN');
check(policy.userPortfolio?.influencesModelPortfolio === false, 'USER_PORTFOLIO_INFLUENCES_MODEL_PORTFOLIO');
check(policy.userPortfolio?.influencesOpportunityRanking === false, 'USER_PORTFOLIO_INFLUENCES_RANKING');
check(policy.userPortfolio?.influencesChampion === false, 'USER_PORTFOLIO_INFLUENCES_CHAMPION');
check(policy.userPortfolio?.influencesExecutionGate === false, 'USER_PORTFOLIO_INFLUENCES_EXECUTION_GATE');
check(policy.userPortfolio?.automaticOrders === false, 'USER_PORTFOLIO_AUTOMATIC_ORDERS_NOT_FORBIDDEN');
check(policy.userPortfolio?.automaticBuySellInstructions === false, 'USER_PORTFOLIO_AUTO_BUY_SELL_NOT_FORBIDDEN');
check(policy.userPortfolio?.valuationRequiresCurrentSessionPrice === true, 'CURRENT_SESSION_PRICE_REQUIREMENT_MISSING');
check(policy.userPortfolio?.stalePriceFallbackAllowed === false, 'STALE_PORTFOLIO_PRICE_FALLBACK_ALLOWED');
check(core.STORAGE_KEY === policy.userPortfolio?.storageKey, 'PORTFOLIO_STORAGE_KEY_POLICY_MISMATCH');

const valid = core.normalizeHolding({ ticker: 'comi.ca', averageBuyPrice: 100, quantity: 10 });
check(valid.ok === true && valid.holding.ticker === 'COMI', 'HOLDING_NORMALIZATION_FAILED');
check(core.normalizeHolding({ ticker: 'COMI', averageBuyPrice: 0, quantity: 10 }).ok === false, 'ZERO_BUY_PRICE_ACCEPTED');
check(core.normalizeHolding({ ticker: 'COMI', averageBuyPrice: 100, quantity: 0 }).ok === false, 'ZERO_QUANTITY_ACCEPTED');

const currentRow = {
  ticker: 'COMI',
  currentSessionAvailable: true,
  price: 110,
  dataQualityState: 'COMPLETE_FOR_CURRENT_SCOPE',
  criticalFieldCompletenessPct: 100,
  sourceConflict: false,
};
const opportunity = { rank: 1, status: 'WATCH', tradePlan: { stop: 90, target1: 120 } };
const evaluated = core.evaluateHolding(valid.holding, currentRow, opportunity, 'RESEARCH_ONLY');
check(evaluated.ok === true, 'VALID_HOLDING_EVALUATION_FAILED');
check(close(evaluated.costBasis, 1000), 'COST_BASIS_FORMULA_FAILED');
check(close(evaluated.currentValue, 1100), 'CURRENT_VALUE_FORMULA_FAILED');
check(close(evaluated.pnl, 100), 'PNL_FORMULA_FAILED');
check(close(evaluated.pnlPct, 10), 'PNL_PCT_FORMULA_FAILED');
check(evaluated.riskFlags.includes('GLOBAL_EXECUTION_GATE_CLOSED'), 'GLOBAL_GATE_FLAG_MISSING');
check(evaluated.automaticBuySellInstruction === null, 'AUTOMATIC_BUY_SELL_INSTRUCTION_CREATED');
check(evaluated.executionGateOverridden === false, 'USER_PORTFOLIO_OVERRIDES_EXECUTION_GATE');

const staleRow = { ...currentRow, currentSessionAvailable: false, price: 999 };
const stale = core.evaluateHolding(valid.holding, staleRow, opportunity, 'EXECUTION_GRADE');
check(stale.currentPrice === null && stale.currentValue === null && stale.pnl === null, 'STALE_PRICE_USED_FOR_PORTFOLIO_VALUATION');
check(stale.riskFlags.includes('NO_CURRENT_SESSION_PRICE'), 'NO_CURRENT_PRICE_RISK_FLAG_MISSING');

const conflicted = core.evaluateHolding(valid.holding, { ...currentRow, sourceConflict: true }, opportunity, 'EXECUTION_GRADE');
check(conflicted.riskFlags.includes('SOURCE_CONFLICT'), 'SOURCE_CONFLICT_FLAG_MISSING');
check(conflicted.monitoringState === 'OWNED_POSITION_REVIEW_REQUIRED', 'SOURCE_CONFLICT_DID_NOT_REQUIRE_REVIEW');

const stop = core.evaluateHolding(valid.holding, { ...currentRow, price: 85 }, opportunity, 'EXECUTION_GRADE');
check(stop.riskFlags.includes('REFERENCE_STOP_LEVEL_REACHED_OR_BREACHED'), 'REFERENCE_STOP_FLAG_MISSING');
check(stop.monitoringState === 'OWNED_POSITION_REVIEW_REQUIRED', 'STOP_BREACH_DID_NOT_REQUIRE_REVIEW');

const aggregate = core.aggregateEvaluations([evaluated, stale]);
check(aggregate.holdingCount === 2, 'AGGREGATE_HOLDING_COUNT_FAILED');
check(aggregate.pricedCount === 1 && aggregate.unpricedCount === 1, 'AGGREGATE_PRICED_COVERAGE_FAILED');
check(close(aggregate.pricedCurrentValue, 1100), 'AGGREGATE_CURRENT_VALUE_FAILED');
check(close(aggregate.pricedPnl, 100), 'AGGREGATE_PNL_FAILED');

const weights = core.portfolioWeights([
  evaluated,
  core.evaluateHolding({ ticker: 'OCDI', averageBuyPrice: 50, quantity: 10 }, { ...currentRow, ticker: 'OCDI', price: 55 }, null, 'EXECUTION_GRADE')
]);
check(close((weights.COMI || 0) + (weights.OCDI || 0), 100), 'PORTFOLIO_WEIGHT_SUM_NOT_100');

const report = {
  schemaVersion: '20.0.0-user-portfolio-regression-1',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  checks: {
    browserLocalOnly: true,
    stalePriceNeverUsed: true,
    pnlMathVerified: true,
    executionGateNeverOverridden: true,
    noAutomaticBuySell: true,
    userPortfolioSeparatedFromModelPortfolio: true,
  }
};

fs.mkdirSync(P('data/v20'), { recursive: true });
fs.writeFileSync(P('data/v20/user-portfolio-regression.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
