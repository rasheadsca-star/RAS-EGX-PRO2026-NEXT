import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateResearchBarTriageRegistry,deriveResearchBarTriageSummary} from '../src/research-bar-triage.js';

const registry=JSON.parse(fs.readFileSync(new URL('../data/research/egx-missing-session-bar-research-2026-09-01.json',import.meta.url),'utf8'));
const expected=['AMII','DEIN','GOUR','ICLE','MEGM','NDRL','SEIGA','SPHT'];

test('checked-in missing-session bar triage is exact eight-member research-only set',()=>{
  const r=validateResearchBarTriageRegistry(registry,{session:'2026-08-31',expectedTickers:expected});
  assert.equal(r.state,'READY_RESEARCH_TRIAGE_ONLY');
  assert.equal(r.ready,true);
  assert.equal(r.recordCount,8);
  assert.equal(r.productionTrueOhlcvReady,0);
  assert.equal(r.productionAuthority,false);
  assert.equal(r.phase4Open,false);
});

test('AMII open conflict remains explicit and blocks true OHLCV research eligibility',()=>{
  const row=registry.records.find(x=>x.ticker==='AMII');
  assert.equal(row.state,'RESEARCH_OHLC_CONFLICT_OPEN');
  assert.equal(row.trueOhlcvResearchEligible,false);
  assert.equal(row.blockers.includes('OPEN_CONFLICT_15.36_VS_15.20'),true);
});

test('GOUR exact close-volume crosscheck does not authorize cross-provider OHLCV field splicing',()=>{
  const row=registry.records.find(x=>x.ticker==='GOUR');
  assert.equal(row.state,'RESEARCH_OHL_SUPPORTED_CLOSE_VOLUME_CROSSCHECKED_BUT_NOT_ADMITTED');
  assert.equal(row.trueOhlcvResearchEligible,false);
  assert.equal(row.blockers.includes('OHLC_FIELDS_NOT_IN_EXACT_VOLUME_CROSSCHECK_RECEIPT'),true);
  assert.equal(registry.policy.crossProviderFieldSplicingMayCreateProductionOhlcv,false);
});

test('all micro-trade missing bars stay blocked instead of being synthesized from flat prices',()=>{
  const rows=registry.records.filter(x=>String(x.state).includes('MICRO_TRADE'));
  assert.deepEqual(rows.map(x=>x.ticker).sort(),['DEIN','ICLE','NDRL','SEIGA']);
  assert.equal(rows.every(x=>x.trueOhlcvResearchEligible===false),true);
  assert.equal(registry.policy.flatCarryForwardPriceWithoutVolumeProvesTradeBar,false);
});

test('derived research triage summary exposes conflicts without granting authority',()=>{
  const s=deriveResearchBarTriageSummary(registry);
  assert.equal(s.records,8);
  assert.equal(s.openConflict,1);
  assert.equal(s.microTrade,4);
  assert.equal(s.trueOhlcvResearchEligible,0);
  assert.equal(s.productionAuthority,false);
});

test('attempt to relabel one research record true-OHLCV-ready fails registry validation',()=>{
  const bad=structuredClone(registry);
  bad.records[0].trueOhlcvResearchEligible=true;
  const r=validateResearchBarTriageRegistry(bad,{session:'2026-08-31',expectedTickers:expected});
  assert.equal(r.state,'BLOCKED');
  assert.equal(r.reasons.some(x=>x.includes('TRUE_OHLCV_RESEARCH_ELIGIBLE_NOT_FALSE')),true);
});
