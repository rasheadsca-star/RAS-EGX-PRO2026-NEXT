'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {evaluateRows,summarize}=require('./native/astra-intelligence.cjs');

const ROOT=path.resolve(__dirname,'../..');
const P=(...x)=>path.join(ROOT,...x);
const read=(rel)=>JSON.parse(fs.readFileSync(P(rel),'utf8'));
const write=(rel,val)=>{fs.mkdirSync(path.dirname(P(rel)),{recursive:true});fs.writeFileSync(P(rel),JSON.stringify(val,null,2)+'\n')};
const round=(v,n=4)=>Number.isFinite(Number(v))?Number(Number(v).toFixed(n)):null;
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const sum=a=>a.reduce((s,x)=>s+x,0);
const pct=(a,b)=>b?round(a/b*100,2):null;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

function historyRows(ticker){
  const doc=read('data/history/'+ticker+'.json');
  return (doc.sessions||doc.rows||[]).map(r=>({
    date:String(r.date||r.sessionDate||'').slice(0,10),
    open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),
    volume:Number.isFinite(Number(r.volume))?Number(r.volume):null,
    validationStatus:r.validationStatus||null,
    warnings:Array.isArray(r.warnings)?r.warnings:[]
  })).filter(r=>r.date&&[r.open,r.high,r.low,r.close].every(Number.isFinite)).sort((a,b)=>a.date.localeCompare(b.date));
}

function buildRecord(session,member,index){
  return {
    schemaVersion:'astra-retrospective-recommendation-1',
    recommendationId:'RETRO-'+hash({d:session.signalDate,t:member.ticker,i:index}).slice(0,20),
    decisionSnapshotId:'RETRO-'+session.signalDate,
    semanticDecisionHash:hash({session:session.signalDate}),
    ticker:member.ticker,
    sessionDate:session.signalDate,
    effectiveFromSession:null,
    effectiveFromPolicy:'NEXT_FINALIZED_SESSION_AFTER_DECISION',
    rank:Number.isFinite(Number(member.rank))?Number(member.rank):index+1,
    entryPlan:{low:Number(member.entryLow),high:Number(member.entryHigh)},
    stopLoss:Number(member.stopLoss),
    targets:[Number(member.target1)],
    marketRegime:'HISTORICAL_REPLAY_UNKNOWN',
    sourceDecisionVersion:{
      pipelineVersion:'ASTRA_G09_PIPELINE_1',
      rankingVersion:'ASTRA_G09_V16_9_SOURCE_ORDER_1',
      riskVersion:'ASTRA_G09_V16_9_RISK_1',
      basketVersion:'V16_9_EQUAL_WEIGHT_BASKET_PILOT'
    },
    sourceV169:{
      memberStatus:member.memberStatus,
      netReturnPct:Number.isFinite(Number(member.netReturnPct))?Number(member.netReturnPct):null,
      holdingSessions:member.holdingSessions,
      entryMode:member.entryMode||null
    }
  };
}

function memberMetrics(members){
  const ret=members.map(x=>Number(x.netReturnPct)).filter(Number.isFinite);
  const pos=ret.filter(x=>x>0),neg=ret.filter(x=>x<0);
  const target=members.filter(x=>x.memberStatus==='TARGET_HIT').length;
  const stop=members.filter(x=>x.memberStatus==='STOP_HIT').length;
  const time=members.filter(x=>x.memberStatus==='TIME_EXIT').length;
  const cash=members.filter(x=>/CASH|UNFILLED/.test(String(x.memberStatus||''))).length;
  return {
    total:members.length,targetHits:target,stopHits:stop,timeExits:time,cashUnfilled:cash,
    targetHitRatePct:pct(target,members.length),stopHitRatePct:pct(stop,members.length),
    memberWinRatePct:pct(pos.length,pos.length+neg.length),
    averageMemberNetReturnPct:round(avg(ret)),
    averageWinnerPct:round(avg(pos)),averageLoserPct:round(avg(neg)),
    profitFactor:neg.length?round(sum(pos)/Math.abs(sum(neg))):null
  };
}

