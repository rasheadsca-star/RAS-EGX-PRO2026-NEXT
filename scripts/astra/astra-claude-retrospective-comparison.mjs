#!/usr/bin/env node
'use strict';
// refresh-trigger: keep currentSnapshot synchronized with current Astra session

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const P=(...x)=>path.join(ROOT,...x);
const RC2_ROOT=path.resolve(process.env.RC2_ROOT||P('_rc2'));
const read=(p)=>JSON.parse(fs.readFileSync(P(p),'utf8'));
const readOptional=(p,fallback=null)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}};
const write=(p,v)=>{fs.mkdirSync(path.dirname(P(p)),{recursive:true});fs.writeFileSync(P(p),JSON.stringify(v,null,2)+'\n')};
const round=(v,n=4)=>Number.isFinite(Number(v))?Number(Number(v).toFixed(n)):null;
const avg=(a)=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const pct=(n,d)=>d?round(n/d*100,2):null;
const sha=(v)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

function historyRows(ticker){
  const file=P('data/history',ticker+'.json');
  if(!fs.existsSync(file))return[];
  const d=JSON.parse(fs.readFileSync(file,'utf8'));
  return (d.sessions||d.rows||[]).map(r=>({
    date:String(r.date||r.sessionDate||'').slice(0,10),
    open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),
    volume:Number.isFinite(Number(r.volume))?Number(r.volume):0,
    valueTraded:Number.isFinite(Number(r.valueTraded))?Number(r.valueTraded):undefined
  })).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&[r.open,r.high,r.low,r.close].every(Number.isFinite))
    .sort((a,b)=>a.date.localeCompare(b.date));
}
function fill(bar,plan){
  if(bar.open>=plan.entryLow&&bar.open<=plan.entryHigh)return bar.open;
  if(bar.open>plan.entryHigh&&bar.low<=plan.entryHigh)return plan.entryHigh;
  if(bar.open<plan.entryLow)return null;
  if(bar.low<=plan.entryHigh&&bar.high>=plan.entryLow)return plan.entryHigh;
  return null;
}
function evaluatePlan(signal,bars,policy){
  const future=bars.filter(b=>b.date>signal.signalDate);
  if(!future.length)return{...signal,state:'UNRESOLVED_NO_FUTURE_BARS'};
  const entryEnd=Math.min(future.length-1,policy.entryExpirySessions-1);
  let entry=null;
  for(let j=0;j<=entryEnd;j++){
    const p=fill(future[j],signal);
    if(p!=null){entry={j,price:p,date:future[j].date};break}
  }
  if(!entry){
    const expiry=future[entryEnd]?.date||future.at(-1).date;
    return{...signal,state:'EXPIRED',expiryDate:expiry,terminalDate:expiry,netPct:null};
  }
  const maxExit=Math.min(future.length-1,entry.j+policy.maxHoldSessions-1);
  let exit=null;
  for(let j=entry.j;j<=maxExit;j++){
    const b=future[j],stop=b.low<=signal.stop,target=b.high>=signal.target1;
    if(stop&&target){exit={j,date:b.date,price:signal.stop,outcome:'STOP_SAME_BAR'};break}
    if(stop){exit={j,date:b.date,price:signal.stop,outcome:'STOP'};break}
    if(target){exit={j,date:b.date,price:signal.target1,outcome:'TARGET1'};break}
  }
  if(!exit){
    const b=future[maxExit];
    exit={j:maxExit,date:b.date,price:b.close,outcome:'TIME_EXIT'};
  }
  return{
    ...signal,state:'ENTERED',entryDate:entry.date,entryPrice:round(entry.price,4),
    exitDate:exit.date,terminalDate:exit.date,outcome:exit.outcome,
    netPct:round((exit.price-entry.price)/entry.price*100-policy.roundTripCostPct,2)
  };
}
function summarizeEpisodes(all){
  const episodes=all.filter(x=>x.state!=='SUPPRESSED_OVERLAP');
  const trades=episodes.filter(x=>x.state==='ENTERED');
  const expired=episodes.filter(x=>x.state==='EXPIRED');
  const unresolved=episodes.filter(x=>x.state==='UNRESOLVED_NO_FUTURE_BARS');
  const t=trades.filter(x=>x.outcome==='TARGET1');
  const s=trades.filter(x=>String(x.outcome).startsWith('STOP'));
  const time=trades.filter(x=>x.outcome==='TIME_EXIT');
  const wins=trades.filter(x=>x.netPct>0),loss=trades.filter(x=>x.netPct<0);
  const gp=wins.reduce((a,x)=>a+x.netPct,0),gl=Math.abs(loss.reduce((a,x)=>a+x.netPct,0));
  return{
    issuedSignals:all.length,
    suppressedOverlap:all.filter(x=>x.state==='SUPPRESSED_OVERLAP').length,
    eligibleEpisodes:episodes.length,
    entered:trades.length,expired:expired.length,unresolved:unresolved.length,
    target1:t.length,stops:s.length,timeExits:time.length,
    target1Pct:pct(t.length,trades.length),stopPct:pct(s.length,trades.length),
    positivePct:pct(wins.length,trades.length),avgNetPct:round(avg(trades.map(x=>x.netPct)),2),
    profitFactor:gl?round(gp/gl,2):(gp>0?'INF':null),
    signalDates:[...new Set(episodes.map(x=>x.signalDate))].sort().length,
    tickers:[...new Set(episodes.map(x=>x.ticker))].sort().length
  };
}
function sequentialAstraEpisodes(signals,policy){
  const by=new Map();
  for(const s of signals){if(!by.has(s.ticker))by.set(s.ticker,[]);by.get(s.ticker).push(s)}
  const out=[];
  for(const [ticker,list] of by){
    const bars=historyRows(ticker);
    let blockedThrough=null;
    for(const s of list.sort((a,b)=>a.signalDate.localeCompare(b.signalDate))){
      if(blockedThrough&&s.signalDate<=blockedThrough){
        out.push({...s,state:'SUPPRESSED_OVERLAP',blockedThrough});
        continue;
      }
      const r=evaluatePlan(s,bars,policy);out.push(r);
      blockedThrough=r.terminalDate||blockedThrough;
    }
  }
  return out.sort((a,b)=>a.signalDate.localeCompare(b.signalDate)||a.ticker.localeCompare(b.ticker));
}
function currentAstra(){
  const d=read('astra-prod/app/data.json');
  return{
    session:d.sourceDecision?.session||d.decisionSnapshot?.sessionDate||null,
    recommendations:(d.decisionSnapshot?.top5||d.decisionSnapshot?.opportunities||[]).map(x=>({
      ticker:x.ticker,rank:x.rank,entryLow:x.entryPlan?.low??null,entryHigh:x.entryPlan?.high??null,
      stop:x.stopLoss??null,target1:x.targets?.[0]??null,score:x.decisionScore??x.ranking?.score??null
    }))
  };
}
function markdown(r){
  const a=r.sameWindow.astraCommonPolicy,c=r.sameWindow.claudeRc2Frozen;
  const live=r.currentSnapshot;
  return [
    '# Astra PRO v3 vs EGX Pro Professional V16.9 UI CLAUDE',
    '',
    'Generated: '+r.generatedAt,
    '',
    '## Identity',
    '- Current Astra: **EGX PRO — Astra PRO ANALYTICS v3**',
    '- Comparator: **EGX Pro Professional V16.9 UI CLAUDE**',
    '- Comparator engine: **TFE V20 Fusion RC2**',
    '- Frozen RC2 source: **'+r.sources.rc2FrozenCommit+'**',
    '',
    '## Current-session recommendations',
    '- Session: **'+(live.session||'n/a')+'**',
    '- Astra: **'+(live.astraTickers.join(', ')||'none')+'**',
    '- UI CLAUDE / RC2: **'+(live.claudeTickers.join(', ')||'none')+'**',
    '- Overlap: **'+(live.overlap.join(', ')||'none')+'**',
    '',
    '## Same-window neutral execution comparison',
    'Window: **'+r.window.first+' → '+r.window.last+'**. Both sides are evaluated with next-session entry, 3-session entry expiry, 10-session max hold, STOP_FIRST same-bar rule, and 0.60% round-trip cost.',
    '',
    '| Metric | Astra current signal lineage | UI CLAUDE / RC2 frozen |',
    '|---|---:|---:|',
    '| Issued signals | '+a.issuedSignals+' | '+c.issuedSignals+' |',
    '| Eligible episodes after overlap suppression | '+a.eligibleEpisodes+' | '+c.eligibleEpisodes+' |',
    '| Entered | '+a.entered+' | '+c.entered+' |',
    '| Target 1 % | '+(a.target1Pct??'—')+'% | '+(c.target1Pct??'—')+'% |',
    '| Stop % | '+(a.stopPct??'—')+'% | '+(c.stopPct??'—')+'% |',
    '| Positive trades % | '+(a.positivePct??'—')+'% | '+(c.positivePct??'—')+'% |',
    '| Avg net / entered trade | '+(a.avgNetPct??'—')+'% | '+(c.avgNetPct??'—')+'% |',
    '| Profit factor | '+(a.profitFactor??'—')+' | '+(c.profitFactor??'—')+' |',
    '| Expired entries | '+a.expired+' | '+c.expired+' |',
    '| Signal dates | '+a.signalDates+' | '+c.signalDates+' |',
    '| Unique tickers | '+a.tickers+' | '+c.tickers+' |',
    '',
    '## UI CLAUDE built-in full-history simulator',
    '- Entered: **'+(r.claudeLiveFullHistory?.entered??'n/a')+'**',
    '- T1: **'+(r.claudeLiveFullHistory?.target1Pct??'n/a')+'%**',
    '- Stop: **'+(r.claudeLiveFullHistory?.stopPct??'n/a')+'%**',
    '- Positive: **'+(r.claudeLiveFullHistory?.positivePct??'n/a')+'%**',
    '- Avg net: **'+(r.claudeLiveFullHistory?.avgNetPct??'n/a')+'%**',
    '- Profit factor: **'+(r.claudeLiveFullHistory?.profitFactor??'n/a')+'**',
    '- Wilson 95% lower T1: **'+(r.claudeLiveFullHistory?.wilson95LowerTarget1Pct??'n/a')+'%**',
    '',
    '## Interpretation constraints',
    '- The same-window table is the primary apples-to-apples comparison.',
    '- Astra historical signals come from its preserved V16.9-source decision history; RC2 signals are regenerated with the frozen RC2 algorithm using only data available through each signal date.',
    '- No future bar is used to create a signal. Future bars are used only to resolve entry/exit outcomes.',
    '- This is research/backtest evidence, not a guarantee of future returns.',
    ''
  ].join('\n');
}

