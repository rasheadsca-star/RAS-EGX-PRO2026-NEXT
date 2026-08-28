#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');

const ROOT=path.resolve(__dirname,'../..');
const DATA=path.join(ROOT,'gann-fusion-x','data');
const SOURCE=path.join(__dirname,'backtest-consensus-pipeline-v1.cjs');
const RUNTIME=path.join(__dirname,'.consensus-trigger-distance-forward-v1.runtime.cjs');
const SOURCE_JSON=path.join(DATA,'consensus-trigger-distance-forward-v1-source.json');
const OUT_JSON=path.join(DATA,'consensus-trigger-distance-forward-v1-report.json');
const OUT_MD=path.join(DATA,'consensus-trigger-distance-forward-v1-report.md');
const OUT_HTML=path.join(DATA,'consensus-trigger-distance-forward-v1-report.html');

const CUTOFF='2026-08-25';
const DISTANCE_LIMIT_PCT=5;
const MIN_SESSIONS=20;
const MIN_CANDIDATES=50;

const read=(p,d=null)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return d}};
const round=(n,d=3)=>Number.isFinite(Number(n))?Number(Number(n).toFixed(d)):null;
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;

let text=fs.readFileSync(SOURCE,'utf8');
function replaceOnce(from,to,label){
  const n=text.split(from).length-1;
  if(n!==1)throw new Error(`FORWARD_V1_REWRITE_${label}_EXPECTED_ONCE_GOT_${n}`);
  text=text.replace(from,to);
}

// Reproduce the locked V16 Quality Gate V2 pipeline exactly before changing only the evaluation window.
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

// Forward-only observation. Candidate issuance is retained even when 3 future sessions are not yet available.
replaceOnce(
  "const candidateDates=(v16Doc.sessions||[]).map(s=>s.signalDate).filter(d=>universe.some(u=>future(u.adj,d,HOLD).length===HOLD));const dates=[...new Set(candidateDates)].sort().slice(-EXTENDED),first=dates.slice(0,30),last=dates.slice(30);",
  "const candidateDates=(v16Doc.sessions||[]).map(s=>s.signalDate).filter(d=>d>='2026-08-25');const dates=[...new Set(candidateDates)].sort(),first=dates.slice(0,Math.min(30,dates.length)),last=dates.slice(Math.min(30,dates.length));",
  'FORWARD_DATES'
);
replaceOnce("commonLive,acceptance};", "commonLive,acceptance,forwardRows:rows.final};", 'EXPORT_ROWS');

text=text.replaceAll('consensus-pipeline-v1-backtest','consensus-trigger-distance-forward-v1-source');
text=text.replace("schemaVersion:'egx-consensus-pipeline-v1-backtest'", "schemaVersion:'egx-consensus-trigger-distance-forward-v1-source'");
text=text.replace('# EGX Consensus Pipeline V1 — Uncapped Walk-Forward','# EGX Consensus Trigger Distance Forward V1 — Source');
text=text.replaceAll('V16_QUALIFIED_WF','V16_QUALITY_GATE_V2_WF');
text=text.replace("gannRole:'Timing sequencer only. It cannot add a stock. Timing rank uses A/B/C, trigger proximity, Gann time, breakout and volume.'", "gannRole:'Timing-only sequencer. It cannot add a stock or replace SEPA stop/target. B requires GANN trigger; C requires GANN pullback; A keeps the base SEPA entry zone.'");

fs.writeFileSync(RUNTIME,text,'utf8');
try{require(RUNTIME)}finally{try{fs.unlinkSync(RUNTIME)}catch{}}

const src=read(SOURCE_JSON);
if(!src||!Array.isArray(src.dates)||!Array.isArray(src.forwardRows))throw new Error('FORWARD_SOURCE_MISSING');
if(src.dates.some(d=>d<CUTOFF))throw new Error('PRE_CUTOFF_SESSION_LEAK');

