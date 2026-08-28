#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const OUT=path.join(ROOT,'gann-fusion-x','data');
const Planner=require(path.join(ROOT,'gann-fusion-x','engine','planner.js'));
const EntryTiming=require(path.join(ROOT,'gann-fusion-x','engine','entry-timing.js'));

// Run the historical harness through the same production decision stack used by the UI:
// ACTIONABLE funnel -> Execution Quality rankScore -> Entry Timing A/B/C.
EntryTiming.install(Planner);
const productionBuildPlan=Planner.buildPlan.bind(Planner);

Planner.buildPlan=function currentBacktestPlan(a,horizon,opts){
  const p=productionBuildPlan(a,horizon,opts);
  if(horizon!=='speculative')return p;

  const actionable=Boolean(p.eligible&&p.decision?.code==='ACTIONABLE');
  const levels={...(p.levels||{})};
  const timing=p.entryTiming||{};

  // B means do not count an entry before the trigger is actually traded.
  if(actionable&&timing.grade==='B'&&Number(timing.activationPrice)>0){
    const trigger=Number(timing.activationPrice);
    levels.entryLow=Math.max(Number(levels.entryLow)||trigger,trigger);
    levels.entryHigh=Math.max(Number(levels.entryHigh)||trigger,trigger);
  }

  // C means no chasing: only count an entry if the announced pullback zone is revisited.
  if(actionable&&timing.grade==='C'&&Number(timing.pullbackZone?.low)>0&&Number(timing.pullbackZone?.high)>=Number(timing.pullbackZone?.low)){
    levels.entryLow=Number(timing.pullbackZone.low);
    levels.entryHigh=Number(timing.pullbackZone.high);
  }

  return{
    ...p,
    eligible:actionable,
    score:Number.isFinite(Number(p.rankScore))?Number(p.rankScore):p.score,
    levels
  };
};

require('./backtest-compare.cjs');

// Annotate the generated evidence so it cannot be confused with the older score-only harness.
const jsonPath=path.join(OUT,'backtest-comparison.json');
const mdPath=path.join(OUT,'backtest-comparison.md');
const result=JSON.parse(fs.readFileSync(jsonPath,'utf8'));
result.schemaVersion='gann-fusion-x-comparison-current-v2';
result.method.gannSelection='Production ACTIONABLE funnel only; Top 3 sorted by Execution Quality rankScore.';
result.method.gannEntryTiming='A=normal confirmed zone; B=entry cannot occur below Trigger; C=entry only on announced Pullback zone.';
result.comparability.GANN_FUSION_X='Current production Gann Fusion X speculative decision stack: ACTIONABLE funnel, Execution Quality rankScore, and Entry Timing A/B/C. Historical fundamentals and non-reconstructable point-in-time metadata remain neutral/unknown to prevent look-ahead.';
result.limitations=[
  ...(result.limitations||[]),
  'Historical GANN ranking uses only point-in-time OHLCV-derived evidence; current-day SEPA fundamentals, liquidity percentile and money-flow metadata are not backfilled into past dates.',
  'Entry Timing is evaluated from daily OHLC bars, so intraday ordering around Trigger/Pullback cannot be reconstructed; the rules are intentionally conservative.'
];
fs.writeFileSync(jsonPath,JSON.stringify(result,null,2)+'\n');
const md=fs.readFileSync(mdPath,'utf8');
const note='\n## Current-production GANN adapter\n- GANN candidates are ACTIONABLE only and ranked by Execution Quality `rankScore`.\n- Grade B cannot enter below Trigger.\n- Grade C can enter only after revisiting the announced Pullback zone.\n- Historical fundamentals/non-reconstructable metadata stay neutral to avoid look-ahead.\n';
fs.writeFileSync(mdPath,md+note);

console.log(JSON.stringify({
  schemaVersion:result.schemaVersion,
  commonDates:result.commonDateTest?.dates?.length||0,
  commonRanking:result.commonDateTest?.ranking||[],
  extendedDates:result.extendedWalkForward?.dates?.length||0,
  extendedRanking:result.extendedWalkForward?.ranking||[]
},null,2));
