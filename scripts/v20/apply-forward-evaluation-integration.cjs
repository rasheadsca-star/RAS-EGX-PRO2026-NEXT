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

function patchPolicy() {
  const file = P('data/v20/policy-registry.json');
  const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
  policy.schemaVersion = '20.0.0-policy-registry-7';
  policy.forwardEvaluation = {
    horizonsSessions: [1,3,5,10,20],
    immutableArchiveMutationAllowed: false,
    appliedPortfolioAndResearchSeparated: true,
    legacyPortfolioReturnFieldsMeaning: 'APPLIED_PORTFOLIO_ONLY',
    pendingReturnMustRemainNull: true,
    marketSessionCalendar: 'MULTI_SYMBOL_TRUSTED_OHLC_DATE_CONSENSUS',
    calendarConsensusPct: 50,
    calendarMinimumVotes: 5,
    calendarAssumedWeekdaysAllowed: false,
    entryPolicy: 'FIRST_CONSENSUS_MARKET_SESSION_OPEN_ONLY_WITHIN_ISSUED_ENTRY_RANGE',
    delayedEntryAfterFirstSessionAllowed: false,
    sameSessionTargetStopAmbiguity: 'TREAT_AS_STOP',
    gapBelowStopPolicy: 'EXIT_AT_ACTUAL_OPEN_IF_WORSE_THAN_STOP',
    gapAboveTargetPolicy: 'CREDIT_CAPPED_AT_TARGET1',
    horizonClosePolicy: 'CLOSE_AT_HORIZON_SESSION_CLOSE_IF_NO_PRIOR_EXIT',
    roundTripTransactionCostPct: policy.transactionCosts?.roundTripPct ?? 0.6,
    avoidStatusResearchEvaluationAllowed: false,
    hardReviewOrInvalidPlanResearchEvaluationAllowed: false,
    futureRowsAllowed: false,
    syntheticOhlcAllowed: false,
    researchOutcomeMayBecomeProductionPerformance: false,
    productionExecutionGateInfluence: false,
    automaticPromotionInfluence: false,
    note: 'Forward horizons resolve only after actual trusted post-signal market sessions exist. Applied portfolio performance is kept separate from research opportunity diagnostics. A zero-exposure issued portfolio remains cash and research returns never become production returns.',
  };
  fs.writeFileSync(file, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
}

function patchWorkflow() {
  const file = P('.github/workflows/v20-integrated-decision-platform.yml');
  let source = fs.readFileSync(file, 'utf8');

  source = replaceExact(
    source,
    "\.github/workflows/v20-integrated-decision-platform\\.yml$|\\.github/workflows/v20-market-regime\\.yml$)' || true)",
    "\.github/workflows/v20-integrated-decision-platform\\.yml$|\\.github/workflows/v20-market-regime\\.yml$|\\.github/workflows/v20-forward-evaluation\\.yml$)' || true)",
    'forward workflow isolation allowlist',
  );

  source = replaceExact(
    source,
    "          node --check scripts/v20/archive-signal.cjs\n          node --check scripts/v20/regression.cjs",
    "          node --check scripts/v20/archive-signal.cjs\n          node --check scripts/v20/forward-evaluation-core.cjs\n          node --check scripts/v20/resolve-forward-evaluation.cjs\n          node --check scripts/v20/forward-evaluation-unit.cjs\n          node --check scripts/v20/forward-evaluation-regression.cjs\n          node --check scripts/v20/apply-forward-evaluation-integration.cjs\n          node --check scripts/v20/regression.cjs",
    'forward static validation',
  );

  source = replaceExact(
    source,
    "      - name: Archive immutable daily signal and forward horizons\n        run: node scripts/v20/archive-signal.cjs\n\n      - name: Build separated performance evidence registry",
    "      - name: Archive immutable daily signal and forward horizons\n        run: node scripts/v20/archive-signal.cjs\n\n      - name: Run forward evaluation unit tests\n        run: node scripts/v20/forward-evaluation-unit.cjs\n\n      - name: Resolve trusted forward evaluation horizons\n        env:\n          V20_FORWARD_NETWORK_REFRESH: \"true\"\n          V20_FORWARD_CONCURRENCY: \"6\"\n          V20_FORWARD_FETCH_RANGE: \"3mo\"\n          V20_FORWARD_CALENDAR_CONSENSUS_PCT: \"50\"\n          V20_FORWARD_CALENDAR_MIN_VOTES: \"5\"\n          V20_FORWARD_TRANSACTION_COST_PCT: \"0.6\"\n        run: node scripts/v20/resolve-forward-evaluation.cjs\n\n      - name: Run forward evaluation regression\n        run: node scripts/v20/forward-evaluation-regression.cjs\n\n      - name: Build separated performance evidence registry",
    'forward resolver workflow steps',
  );

  source = replaceExact(
    source,
    "          const forward=require('./data/v20/forward-evaluation.json');\n          const p=require('./data/v20/portfolio-risk.json');",
    "          const forward=require('./data/v20/forward-evaluation.json');\n          const forwardReg=require('./data/v20/forward-evaluation-regression.json');\n          const forwardStatus=require('./data/v20/forward-resolution-status.json');\n          const p=require('./data/v20/portfolio-risk.json');",
    'forward acceptance inputs',
  );

  source = replaceExact(
    source,
    "          if(r.ok!==true||tr.ok!==true||r3.ok!==true||ui.ok!==true||treg.ok!==true||mxr.ok!==true||dq.ok!==true||ns.ok!==true||sectorReg.ok!==true||perfReg.ok!==true||upr.ok!==true) process.exit(1);",
    "          if(r.ok!==true||tr.ok!==true||r3.ok!==true||ui.ok!==true||treg.ok!==true||mxr.ok!==true||dq.ok!==true||ns.ok!==true||sectorReg.ok!==true||perfReg.ok!==true||forwardReg.ok!==true||upr.ok!==true) process.exit(1);",
    'forward regression acceptance',
  );

  source = replaceExact(
    source,
    "          if((forward.evaluations||[]).some(e=>e.status==='PENDING'&&(e.portfolioReturnGrossPct!==null||e.portfolioReturnNetPct!==null))) process.exit(1);\n          if(policy.userPortfolio?.storage!=='BROWSER_LOCAL_STORAGE_ONLY') process.exit(1);",
    "          if((forward.evaluations||[]).some(e=>e.status==='PENDING'&&(e.portfolioReturnGrossPct!==null||e.portfolioReturnNetPct!==null))) process.exit(1);\n          if(policy.forwardEvaluation?.immutableArchiveMutationAllowed!==false||policy.forwardEvaluation?.appliedPortfolioAndResearchSeparated!==true) process.exit(1);\n          if(policy.forwardEvaluation?.legacyPortfolioReturnFieldsMeaning!=='APPLIED_PORTFOLIO_ONLY'||policy.forwardEvaluation?.pendingReturnMustRemainNull!==true) process.exit(1);\n          if(policy.forwardEvaluation?.calendarAssumedWeekdaysAllowed!==false||policy.forwardEvaluation?.delayedEntryAfterFirstSessionAllowed!==false) process.exit(1);\n          if(policy.forwardEvaluation?.sameSessionTargetStopAmbiguity!=='TREAT_AS_STOP') process.exit(1);\n          if(policy.forwardEvaluation?.futureRowsAllowed!==false||policy.forwardEvaluation?.syntheticOhlcAllowed!==false) process.exit(1);\n          if(policy.forwardEvaluation?.researchOutcomeMayBecomeProductionPerformance!==false||policy.forwardEvaluation?.productionExecutionGateInfluence!==false) process.exit(1);\n          if(forward.schemaVersion!=='20.0.0-forward-evaluation-2'||forward.asOfSessionDate!==x.sessionDate) process.exit(1);\n          if(forwardStatus.evaluationCount!==(forward.evaluations||[]).length) process.exit(1);\n          if((forward.evaluations||[]).some(e=>e.status==='RESOLVED'&&e.researchEvaluation?.appliedToProduction!==false)) process.exit(1);\n          if((forward.evaluations||[]).some(e=>e.status==='RESOLVED'&&e.portfolioReturnNetPct!==e.appliedPortfolio?.netReturnPct)) process.exit(1);\n          if((forward.evaluations||[]).some(e=>e.sessionDate===x.sessionDate&&e.status!=='PENDING')) process.exit(1);\n          if(policy.userPortfolio?.storage!=='BROWSER_LOCAL_STORAGE_ONLY') process.exit(1);",
    'forward policy and semantics acceptance',
  );

  source = replaceExact(
    source,
    "            data/v20/forward-evaluation.json \\\n            data/v20/signal-archive",
    "            data/v20/forward-evaluation.json \\\n            data/v20/forward-evaluation-regression.json \\\n            data/v20/forward-resolution-status.json \\\n            data/v20/signal-archive",
    'forward evidence persistence',
  );

  fs.writeFileSync(file, source, 'utf8');
}

patchPolicy();
patchWorkflow();
console.log(JSON.stringify({ patched:true, policySchemaVersion:'20.0.0-policy-registry-7', files:['data/v20/policy-registry.json','.github/workflows/v20-integrated-decision-platform.yml'] }, null, 2));
