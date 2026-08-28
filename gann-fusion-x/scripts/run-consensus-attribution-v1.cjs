#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const source=path.join(__dirname,'backtest-consensus-pipeline-v1.cjs');
const runtime=path.join(__dirname,'.consensus-attribution-v1.runtime.cjs');
let text=fs.readFileSync(source,'utf8');

function replaceOnce(from,to,label){
  const n=text.split(from).length-1;
  if(n!==1)throw new Error(`ATTRIBUTION_V1_REWRITE_${label}_EXPECTED_ONCE_GOT_${n}`);
  text=text.replace(from,to);
}

// Reproduce the locked V16 Quality Gate V2 pipeline exactly before adding diagnostics.
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

// Preserve contemporaneous GANN component state for attribution only. This does not change selection, timing or risk decisions.
replaceOnce(
  "regime:rg,gannAvailable:true})}",
  "regime:rg,gannAvailable:true,gannParts:{gannTimeScore:Number(g.analysis?.parts?.gannTime?.score??50),breakoutConfirmed:Boolean(g.analysis?.parts?.breakout?.confirmed),breakoutNear:Boolean(g.analysis?.parts?.breakout?.near),breakoutScore:Number(g.analysis?.parts?.breakout?.score??0),volumeConfirmed:Boolean(g.analysis?.parts?.volume?.confirmed),volumeScore:Number(g.analysis?.parts?.volume?.score??0)}})}",
  'GANN_COMPONENTS'
);
replaceOnce(
  "regime:rg,gannAvailable:false});continue}",
  "regime:rg,gannAvailable:false,gannParts:null});continue}",
  'NO_GANN_COMPONENTS'
);

// Create a candidate-level immutable diagnostic ledger from the already-evaluated locked pipeline.
const resultNeedle="const result={schemaVersion:'egx-consensus-pipeline-v1-backtest'";
const diagnosticBlock=`const rawBy=new Map(rows.raw.map(x=>[x.date+'|'+x.ticker,x])),timedBy=new Map(rows.timed.map(x=>[x.date+'|'+x.ticker,x]));\nconst attributionTrades=rows.final.map(f=>{const key=f.date+'|'+f.ticker,r=rawBy.get(key)||{},t=timedBy.get(key)||{},s=scan(f.date),td=Number(f.timing?.triggerDistancePct);return{date:f.date,ticker:f.ticker,window:first.includes(f.date)?'FIRST_30':'LAST_30',v16Rank:Number(f.v16Rank),v16QualifiedCount:s.v16.length,v16RankPct:s.v16.length?round(Number(f.v16Rank)/s.v16.length*100,2):null,v16Score:round(Number(f.v16Score),3),sepaRank:Number(f.sepaRank),sepaQualifiedCount:s.sepa.length,sepaRankPct:s.sepa.length?round(Number(f.sepaRank)/s.sepa.length*100,2):null,sepaScore:round(Number(f.sepaScore),3),commonCount:s.common.length,gannAvailable:Boolean(f.gannAvailable),gannTimingRank:Number(f.gannTimingRank||0),gannTimingScore:round(Number(f.gannTimingScore),3),timingGrade:f.timing?.grade||'NONE',triggerDistancePct:Number.isFinite(td)?round(td,3):null,activationPrice:round(Number(f.timing?.activationPrice),4),pullbackLow:round(Number(f.timing?.pullbackZone?.low),4),pullbackHigh:round(Number(f.timing?.pullbackZone?.high),4),gannTimeScore:round(Number(f.gannParts?.gannTimeScore),3),breakoutState:f.gannParts?.breakoutConfirmed?'CONFIRMED':f.gannParts?.breakoutNear?'NEAR':'NONE',breakoutScore:round(Number(f.gannParts?.breakoutScore),3),volumeConfirmed:Boolean(f.gannParts?.volumeConfirmed),volumeScore:round(Number(f.gannParts?.volumeScore),3),regime:f.regime?.regime||'UNKNOWN',regimeScore:round(Number(f.regime?.score),3),deteriorationCount:Number(f.regime?.deterioration?.count||0),highVolatility:Boolean(f.regime?.deterioration?.highVolatility),gateAction:f.gateAction||f.gate?.action||'UNKNOWN',sizeMultiplier:Number(f.sizeMultiplier??0),entryLow:round(Number(f.levels?.entryLow),4),entryHigh:round(Number(f.levels?.entryHigh),4),trigger:round(Number(f.levels?.trigger),4),stopLoss:round(Number(f.levels?.stopLoss),4),target1:round(Number(f.levels?.target1),4),rawStatus:r.status||null,rawNetPct:round(Number(r.netReturnPct),3),timedStatus:t.status||null,timedNetPct:round(Number(t.netReturnPct),3),finalStatus:f.status,finalNetPct:round(Number(f.netReturnPct),3),effectiveNetPct:round(Number(f.effectiveNetPct),3),entryPrice:round(Number(f.entryPrice),4),exitPrice:round(Number(f.exitPrice),4)};});\nconst ledgerKeys=new Set(attributionTrades.map(x=>x.date+'|'+x.ticker));if(attributionTrades.length!==ledgerKeys.size)throw new Error('ATTRIBUTION_DUPLICATE_DATE_TICKER');\nif(attributionTrades.length!==summary60.CONSENSUS_FINAL.candidates)throw new Error('ATTRIBUTION_CANDIDATE_COUNT_MISMATCH');\nfs.writeFileSync(path.join(OUT,'consensus-attribution-v1-trades.json'),JSON.stringify({schemaVersion:'egx-consensus-attribution-v1-trades',generatedAt:new Date().toISOString(),diagnosticOnly:true,noPipelineChanges:true,dates,trades:attributionTrades},null,2)+'\\n');\n`;
replaceOnce(resultNeedle,diagnosticBlock+"const result={schemaVersion:'egx-consensus-pipeline-v1-backtest'",'ATTRIBUTION_LEDGER');

text=text.replaceAll('consensus-pipeline-v1-backtest','consensus-attribution-v1-baseline');
text=text.replace("schemaVersion:'egx-consensus-pipeline-v1-backtest'", "schemaVersion:'egx-consensus-attribution-v1-baseline'");
text=text.replace('# EGX Consensus Pipeline V1 — Uncapped Walk-Forward','# EGX Consensus Attribution V1 — Locked V16 Quality Gate V2 Baseline');
text=text.replaceAll('V16_QUALIFIED_WF','V16_QUALITY_GATE_V2_WF');
text=text.replace("gannRole:'Timing sequencer only. It cannot add a stock. Timing rank uses A/B/C, trigger proximity, Gann time, breakout and volume.'", "gannRole:'Unchanged timing-only sequencer from V16 Quality Gate V2. Diagnostics observe its contemporaneous components but do not alter them.'");
text=text.replace("limitations:['V16 60-session list", "limitations:['ATTRIBUTION ONLY: candidate-level diagnostics must not be used to retroactively tune and re-score the same 60-session sample.','V16 Quality Gate V2 remains locked: historical Top-10 lift > 1 and a 3-of-4 same-session relative-quality vote; no realized-return threshold and no fixed Top-N cap.','The 11-session V16 warm-up exists only to leave exactly 60 fully evaluable sessions after future-window eligibility.','V16 60-session list");

fs.writeFileSync(runtime,text,'utf8');
try{require(runtime)}finally{try{fs.unlinkSync(runtime)}catch{}}
