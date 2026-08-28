#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const DATA=path.join(ROOT,'data');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const ledger=read(path.join(DATA,'consensus-attribution-v1-trades.json'));
const baseline=read(path.join(DATA,'consensus-attribution-v1-baseline.json'));
const trades=ledger.trades||[];
const dates=ledger.dates||[];
const round=(n,d=3)=>Number.isFinite(Number(n))?Number(Number(n).toFixed(d)):null;
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;

if(dates.length!==60)throw new Error(`ATTRIBUTION_EXPECTED_60_DATES_GOT_${dates.length}`);
if(baseline?.summary60?.CONSENSUS_FINAL?.candidates!==447)throw new Error(`LOCKED_BASELINE_EXPECTED_447_GOT_${baseline?.summary60?.CONSENSUS_FINAL?.candidates}`);
if(trades.length!==447)throw new Error(`ATTRIBUTION_EXPECTED_447_TRADES_GOT_${trades.length}`);
const keyset=new Set(trades.map(x=>`${x.date}|${x.ticker}`));
if(keyset.size!==trades.length)throw new Error('ATTRIBUTION_DUPLICATES_FOUND');
if(trades.some(x=>!dates.includes(x.date)))throw new Error('ATTRIBUTION_DATE_OUTSIDE_LOCKED_WINDOW');
const required=['v16Rank','sepaRank','gannAvailable','regime','gateAction','sizeMultiplier','finalStatus'];
const missing=trades.filter(x=>required.some(k=>x[k]===undefined||x[k]===null));
if(missing.length)throw new Error(`ATTRIBUTION_MISSING_REQUIRED_FIELDS_${missing.length}`);

function maxDD(vals){let eq=1,peak=1,m=0;for(const r of vals){eq*=1+r/100;peak=Math.max(peak,eq);m=Math.min(m,(eq/peak-1)*100)}return m}
function metrics(rows,scopeDates=dates){
  const active=rows.filter(x=>Number(x.sizeMultiplier)>0);
  const filled=active.filter(x=>!['UNFILLED','WAIT','BLOCK'].includes(String(x.finalStatus)));
  const nets=filled.map(x=>Number(x.effectiveNetPct||0));
  const pos=nets.filter(x=>x>0),neg=nets.filter(x=>x<0);
  const by=new Map(scopeDates.map(d=>[d,[]]));
  for(const r of rows){if(!by.has(r.date))by.set(r.date,[]);by.get(r.date).push(r)}
  const daily=[...by.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,rs])=>({date,netPct:rs.length?rs.reduce((s,r)=>s+Number(r.effectiveNetPct||0),0)/rs.length:0,candidates:rs.length}));
  let eq=1;for(const d of daily)eq*=1+d.netPct/100;
  return {candidates:rows.length,active:active.length,filled:filled.length,fillRatePct:round(active.length?filled.length/active.length*100:0,1),positiveTradeRatePct:round(filled.length?pos.length/filled.length*100:0,1),targetHitPct:round(filled.length?filled.filter(x=>x.finalStatus==='TARGET_HIT').length/filled.length*100:0,1),stopHitPct:round(filled.length?filled.filter(x=>String(x.finalStatus).startsWith('STOP')).length/filled.length*100:0,1),averageEffectiveNetPct:round(mean(nets),3),profitFactor:round(neg.length?pos.reduce((a,b)=>a+b,0)/Math.abs(neg.reduce((a,b)=>a+b,0)):pos.length?999:0,2),compoundedBasketPct:round((eq-1)*100,3),maxDrawdownPct:round(maxDD(daily.map(x=>x.netPct)),3),daily};
}
function groupBy(rows,labelFn,scopeDates){
  const m=new Map();for(const r of rows){const k=String(labelFn(r));if(!m.has(k))m.set(k,[]);m.get(k).push(r)}
  return Object.fromEntries([...m.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>[k,metrics(v,scopeDates)]));
}
const firstDates=dates.slice(0,30),lastDates=dates.slice(30);
const first=trades.filter(x=>x.window==='FIRST_30'),last=trades.filter(x=>x.window==='LAST_30');
const absTrigger=x=>Number.isFinite(Number(x.triggerDistancePct))?Math.abs(Number(x.triggerDistancePct)):null;
const triggerBand=x=>{const d=absTrigger(x);if(d==null)return'MISSING';if(d<=1)return'0-1%';if(d<=2.5)return'1-2.5%';if(d<=5)return'2.5-5%';return'>5%'};
const rankBand=(r,count)=>{if(!(count>0&&r>0))return'MISSING';const p=r/count*100;if(p<=10)return'TOP_10_PCT';if(p<=25)return'10-25_PCT';if(p<=50)return'25-50_PCT';return'BOTTOM_50_PCT'};
const gannTimeBand=x=>{const v=Number(x.gannTimeScore);if(!Number.isFinite(v))return'MISSING';if(v<40)return'<40';if(v<60)return'40-59';if(v<80)return'60-79';return'80+'};
const timingScoreBand=x=>{const v=Number(x.gannTimingScore);if(!Number.isFinite(v))return'MISSING';if(v<50)return'<50';if(v<65)return'50-64';if(v<80)return'65-79';return'80+'};
const selectors={
  regime:x=>x.regime,
  timingGrade:x=>x.timingGrade,
  gateAction:x=>x.gateAction,
  gannAvailable:x=>x.gannAvailable?'YES':'NO',
  triggerDistance:x=>triggerBand(x),
  gannTime:x=>gannTimeBand(x),
  gannTimingScore:x=>timingScoreBand(x),
  breakout:x=>x.breakoutState,
  volumeConfirmed:x=>x.volumeConfirmed?'YES':'NO',
  v16RelativeRank:x=>rankBand(Number(x.v16Rank),Number(x.v16QualifiedCount)),
  sepaRelativeRank:x=>rankBand(Number(x.sepaRank),Number(x.sepaQualifiedCount)),
};
const groups={};
for(const [name,fn] of Object.entries(selectors))groups[name]={full60:groupBy(trades,fn,dates),first30:groupBy(first,fn,firstDates),last30:groupBy(last,fn,lastDates)};

