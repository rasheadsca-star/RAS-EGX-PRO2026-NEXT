import test from 'node:test';
import assert from 'node:assert/strict';
import { selectHistoricalResearchPool } from '../src/concentration.js';

const row=(symbol,score,failed=[])=>({
  symbol,status:'READY NOW',market_regime:'BULL',action:'BUY',final_score:score,confidence_score:80,rs_percentile:80,vcp:{quality:75},reward_risk:2,risk_pct:5,entry_zone:{from:100,to:101},stop_loss:96,failed_rules:failed,audit_stages:{entry:{raw:{do_not_chase:false}},risk:{raw:{}}}
});

test('historical research pool is broader but never executable',()=>{
  const rows=[row('AAA',90),row('BBB',89,['ONE_RESEARCH_BLOCKER']),row('CCC',88,['A','B']),row('DDD',87,['A','B','C'])];
  const out=selectHistoricalResearchPool(rows,{}, {maxPerSignal:10,maxFailedRules:2,minFinalScore:60});
  assert.deepEqual(out.map(x=>x.symbol),['AAA','BBB','CCC']);
  assert.ok(out.every(x=>x.research_only===true&&x.execution_allowed===false&&x.target_plan?.valid===true));
  assert.equal(out[1].research_failed_rule_count,1);
});
