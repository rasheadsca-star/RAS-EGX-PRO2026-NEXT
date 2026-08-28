#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const source=path.join(__dirname,'backtest-consensus-pipeline-v1.cjs');
const runtime=path.join(__dirname,'.consensus-selection-attribution-v1.runtime.cjs');
let text=fs.readFileSync(source,'utf8');
function replaceOnce(from,to,label){const n=text.split(from).length-1;if(n!==1)throw new Error(`ATTR_V1_REWRITE_${label}_EXPECTED_ONCE_GOT_${n}`);text=text.replace(from,to)}

// Locked V16 Quality Gate V2 methodology. No stock is added, removed or reranked here.
replaceOnce(",'','## Acceptance'];for(const [k,v]", ",'','## Acceptance');for(const [k,v]", 'REPORT_BRACKET');

// Carry point-in-time explanatory features through the unchanged intersection BEFORE
// the locked level rewrite touches the same GANN candidate expression.
replaceOnce(
  "gannTimingScore:null,timing:null,levels:s.levels",
  "gannTimingScore:null,timing:null,v16Meta:v.meta,sepaMeta:s.meta,sepaActionable:s.actionable,gannMeta:null,levels:s.levels",
  'NO_GANN_META'
);
replaceOnce(
  "gannTimingScore:g.score,timing:g.timing,levels:g.levels",
  "gannTimingScore:g.score,timing:g.timing,v16Meta:v.meta,sepaMeta:s.meta,sepaActionable:s.actionable,gannMeta:{gannTimeScore:g.analysis.parts?.gannTime?.score??null,volumeConfirmed:Boolean(g.analysis.parts?.volume?.confirmed),volumeScore:g.analysis.parts?.volume?.score??null,breakoutConfirmed:Boolean(g.analysis.parts?.breakout?.confirmed),breakoutNear:Boolean(g.analysis.parts?.breakout?.near),breakoutScore:g.analysis.parts?.breakout?.score??null,momentumOverheated:Boolean(g.analysis.parts?.momentum?.overheated),momentumScore:g.analysis.parts?.momentum?.score??null},levels:g.levels",
  'GANN_META'
);

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

