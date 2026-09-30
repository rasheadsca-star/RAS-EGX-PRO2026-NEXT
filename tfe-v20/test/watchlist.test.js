import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHighPotentialWatchlist } from '../src/watchlist.js';

const base=(ticker,overrides={})=>({
  ticker,eligible:false,sessionDate:'2026-09-30',price:10,
  scores:{core:68,research:70,liquidity:70,supportResistance:70,dataQuality:95},
  liquidity:{eligible:true},
  supportResistance:{methodCount:3},
  tradePlan:{structuralNetRR:1.1,alignmentState:'IN_ENTRY_RANGE'},
  quality:{state:'TRUSTED',publicationHold:false},
  reasonCodes:['CORE_SCORE_LOW','RESEARCH_SCORE_LOW'],
  ...overrides
});

test('near qualified stays watchlist-only',()=>{
  const x=buildHighPotentialWatchlist([base('AAA')]).candidates[0];
  assert.equal(x.tier,'NEAR_QUALIFIED');
  assert.equal(x.recommendation,false);
  assert.equal(x.executionAllowed,false);
});

test('official eligible is never relabeled',()=>{
  const x=base('PASS',{eligible:true,reasonCodes:[],scores:{core:80,research:82,liquidity:80,supportResistance:75,dataQuality:99}});
  assert.equal(buildHighPotentialWatchlist([x]).candidates.length,0);
});

test('critical blockers never enter watchlist',()=>{
  assert.equal(buildHighPotentialWatchlist([base('BAD',{reasonCodes:['QUALITY_BLOCKED','CORE_SCORE_LOW']})]).candidates.length,0);
});

test('unsafe structure never enters relative leader tier',()=>{
  const x=base('RR',{scores:{core:90,research:90,liquidity:90,supportResistance:90,dataQuality:90},tradePlan:{structuralNetRR:.3,alignmentState:'IN_ENTRY_RANGE'},reasonCodes:['STRUCTURAL_RR_LOW']});
  assert.equal(buildHighPotentialWatchlist([x]).candidates.length,0);
});

test('cross-sectional leaders can surface despite core/research absolute-gate misses',()=>{
  const rows=[
    base('LEADER',{scores:{core:60.6,research:70.2,liquidity:98,supportResistance:76.6,dataQuality:78},tradePlan:{structuralNetRR:.858,alignmentState:'PENDING_PULLBACK'}}),
    base('WEAK',{scores:{core:10,research:40,liquidity:80,supportResistance:60,dataQuality:78},tradePlan:{structuralNetRR:.55,alignmentState:'IN_ENTRY_RANGE'},reasonCodes:['CORE_SCORE_LOW','RESEARCH_SCORE_LOW','STRUCTURAL_RR_LOW']}),
    base('MID',{scores:{core:30,research:55,liquidity:90,supportResistance:70,dataQuality:78},tradePlan:{structuralNetRR:.7,alignmentState:'IN_ENTRY_RANGE'},reasonCodes:['CORE_SCORE_LOW','RESEARCH_SCORE_LOW']})
  ];
  const out=buildHighPotentialWatchlist(rows);
  assert.equal(out.candidates[0].ticker,'LEADER');
  assert.ok(['NEAR_QUALIFIED','RELATIVE_LEADER'].includes(out.candidates[0].tier));
  assert.equal(out.candidates[0].recommendation,false);
});