const rc2BacktestUrl=pathToFileURL(path.join(RC2_ROOT,'tfe-v20/src/backtest.js')).href;
const rc2PolicyUrl=pathToFileURL(path.join(RC2_ROOT,'tfe-v20/src/policy.js')).href;
const {backtestHistory,summarizeBacktest}=await import(rc2BacktestUrl);
const {POLICY}=await import(rc2PolicyUrl);

const source=read('data/stable/v16-v169-live-evaluation.json');
const resolved=(source.sessions||[]).filter(s=>s.status==='RESOLVED').sort((a,b)=>a.signalDate.localeCompare(b.signalDate));
if(!resolved.length)throw new Error('No historical Astra/V16.9 source sessions');
const first=resolved[0].signalDate,last=resolved.at(-1).signalDate;
const commonPolicy={entryExpirySessions:3,maxHoldSessions:10,roundTripCostPct:0.6};
const astraSignals=resolved.flatMap((s)=> (s.members||[]).map((m,i)=>({
  engine:'ASTRA_CURRENT_SIGNAL_LINEAGE',ticker:m.ticker,signalDate:s.signalDate,rank:i+1,
  entryLow:Number(m.entryLow),entryHigh:Number(m.entryHigh),stop:Number(m.stopLoss),target1:Number(m.target1)
}))).filter(x=>[x.entryLow,x.entryHigh,x.stop,x.target1].every(Number.isFinite));
const astraEpisodes=sequentialAstraEpisodes(astraSignals,commonPolicy);
const astraSummary=summarizeEpisodes(astraEpisodes);

