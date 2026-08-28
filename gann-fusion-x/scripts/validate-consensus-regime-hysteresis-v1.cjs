#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const DATA=path.join(ROOT,'data');
const baselinePath=path.join(DATA,'consensus-v16-quality-gate-v2-backtest.json');
const challengerPath=path.join(DATA,'consensus-regime-hysteresis-v1-backtest.json');
const evidenceJson=path.join(DATA,'consensus-regime-hysteresis-v1-evidence.json');
const evidenceMd=path.join(DATA,'consensus-regime-hysteresis-v1-evidence.md');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const b=read(baselinePath),h=read(challengerPath);
const bf=b.summary60?.CONSENSUS_FINAL,hf=h.summary60?.CONSENSUS_FINAL;
if(!bf||!hf)throw new Error('MISSING_CONSENSUS_FINAL_SUMMARY');
if(!Array.isArray(b.dates)||!Array.isArray(h.dates)||b.dates.length!==60||h.dates.length!==60)throw new Error('EXPECTED_EXACTLY_60_SESSIONS');
if(b.dates.join('|')!==h.dates.join('|'))throw new Error('EVALUATION_DATES_CHANGED');
if(Number(bf.candidates)!==Number(hf.candidates))throw new Error(`CANDIDATE_COUNT_CHANGED_${bf.candidates}_TO_${hf.candidates}`);

const acceptance={
  same60Sessions:true,
  sameCandidateCount:true,
  full60PfNotWorse:Number(hf.profitFactor)>=Number(bf.profitFactor),
  full60CompoundNotWorse:Number(hf.compoundedBasketPct)>=Number(bf.compoundedBasketPct),
  full60DrawdownNotWorse:Number(hf.maxDrawdownPct)>=Number(bf.maxDrawdownPct),
  first30PfImproved:Number(h.first30?.profitFactor)>Number(b.first30?.profitFactor),
  first30CompoundNonNegative:Number(h.first30?.compoundedBasketPct)>=0,
  first30DrawdownNotWorse:Number(h.first30?.maxDrawdownPct)>=Number(b.first30?.maxDrawdownPct),
  last30StillProfitable:Number(h.last30?.profitFactor)>=1&&Number(h.last30?.compoundedBasketPct)>0,
};
acceptance.passed=Object.values(acceptance).every(Boolean);
const evidence={
  schemaVersion:'consensus-regime-hysteresis-v1-evidence',
  generatedAt:new Date().toISOString(),
  method:{
    candidateSelection:'Unchanged V16 Quality Gate V2 ∩ SEPA qualified intersection.',
    gann:'Unchanged timing-only sequencer.',
    regimeChange:'Defensive raw transitions apply immediately. A move back to RISK_ON is effective only after two consecutive raw RISK_ON sessions.',
    returnTuning:false,
    fixedTopN:false,
  },
  baseline:{full60:bf,first30:b.first30,last30:b.last30,regimeCounts:b.regimeCounts,actionCounts:b.actionCounts},
  hysteresis:{full60:hf,first30:h.first30,last30:h.last30,regimeCounts:h.regimeCounts,actionCounts:h.actionCounts},
  acceptance,
};
fs.writeFileSync(evidenceJson,JSON.stringify(evidence,null,2)+'\n');
const rows=[
  ['60','PF',bf.profitFactor,hf.profitFactor],
  ['60','Compound %',bf.compoundedBasketPct,hf.compoundedBasketPct],
  ['60','Max DD %',bf.maxDrawdownPct,hf.maxDrawdownPct],
  ['First 30','PF',b.first30?.profitFactor,h.first30?.profitFactor],
  ['First 30','Compound %',b.first30?.compoundedBasketPct,h.first30?.compoundedBasketPct],
  ['First 30','Max DD %',b.first30?.maxDrawdownPct,h.first30?.maxDrawdownPct],
  ['Last 30','PF',b.last30?.profitFactor,h.last30?.profitFactor],
  ['Last 30','Compound %',b.last30?.compoundedBasketPct,h.last30?.compoundedBasketPct],
  ['Last 30','Max DD %',b.last30?.maxDrawdownPct,h.last30?.maxDrawdownPct],
];
let md=`# Consensus Regime Hysteresis V1 — Locked Evidence\n\nGenerated: ${evidence.generatedAt}\n\nAcceptance: **${acceptance.passed?'PASS':'FAIL'}**\n\n`;
md+='Only the effective regime transition policy changes. Candidate selection, V16 Quality Gate V2, SEPA, GANN timing, entries, stops, targets and ranking are unchanged.\n\n';
md+='Hysteresis rule: defensive transitions are immediate; re-entry to `RISK_ON` requires two consecutive raw `RISK_ON` sessions.\n\n';
md+='| Window | Metric | V2 baseline | Hysteresis V1 |\n|---|---|---:|---:|\n';
for(const r of rows)md+=`| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} |\n`;
md+='\n## Regime / gate counts\n\n';
md+=`- Baseline regimes: ${JSON.stringify(b.regimeCounts||{})}\n- Hysteresis regimes: ${JSON.stringify(h.regimeCounts||{})}\n- Baseline actions: ${JSON.stringify(b.actionCounts||{})}\n- Hysteresis actions: ${JSON.stringify(h.actionCounts||{})}\n\n`;
md+='## Acceptance\n\n';
for(const [k,v] of Object.entries(acceptance))md+=`- ${k}: **${v}**\n`;
md+='\nThis is research evidence, not a guarantee of future returns. No production engine or UI is changed by this run.\n';
fs.writeFileSync(evidenceMd,md);
console.log(JSON.stringify({acceptance,baseline:{pf:bf.profitFactor,compound:bf.compoundedBasketPct,dd:bf.maxDrawdownPct,first30:b.first30,last30:b.last30},hysteresis:{pf:hf.profitFactor,compound:hf.compoundedBasketPct,dd:hf.maxDrawdownPct,first30:h.first30,last30:h.last30},regimeCounts:h.regimeCounts,actionCounts:h.actionCounts},null,2));