function sessionReplay(session){
  const records=(session.members||[]).map((m,i)=>buildRecord(session,m,i));
  const outcomes=records.map(r=>evaluateRows(r,historyRows(r.ticker),{expirySessions:20}));
  const s=summarize(records,outcomes);
  return {
    signalDate:session.signalDate,
    v169:{result:session.result,netReturnPct:session.netReturnPct,basketSize:session.basketSize,memberSummary:session.memberSummary},
    astra:{metrics:s.metrics,reconciliation:s.reconciliation},
    comparisons:records.map((r,i)=>({
      ticker:r.ticker,rank:r.rank,plan:{entry:r.entryPlan,stopLoss:r.stopLoss,target1:r.targets[0]},
      v169Status:r.sourceV169.memberStatus,v169NetReturnPct:r.sourceV169.netReturnPct,
      astraState:outcomes[i].state,astraTargetHit:outcomes[i].finalTargetHit,
      astraStopHit:outcomes[i].stopLossHit,astraAmbiguous:outcomes[i].ambiguous,
      astraReturnPct:outcomes[i].returnPct,activationPricePrecision:outcomes[i].activationPricePrecision
    }))
  };
}

function md(report){
  const a=report.astraReplay.metrics,v=report.v169Native.sessionSummary,m=report.v169Native.memberMetrics;
  return [
    '# Astra vs EGX Pro Professional V16.9 — Retrospective Simulator',
    '',
    'Generated: '+report.generatedAt,
    '',
    '## Scope',
    '- Historical window: **'+report.window.first+' → '+report.window.last+'**',
    '- Resolved V16.9 sessions: **'+report.window.sessions+'**',
    '- Recommendation members replayed: **'+report.window.recommendations+'**',
    '- Unique tickers: **'+report.window.uniqueTickers+'**',
    '',
    '## Critical interpretation',
    'Current Astra G09 is not an independent stock-selection model versus V16.9. It preserves V16.9 source selection order and the same V16.9 entry/stop/target geometry. Therefore this simulator separates **signal parity** from **execution/governance semantics**. A 100% plan-parity result is expected by design and must not be presented as independent alpha validation.',
    '',
    '## V16.9 native historical result',
    '- Winning sessions: **'+v.winningSessions+'/'+v.resolvedSessions+' ('+v.winningSessionPct+'%)**',
    '- Average net session return: **'+v.averageNetReturnPct+'%**',
    '- Profit factor: **'+v.profitFactor+'**',
    '- Compounded net return: **'+v.compoundedNetReturnPct+'%**',
    '- Maximum drawdown: **'+v.maximumDrawdownPct+'%**',
    '- Member target-hit rate: **'+m.targetHitRatePct+'%**',
    '- Member stop-hit rate: **'+m.stopHitRatePct+'%**',
    '',
    '## Astra current-policy replay on the same historical recommendations',
    '- Issued: **'+a.totalRecommendations+'**',
    '- Activated: **'+a.activatedRecommendations+'**',
    '- Final target hits: **'+a.finalTargetHit+'**',
    '- Stop-loss hits: **'+a.stopLossHit+'**',
    '- Ambiguous daily-OHLC paths: **'+a.ambiguous+'**',
    '- Expired entries: **'+a.expired+'**',
    '- Still open at end of available history: **'+a.openTrades+'**',
    '- Numeric closed-trade win rate: **'+(a.winRate?.pct??'n/a')+'%**',
    '- Average numeric gross return: **'+(a.averageReturnPct??'n/a')+'%**',
    '- Profit factor on numeric closed trades: **'+(a.profitFactor??'n/a')+'**',
    '',
    '## Signal comparison',
    '- Ranking lineage: **ASTRA_G09_V16_9_SOURCE_ORDER_1**',
    '- Basket lineage: **V16_9_EQUAL_WEIGHT_BASKET_PILOT**',
    '- Historical ticker/plan parity in this replay: **100% by source contract**',
    '- Independent-alpha comparison: **NOT APPLICABLE** until Astra uses a genuinely independent ranking/selection model.',
    '',
    '## Methodology notes',
    '- V16.9 native results use the preserved historical live-evaluation methodology, including its holding-period and 0.6% estimated round-trip cost assumptions.',
    '- Astra replay uses the current native Astra outcome engine: next-session activation, 20-session entry expiry, conservative ambiguity handling when daily OHLC cannot establish intraday ordering, and gross return only when exact activation price is known.',
    '- Because execution semantics differ, raw return numbers are not a clean apples-to-apples alpha comparison. The clean alpha comparison is the signal/plan parity result.',
    ''
  ].join('\n');
}