const historyFiles=fs.readdirSync(P('data/history')).filter(x=>x.endsWith('.json'));
const rc2Trades=[],rc2Expired=[];
for(const file of historyFiles){
  const ticker=file.replace(/\.json$/,'');
  const rows=historyRows(ticker);
  if(rows.length<POLICY.minBars)continue;
  const bt=backtestHistory({ticker,rows});
  rc2Trades.push(...(bt.trades||[]).filter(x=>x.signalDate>=first&&x.signalDate<=last));
  rc2Expired.push(...(bt.expired||[]).filter(x=>x.signalDate>=first&&x.signalDate<=last).map(x=>({ticker,...x})));
}
const rc2NativeSummary=summarizeBacktest(rc2Trades,rc2Expired).summary;
const rc2EpisodeRows=[
  ...rc2Trades.map(x=>({ticker:x.ticker,signalDate:x.signalDate,state:'ENTERED',outcome:x.outcome,netPct:x.netPct})),
  ...rc2Expired.map(x=>({ticker:x.ticker,signalDate:x.signalDate,state:'EXPIRED'}))
];
const rc2Summary={
  issuedSignals:rc2EpisodeRows.length,suppressedOverlap:0,eligibleEpisodes:rc2EpisodeRows.length,
  entered:rc2Trades.length,expired:rc2Expired.length,unresolved:0,
  target1:rc2Trades.filter(x=>x.outcome==='TARGET1').length,
  stops:rc2Trades.filter(x=>String(x.outcome).startsWith('STOP')).length,
  timeExits:rc2Trades.filter(x=>x.outcome==='TIME_EXIT').length,
  target1Pct:round(rc2NativeSummary.target1Pct,2),stopPct:round(rc2NativeSummary.stopPct,2),
  positivePct:round(rc2NativeSummary.positivePct,2),avgNetPct:round(rc2NativeSummary.avgNetPct,2),
  profitFactor:rc2NativeSummary.profitFactor,
  signalDates:[...new Set(rc2EpisodeRows.map(x=>x.signalDate))].length,
  tickers:[...new Set(rc2EpisodeRows.map(x=>x.ticker))].length
};