const baseline=src.forwardRows.map(r=>({...r}));
const challenger=baseline.map(r=>{
  const out={...r};
  const distance=Math.abs(Number(r.timing?.triggerDistancePct));
  const baselineSize=Number(r.sizeMultiplier??0);
  const alreadyInactive=baselineSize<=0||['WAIT','BLOCK'].includes(String(r.gateAction||''));
  const blockedByDistance=!alreadyInactive&&Number.isFinite(distance)&&distance>DISTANCE_LIMIT_PCT;
  out.forwardGuard={distancePct:Number.isFinite(distance)?round(distance,3):null,limitPct:DISTANCE_LIMIT_PCT,blockedByDistance};
  if(blockedByDistance){
    out.sizeMultiplier=0;
    out.gateAction='WAIT';
    if(!['NO_HISTORY','INSUFFICIENT_FUTURE','INVALID_LEVELS'].includes(String(out.status||''))){
      out.status='WAIT';
      out.netReturnPct=0;
      out.effectiveNetPct=0;
    }
  }
  return out;
});

const key=r=>`${r.date}|${r.ticker}`;
const baseKeys=baseline.map(key),challKeys=challenger.map(key);
const invariants={
  allDatesForward:src.dates.every(d=>d>=CUTOFF),
  candidateCountIdentical:baseline.length===challenger.length,
  candidateKeysIdentical:baseKeys.join('|')===challKeys.join('|'),
  uniqueCandidateKeys:new Set(baseKeys).size===baseKeys.length,
  noSizeIncrease:challenger.every((r,i)=>Number(r.sizeMultiplier??0)<=Number(baseline[i].sizeMultiplier??0)),
  lockedFieldsIdentical:challenger.every((r,i)=>{
    const b=baseline[i];
    const same=(a,c)=>JSON.stringify(a??null)===JSON.stringify(c??null);
    return r.date===b.date&&r.ticker===b.ticker&&r.v16Rank===b.v16Rank&&r.sepaRank===b.sepaRank&&r.gannTimingScore===b.gannTimingScore&&same(r.timing,b.timing)&&same(r.levels,b.levels);
  })
};
invariants.passed=Object.values(invariants).every(Boolean);
if(!invariants.passed)throw new Error(`FORWARD_INVARIANT_FAILED:${JSON.stringify(invariants)}`);

const invalidStatus=new Set(['NO_HISTORY','INSUFFICIENT_FUTURE','INVALID_LEVELS']);
const evaluableDates=src.dates.filter(d=>baseline.some(r=>r.date===d&&!invalidStatus.has(String(r.status||''))));

function maxDD(vals){let eq=1,peak=1,m=0;for(const r of vals){eq*=1+r/100;peak=Math.max(peak,eq);m=Math.min(m,(eq/peak-1)*100)}return m}
function summarize(rows,dates){
  const valid=rows.filter(r=>dates.includes(r.date)&&!invalidStatus.has(String(r.status||'')));
  const active=valid.filter(r=>Number(r.sizeMultiplier??0)>0);
  const filled=active.filter(r=>!['UNFILLED','WAIT','BLOCK'].includes(String(r.status||'')));
  const nets=filled.map(r=>Number(r.effectiveNetPct??0));
  const pos=nets.filter(x=>x>0),neg=nets.filter(x=>x<0);
  const daily=dates.map(date=>{
    const rs=valid.filter(r=>r.date===date);
    return {
      date,
      candidates:rs.length,
      netPct:rs.length?rs.reduce((s,r)=>s+Number(r.effectiveNetPct||0),0)/rs.length:0,
      exposurePct:rs.length?rs.reduce((s,r)=>s+Number(r.sizeMultiplier??0),0)/rs.length*100:0
    };
  });
  let eq=1;for(const d of daily)eq*=1+d.netPct/100;
  return {
    sessions:dates.length,
    candidates:valid.length,
    active:active.length,
    filled:filled.length,
    exposurePct:round(mean(daily.map(x=>x.exposurePct)),1),
    fillRatePct:round(active.length?filled.length/active.length*100:0,1),
    positiveTradeRatePct:round(filled.length?pos.length/filled.length*100:0,1),
    targetHitPct:round(filled.length?filled.filter(x=>x.status==='TARGET_HIT').length/filled.length*100:0,1),
    stopHitPct:round(filled.length?filled.filter(x=>String(x.status).startsWith('STOP')).length/filled.length*100:0,1),
    averageEffectiveNetPct:round(mean(nets),3),
    profitFactor:round(neg.length?pos.reduce((a,b)=>a+b,0)/Math.abs(neg.reduce((a,b)=>a+b,0)):pos.length?999:0,2),
    compoundedBasketPct:round((eq-1)*100,3),
    maxDrawdownPct:round(maxDD(daily.map(x=>x.netPct)),3),
    daily
  };
}