const inject=`
const attributionRows=[];
for(const d of dates){
  const s=scan(d),rawBy=new Map(s.raw.map(x=>[x.ticker,evaluate(x)])),timedBy=new Map(s.timed.map(x=>[x.ticker,evaluate(x)])),finalBy=new Map(s.final.map(x=>[x.ticker,evaluate(x)]));
  for(const c of s.common){
    const raw=rawBy.get(c.ticker),timed=timedBy.get(c.ticker),finalEff=finalBy.get(c.ticker),lv=(s.raw.find(x=>x.ticker===c.ticker)?.levels)||c.levels||{};
    const mid=(Number(lv.entryLow)+Number(lv.entryHigh))/2,risk=mid-Number(lv.stopLoss),reward=Number(lv.target1)-mid;
    attributionRows.push({
      date:d,ticker:c.ticker,
      v16Rank:c.v16Rank,v16Count:s.v16.length,v16RankPct:s.v16.length?c.v16Rank/s.v16.length:null,v16ExecutionScore:c.v16Score,
      v16PTop10:c.v16Meta?.pTop10??null,v16PPositive:c.v16Meta?.pPositive??null,v16PLargeLoss:c.v16Meta?.pLargeLoss??null,
      sepaRank:c.sepaRank,sepaCount:s.sepa.length,sepaRankPct:s.sepa.length?c.sepaRank/s.sepa.length:null,sepaScore:c.sepaScore,sepaActionable:Boolean(c.sepaActionable),
      sepaTrend:c.sepaMeta?.trend??null,sepaRS:c.sepaMeta?.rs??null,sepaMomentum:c.sepaMeta?.momentum??null,sepaVolume:c.sepaMeta?.volume??null,sepaEntry:c.sepaMeta?.entry??null,sepaRisk:c.sepaMeta?.risk??null,
      gannAvailable:Boolean(c.gannAvailable),gannGrade:c.timing?.grade??null,gannTriggerDistancePct:c.timing?.triggerDistancePct??null,gannTimingScore:c.gannTimingScore??null,
      gannTimeScore:c.gannMeta?.gannTimeScore??null,gannVolumeConfirmed:c.gannMeta?.volumeConfirmed??null,gannVolumeScore:c.gannMeta?.volumeScore??null,
      gannBreakoutState:c.gannMeta?(c.gannMeta.breakoutConfirmed?'CONFIRMED':c.gannMeta.breakoutNear?'NEAR':'OTHER'):null,gannBreakoutScore:c.gannMeta?.breakoutScore??null,
      gannMomentumOverheated:c.gannMeta?.momentumOverheated??null,gannMomentumScore:c.gannMeta?.momentumScore??null,
      rr:risk>0?reward/risk:null,stopPct:mid>0&&risk>0?risk/mid*100:null,
      regime:c.regime?.regime??null,regimeScore:c.regime?.score??null,highVolatility:Boolean(c.regime?.deterioration?.highVolatility),gateAction:c.gate?.action??null,sizeMultiplier:c.gate?.sizeMultiplier??0,
      rawOutcome:{status:raw?.status??null,netReturnPct:raw?.netReturnPct??0},
      timedOutcome:{status:timed?.status??null,netReturnPct:timed?.netReturnPct??0,effectiveNetPct:timed?.effectiveNetPct??0},
      finalOutcome:{status:finalEff?.status??null,netReturnPct:finalEff?.netReturnPct??0,effectiveNetPct:finalEff?.effectiveNetPct??0}
    });
  }
}
fs.writeFileSync(path.join(OUT,'consensus-selection-attribution-v1-rows.json'),JSON.stringify({schemaVersion:'egx-consensus-selection-attribution-v1-rows',generatedAt:new Date().toISOString(),method:{selection:'NONE — all V16 Quality Gate V2 ∩ SEPA candidates retained',rawOutcome:'SEPA base entry/stop/target, full-size shadow outcome',timedOutcome:'Same candidate after unchanged GANN A/B/C timing, full-size shadow outcome when GANN available',finalOutcome:'Same candidate after unchanged Regime Gate ALLOW/REDUCE_SIZE/WAIT/BLOCK',tradeabilityProxy:'V16 executionScore; no new tradeability formula introduced'},dates,rows:attributionRows},null,2)+'\\n');
`;
replaceOnce("const result={schemaVersion:'egx-consensus-pipeline-v1-backtest'",inject+"\nconst result={schemaVersion:'egx-consensus-pipeline-v1-backtest'",'ATTRIBUTION_CAPTURE');

text=text.replaceAll('consensus-pipeline-v1-backtest','consensus-selection-attribution-v1-source');
text=text.replace("schemaVersion:'egx-consensus-pipeline-v1-backtest'","schemaVersion:'egx-consensus-selection-attribution-v1-source'");
text=text.replace('# EGX Consensus Pipeline V1 — Uncapped Walk-Forward','# EGX Consensus Selection Attribution V1 — Locked Source');
text=text.replaceAll('V16_QUALIFIED_WF','V16_QUALITY_GATE_V2_WF');
text=text.replace("gannRole:'Timing sequencer only. It cannot add a stock. Timing rank uses A/B/C, trigger proximity, Gann time, breakout and volume.'","gannRole:'Unchanged timing-only sequencer. Attribution capture does not alter candidate selection or timing.'");
text=text.replace("limitations:['V16 60-session list","limitations:['Attribution capture is diagnostic only and makes no selection decision.','Tradeability is represented only by the already-existing V16 executionScore; no new tradeability formula is introduced.','V16 60-session list");
fs.writeFileSync(runtime,text,'utf8');
try{require(runtime)}finally{try{fs.unlinkSync(runtime)}catch{}}