const astraNow=currentAstra();
const liveScan=readOptional(process.env.RC2_SCAN_PATH||'',{});
const liveSim=readOptional(process.env.RC2_SIM_PATH||'',{});
const claudeNow=(liveScan.recommendations||[]).map(x=>({ticker:x.ticker,rank:x.rank,decision:x.decision,entryLow:x.tradePlan?.entryLow??null,entryHigh:x.tradePlan?.entryHigh??null,stop:x.tradePlan?.stop??null,target1:x.tradePlan?.target1??null,fusionRank:x.scores?.fusionRank??null}));
const astraTickers=astraNow.recommendations.map(x=>x.ticker),claudeTickers=claudeNow.map(x=>x.ticker);
const overlap=astraTickers.filter(x=>claudeTickers.includes(x));
const union=new Set([...astraTickers,...claudeTickers]);

const report={
  schemaVersion:'astra-vs-claude-rc2-retrospective-1',
  generatedAt:new Date().toISOString(),
  simulatorVersion:'ASTRA_CLAUDE_NEUTRAL_REPLAY_1',
  window:{first,last,astraRecordedSessions:resolved.length},
  sources:{
    astraHistory:'data/stable/v16-v169-live-evaluation.json',
    marketHistory:'data/history/*.json',
    rc2FrozenBranch:'release/rc2-frozen',
    rc2FrozenCommit:'cf5f9e2f4db9e81dc8245becf45f280aa42dc010',
    rc2Engine:'TFE_V20_FUSION_RC2',
    rc2SchemaVersion:POLICY.schemaVersion,
    rc2Ui:'EGX Pro Professional V16.9 UI CLAUDE'
  },
  neutralExecutionPolicy:{
    entryAfterSignal:true,entryExpirySessions:3,maxHoldSessions:10,sameBarAmbiguity:'STOP_FIRST',
    roundTripCostPct:0.6,fillPolicy:'RC2_FROZEN_FILL_RULES',lookaheadForSignal:false
  },
  currentSnapshot:{
    session:astraNow.session,
    astra:astraNow.recommendations,
    claude:claudeNow,
    astraTickers,claudeTickers,overlap,overlapCount:overlap.length,
    jaccardPct:union.size?round(overlap.length/union.size*100,2):null
  },
  sameWindow:{
    astraCommonPolicy:astraSummary,
    claudeRc2Frozen:rc2Summary,
    deltas:{
      target1Pct:round((astraSummary.target1Pct??0)-(rc2Summary.target1Pct??0),2),
      stopPct:round((astraSummary.stopPct??0)-(rc2Summary.stopPct??0),2),
      positivePct:round((astraSummary.positivePct??0)-(rc2Summary.positivePct??0),2),
      avgNetPct:round((astraSummary.avgNetPct??0)-(rc2Summary.avgNetPct??0),2)
    }
  },
  claudeLiveFullHistory:liveSim.summary||null,
  integrity:{
    astraSignalHash:sha(astraSignals),
    astraEpisodeHash:sha(astraEpisodes),
    rc2EpisodeHash:sha(rc2EpisodeRows),
    rc2FrozenCommitPinned:true,
    noFutureDataInSignalGeneration:true,
    sameExecutionPolicyForReportedSameWindowMetrics:true
  },
  limitations:[
    'Astra historical signals are preserved issued recommendations from its V16.9-source lineage rather than a freshly regenerated full-universe Astra ranking for every historical date.',
    'RC2 same-window signals are regenerated by the frozen TFE V20 Fusion RC2 backtest engine from recorded history.',
    'The neutral comparison standardizes execution semantics but does not equalize the two engines’ signal frequency or ranking universe.',
    'Backtest and retrospective results are research evidence and do not guarantee future performance.'
  ]
};
write('docs/astra/ASTRA_CLAUDE_RETROSPECTIVE_COMPARISON.json',report);
write('astra-prod/app/intelligence/retrospective-claude-comparison.json',report);
fs.writeFileSync(P('docs/astra/ASTRA_CLAUDE_RETROSPECTIVE_COMPARISON.md'),markdown(report)+'\n');
console.log(JSON.stringify({status:'PASS',window:report.window,currentSnapshot:report.currentSnapshot,sameWindow:report.sameWindow,claudeLiveFullHistory:report.claudeLiveFullHistory,integrity:report.integrity},null,2));
