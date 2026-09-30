import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHighPotentialWatchlist } from '../src/watchlist.js';

const base = (ticker, overrides={}) => ({
  ticker, eligible:false, sessionDate:'2026-09-30', price:10,
  scores:{core:68,research:70,liquidity:70,supportResistance:70,dataQuality:95},
  tradePlan:{structuralNetRR:1.1,alignmentState:'IN_ENTRY_RANGE'},
  quality:{state:'TRUSTED',publicationHold:false},
  reasonCodes:['CORE_SCORE_LOW','RESEARCH_SCORE_LOW'],
  ...overrides,
});

test('near miss with at most two bounded noncritical gates becomes watchlist only',()=>{
  const out=buildHighPotentialWatchlist([base('AAA')]);
  assert.equal(out.candidates.length,1);
  assert.equal(out.candidates[0].ticker,'AAA');
  assert.equal(out.candidates[0].recommendation,false);
  assert.equal(out.candidates[0].executionAllowed,false);
  assert.deepEqual(out.candidates[0].failedGates.sort(),['core','research']);
});

test('officially eligible result is never relabeled as watchlist candidate',()=>{
  const x=base('PASS',{eligible:true,reasonCodes:[],scores:{core:80,research:82,liquidity:80,supportResistance:75,dataQuality:99}});
  assert.equal(buildHighPotentialWatchlist([x]).candidates.length,0);
});

test('critical blocker never enters watchlist',()=>{
  const x=base('BAD',{reasonCodes:['QUALITY_BLOCKED','CORE_SCORE_LOW']});
  assert.equal(buildHighPotentialWatchlist([x]).candidates.length,0);
});

test('large deficit or more than two failed numeric gates stays rejected',()=>{
  const x=base('FAR',{scores:{core:50,research:55,liquidity:40,supportResistance:70,dataQuality:90},reasonCodes:['CORE_SCORE_LOW','RESEARCH_SCORE_LOW','LIQUIDITY_GATE_FAIL']});
  assert.equal(buildHighPotentialWatchlist([x]).candidates.length,0);
});

test('cross-sectional ranking orders otherwise valid near misses by evidence strength',()=>{
  const out=buildHighPotentialWatchlist([
    base('LOW',{scores:{core:63,research:65,liquidity:60,supportResistance:60,dataQuality:90}}),
    base('HIGH',{scores:{core:69,research:71,liquidity:85,supportResistance:80,dataQuality:99}}),
  ]);
  assert.equal(out.candidates[0].ticker,'HIGH');
  assert.ok(out.candidates[0].relativeOpportunityScore>out.candidates[1].relativeOpportunityScore);
});