const contributorRows=[...trades].filter(x=>Number(x.sizeMultiplier)>0&&!['UNFILLED','WAIT','BLOCK'].includes(String(x.finalStatus))).sort((a,b)=>Number(a.effectiveNetPct)-Number(b.effectiveNetPct));
const worstTrades=contributorRows.slice(0,15).map(x=>({date:x.date,ticker:x.ticker,window:x.window,effectiveNetPct:x.effectiveNetPct,status:x.finalStatus,timingGrade:x.timingGrade,regime:x.regime,gateAction:x.gateAction,v16Rank:x.v16Rank,sepaRank:x.sepaRank,gannTimingScore:x.gannTimingScore,triggerDistancePct:x.triggerDistancePct}));
const bestTrades=contributorRows.slice(-15).reverse().map(x=>({date:x.date,ticker:x.ticker,window:x.window,effectiveNetPct:x.effectiveNetPct,status:x.finalStatus,timingGrade:x.timingGrade,regime:x.regime,gateAction:x.gateAction,v16Rank:x.v16Rank,sepaRank:x.sepaRank,gannTimingScore:x.gannTimingScore,triggerDistancePct:x.triggerDistancePct}));
const daily=metrics(trades,dates).daily.sort((a,b)=>a.netPct-b.netPct);
const worstDays=daily.slice(0,10),bestDays=daily.slice(-10).reverse();

const robustWarnings=[];
for(const [dimension,g] of Object.entries(groups)){
  for(const [bucket,m] of Object.entries(g.first30)){
    if(m.filled>=15&&m.profitFactor<1)robustWarnings.push({dimension,bucket,reason:'FIRST30_PF_BELOW_1_WITH_15_PLUS_FILLS',metrics:m});
  }
}

const evidence={
  schemaVersion:'egx-consensus-attribution-v1-evidence',
  generatedAt:new Date().toISOString(),
  diagnosticOnly:true,
  lockedBaseline:{dates:60,candidates:447,duplicates:0,missingRequired:0,full60:baseline.summary60.CONSENSUS_FINAL,first30:baseline.summaryFirst30.final,last30:baseline.summaryLast30.final},
  methodology:{purpose:'Post-run attribution only. No candidate is added, removed, re-ranked or resized by this diagnostic.',futureOutcomesUsedOnlyForAttribution:true,retroactiveTuningProhibited:true,dimensions:Object.keys(selectors)},
  groups,
  worstTrades,bestTrades,worstDays,bestDays,robustWarnings
};
fs.writeFileSync(path.join(DATA,'consensus-attribution-v1-evidence.json'),JSON.stringify(evidence,null,2)+'\n');

