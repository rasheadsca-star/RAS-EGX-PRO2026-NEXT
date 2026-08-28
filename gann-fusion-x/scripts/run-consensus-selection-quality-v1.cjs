#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const source=path.join(__dirname,'backtest-consensus-pipeline-v1.cjs');

function build(mode,stem){
  let text=fs.readFileSync(source,'utf8');
  const runtime=path.join(__dirname,`.${stem}.runtime.cjs`);
  function replaceOnce(from,to,label){
    const n=text.split(from).length-1;
    if(n!==1)throw new Error(`SELECTION_V1_REWRITE_${label}_EXPECTED_ONCE_GOT_${n}`);
    text=text.replace(from,to);
  }

  // Preserve the locked V16 Quality Gate V2 / timing-only GANN methodology.
  replaceOnce(",'','## Acceptance'];for(const [k,v]", ",'','## Acceptance');for(const [k,v]", 'REPORT_BRACKET');
  replaceOnce("levels:g.levels,sourceScale:'adjusted',gate", "levels:{...s.levels},gannPlanLevels:{...g.plan.levels},sourceScale:'adjusted',gate", 'BASE_LEVELS');
  replaceOnce(
    "const timed=common.map(x=>({...x,engine:'CONSENSUS_GANN_TIMED',sizeMultiplier:x.gannAvailable?1:0}));",
    "const timed=common.map(x=>{const lv={...x.levels};if(x.gannAvailable&&x.timing?.grade==='C'&&+x.timing.pullbackZone?.low>0&&+x.timing.pullbackZone?.high>=+x.timing.pullbackZone?.low){lv.entryLow=+x.timing.pullbackZone.low;lv.entryHigh=+x.timing.pullbackZone.high}return{...x,engine:'CONSENSUS_GANN_TIMED',levels:lv,sizeMultiplier:x.gannAvailable?1:0}});",
    'TIMED_STAGE'
  );
  replaceOnce(
    "const final=common.map(x=>({...x,engine:'CONSENSUS_FINAL',sizeMultiplier:x.gate.sizeMultiplier,gateAction:x.gate.action}));",
    "const final=timed.map(x=>({...x,engine:'CONSENSUS_FINAL',sizeMultiplier:x.gate.sizeMultiplier,gateAction:x.gate.action}));",
    'FINAL_STAGE'
  );

  const sortNeedle="common.sort((a,b)=>(Number(b.gannAvailable)-Number(a.gannAvailable))||(Number(b.gannTimingScore||-1)-Number(a.gannTimingScore||-1)));";
  const paretoExpr="common.filter(x=>!common.some(y=>y.ticker!==x.ticker&&Number(y.v16Rank)<=Number(x.v16Rank)&&Number(y.sepaRank)<=Number(x.sepaRank)&&(Number(y.v16Rank)<Number(x.v16Rank)||Number(y.sepaRank)<Number(x.sepaRank))))";
  const selector=mode==='frontier'
    ? `const paretoRows=${paretoExpr};common.splice(0,common.length,...paretoRows);`
    : `const paretoSet=new Set((${paretoExpr}).map(x=>x.ticker));const dominatedRows=common.filter(x=>!paretoSet.has(x.ticker));common.splice(0,common.length,...dominatedRows);`;
  replaceOnce(sortNeedle,selector+sortNeedle,'PARETO_SELECTOR');

  // The base invariant required the entire intersection. Selection V1 is intentionally a strict subset.
  replaceOnce(
    "const commonSet=new Set(common.map(x=>x.ticker));if(common.length!==commonTickers.length||common.some(x=>!v16Set.has(x.ticker)||!sepaSet.has(x.ticker))||commonSet.size!==common.length)throw new Error(`CONSENSUS_INVARIANT_FAILED:${date}`);",
    "const commonSet=new Set(common.map(x=>x.ticker));if(common.some(x=>!v16Set.has(x.ticker)||!sepaSet.has(x.ticker))||commonSet.size!==common.length)throw new Error(`CONSENSUS_SELECTION_SUBSET_INVARIANT_FAILED:${date}`);",
    'SUBSET_INVARIANT'
  );

  text=text.replaceAll('consensus-pipeline-v1-backtest',stem);
  text=text.replace("schemaVersion:'egx-consensus-pipeline-v1-backtest'",`schemaVersion:'egx-${stem}'`);
  text=text.replace('# EGX Consensus Pipeline V1 — Uncapped Walk-Forward',mode==='frontier'?'# EGX Consensus Selection Quality V1 — Pareto Frontier':'# EGX Consensus Selection Quality V1 — Dominated Shadow Book');
  text=text.replaceAll('V16_QUALIFIED_WF','V16_QUALITY_GATE_V2_WF');
  text=text.replace(
    "gannRole:'Timing sequencer only. It cannot add a stock. Timing rank uses A/B/C, trigger proximity, Gann time, breakout and volume.'",
    "gannRole:'Unchanged timing-only sequencer after selection. It cannot add a stock or replace the SEPA stop/target.'"
  );
  text=text.replace(
    "intersection:'Exact ticker intersection of qualified V16 and qualified SEPA lists.'",
    mode==='frontier'
      ? "intersection:'Exact V16 Quality Gate V2 ∩ SEPA intersection, then parameter-free Pareto frontier on V16 rank and SEPA rank only.'"
      : "intersection:'Shadow book of candidates dominated on both V16 rank and SEPA rank by at least one other common candidate in the same session.'"
  );
  text=text.replace(
    "limitations:['V16 60-session list",
    "limitations:['Selection Quality V1 uses only same-session V16 and SEPA ranks; it has no fixed Top-N, no weighted score and no realized-return threshold.','The Pareto rule is locked before this run and is not tuned to the backtest outcome.','V16 60-session list"
  );

  fs.writeFileSync(runtime,text,'utf8');
  try{
    delete require.cache[require.resolve(runtime)];
    require(runtime);
  }finally{
    try{fs.unlinkSync(runtime)}catch{}
  }
}

build('frontier','consensus-selection-quality-v1-backtest');
build('shadow','consensus-selection-quality-v1-shadow-backtest');
