#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const source=path.join(__dirname,'backtest-consensus-pipeline-v1.cjs');
const runtime=path.join(__dirname,'.backtest-consensus-v16-quality-gate-v1.runtime.cjs');
let text=fs.readFileSync(source,'utf8');

function replaceOnce(from,to,label){
  const n=text.split(from).length-1;
  if(n!==1)throw new Error(`QUALITY_V1_REWRITE_${label}_EXPECTED_ONCE_GOT_${n}`);
  text=text.replace(from,to);
}

// Reproduce the validated V2 timing architecture first.
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

// Quality-gate challenger evidence is isolated from V1/V2 evidence.
text=text.replaceAll('consensus-pipeline-v1-backtest','consensus-v16-quality-gate-v1-backtest');
text=text.replace("schemaVersion:'egx-consensus-pipeline-v1-backtest'", "schemaVersion:'egx-consensus-v16-quality-gate-v1-backtest'");
text=text.replace('# EGX Consensus Pipeline V1 — Uncapped Walk-Forward','# EGX Consensus — V16 Quality Gate V1 — 60-Session Validation');
text=text.replaceAll('V16_QUALIFIED_WF','V16_QUALITY_GATE_WF');
text=text.replace("gannRole:'Timing sequencer only. It cannot add a stock. Timing rank uses A/B/C, trigger proximity, Gann time, breakout and volume.'", "gannRole:'Timing-only sequencer. It cannot add a stock or replace SEPA stop/target. B requires GANN trigger; C requires GANN pullback; A keeps the base SEPA entry zone.'");
text=text.replace("limitations:['V16 60-session list", "limitations:['V16 Quality Gate V1 uses only point-in-time model outputs and same-session relative medians; no realized-return threshold and no fixed Top-N cap.','The 11-session V16 warm-up exists only to leave exactly 60 fully evaluable sessions after future-window eligibility.','V16 60-session list");

fs.writeFileSync(runtime,text,'utf8');
try{require(runtime)}finally{try{fs.unlinkSync(runtime)}catch{}}
