'use strict';
const crypto=require('crypto');

const VERSION=Object.freeze({
  pipeline:'ASTRA_G09_PIPELINE_1',
  eligibility:'ASTRA_G09_PRODUCTION_ELIGIBILITY_1',
  regime:'EGX_PRO_MARKET_REGIME_BREADTH_1.0',
  evidence:'ASTRA_G09_EVIDENCE_1',
  agreement:'ASTRA_G09_AGREEMENT_1',
  ranking:'ASTRA_G09_V16_9_SOURCE_ORDER_1',
  risk:'ASTRA_G09_V16_9_RISK_1',
  basket:'V16_9_EQUAL_WEIGHT_BASKET_PILOT',
  snapshot:'ASTRA_G09_DECISION_SNAPSHOT_1'
});

const ACTIVE_STRATEGY='PORTFOLIO_BASKET_EQUAL_WEIGHT';
const EMBEDDED_SELECTION_MODEL='V16_TWO_STAGE_TOP_GAINER';
const QUANT_EDGE='QUANT_EDGE';
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const DIAGNOSTIC_CODES=Object.freeze([
  'DECISION_INPUT_INVALID','REGIME_EXECUTION_FAILED','STRATEGY_EXECUTION_FAILED',
  'STRATEGY_NOT_PRODUCTION_ELIGIBLE','INSUFFICIENT_INDEPENDENT_EVIDENCE',
  'EVIDENCE_CONTRADICTION','RANKING_INPUT_INVALID','RISK_PLAN_INVALID',
  'BASKET_CONSTRAINT_FAILED','VALID_ZERO_OPPORTUNITY_SESSION',
  'DECISION_SNAPSHOT_INCONSISTENT','TEMPORAL_LEAKAGE_GUARD_FAILED',
  'INVALID_UNRESOLVED_DATA_QUARANTINED','QUANT_EDGE_LIVE_INFLUENCE_FORBIDDEN',
  'ALL_PRODUCTION_STRATEGIES_FAILED','BASKET_SELECTION_MODEL_INELIGIBLE'
]);

const CONFIG=Object.freeze({
  schemaVersion:'astra-g09-config-1',
  versions:VERSION,
  productionStrategyApproval:Object.freeze({
    strategyId:ACTIVE_STRATEGY,
    sourceEngine:'V16_9_EQUAL_WEIGHT_BASKET',
    approvedStrategyVersion:'2351b2ec2bbcf3e36e992021e26b36845e879ab0',
    requiredLifecycleStatus:'active',
    requiredProductionEligible:true,
    allowedBasketSizes:Object.freeze([3,4,5]),
    maxTotalExposurePct:50,
    failedWeightPolicy:'KEEP_CASH',
    selectionComponent:Object.freeze({
      strategyId:EMBEDDED_SELECTION_MODEL,
      role:'EMBEDDED_SOURCE_PINNED_SELECTION_MODEL_NOT_INDEPENDENT_VOTER',
      sourceEvidence:'scripts/research/v16-v169-basket-engine.py',
      rationale:'The certified V16.9 basket source ranks candidates with the existing out-of-sample top-gainer probability model, then equal-weights the selected basket.'
    })
  }),
  regimeSource:Object.freeze({
    path:'scripts/stable/v16-market-regime-engine.cjs',
    methodology:'EGX_PRO_MARKET_REGIME_BREADTH_1.0'
  }),
  rankingSource:Object.freeze({
    path:'scripts/research/v16-v169-basket-engine.py',
    rule:'Preserve source selection order/score; no new weighted decision-score formula is introduced in G09.'
  }),
  riskSource:Object.freeze({
    path:'scripts/research/v16-v169-basket-engine.py',
    entryAtrLow:-0.08,entryAtrHigh:0.08,stopAtr:-0.90,targetAtr:1.20,
    portfolioAllocationPct:50,unfilledMemberPolicy:'KEEP_CASH'
  }),
  evidenceFamilies:Object.freeze({
    MODEL_SELECTION:'selection model and basket membership are correlated; count once',
    LIQUIDITY:'source-model liquidity gate/input',
    REGIME:'market-regime context; not a second strategy vote',
    STRUCTURE:'entry/stop/target structural plan where present'
  }),
  tieBreak:Object.freeze(['sourceSelectionScore DESC','ticker ASC'])
});

function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v}
function stableHash(v){return crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')}
function finite(v,d=null){const n=Number(v);return Number.isFinite(n)?n:d}
function round(v,d=6){const n=finite(v);return n===null?null:Number(n.toFixed(d))}
function mean(a){const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null}
function median(a){const x=a.filter(Number.isFinite).sort((a,b)=>a-b);if(!x.length)return null;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2}
function deepFreeze(o){if(!o||typeof o!=='object'||Object.isFrozen(o))return o;Object.freeze(o);for(const v of Object.values(o))deepFreeze(v);return o}
function diagnostic(code,severity='ERROR',context={}){if(!DIAGNOSTIC_CODES.includes(code))throw new Error(`Unknown G09 diagnostic ${code}`);return{code,severity,context}}
function asDate(row){return String(row?.sessionDate||row?.date||'').slice(0,10)}
function after(a,b){return DATE_RE.test(a)&&DATE_RE.test(b)&&a>b}
function migrationBad(v){return['INVALID','UNRESOLVED','QUARANTINED'].includes(String(v||'').toUpperCase())}
function assertFiniteUnit(value,name,{positive=false,nonNegative=false}={}){const n=Number(value);if(!Number.isFinite(n))throw Object.assign(new Error(`${name} must be finite`),{code:'DECISION_INPUT_INVALID'});if(positive&&!(n>0))throw Object.assign(new Error(`${name} must be > 0`),{code:'DECISION_INPUT_INVALID'});if(nonNegative&&n<0)throw Object.assign(new Error(`${name} must be >= 0`),{code:'DECISION_INPUT_INVALID'});return n}

module.exports={VERSION,ACTIVE_STRATEGY,EMBEDDED_SELECTION_MODEL,QUANT_EDGE,DATE_RE,DIAGNOSTIC_CODES,CONFIG,canonical,stableHash,finite,round,mean,median,deepFreeze,diagnostic,asDate,after,migrationBad,assertFiniteUnit};