const baselineSummary=summarize(baseline,evaluableDates);
const challengerSummary=summarize(challenger,evaluableDates);
const blockedRows=challenger.filter(r=>r.forwardGuard?.blockedByDistance);
const issuedCandidates=baseline.length;
const minimumSampleMet=evaluableDates.length>=MIN_SESSIONS&&baselineSummary.candidates>=MIN_CANDIDATES;
const acceptance={
  minimumSampleMet,
  pfNotWorse:minimumSampleMet?challengerSummary.profitFactor>=baselineSummary.profitFactor:null,
  compoundNotWorse:minimumSampleMet?challengerSummary.compoundedBasketPct>=baselineSummary.compoundedBasketPct:null,
  drawdownNotWorse:minimumSampleMet?challengerSummary.maxDrawdownPct>=baselineSummary.maxDrawdownPct:null,
  stopHitNotWorse:minimumSampleMet?challengerSummary.stopHitPct<=baselineSummary.stopHitPct:null,
  invariantsPassed:invariants.passed
};
acceptance.passed=minimumSampleMet&&acceptance.pfNotWorse&&acceptance.compoundNotWorse&&acceptance.drawdownNotWorse&&acceptance.stopHitNotWorse&&acceptance.invariantsPassed;
const status=!minimumSampleMet?'INSUFFICIENT_FORWARD_SAMPLE':acceptance.passed?'FORWARD_GATE_PASS_REVIEW_REQUIRED':'FORWARD_GATE_FAIL';

const report={
  schemaVersion:'egx-consensus-trigger-distance-forward-v1-report',
  generatedAt:new Date().toISOString(),
  status,
  policy:{cutoff:CUTOFF,distanceLimitPct:DISTANCE_LIMIT_PCT,minimumEvaluableSessions:MIN_SESSIONS,minimumEvaluableCandidates:MIN_CANDIDATES,noFixedTopN:true,productionChanged:false},
  sourceSessions:src.dates,
  evaluableSessions:evaluableDates,
  issuedCandidates,
  evaluableCandidates:baselineSummary.candidates,
  blockedByDistance:blockedRows.length,
  invariants,
  baseline:baselineSummary,
  challenger:challengerSummary,
  acceptance,
  blockedRows:blockedRows.map(r=>({date:r.date,ticker:r.ticker,distancePct:r.forwardGuard.distancePct,v16Rank:r.v16Rank,sepaRank:r.sepaRank,gannTimingScore:r.gannTimingScore,timingGrade:r.timing?.grade||null,baselineAction:baseline.find(b=>key(b)===key(r))?.gateAction||null}))
};

