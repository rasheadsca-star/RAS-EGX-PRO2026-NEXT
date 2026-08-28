#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const DATA=path.join(ROOT,'data');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const base=read(path.join(DATA,'consensus-v16-quality-gate-v2-backtest.json'));
const sel=read(path.join(DATA,'consensus-selection-quality-v1-backtest.json'));
const shadow=read(path.join(DATA,'consensus-selection-quality-v1-shadow-backtest.json'));

function sameDates(a,b){return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((x,i)=>x===b[i])}
if(base.dates?.length!==60||sel.dates?.length!==60||shadow.dates?.length!==60)throw new Error('EXPECTED_EXACTLY_60_SESSIONS');
if(!sameDates(base.dates,sel.dates)||!sameDates(base.dates,shadow.dates))throw new Error('EVALUATION_DATES_CHANGED');

const b60=base.summary60?.CONSENSUS_FINAL;
const s60=sel.summary60?.CONSENSUS_FINAL;
const h60=shadow.summary60?.CONSENSUS_FINAL;
const b1=base.summaryFirst30?.final,s1=sel.summaryFirst30?.final,h1=shadow.summaryFirst30?.final;
const b2=base.summaryLast30?.final,s2=sel.summaryLast30?.final,h2=shadow.summaryLast30?.final;
if(!b60||!s60||!h60||!b1||!s1||!b2||!s2)throw new Error('MISSING_SUMMARY');

const bm=new Map((base.intersectionCounts||[]).map(x=>[x.date,x.common]));
const sm=new Map((sel.intersectionCounts||[]).map(x=>[x.date,x.common]));
const hm=new Map((shadow.intersectionCounts||[]).map(x=>[x.date,x.common]));
const partition=base.dates.map(date=>({date,baseline:Number(bm.get(date)||0),selected:Number(sm.get(date)||0),shadow:Number(hm.get(date)||0)}));
const exactPartition=partition.every(x=>x.selected+x.shadow===x.baseline&&x.selected<=x.baseline&&x.shadow<=x.baseline);
if(!exactPartition)throw new Error('PARETO_PARTITION_INVARIANT_FAILED');
const noEmptyFrontierWhenCommon=partition.every(x=>x.baseline===0||x.selected>0);
if(!noEmptyFrontierWhenCommon)throw new Error('PARETO_FRONTIER_EMPTY_WITH_COMMON_CANDIDATES');

const acceptance={
  exactSame60Sessions:true,
  exactBaselinePartition:true,
  noCandidateAdditions:true,
  full60PfAtLeast2:Number(s60.profitFactor)>=2,
  full60CompoundPositive:Number(s60.compoundedBasketPct)>0,
  full60DrawdownNotWorse:Number(s60.maxDrawdownPct)>=Number(b60.maxDrawdownPct),
  first30PfAtLeast125:Number(s1.profitFactor)>=1.25,
  first30CompoundNonNegative:Number(s1.compoundedBasketPct)>=0,
  first30DrawdownNotWorse:Number(s1.maxDrawdownPct)>=Number(b1.maxDrawdownPct),
  last30StillProfitable:Number(s2.profitFactor)>=1&&Number(s2.compoundedBasketPct)>0,
};
acceptance.passed=Object.values(acceptance).every(Boolean);

const evidence={
  schemaVersion:'consensus-selection-quality-v1-evidence',
  generatedAt:new Date().toISOString(),
  method:{
    selection:'Parameter-free Pareto frontier of same-session V16 Quality Gate V2 rank and SEPA rank. A candidate is excluded only when another common candidate is at least as good in both ranks and strictly better in one.',
    fixedTopN:false,
    weightedBlend:false,
    realizedReturnThreshold:false,
    v16:'Unchanged V16 Quality Gate V2.',
    sepa:'Unchanged SEPA qualification.',
    gann:'Unchanged timing-only sequencer.',
    regime:'Unchanged V2 regime capital-protection gate.',
    stopTarget:'Unchanged SEPA stop/target; GANN only affects timing/pullback entry as in locked V2.',
  },
  baseline:{full60:b60,first30:b1,last30:b2},
  selected:{full60:s60,first30:s1,last30:s2,commonLive:sel.commonLive},
  shadow:{full60:h60,first30:h1,last30:h2,commonLive:shadow.commonLive},
  partition,
  acceptance,
};
fs.writeFileSync(path.join(DATA,'consensus-selection-quality-v1-evidence.json'),JSON.stringify(evidence,null,2)+'\n');

