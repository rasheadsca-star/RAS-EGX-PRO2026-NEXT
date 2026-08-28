#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, 'backtest-consensus-pipeline-v1.cjs');
const runtime = path.join(__dirname, '.backtest-consensus-rank-v1.runtime.cjs');
let text = fs.readFileSync(source, 'utf8');

function replaceOnce(from, to, label) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`CONSENSUS_RANK_V1_REWRITE_${label}_EXPECTED_ONCE_GOT_${n}`);
  text = text.replace(from, to);
}

// Keep the already-validated V16 Quality Gate V2 / SEPA / GANN / Regime methodology.
replaceOnce(",'','## Acceptance'];for(const [k,v]", ",'','## Acceptance');for(const [k,v]", 'REPORT_BRACKET');
replaceOnce(
  "levels:g.levels,sourceScale:'adjusted',gate",
  "levels:{...s.levels},gannPlanLevels:{...g.plan.levels},sourceScale:'adjusted',gate",
  'BASE_LEVELS'
);

// Consensus Rank V1: same-session, point-in-time percentiles only.
// Geometric mean forces a stock to be strong in BOTH V16 and SEPA without a tuned 60/40 weight.
// No fixed Top-N and no realized-return threshold is used.
replaceOnce(
  "common.sort((a,b)=>(Number(b.gannAvailable)-Number(a.gannAvailable))||(Number(b.gannTimingScore||-1)-Number(a.gannTimingScore||-1)));common.forEach((x,i)=>x.gannTimingRank=i+1);",
  "for(const x of common){const vp=v16.length?clamp((v16.length-Number(x.v16Rank||v16.length)+1)/v16.length*100):0,sp=sepa.length?clamp((sepa.length-Number(x.sepaRank||sepa.length)+1)/sepa.length*100):0;x.v16Percentile=round(vp,2);x.sepaPercentile=round(sp,2);x.consensusQualityScore=round(Math.sqrt(Math.max(0,vp)*Math.max(0,sp)),2);x.consensusQualityWeight=round(clamp(x.consensusQualityScore,0,100)/100,4)}const qualityOrder=[...common].sort((a,b)=>Number(b.consensusQualityScore||0)-Number(a.consensusQualityScore||0));qualityOrder.forEach((x,i)=>x.consensusQualityRank=i+1);common.sort((a,b)=>(Number(b.gannAvailable)-Number(a.gannAvailable))||(Number(b.gannTimingScore||-1)-Number(a.gannTimingScore||-1))||(Number(b.consensusQualityScore||0)-Number(a.consensusQualityScore||0)));common.forEach((x,i)=>x.gannTimingRank=i+1);",
  'QUALITY_SCORE'
);

// GANN remains timing-only. Consensus quality changes capital weight continuously, not membership.
replaceOnce(
  "const timed=common.map(x=>({...x,engine:'CONSENSUS_GANN_TIMED',sizeMultiplier:x.gannAvailable?1:0}));",
  "const timed=common.map(x=>{const lv={...x.levels};if(x.gannAvailable&&x.timing?.grade==='C'&&+x.timing.pullbackZone?.low>0&&+x.timing.pullbackZone?.high>=+x.timing.pullbackZone?.low){lv.entryLow=+x.timing.pullbackZone.low;lv.entryHigh=+x.timing.pullbackZone.high}return{...x,engine:'CONSENSUS_GANN_TIMED',levels:lv,sizeMultiplier:x.gannAvailable?x.consensusQualityWeight:0}});",
  'TIMED_STAGE'
);
replaceOnce(
  "const final=common.map(x=>({...x,engine:'CONSENSUS_FINAL',sizeMultiplier:x.gate.sizeMultiplier,gateAction:x.gate.action}));",
  "const final=timed.map(x=>({...x,engine:'CONSENSUS_FINAL',sizeMultiplier:x.gate.sizeMultiplier*x.consensusQualityWeight,gateAction:x.gate.action,consensusRankApplied:true}));",
  'FINAL_STAGE'
);

text = text.replaceAll('consensus-pipeline-v1-backtest', 'consensus-rank-v1-backtest');
text = text.replace("schemaVersion:'egx-consensus-pipeline-v1-backtest'", "schemaVersion:'egx-consensus-rank-v1-backtest'");
text = text.replace('# EGX Consensus Pipeline V1 — Uncapped Walk-Forward', '# EGX Consensus Rank V1 — Quality-Weighted 60-Session Validation');
text = text.replaceAll('V16_QUALIFIED_WF', 'V16_QUALITY_GATE_V2_WF');
text = text.replace(
  "gannRole:'Timing sequencer only. It cannot add a stock. Timing rank uses A/B/C, trigger proximity, Gann time, breakout and volume.'",
  "gannRole:'Timing-only sequencer after V16∩SEPA. It cannot add a stock or replace SEPA stop/target. Consensus Rank only sizes the already-common stock; GANN still controls entry timing.'"
);
text = text.replace(
  "limitations:['V16 60-session list",
  "limitations:['Consensus Rank V1 is point-in-time and parameter-light: V16 percentile and SEPA percentile are combined by geometric mean; no fixed Top-N and no realized-return fitting.','Consensus quality weight is score/100 with no floor; Regime multiplier is applied afterwards.','V16 Quality Gate V2 remains unchanged and requires historical Top-10 lift > 1 plus a 3-of-4 same-session relative-quality vote.','The 11-session V16 warm-up exists only to leave exactly 60 fully evaluable sessions after future-window eligibility.','V16 60-session list"
);

fs.writeFileSync(runtime, text, 'utf8');
try {
  require(runtime);
} finally {
  try { fs.unlinkSync(runtime); } catch {}
}
