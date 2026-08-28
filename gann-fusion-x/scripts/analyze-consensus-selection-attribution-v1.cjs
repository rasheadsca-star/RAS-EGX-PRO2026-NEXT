#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'gann-fusion-x','data');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const src=read(path.join(OUT,'consensus-selection-attribution-v1-rows.json'));
const baseline=read(path.join(OUT,'consensus-v16-quality-gate-v2-backtest.json'));
const sourceSummary=read(path.join(OUT,'consensus-selection-attribution-v1-source.json'));
const rows=src.rows||[],dates=src.dates||[],firstDates=new Set(dates.slice(0,30)),lastDates=new Set(dates.slice(30));
const round=(n,d=3)=>Number.isFinite(Number(n))?Number(Number(n).toFixed(d)):null;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const finite=a=>a.map(Number).filter(Number.isFinite).sort((x,y)=>x-y);
const quantile=(a,q)=>{const s=finite(a);if(!s.length)return null;const p=(s.length-1)*q,lo=Math.floor(p),hi=Math.ceil(p);return s[lo]+(s[hi]-s[lo])*(p-lo)};
const pf=nets=>{const p=nets.filter(x=>x>0).reduce((a,b)=>a+b,0),n=nets.filter(x=>x<0).reduce((a,b)=>a+b,0);return n<0?round(p/Math.abs(n),2):p>0?999:0};
function outcome(r,layer){return layer==='raw'?r.rawOutcome:layer==='timed'?r.timedOutcome:r.finalOutcome}
function metrics(rs,layer='raw'){
  const valid=rs.filter(r=>!['NO_HISTORY','INSUFFICIENT_FUTURE','INVALID_LEVELS'].includes(outcome(r,layer)?.status));
  const eligible=valid.filter(r=>!['WAIT','BLOCK'].includes(outcome(r,layer)?.status));
  const filled=eligible.filter(r=>outcome(r,layer)?.status!=='UNFILLED');
  const nets=filled.map(r=>Number(layer==='final'?outcome(r,layer)?.effectiveNetPct:outcome(r,layer)?.netReturnPct)||0);
  return {candidates:valid.length,eligible:eligible.length,filled:filled.length,fillRatePct:round(eligible.length?filled.length/eligible.length*100:0,1),positivePct:round(filled.length?nets.filter(x=>x>0).length/filled.length*100:0,1),avgNetPct:round(mean(nets),3),profitFactor:pf(nets),sumNetPct:round(nets.reduce((a,b)=>a+b,0),3),targetPct:round(filled.length?filled.filter(r=>outcome(r,layer)?.status==='TARGET_HIT').length/filled.length*100:0,1),stopPct:round(filled.length?filled.filter(r=>String(outcome(r,layer)?.status).startsWith('STOP')).length/filled.length*100:0,1)};
}
function qCuts(field){const a=rows.map(r=>r[field]);return[quantile(a,.25),quantile(a,.5),quantile(a,.75)]}
function qLabel(v,cuts,highGood=true){v=Number(v);if(!Number.isFinite(v))return'NA';const q=v<=cuts[0]?1:v<=cuts[1]?2:v<=cuts[2]?3:4;return `${highGood?'Q':'Q'}${q}`}
function rankQuart(v){v=Number(v);if(!Number.isFinite(v))return'NA';return v<=.25?'TOP_25':v<=.5?'25_50':v<=.75?'50_75':'BOTTOM_25'}
function triggerBin(v){v=Number(v);if(!Number.isFinite(v))return'NA';return v<=0?'AT_OR_ABOVE':v<=1?'0_1':v<=2.5?'1_2.5':v<=4?'2.5_4':'GT_4'}
function rrBin(v){v=Number(v);if(!Number.isFinite(v))return'NA';return v<1.5?'LT_1.5':v<2?'1.5_2':v<3?'2_3':'GE_3'}
function stopBin(v){v=Number(v);if(!Number.isFinite(v))return'NA';return v<3?'LT_3':v<5?'3_5':v<=8?'5_8':'GT_8'}
const cuts={v16ExecutionScore:qCuts('v16ExecutionScore'),v16PTop10:qCuts('v16PTop10'),v16PPositive:qCuts('v16PPositive'),v16PLargeLoss:qCuts('v16PLargeLoss'),sepaScore:qCuts('sepaScore'),sepaTrend:qCuts('sepaTrend'),sepaRS:qCuts('sepaRS'),sepaVolume:qCuts('sepaVolume'),gannTimingScore:qCuts('gannTimingScore'),gannTimeScore:qCuts('gannTimeScore')};
const factors=[
  {name:'V16_RANK_PERCENTILE',layer:'raw',fn:r=>rankQuart(r.v16RankPct)},
  {name:'SEPA_RANK_PERCENTILE',layer:'raw',fn:r=>rankQuart(r.sepaRankPct)},
  {name:'V16_EXECUTION_SCORE_QUARTILE',layer:'raw',fn:r=>qLabel(r.v16ExecutionScore,cuts.v16ExecutionScore)},
  {name:'V16_P_TOP10_QUARTILE',layer:'raw',fn:r=>qLabel(r.v16PTop10,cuts.v16PTop10)},
  {name:'V16_P_POSITIVE_QUARTILE',layer:'raw',fn:r=>qLabel(r.v16PPositive,cuts.v16PPositive)},
  {name:'V16_P_LARGE_LOSS_QUARTILE',layer:'raw',fn:r=>qLabel(r.v16PLargeLoss,cuts.v16PLargeLoss)},
  {name:'SEPA_SCORE_QUARTILE',layer:'raw',fn:r=>qLabel(r.sepaScore,cuts.sepaScore)},
  {name:'SEPA_ACTIONABLE',layer:'raw',fn:r=>String(Boolean(r.sepaActionable))},
  {name:'SEPA_TREND_QUARTILE',layer:'raw',fn:r=>qLabel(r.sepaTrend,cuts.sepaTrend)},
  {name:'SEPA_RS_QUARTILE',layer:'raw',fn:r=>qLabel(r.sepaRS,cuts.sepaRS)},
  {name:'SEPA_VOLUME_QUARTILE',layer:'raw',fn:r=>qLabel(r.sepaVolume,cuts.sepaVolume)},
  {name:'RR_BIN',layer:'raw',fn:r=>rrBin(r.rr)},
  {name:'STOP_DISTANCE_BIN',layer:'raw',fn:r=>stopBin(r.stopPct)},
  {name:'GANN_GRADE',layer:'timed',fn:r=>r.gannGrade||'NA'},
  {name:'GANN_TRIGGER_DISTANCE',layer:'timed',fn:r=>triggerBin(r.gannTriggerDistancePct)},
  {name:'GANN_TIMING_SCORE_QUARTILE',layer:'timed',fn:r=>qLabel(r.gannTimingScore,cuts.gannTimingScore)},
  {name:'GANN_TIME_SCORE_QUARTILE',layer:'timed',fn:r=>qLabel(r.gannTimeScore,cuts.gannTimeScore)},
  {name:'GANN_VOLUME_CONFIRMED',layer:'timed',fn:r=>r.gannAvailable?String(Boolean(r.gannVolumeConfirmed)):'NA'},
  {name:'GANN_BREAKOUT_STATE',layer:'timed',fn:r=>r.gannBreakoutState||'NA'},
  {name:'GANN_MOMENTUM_OVERHEATED',layer:'timed',fn:r=>r.gannAvailable?String(Boolean(r.gannMomentumOverheated)):'NA'},
  {name:'REGIME',layer:'timed',fn:r=>r.regime||'NA'},
  {name:'HIGH_VOLATILITY',layer:'timed',fn:r=>String(Boolean(r.highVolatility))},
  {name:'GATE_ACTION',layer:'final',fn:r=>r.gateAction||'NA'}
];
const pairs=[
  {name:'V16xSEPA_RANK',layer:'raw',fn:r=>`${rankQuart(r.v16RankPct)}|${rankQuart(r.sepaRankPct)}`},
  {name:'GANN_GRADExVOLUME',layer:'timed',fn:r=>`${r.gannGrade||'NA'}|${r.gannAvailable?String(Boolean(r.gannVolumeConfirmed)):'NA'}`},
  {name:'GANN_GRADExREGIME',layer:'timed',fn:r=>`${r.gannGrade||'NA'}|${r.regime||'NA'}`},
  {name:'SEPA_ACTIONABLExGANN_GRADE',layer:'timed',fn:r=>`${String(Boolean(r.sepaActionable))}|${r.gannGrade||'NA'}`}
];
function grouped(def){const map=new Map();for(const r of rows){const k=def.fn(r);if(!map.has(k))map.set(k,[]);map.get(k).push(r)}const arr=[];for(const [group,rs] of map){const f=rs.filter(r=>firstDates.has(r.date)),l=rs.filter(r=>lastDates.has(r.date));arr.push({group,all:metrics(rs,def.layer),first30:metrics(f,def.layer),last30:metrics(l,def.layer)})}return{name:def.name,layer:def.layer,groups:arr.sort((a,b)=>b.all.filled-a.all.filled)}}
const factorResults=factors.map(grouped),pairResults=pairs.map(grouped);
function pearson(field,layer='raw'){
  const xy=rows.map(r=>[Number(r[field]),Number(layer==='final'?outcome(r,layer)?.effectiveNetPct:outcome(r,layer)?.netReturnPct),outcome(r,layer)?.status]).filter(([x,y,s])=>Number.isFinite(x)&&Number.isFinite(y)&&!['UNFILLED','WAIT','BLOCK','NO_HISTORY','INSUFFICIENT_FUTURE','INVALID_LEVELS'].includes(s));
  if(xy.length<3)return{n:xy.length,r:null};const mx=mean(xy.map(x=>x[0])),my=mean(xy.map(x=>x[1]));let num=0,dx=0,dy=0;for(const [x,y] of xy){num+=(x-mx)*(y-my);dx+=(x-mx)**2;dy+=(y-my)**2}return{n:xy.length,r:round(dx&&dy?num/Math.sqrt(dx*dy):0,3)}
}
const correlations={raw:{v16RankPct:pearson('v16RankPct'),sepaRankPct:pearson('sepaRankPct'),v16ExecutionScore:pearson('v16ExecutionScore'),v16PTop10:pearson('v16PTop10'),v16PPositive:pearson('v16PPositive'),v16PLargeLoss:pearson('v16PLargeLoss'),sepaScore:pearson('sepaScore'),rr:pearson('rr'),stopPct:pearson('stopPct')},timed:{gannTriggerDistancePct:pearson('gannTriggerDistancePct','timed'),gannTimingScore:pearson('gannTimingScore','timed'),gannTimeScore:pearson('gannTimeScore','timed'),gannVolumeScore:pearson('gannVolumeScore','timed'),gannBreakoutScore:pearson('gannBreakoutScore','timed')}};
const stableStrong=[],stableWeak=[];for(const f of [...factorResults,...pairResults])for(const g of f.groups){const a=g.first30,b=g.last30;if(a.filled>=10&&b.filled>=10){if(a.profitFactor>=1.25&&b.profitFactor>=1.25&&a.avgNetPct>0&&b.avgNetPct>0)stableStrong.push({factor:f.name,layer:f.layer,group:g.group,first30:a,last30:b,robustPF:Math.min(a.profitFactor,b.profitFactor)});if(a.profitFactor<1&&b.profitFactor<1&&a.avgNetPct<0&&b.avgNetPct<0)stableWeak.push({factor:f.name,layer:f.layer,group:g.group,first30:a,last30:b,robustPF:Math.max(a.profitFactor,b.profitFactor)})}
stableStrong.sort((a,b)=>b.robustPF-a.robustPF);stableWeak.sort((a,b)=>a.robustPF-b.robustPF);
const baselineFinal=baseline.summary60.CONSENSUS_FINAL,sourceFinal=sourceSummary.summary60.CONSENSUS_FINAL;
const validation={exactly60Sessions:dates.length===60,poolCountMatchesBaseline:rows.length===baselineFinal.candidates,sourceCandidateCountMatchesBaseline:sourceFinal.candidates===baselineFinal.candidates,datesMatchBaseline:JSON.stringify(dates)===JSON.stringify(baseline.dates),noDuplicateDateTicker:new Set(rows.map(r=>`${r.date}|${r.ticker}`)).size===rows.length,allRowsHaveRawOutcome:rows.every(r=>r.rawOutcome&&r.rawOutcome.status)};validation.passed=Object.values(validation).every(Boolean);
const result={schemaVersion:'egx-consensus-selection-attribution-v1',generatedAt:new Date().toISOString(),method:{purpose:'Diagnostic attribution only — no selection filter is created or tested.',layers:{raw:'V16 Quality Gate V2 ∩ SEPA selection before GANN/Regime effects',timed:'Same candidates after unchanged GANN timing, full-size shadow result',final:'Same candidates after unchanged Regime Gate effective sizing'},rankBuckets:'Within-session rank percentiles; no fixed Top-N.',scoreBuckets:'Full-sample diagnostic quartiles, used only for attribution and not proposed as production thresholds.',minimumStabilitySample:'At least 10 filled outcomes in both First30 and Last30 before a subgroup can be labelled stable.',tradeabilityProxy:'V16 executionScore only.'},validation,baseline:{candidates:baselineFinal.candidates,profitFactor:baselineFinal.profitFactor,compoundPct:baselineFinal.compoundedBasketPct,maxDrawdownPct:baselineFinal.maxDrawdownPct},overall:{raw:metrics(rows,'raw'),timed:metrics(rows,'timed'),final:metrics(rows,'final')},cuts,correlations,factors:factorResults,pairs:pairResults,stableStrong,stableWeak};
fs.writeFileSync(path.join(OUT,'consensus-selection-attribution-v1.json'),JSON.stringify(result,null,2)+'\n');
const md=['# EGX Consensus — Selection Attribution Study V1','',`Generated: ${result.generatedAt}`,'',`Validation: **${validation.passed?'PASS':'FAIL'}**`,'','This is an attribution study only. It does not create or tune a new stock-selection filter.','','## Pool invariants',`- Sessions: ${dates.length}`,`- Original consensus opportunities: ${rows.length}`,`- Baseline candidate count: ${baselineFinal.candidates}`,`- Exact pool match: ${validation.poolCountMatchesBaseline}`,`- Date match: ${validation.datesMatchBaseline}`,'','## Three-layer totals','| Layer | Candidates | Eligible | Filled | Fill % | Positive % | Avg net % | PF |','|---|---:|---:|---:|---:|---:|---:|---:|'];for(const [k,m] of Object.entries(result.overall))md.push(`| ${k} | ${m.candidates} | ${m.eligible} | ${m.filled} | ${m.fillRatePct} | ${m.positivePct} | ${m.avgNetPct} | ${m.profitFactor} |`);md.push('','## Stable strong subgroups','A subgroup appears here only when First30 and Last30 each have at least 10 filled observations, PF >= 1.25 and positive average return.','| Factor | Layer | Group | First n | First PF | First avg % | Last n | Last PF | Last avg % |','|---|---|---|---:|---:|---:|---:|---:|---:|');for(const x of stableStrong.slice(0,20))md.push(`| ${x.factor} | ${x.layer} | ${x.group} | ${x.first30.filled} | ${x.first30.profitFactor} | ${x.first30.avgNetPct} | ${x.last30.filled} | ${x.last30.profitFactor} | ${x.last30.avgNetPct} |`);if(!stableStrong.length)md.push('| none | - | - | - | - | - | - | - | - |');md.push('','## Stable weak subgroups','| Factor | Layer | Group | First n | First PF | First avg % | Last n | Last PF | Last avg % |','|---|---|---|---:|---:|---:|---:|---:|---:|');for(const x of stableWeak.slice(0,20))md.push(`| ${x.factor} | ${x.layer} | ${x.group} | ${x.first30.filled} | ${x.first30.profitFactor} | ${x.first30.avgNetPct} | ${x.last30.filled} | ${x.last30.profitFactor} | ${x.last30.avgNetPct} |`);if(!stableWeak.length)md.push('| none | - | - | - | - | - | - | - | - | - |');md.push('','## Factor tables');for(const f of factorResults){md.push('',`### ${f.name} (${f.layer})`,'| Group | All n | All PF | All avg % | First n | First PF | First avg % | Last n | Last PF | Last avg % |','|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');for(const g of f.groups)md.push(`| ${g.group} | ${g.all.filled} | ${g.all.profitFactor} | ${g.all.avgNetPct} | ${g.first30.filled} | ${g.first30.profitFactor} | ${g.first30.avgNetPct} | ${g.last30.filled} | ${g.last30.profitFactor} | ${g.last30.avgNetPct} |`)}md.push('','## Pairwise tables');for(const f of pairResults){md.push('',`### ${f.name} (${f.layer})`,'| Group | All n | All PF | All avg % | First n | First PF | Last n | Last PF |','|---|---:|---:|---:|---:|---:|---:|---:|');for(const g of f.groups)md.push(`| ${g.group} | ${g.all.filled} | ${g.all.profitFactor} | ${g.all.avgNetPct} | ${g.first30.filled} | ${g.first30.profitFactor} | ${g.last30.filled} | ${g.last30.profitFactor} |`)}md.push('','## Continuous correlations with realized return','```json',JSON.stringify(correlations,null,2),'```','','No production engine or UI is changed by this study.');fs.writeFileSync(path.join(OUT,'consensus-selection-attribution-v1.md'),md.join('\n')+'\n');
if(!validation.passed){console.error(validation);process.exitCode=2}else console.log(`ATTRIBUTION_V1_VALID rows=${rows.length} sessions=${dates.length} stableStrong=${stableStrong.length} stableWeak=${stableWeak.length}`);