const rows=[
  ['60','PF',b60.profitFactor,s60.profitFactor,h60.profitFactor],
  ['60','Compound %',b60.compoundedBasketPct,s60.compoundedBasketPct,h60.compoundedBasketPct],
  ['60','Max DD %',b60.maxDrawdownPct,s60.maxDrawdownPct,h60.maxDrawdownPct],
  ['60','Candidates',b60.candidates,s60.candidates,h60.candidates],
  ['60','Exposure %',b60.exposurePct,s60.exposurePct,h60.exposurePct],
  ['First 30','PF',b1.profitFactor,s1.profitFactor,h1.profitFactor],
  ['First 30','Compound %',b1.compoundedBasketPct,s1.compoundedBasketPct,h1.compoundedBasketPct],
  ['First 30','Max DD %',b1.maxDrawdownPct,s1.maxDrawdownPct,h1.maxDrawdownPct],
  ['Last 30','PF',b2.profitFactor,s2.profitFactor,h2.profitFactor],
  ['Last 30','Compound %',b2.compoundedBasketPct,s2.compoundedBasketPct,h2.compoundedBasketPct],
  ['Last 30','Max DD %',b2.maxDrawdownPct,s2.maxDrawdownPct,h2.maxDrawdownPct],
];
let md=`# Consensus Selection Quality V1 — Locked Evidence\n\nGenerated: ${evidence.generatedAt}\n\nAcceptance: **${acceptance.passed?'PASS':'FAIL'}**\n\n`;
md+='Selection rule: Pareto frontier on V16 Quality Gate V2 rank and SEPA rank only. No Top-N, no weighted score, no return-tuned threshold. GANN and Regime are unchanged downstream.\n\n';
md+='| Window | Metric | V2 baseline | Pareto selected | Dominated shadow |\n|---|---|---:|---:|---:|\n';
for(const r of rows)md+=`| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | ${r[4]} |\n`;
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
md+='\n## Selection coverage\n\n';
md+=`- Average baseline common/session: ${avg(partition.map(x=>x.baseline)).toFixed(2)}\n`;
md+=`- Average Pareto selected/session: ${avg(partition.map(x=>x.selected)).toFixed(2)}\n`;
md+=`- Average dominated shadow/session: ${avg(partition.map(x=>x.shadow)).toFixed(2)}\n`;
md+=`- Sessions with baseline common candidates: ${partition.filter(x=>x.baseline>0).length}/60\n`;
md+=`- Sessions with selected candidates: ${partition.filter(x=>x.selected>0).length}/60\n`;
md+='\n## Exact V16 live common window\n\n';
if(sel.commonLive){
  const x=sel.commonLive.CONSENSUS_FINAL||{};
  md+=`- Dates: ${(sel.commonLive.dates||[]).length}\n- Pareto Consensus: PF ${x.profitFactor}, compound ${x.compoundedBasketPct}%, DD ${x.maxDrawdownPct}%\n`;
}
md+='\n## Acceptance\n\n';
for(const [k,v] of Object.entries(acceptance))md+=`- ${k}: **${v}**\n`;
md+='\nShadow results are diagnostic only and are not used to tune or alter the locked selection rule after this run. This is research evidence, not a guarantee of future returns. No production engine or UI is changed.\n';
fs.writeFileSync(path.join(DATA,'consensus-selection-quality-v1-evidence.md'),md);
console.log(JSON.stringify({acceptance,baseline:{full60:b60,first30:b1,last30:b2},selected:{full60:s60,first30:s1,last30:s2},shadow:{full60:h60,first30:h1,last30:h2},coverage:{avgBaseline:avg(partition.map(x=>x.baseline)),avgSelected:avg(partition.map(x=>x.selected)),avgShadow:avg(partition.map(x=>x.shadow))}},null,2));