function main(){
  const source=read('data/stable/v16-v169-live-evaluation.json');
  const sessions=(source.sessions||[]).filter(s=>s.status==='RESOLVED');
  if(!sessions.length) throw new Error('No resolved V16.9 historical sessions');
  const replays=sessions.map(sessionReplay);
  const records=[], outcomes=[];
  for(const s of sessions){
    (s.members||[]).forEach((m,i)=>{
      const r=buildRecord(s,m,i);records.push(r);outcomes.push(evaluateRows(r,historyRows(r.ticker),{expirySessions:20}));
    });
  }
  const astraSummary=summarize(records,outcomes);
  if(!astraSummary.reconciliation.pass) throw new Error('Astra replay reconciliation failed');
  const members=sessions.flatMap(s=>s.members||[]);
  const uniqueTickers=[...new Set(members.map(m=>m.ticker))].sort();
  const report={
    schemaVersion:'astra-v169-retrospective-comparison-1',
    generatedAt:new Date().toISOString(),
    simulatorVersion:'ASTRA_RETROSPECTIVE_SIM_1',
    window:{first:sessions[0].signalDate,last:sessions.at(-1).signalDate,sessions:sessions.length,recommendations:members.length,uniqueTickers:uniqueTickers.length},
    source:{
      v169Evaluation:'data/stable/v16-v169-live-evaluation.json',
      historicalPrices:'data/history/*.json',
      astraOutcomeEngine:'scripts/astra/native/astra-intelligence.cjs'
    },
    signalContract:{
      currentAstraRanking:'ASTRA_G09_V16_9_SOURCE_ORDER_1',
      currentAstraBasket:'V16_9_EQUAL_WEIGHT_BASKET_PILOT',
      sourceEngine:'V16_9_EQUAL_WEIGHT_BASKET',
      independentSelectionModel:false,
      tickerAndPlanParityPct:100,
      interpretation:'Astra currently inherits V16.9 recommendation selection and plan geometry; replay differences measure execution/governance semantics rather than independent alpha.'
    },
    v169Native:{sessionSummary:source.summary,memberMetrics:memberMetrics(members)},
    astraReplay:astraSummary,
    sessionComparison:replays,
    limitations:[
      'Historical market-regime position sizing is not reconstructed here because the preserved V16.9 evaluation does not contain a complete per-session Astra regime snapshot.',
      'V16.9 native net returns include its own holding/cost methodology; Astra native replay uses current outcome-state semantics and gross returns when exact fill is knowable.',
      'No claim of Astra signal superiority is valid while G09 ranking remains source-pinned to V16.9.'
    ]
  };
  write('docs/astra/ASTRA_V169_RETROSPECTIVE_COMPARISON.json',report);
  write('astra-prod/app/intelligence/retrospective-v169-comparison.json',report);
  fs.writeFileSync(P('docs/astra/ASTRA_V169_RETROSPECTIVE_COMPARISON.md'),md(report)+'\n');
  console.log(JSON.stringify({status:'PASS',window:report.window,v169:report.v169Native.sessionSummary,astra:report.astraReplay.metrics,reconciliation:report.astraReplay.reconciliation},null,2));
}

if(require.main===module) main();
module.exports={buildRecord,memberMetrics,sessionReplay};
