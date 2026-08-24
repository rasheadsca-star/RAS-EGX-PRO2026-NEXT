#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const research=path.join(root,'data','research'),docs=path.join(root,'docs');
const read=(name)=>JSON.parse(fs.readFileSync(path.join(research,name),'utf8'));
const finite=v=>Number.isFinite(Number(v));
const fmt=(v,d=2)=>finite(v)?Number(v).toFixed(d):'N/A';
const sep=read('historical-simulator.json');
const rc2=read('rc2-simulate.json');
const v16=read('v16-v169-basket-engine.json');
const s=sep.summary||{},r=rc2.summary||{},v=v16.blockedWalkForwardMetrics||{};

const sampleAdequacy={
  sepax:(s.entered??0)>=30?'STRONG':(s.entered??0)>=15?'MODERATE':'LIMITED',
  rc2:(r.entered??0)>=30?'STRONG':'MODERATE',
  v169:(v.sessions??0)>=30?'STRONG':'MODERATE',
};

const dimensions={
  targetPrecision:{
    winner:(finite(s.target1HitPct)&&s.entered>=20&&Number(s.target1HitPct)>=50)?'SEPA-X':'RC2',
    note:'Not a like-for-like target: SEPA-X T1 is 2R, RC2 T1 is approximately 0.8R capped by structural resistance; V16.9 frozen artifact does not publish a target-hit rate.'
  },
  shortHorizonRanking:{winner:'V16.9',note:'V16.9 is explicitly a blocked walk-forward top-gainer basket with one-session holding.'},
  nativeProfitFactor:{winner:[['SEPA-X',s.profitFactor],['RC2',r.profitFactor],['V16.9',v.profitFactor]].filter(x=>finite(x[1])).sort((a,b)=>Number(b[1])-Number(a[1]))[0]?.[0]??null,note:'Native profit factors use different holding periods and objectives; use as supporting evidence only.'},
  largeTargetOpportunity:{winner:(finite(s.expectancyR)&&Number(s.expectancyR)>0&&finite(s.target1HitPct)&&s.entered>=20)?'SEPA-X':'INSUFFICIENT_SEPA_X_EVIDENCE',note:'SEPA-X uniquely evaluates 2R/3R/4R targets in this benchmark.'},
  conservativeTargetEvidence:{winner:'RC2',note:'RC2 supplies a Wilson 95% lower confidence bound for Target1 hit rate.'},
};

let overall='NO_SINGLE_UNIVERSAL_WINNER';
let recommendation='Use the engine according to horizon: RC2 for conservative target precision, V16.9 for one-session basket ranking, and SEPA-X only for larger 2R+ objectives if its retrospective evidence is adequate.';
if(sampleAdequacy.sepax!=='LIMITED'&&finite(s.expectancyR)&&Number(s.expectancyR)>0.35&&finite(s.target1HitPct)&&Number(s.target1HitPct)>=45&&finite(s.profitFactor)&&Number(s.profitFactor)>=1.7){
  overall='SEPA-X_FOR_2R_PLUS_OBJECTIVES';
  recommendation='SEPA-X has sufficient evidence to be preferred when the objective is a concentrated 3–5 stock list pursuing 2R+ targets; RC2 remains the conservative precision benchmark and V16.9 the short-horizon benchmark.';
}