fs.writeFileSync(OUT_JSON,JSON.stringify(report,null,2)+'\n');
const md=[
  '# Consensus Trigger Distance Forward V1 — Shadow Evidence','',
  `Generated: ${report.generatedAt}`,'',
  `Status: **${status}**`,'',
  `Forward cutoff: **${CUTOFF}**`,'',
  `Frozen rule: **abs(triggerDistancePct) > ${DISTANCE_LIMIT_PCT}% → WAIT**`,'',
  `Source sessions observed: **${src.dates.length}**`,'',
  `Evaluable sessions: **${evaluableDates.length}/${MIN_SESSIONS}**`,'',
  `Issued candidates: **${issuedCandidates}**`,'',
  `Evaluable candidates: **${baselineSummary.candidates}/${MIN_CANDIDATES}**`,'',
  `Rows blocked by distance guard: **${blockedRows.length}**`,'',
  '## Baseline vs Challenger','',
  '| Metric | Baseline | Challenger |','|---|---:|---:|',
  `| PF | ${baselineSummary.profitFactor} | ${challengerSummary.profitFactor} |`,
  `| Compound % | ${baselineSummary.compoundedBasketPct} | ${challengerSummary.compoundedBasketPct} |`,
  `| Max DD % | ${baselineSummary.maxDrawdownPct} | ${challengerSummary.maxDrawdownPct} |`,
  `| Exposure % | ${baselineSummary.exposurePct} | ${challengerSummary.exposurePct} |`,
  `| Fill % | ${baselineSummary.fillRatePct} | ${challengerSummary.fillRatePct} |`,
  `| Positive % | ${baselineSummary.positiveTradeRatePct} | ${challengerSummary.positiveTradeRatePct} |`,
  `| Target hit % | ${baselineSummary.targetHitPct} | ${challengerSummary.targetHitPct} |`,
  `| Stop hit % | ${baselineSummary.stopHitPct} | ${challengerSummary.stopHitPct} |`,'',
  '## Integrity','',
  ...Object.entries(invariants).map(([k,v])=>`- ${k}: **${v}**`),'',
  '## Acceptance','',
  ...Object.entries(acceptance).map(([k,v])=>`- ${k}: **${v===null?'PENDING':v}**`),'',
  'No production engine or UI is modified by this forward-shadow runner.'
];
fs.writeFileSync(OUT_MD,md.join('\n')+'\n');

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const metricRows=[
  ['Profit Factor',baselineSummary.profitFactor,challengerSummary.profitFactor],
  ['Compound %',baselineSummary.compoundedBasketPct,challengerSummary.compoundedBasketPct],
  ['Max DD %',baselineSummary.maxDrawdownPct,challengerSummary.maxDrawdownPct],
  ['Exposure %',baselineSummary.exposurePct,challengerSummary.exposurePct],
  ['Fill %',baselineSummary.fillRatePct,challengerSummary.fillRatePct],
  ['Positive %',baselineSummary.positiveTradeRatePct,challengerSummary.positiveTradeRatePct],
  ['Target hit %',baselineSummary.targetHitPct,challengerSummary.targetHitPct],
  ['Stop hit %',baselineSummary.stopHitPct,challengerSummary.stopHitPct]
];
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Consensus Trigger Distance Forward V1</title><style>body{font-family:Arial,sans-serif;max-width:980px;margin:32px auto;padding:0 18px;line-height:1.5}h1{font-size:26px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:18px 0}.card{border:1px solid #ccc;border-radius:10px;padding:14px}.value{font-size:24px;font-weight:700}table{width:100%;border-collapse:collapse;margin:18px 0}th,td{border:1px solid #ccc;padding:9px;text-align:right}th:first-child,td:first-child{text-align:left}.small{font-size:13px}</style></head><body><h1>Consensus Trigger Distance Forward V1</h1><p><strong>Status:</strong> ${esc(status)}</p><p>Frozen rule: <strong>abs(triggerDistancePct) &gt; ${DISTANCE_LIMIT_PCT}% → WAIT</strong>. Forward observations only from ${CUTOFF}.</p><div class="cards"><div class="card"><div>Observed sessions</div><div class="value">${src.dates.length}</div></div><div class="card"><div>Evaluable sessions</div><div class="value">${evaluableDates.length}/${MIN_SESSIONS}</div></div><div class="card"><div>Evaluable candidates</div><div class="value">${baselineSummary.candidates}/${MIN_CANDIDATES}</div></div><div class="card"><div>Distance blocks</div><div class="value">${blockedRows.length}</div></div></div><table><thead><tr><th>Metric</th><th>Baseline</th><th>Challenger</th></tr></thead><tbody>${metricRows.map(r=>`<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody></table><h2>Integrity</h2><ul>${Object.entries(invariants).map(([k,v])=>`<li>${esc(k)}: <strong>${esc(v)}</strong></li>`).join('')}</ul><h2>Acceptance</h2><ul>${Object.entries(acceptance).map(([k,v])=>`<li>${esc(k)}: <strong>${esc(v===null?'PENDING':v)}</strong></li>`).join('')}</ul><p class="small">Generated ${esc(report.generatedAt)}. Research shadow only; no production engine or UI change.</p></body></html>`;
fs.writeFileSync(OUT_HTML,html);

console.log(JSON.stringify({status,sourceSessions:src.dates,evaluableSessions:evaluableDates.length,issuedCandidates,evaluableCandidates:baselineSummary.candidates,blockedByDistance:blockedRows.length,baseline:baselineSummary,challenger:challengerSummary,acceptance},null,2));
