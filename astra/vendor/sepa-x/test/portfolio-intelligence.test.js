import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRc2Analysis, portfolioReadout } from '../src/portfolio-intelligence.js';

test('normalizes frozen RC2 analysis without enabling execution',()=>{
  const rc2=normalizeRc2Analysis({result:{ticker:'TEST',price:10,eligible:true,publicationEligible:true,decision:'RESEARCH_BUY_ZONE',scores:{fusionRank:81},tradePlan:{entryLow:9.8,entryHigh:10.1,stop:9.3,target1:10.7,target2:11.4,alignmentState:'IN_ENTRY_RANGE'},permissions:{executionAllowed:false}}});
  assert.equal(rc2.ticker,'TEST');
  assert.equal(rc2.publicationEligible,true);
  assert.equal(rc2.tradePlan.stop,9.3);
  assert.equal(rc2.permissions.executionAllowed,false);
});

test('portfolio readout reports three-way confluence but remains research only',()=>{
  const core={last_price:10.2,stop_loss:9.4,status:'READY NOW',trend_template:{passed:true},strategy_lab:{full_structure_v3:{pass:true}}};
  const rc2={publicationEligible:true,tradePlan:{alignmentState:'IN_ENTRY_RANGE'}};
  const x=portfolioReadout({core,rc2,forwardSignal:{state:'WAIT_ENTRY'}});
  assert.equal(x.state,'THREE_WAY_CONFLUENCE');
  assert.equal(x.researchOnly,true);
  assert.equal(x.automaticOrders,false);
  assert.equal(x.v3ShadowOnly,true);
});

test('portfolio readout prioritizes risk review when price breaks current core stop',()=>{
  const core={last_price:8.9,stop_loss:9.0,status:'FORMING',trend_template:{passed:true},strategy_lab:{full_structure_v3:{pass:true}}};
  const rc2={publicationEligible:true,tradePlan:{alignmentState:'IN_ENTRY_RANGE'}};
  const x=portfolioReadout({core,rc2});
  assert.equal(x.state,'RISK_REVIEW');
  assert.equal(x.checks.belowCoreStop,true);
});