const report={
  schemaVersion:'sepax-engine-comparison.1',generatedAt:new Date().toISOString(),overallVerdict:overall,recommendation,
  comparabilityWarning:'The three engines do not optimize the same target or holding horizon. Raw target-hit percentages must not be compared as if their objectives were identical.',
  engines:{
    'SEPA-X':{objective:'Concentrated 3 or 5 high-conviction stocks; 2R/3R/4R targets',sampleAdequacy:sampleAdequacy.sepax,signalDates:s.signalDates??null,entered:s.entered??null,target1Definition:'2R',target1HitPct:s.target1HitPct??null,target2HitPct:s.target2HitPct??null,target3HitPct:s.target3HitPct??null,positivePct:s.positivePct??null,averageNetPct:s.averageNetPct??null,expectancyR:s.expectancyR??null,profitFactor:s.profitFactor??null,maxDrawdownPct:s.maximumBasketDrawdownPct??null,method:'Point-in-time market replay; current fundamentals/catalysts excluded; market-wide RS recomputed.'},
    'RC2':{objective:'Precision structural trade plan',sampleAdequacy:sampleAdequacy.rc2,entered:r.entered??null,target1Definition:'0.8R precision target capped by structural resistance',target1HitPct:r.target1Pct??null,positivePct:r.positivePct??null,averageNetPct:r.avgNetPct??null,profitFactor:r.profitFactor??null,wilson95LowerTarget1Pct:r.wilson95LowerTarget1Pct??null,maxHoldSessions:rc2.methodology?.maxHoldSessions??10,method:'Recorded full-market history; next-session entry; no lookahead; STOP_FIRST.'},
    'V16.9':{objective:'Top-gainer equal-weight 3–5 stock basket; one-session holding',sampleAdequacy:sampleAdequacy.v169,sessions:v.sessions??null,target1Definition:'Frozen comparison artifact reports next-session return, not target-hit rate',target1HitPct:null,sessionWinRatePct:v.sessionWinRatePct??null,averageNetPct:v.averageNetReturnPct??null,profitFactor:v.profitFactor??null,compoundedNetReturnPct:v.compoundedNetReturnPct??null,maxDrawdownPct:v.maximumDrawdownPct??null,averageTop10Hits:v.averageTop10Hits??null,method:'Blocked walk-forward: basket size chosen from prior 8 sessions and fixed for next 5; 0.60% cost.'}
  },dimensions
};
fs.mkdirSync(research,{recursive:true});fs.mkdirSync(docs,{recursive:true});
fs.writeFileSync(path.join(research,'engine-comparison.json'),JSON.stringify(report,null,2)+'\n');
const md=`# SEPA-X vs RC2 vs V16.9 — Evidence Report\n\nGenerated: ${report.generatedAt}\n\n## Verdict\n\n**${overall}**\n\n${recommendation}\n\n> ${report.comparabilityWarning}\n\n## Native evidence\n\n| Engine | Evidence sample | Target / horizon | Hit / Win | Avg net | Profit Factor | Drawdown |\n|---|---:|---|---:|---:|---:|---:|\n| SEPA-X | ${s.entered??0} entered / ${s.signalDates??0} signal dates | T1=2R, T2=3R, T3=4R; max ${sep.methodology?.maxHoldSessions??20} sessions | T1 ${fmt(s.target1HitPct,1)}%; T2 ${fmt(s.target2HitPct,1)}%; T3 ${fmt(s.target3HitPct,1)}% | ${fmt(s.averageNetPct)}% | ${fmt(s.profitFactor)} | ${fmt(s.maximumBasketDrawdownPct)}% |\n| RC2 | ${r.entered??0} entered | T1≈0.8R capped by resistance; max ${rc2.methodology?.maxHoldSessions??10} sessions | T1 ${fmt(r.target1Pct,1)}%; Wilson lower ${fmt(r.wilson95LowerTarget1Pct,1)}% | ${fmt(r.avgNetPct)}% | ${fmt(r.profitFactor)} | N/A in native API summary |\n| V16.9 | ${v.sessions??0} blocked OOS sessions | 1-session equal-weight basket | Win ${fmt(v.sessionWinRatePct,1)}% | ${fmt(v.averageNetReturnPct)}% | ${fmt(v.profitFactor)} | ${fmt(v.maximumDrawdownPct)}% |\n\n## SEPA-X target evidence\n\n- 2R hit rate: **${fmt(s.target1HitPct,1)}%**\n- 3R hit rate: **${fmt(s.target2HitPct,1)}%**\n- 4R hit rate: **${fmt(s.target3HitPct,1)}%**\n- Expectancy: **${fmt(s.expectancyR)}R**\n- Stop before 2R: **${fmt(s.stopBeforeTarget1Pct,1)}%**\n\n## Interpretation\n\n- **RC2** remains the conservative target-precision benchmark because its primary target is materially closer and it reports a statistical lower bound.\n- **V16.9** has the cleanest native evidence for one-session top-basket ranking.\n- **SEPA-X** is designed for fewer names and larger 2R+ targets; its quality should be judged primarily by 2R/3R/4R hit rate, expectancy in R, and drawdown rather than raw hit rate against RC2.\n`;
fs.writeFileSync(path.join(docs,'ENGINE_COMPARISON_REPORT.md'),md);
console.log(JSON.stringify(report,null,2));
