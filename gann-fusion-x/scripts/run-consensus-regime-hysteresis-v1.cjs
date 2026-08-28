#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const source=path.join(__dirname,'backtest-consensus-pipeline-v1.cjs');
const runtime=path.join(__dirname,'.backtest-consensus-regime-hysteresis-v1.runtime.cjs');
let text=fs.readFileSync(source,'utf8');

function replaceOnce(from,to,label){
  const n=text.split(from).length-1;
  if(n!==1)throw new Error(`HYSTERESIS_V1_REWRITE_${label}_EXPECTED_ONCE_GOT_${n}`);
  text=text.replace(from,to);
}

// Preserve every V16 Quality Gate V2 correction exactly.
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

// Regime Hysteresis V1: deterioration is immediate; re-risking needs two consecutive raw RISK_ON sessions.
replaceOnce("function regimeFor(date){","function rawRegimeFor(date){",'RAW_REGIME_RENAME');
replaceOnce(
  "function gateDecision(rg,grade){",
  `const hysteresisCache=new Map();\nfunction regimeFor(date){\n  if(hysteresisCache.has(date))return hysteresisCache.get(date);\n  const raw=rawRegimeFor(date);\n  const idx=allDates.indexOf(date);\n  if(idx<=0){const first={...raw,rawRegime:raw.regime,hysteresis:{version:'v1',applied:false,reason:'INITIAL_STATE',riskOnConfirmationStreak:raw.regime==='RISK_ON'?1:0}};hysteresisCache.set(date,first);return first}\n  const priorDate=allDates[idx-1];\n  const prior=regimeFor(priorDate);\n  const priorRaw=rawRegimeFor(priorDate);\n  let effective=raw.regime,applied=false,reason='RAW_STATE_ACCEPTED';\n  let streak=raw.regime==='RISK_ON'?(priorRaw.regime==='RISK_ON'?2:1):0;\n  if(raw.regime==='RISK_ON'&&prior.regime!=='RISK_ON'&&priorRaw.regime!=='RISK_ON'){\n    effective=prior.regime;applied=true;reason='RISK_ON_REQUIRES_TWO_CONSECUTIVE_RAW_SESSIONS';\n  }\n  const out={...raw,rawRegime:raw.regime,regime:effective,hysteresis:{version:'v1',applied,reason,riskOnConfirmationStreak:streak,priorEffectiveRegime:prior.regime,priorRawRegime:priorRaw.regime}};\n  hysteresisCache.set(date,out);return out;\n}\nfunction gateDecision(rg,grade){`,
  'HYSTERESIS_INSERT'
);

text=text.replaceAll('consensus-pipeline-v1-backtest','consensus-regime-hysteresis-v1-backtest');
text=text.replace("schemaVersion:'egx-consensus-pipeline-v1-backtest'", "schemaVersion:'egx-consensus-regime-hysteresis-v1-backtest'");
text=text.replace('# EGX Consensus Pipeline V1 — Uncapped Walk-Forward','# EGX Consensus — Regime Hysteresis V1 — 60-Session Validation');
text=text.replaceAll('V16_QUALIFIED_WF','V16_QUALITY_GATE_V2_WF');
text=text.replace("gannRole:'Timing sequencer only. It cannot add a stock. Timing rank uses A/B/C, trigger proximity, Gann time, breakout and volume.'", "gannRole:'Timing-only sequencer. It cannot add a stock or replace SEPA stop/target. B requires GANN trigger; C requires GANN pullback; A keeps the base SEPA entry zone.'");
text=text.replace("limitations:['V16 60-session list", "limitations:['Regime Hysteresis V1 changes only the effective market regime used by the existing gate: defensive transitions are immediate, while RISK_ON requires two consecutive raw RISK_ON sessions.','No realized-return threshold is used by hysteresis and no candidate, rank, GANN timing grade, entry, stop, or target rule is changed.','V16 Quality Gate V2 requires historical Top-10 lift > 1 and a 3-of-4 same-session relative-quality vote; no realized-return threshold and no fixed Top-N cap.','The 11-session V16 warm-up exists only to leave exactly 60 fully evaluable sessions after future-window eligibility.','V16 60-session list");

fs.writeFileSync(runtime,text,'utf8');
try{require(runtime)}finally{try{fs.unlinkSync(runtime)}catch{}}