function table(title,g){
  const keys=[...new Set([...Object.keys(g.first30),...Object.keys(g.last30)])];
  let s=`\n## ${title}\n\n| Bucket | F30 Cand | F30 Filled | F30 PF | F30 Comp % | F30 DD % | L30 Cand | L30 Filled | L30 PF | L30 Comp % | L30 DD % |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
  for(const k of keys){const a=g.first30[k]||{},b=g.last30[k]||{};s+=`| ${k} | ${a.candidates??0} | ${a.filled??0} | ${a.profitFactor??0} | ${a.compoundedBasketPct??0} | ${a.maxDrawdownPct??0} | ${b.candidates??0} | ${b.filled??0} | ${b.profitFactor??0} | ${b.compoundedBasketPct??0} | ${b.maxDrawdownPct??0} |\n`}
  return s;
}
let md=`# Consensus Attribution V1 — Locked Diagnostic Evidence\n\nGenerated: ${evidence.generatedAt}\n\n**Diagnostic only — no production or research selection rule is changed.** Realized outcomes below are used only to explain the already-completed 60-session run and must not be converted into a retroactively tuned threshold on this sample.\n\n## Integrity\n\n- Evaluation sessions: **60**\n- Locked V16 Quality Gate V2 consensus candidates: **447**\n- Duplicate date/ticker rows: **0**\n- Missing required attribution fields: **0**\n- Baseline full-60: PF **${baseline.summary60.CONSENSUS_FINAL.profitFactor}**, compound **${baseline.summary60.CONSENSUS_FINAL.compoundedBasketPct}%**, DD **${baseline.summary60.CONSENSUS_FINAL.maxDrawdownPct}%**\n- Baseline first-30: PF **${baseline.summaryFirst30.final.profitFactor}**, compound **${baseline.summaryFirst30.final.compoundedBasketPct}%**, DD **${baseline.summaryFirst30.final.maxDrawdownPct}%**\n- Baseline last-30: PF **${baseline.summaryLast30.final.profitFactor}**, compound **${baseline.summaryLast30.final.compoundedBasketPct}%**, DD **${baseline.summaryLast30.final.maxDrawdownPct}%**\n`;
for(const [name,g] of Object.entries(groups))md+=table(name,g);
md+='\n## Worst contributing filled trades\n\n| Date | Ticker | Window | Eff Net % | Status | Grade | Regime | Gate | V16 rank | SEPA rank | GANN timing | Trigger dist % |\n|---|---|---|---:|---|---|---|---|---:|---:|---:|---:|\n';
for(const x of worstTrades)md+=`| ${x.date} | ${x.ticker} | ${x.window} | ${x.effectiveNetPct} | ${x.status} | ${x.timingGrade} | ${x.regime} | ${x.gateAction} | ${x.v16Rank} | ${x.sepaRank} | ${x.gannTimingScore} | ${x.triggerDistancePct} |\n`;
md+='\n## Worst basket days\n\n| Date | Basket net % | Candidates |\n|---|---:|---:|\n';for(const x of worstDays)md+=`| ${x.date} | ${round(x.netPct,3)} | ${x.candidates} |\n`;
md+='\n## Diagnostic warnings with material sample size\n\n';
if(!robustWarnings.length)md+='- None under the predeclared diagnostic condition: first-30 PF < 1 with at least 15 filled observations.\n';else for(const x of robustWarnings)md+=`- ${x.dimension} / ${x.bucket}: first-30 PF ${x.metrics.profitFactor}, fills ${x.metrics.filled}, compound ${x.metrics.compoundedBasketPct}%, DD ${x.metrics.maxDrawdownPct}%.\n`;
md+='\nThese warnings are hypothesis generators only. Any next challenger must be specified before testing and must not be accepted merely because it repairs this same historical slice.\n';
fs.writeFileSync(path.join(DATA,'consensus-attribution-v1-evidence.md'),md);
console.log(JSON.stringify({integrity:{dates:60,candidates:447,duplicates:0,missingRequired:0},baseline:evidence.lockedBaseline,robustWarnings,worstDays},null,2));
