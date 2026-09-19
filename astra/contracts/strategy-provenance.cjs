'use strict';

/**
 * Strategy provenance source-path catalog.
 *
 * These paths identify preserved evidence/source locations only. They are
 * metadata, never runtime persistence reads. Keeping them outside strategy
 * implementation prevents provenance strings from coupling strategy logic to
 * repository data/evidence paths.
 */
const SOURCE_PATHS=Object.freeze({
  TREND_FOLLOW:Object.freeze(['scripts/quant/v13-4-quant-engine.cjs','data/v13-4-quant-policy.json']),
  BREAKOUT:Object.freeze(['scripts/quant/v13-4-quant-engine.cjs','data/v13-4-quant-policy.json']),
  PULLBACK:Object.freeze(['scripts/quant/v13-4-quant-engine.cjs','data/v13-4-quant-policy.json']),
  MOMENTUM:Object.freeze(['data/stable/v15-practical-decision.json']),
  REVERSAL:Object.freeze(['data/v18-global-strategy-policy.json']),
  EMA_MACD_TREND_CONTINUATION:Object.freeze(['scripts/stable/v18-global-strategy-ensemble.cjs','data/v18-global-strategy-policy.json']),
  PORTFOLIO_BASKET_EQUAL_WEIGHT:Object.freeze(['data/research/v16-v169-basket-engine.json']),
  RELATIVE_STRENGTH_HIGH_PROXIMITY:Object.freeze(['scripts/stable/v18-leadership-extension.cjs','data/v18-global-strategy-policy.json']),
  VOLATILITY_CONTRACTION_PATTERN:Object.freeze(['scripts/stable/v18-leadership-extension.cjs','data/v18-global-strategy-policy.json']),
  V16_TWO_STAGE_TOP_GAINER:Object.freeze(['.github/workflows/v16-two-stage-predictor.yml','.github/workflows/v16-two-stage-top2-backtest.yml','scripts/research/v16-v167-coherent-engine.py']),
  V16_TRIPLE_BARRIER_GATE:Object.freeze(['scripts/research/v16-v167-blocked-run.py']),
  V19_TOP10_PROBABILITY_INV_VOL_3:Object.freeze(['scripts/v19/native-challenger-v6.py','scripts/v19/native-challenger-v4.py','scripts/v19/native-challenger-v2.py']),
  V20_NATIVE_MULTI_COMPONENT_COMPOSITE:Object.freeze(['data/v20/native-model-freeze.json','scripts/v20/build-full-market-native-selection.cjs']),
  GANN_FUSION:Object.freeze(['gann-fusion-x/engine/fusion.js']),
  GANN_REGIME_ROUTER:Object.freeze(['gann-fusion-x/scripts/backtest-v4-regime-router.cjs']),
  GANN_ENTRY_EXECUTION_QUALITY:Object.freeze(['gann-fusion-x/engine/planner.js']),
  SEPA_QVUA_NEAR_FIRST_THEN_FORMING:Object.freeze(['sepa-x/src/engine.js','sepa-x/src/features.js','sepa-x/src/config.js']),
  TFE_EVIDENCE_AWARE_HARD_GATE_FUSION:Object.freeze(['tfe-v20/src/originalScore.js','tfe-v20/src/originalIndicators.js','tfe-v20/engine.js','tfe-v20/policy.js'])
});
function sourcePathsFor(strategyId){return SOURCE_PATHS[String(strategyId||'')]||Object.freeze([])}
module.exports=Object.freeze({SOURCE_PATHS,sourcePathsFor});
