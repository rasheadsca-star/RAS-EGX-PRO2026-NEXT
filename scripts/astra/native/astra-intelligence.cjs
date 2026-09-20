'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

const ROOT=path.resolve(__dirname,'../../..');
const P=(...x)=>path.join(ROOT,...x);
const readJson=(rel,fallback=null)=>{try{return JSON.parse(fs.readFileSync(P(rel),'utf8'))}catch(e){if(fallback!==null)return fallback;throw e}};
const writeJson=(rel,value)=>{fs.mkdirSync(path.dirname(P(rel)),{recursive:true});fs.writeFileSync(P(rel),JSON.stringify(value,null,2)+'\n')};
const sha256=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const dateOnly=v=>(String(v||'').match(/^\d{4}-\d{2}-\d{2}/)||[])[0]||null;
const finite=v=>Number.isFinite(Number(v))?Number(v):null;
const round=(v,n=4)=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(Number(v).toFixed(n)):null;
const STATES=new Set(['ISSUED','WAITING_FOR_ENTRY','ENTRY_ACTIVATED','OPEN','TARGET_1_HIT','TARGET_2_HIT','FINAL_TARGET_HIT','STOP_LOSS_HIT','EXPIRED','CLOSED','AMBIGUOUS_INTRADAY_PATH','CANCELLED_BY_GOVERNANCE']);

function stableRecommendationId(snapshot,opportunity){
  const payload={
    version:'ASTRA_RECOMMENDATION_ID_1',
    decisionSnapshotId:snapshot.decisionSnapshotId,
    semanticDecisionHash:snapshot.semanticDecisionHash,
    ticker:opportunity.ticker,
    sessionDate:snapshot.sessionDate,
    rank:opportunity.rank,
    strategyExecutionRef:opportunity.strategyExecutionRef||null
  };
  return 'ASTRA-REC-'+sha256(payload).slice(0,24);
}

function nextHistorySession(ticker,afterDate){
  const doc=readJson('data/history/'+ticker+'.json',{sessions:[]});
  return (doc.sessions||[]).map(x=>dateOnly(x.date||x.sessionDate)).filter(Boolean).sort().find(d=>d>afterDate)||null;
}

function sourceSnapshotRefs(appData,handoff){
  return {
    decisionSnapshotId:appData.sourceDecision.decisionSnapshotId,
    semanticDecisionHash:appData.sourceDecision.semanticDecisionHash,
    canonicalDataHead:handoff.canonicalDataHead,
    handoffFingerprint:handoff.materialFingerprint,
    handoffProducerRunId:handoff.producerRunId
  };
}

function recommendationRecord(appData,handoff,opportunity){
  const ds=appData.decisionSnapshot;
  const effective=nextHistorySession(opportunity.ticker,ds.sessionDate);
  const recId=stableRecommendationId(ds,opportunity);
  return {
    schemaVersion:'astra-recommendation-record-1',
    recommendationId:recId,
    decisionSnapshotId:ds.decisionSnapshotId,
    semanticDecisionHash:ds.semanticDecisionHash,
    ticker:opportunity.ticker,
    securityId:opportunity.securityId||('EGX:'+opportunity.ticker),
    sessionDate:ds.sessionDate,
    decisionTimestamp:appData.sourceDecision.refreshedAt||appData.generatedAt||null,
    effectiveFromSession:effective,
    rank:opportunity.rank,
    decisionScore:finite(opportunity.decisionScore??opportunity.ranking?.score),
    entryPlan:{
      low:finite(opportunity.entryPlan?.low??opportunity.risk?.entry),
      high:finite(opportunity.entryPlan?.high??opportunity.risk?.entry)
    },
    stopLoss:finite(opportunity.stopLoss??opportunity.risk?.stopLoss),
    targets:(opportunity.targets||opportunity.risk?.targets||[]).map(Number).filter(Number.isFinite),
    marketRegime:ds.regime?.regime||null,
    marketRegimeId:ds.regime?.regimeId||null,
    riskMetadata:opportunity.risk||null,
    sourceDecisionVersion:{
      pipelineVersion:ds.pipelineVersion||null,
      rankingVersion:opportunity.ranking?.version||ds.rankingVersion||null,
      riskVersion:opportunity.risk?.riskVersion||ds.riskVersion||null,
      strategyExecutionRef:opportunity.strategyExecutionRef||null,
      codeVersion:ds.codeVersion||null
    },
    sourceSnapshot:sourceSnapshotRefs(appData,handoff),
    immutableDecision:{
      entryPlan:opportunity.entryPlan||null,
      stopLoss:opportunity.stopLoss??null,
      targets:opportunity.targets||null,
      ranking:opportunity.ranking||null,
      risk:opportunity.risk||null,
      trace:opportunity.trace||null
    },
    initialState:'ISSUED'
  };
}

function buildLedger(appData,handoff,existing){
  const ds=appData.decisionSnapshot;
  const prior=Array.isArray(existing?.records)?existing.records:[];
  const byId=new Map(prior.map(r=>[r.recommendationId,r]));
  for(const op of (ds.top5||ds.opportunities||[])){
    const rec=recommendationRecord(appData,handoff,op);
    if(!byId.has(rec.recommendationId)) byId.set(rec.recommendationId,rec);
  }
  const records=Array.from(byId.values()).sort((a,b)=>String(a.sessionDate).localeCompare(String(b.sessionDate))||Number(a.rank)-Number(b.rank)||String(a.ticker).localeCompare(String(b.ticker)));
  const first=records[0]?.sessionDate||null,last=records.at(-1)?.sessionDate||null;
  return {
    schemaVersion:'astra-recommendation-ledger-1',
    generatedAt:new Date().toISOString(),
    appendOnly:true,
    idempotent:true,
    sourceSnapshot:sourceSnapshotRefs(appData,handoff),
    sessionRange:{first,last},
    inputHashes:{currentDecisionSnapshotObjectHash:sha256(appData.decisionSnapshot),handoffHash:sha256(handoff)},
    recordCount:records.length,
    records
  };
}

function rowsForTicker(ticker){
  const doc=readJson('data/history/'+ticker+'.json',{sessions:[]});
  return (doc.sessions||[]).map(r=>({
    date:dateOnly(r.date||r.sessionDate),
    open:finite(r.open),high:finite(r.high),low:finite(r.low),close:finite(r.close),
    volume:finite(r.volume),adjustedClose:finite(r.adjustedClose),
    validationStatus:r.validationStatus||null,
    warnings:r.warnings||[]
  })).filter(r=>r.date&&[r.open,r.high,r.low,r.close].every(Number.isFinite)).sort((a,b)=>a.date.localeCompare(b.date));
}

function overlapEntry(row,entry){return row.high>=entry.low&&row.low<=entry.high}
function inside(v,lo,hi){return Number.isFinite(v)&&v>=lo&&v<=hi}

function evaluateRecommendation(rec){
  const rows=rowsForTicker(rec.ticker).filter(r=>r.date>rec.sessionDate);
  const timeline=[{state:'ISSUED',session:rec.sessionDate,evidence:'DecisionSnapshot'}];
  if(!rec.effectiveFromSession||rows.length===0){
    timeline.push({state:'WAITING_FOR_ENTRY',session:rec.effectiveFromSession||null,evidence:'No post-decision finalized session available'});
    return outcome(rec,'WAITING_FOR_ENTRY',timeline,{entryActivated:false,entryNotTriggered:false});
  }
  let activated=false,activationSession=null,activationPrice=null,activationPrecision=null;
  let t1=false,t2=false,final=false,stop=false,ambiguous=false,closedSession=null;
  let sessionsHeld=0,timeToT1=null,timeToFinal=null;
  const targets=rec.targets||[], t1Level=targets[0]??null,t2Level=targets[1]??null,finalLevel=targets.at(-1)??null;

  for(const row of rows){
    if(row.date<rec.effectiveFromSession) continue;
    if(!activated){
      if(!overlapEntry(row,rec.entryPlan)) continue;
      const stopHit=Number.isFinite(rec.stopLoss)&&row.low<=rec.stopLoss;
      const anyTarget=Number.isFinite(finalLevel)&&row.high>=finalLevel;
      if(stopHit&&anyTarget){
        ambiguous=true;activationSession=row.date;
        timeline.push({state:'AMBIGUOUS_INTRADAY_PATH',session:row.date,evidence:'Daily candle touched entry, stop and target without intraday path'});
        break;
      }
      activated=true;activationSession=row.date;
      if(inside(row.open,rec.entryPlan.low,rec.entryPlan.high)){activationPrice=row.open;activationPrecision='EXACT_SESSION_OPEN_INSIDE_ENTRY_ZONE'}
      else {activationPrice=null;activationPrecision='ENTRY_RANGE_TOUCH_PRICE_UNKNOWN'}
      timeline.push({state:'ENTRY_ACTIVATED',session:row.date,evidence:activationPrecision});
      timeline.push({state:'OPEN',session:row.date,evidence:'Activated recommendation is open'});
    }
    if(activated){
      sessionsHeld++;
      const stopHit=Number.isFinite(rec.stopLoss)&&row.low<=rec.stopLoss;
      const targetHits=targets.map(t=>row.high>=t);
      if(stopHit&&targetHits.some(Boolean)){
        ambiguous=true;closedSession=row.date;
        timeline.push({state:'AMBIGUOUS_INTRADAY_PATH',session:row.date,evidence:'Daily candle hit stop and target; order unavailable'});
        break;
      }
      if(stopHit){
        stop=true;closedSession=row.date;
        timeline.push({state:'STOP_LOSS_HIT',session:row.date,level:rec.stopLoss});
        timeline.push({state:'CLOSED',session:row.date,evidence:'Stop-loss resolution'});
        break;
      }
      if(targetHits[0]&&!t1){t1=true;timeToT1=sessionsHeld;timeline.push({state:'TARGET_1_HIT',session:row.date,level:t1Level})}
      if(targetHits[1]&&!t2){t2=true;timeline.push({state:'TARGET_2_HIT',session:row.date,level:t2Level})}
      if(targetHits.length&&targetHits[targetHits.length-1]){
        final=true;timeToFinal=sessionsHeld;closedSession=row.date;
        timeline.push({state:'FINAL_TARGET_HIT',session:row.date,level:finalLevel});
        timeline.push({state:'CLOSED',session:row.date,evidence:'Final target resolution'});
        break;
      }
    }
  }

  if(ambiguous) return outcome(rec,'AMBIGUOUS_INTRADAY_PATH',timeline,{entryActivated:Boolean(activationSession),activationSession,activationPrice,activationPrecision,ambiguous:true,sessionsHeld});
  if(!activated) return outcome(rec,'WAITING_FOR_ENTRY',timeline.concat([{state:'WAITING_FOR_ENTRY',session:rec.effectiveFromSession,evidence:'Entry zone not touched in available post-decision history'}]),{entryActivated:false,entryNotTriggered:false});
  const finalState=stop?'CLOSED':final?'CLOSED':'OPEN';
  return outcome(rec,finalState,timeline,{entryActivated:true,activationSession,activationPrice,activationPrecision,target1Hit:t1,target2Hit:t2,finalTargetHit:final,stopLossHit:stop,closedSession,sessionsHeld,timeToT1,timeToFinal});
}

function outcome(rec,state,timeline,extra={}){
  if(!STATES.has(state)) throw new Error('Undefined outcome state '+state);
  const resolved=state==='CLOSED';
  let returnPct=null;
  if(resolved&&Number.isFinite(extra.activationPrice)){
    let exit=null;
    if(extra.stopLossHit) exit=rec.stopLoss;
    else if(extra.finalTargetHit) exit=rec.targets.at(-1);
    if(Number.isFinite(exit)) returnPct=round((exit/extra.activationPrice-1)*100,4);
  }
  return {
    schemaVersion:'astra-recommendation-outcome-1',
    recommendationId:rec.recommendationId,
    ticker:rec.ticker,
    decisionSnapshotId:rec.decisionSnapshotId,
    sessionDate:rec.sessionDate,
    effectiveFromSession:rec.effectiveFromSession,
    state,
    resolved,
    timeline,
    entryActivated:Boolean(extra.entryActivated),
    entryNotTriggered:Boolean(extra.entryNotTriggered),
    activationSession:extra.activationSession||null,
    activationPrice:extra.activationPrice??null,
    activationPricePrecision:extra.activationPrecision||null,
    target1Hit:Boolean(extra.target1Hit),
    target2Hit:Boolean(extra.target2Hit),
    finalTargetHit:Boolean(extra.finalTargetHit),
    stopLossHit:Boolean(extra.stopLossHit),
    ambiguous:Boolean(extra.ambiguous),
    closedSession:extra.closedSession||null,
    sessionsHeld:extra.sessionsHeld??0,
    timeToT1:extra.timeToT1??null,
    timeToFinalTarget:extra.timeToFinal??null,
    returnPct,
    sourceHistory:'data/history/'+rec.ticker+'.json'
  };
}

function summarize(records,outcomes){
  const byId=new Map(outcomes.map(x=>[x.recommendationId,x]));
  const issued=records.length;
  const activated=outcomes.filter(x=>x.entryActivated).length;
  const waiting=outcomes.filter(x=>x.state==='WAITING_FOR_ENTRY').length;
  const open=outcomes.filter(x=>x.state==='OPEN').length;
  const closed=outcomes.filter(x=>x.state==='CLOSED').length;
  const ambiguous=outcomes.filter(x=>x.state==='AMBIGUOUS_INTRADAY_PATH').length;
  const t1=outcomes.filter(x=>x.target1Hit).length,t2=outcomes.filter(x=>x.target2Hit).length,final=outcomes.filter(x=>x.finalTargetHit).length,stop=outcomes.filter(x=>x.stopLossHit).length;
  const resolvedReturns=outcomes.map(x=>x.returnPct).filter(Number.isFinite);
  const positive=resolvedReturns.filter(x=>x>0),negative=resolvedReturns.filter(x=>x<0);
  const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
  const median=a=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y),m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2};
  const wins=positive.length,losses=negative.length,resolvedDirectional=wins+losses;
  const grossWin=positive.reduce((s,x)=>s+x,0),grossLoss=Math.abs(negative.reduce((s,x)=>s+x,0));
  const holding=outcomes.filter(x=>x.entryActivated&&x.sessionsHeld>0).map(x=>x.sessionsHeld);
  const t1Times=outcomes.map(x=>x.timeToT1).filter(Number.isFinite),finalTimes=outcomes.map(x=>x.timeToFinalTarget).filter(Number.isFinite);
  const metrics={
    totalRecommendations:issued,
    activatedRecommendations:activated,
    entryNotTriggered:outcomes.filter(x=>x.entryNotTriggered).length,
    waitingForEntry:waiting,
    openTrades:open,
    closedTrades:closed,
    target1Hit:t1,target2Hit:t2,finalTargetHit:final,stopLossHit:stop,
    expired:outcomes.filter(x=>x.state==='EXPIRED').length,
    ambiguous,
    activationRate:{numerator:activated,denominator:issued,pct:issued?round(activated/issued*100,2):null},
    target1HitRate:{numerator:t1,denominator:activated,pct:activated?round(t1/activated*100,2):null},
    finalTargetRate:{numerator:final,denominator:activated,pct:activated?round(final/activated*100,2):null},
    stopLossRate:{numerator:stop,denominator:activated,pct:activated?round(stop/activated*100,2):null},
    winRate:{numerator:wins,denominator:resolvedDirectional,pct:resolvedDirectional?round(wins/resolvedDirectional*100,2):null},
    lossRate:{numerator:losses,denominator:resolvedDirectional,pct:resolvedDirectional?round(losses/resolvedDirectional*100,2):null},
    averageReturnPct:round(avg(resolvedReturns),4),
    medianReturnPct:round(median(resolvedReturns),4),
    averageWinnerPct:round(avg(positive),4),
    averageLoserPct:round(avg(negative),4),
    profitFactor:grossLoss?round(grossWin/grossLoss,4):null,
    expectancyPct:round(avg(resolvedReturns),4),
    averageHoldingSessions:round(avg(holding),2),
    averageTimeToT1:round(avg(t1Times),2),
    averageTimeToFinalTarget:round(avg(finalTimes),2),
    bestRecommendation:resolvedReturns.length?outcomes.filter(x=>Number.isFinite(x.returnPct)).sort((a,b)=>b.returnPct-a.returnPct)[0]?.recommendationId:null,
    worstRecommendation:resolvedReturns.length?outcomes.filter(x=>Number.isFinite(x.returnPct)).sort((a,b)=>a.returnPct-b.returnPct)[0]?.recommendationId:null,
    historicalSessionsEvaluated:new Set(outcomes.flatMap(x=>x.timeline.map(t=>t.session).filter(Boolean))).size
  };
  const reconciliation={
    issuedEqualsKnownStates:issued===waiting+open+closed+ambiguous,
    activatedAccounting:activated===open+closed+ambiguous,
    noAmbiguousInWinLossDenominator:true,
    recommendationOutcomeOneToOne:records.every(r=>byId.has(r.recommendationId))&&outcomes.length===records.length
  };
  reconciliation.pass=Object.values(reconciliation).every(Boolean);
  return {metrics,reconciliation};
}

function aggregate(records,outcomes,keyFn){
  const out=[];
  const keys=[...new Set(records.map(keyFn))];
  for(const key of keys){
    const recs=records.filter(r=>keyFn(r)===key);
    const ids=new Set(recs.map(r=>r.recommendationId));
    const outs=outcomes.filter(o=>ids.has(o.recommendationId));
    const s=summarize(recs,outs);
    out.push({key,count:recs.length,metrics:s.metrics,reconciliation:s.reconciliation});
  }
  return out;
}

function buildMarketUniverse(){
  const search=readJson('data/quant/market-search-index-v13-17.json',{stocks:[]});
  const searchRows=Array.isArray(search.stocks)?search.stocks:[];
  const activeTarget=finite(readJson('astra-prod/app/data.json',{}).health?.searchReadiness?.intendedActive)||224;
  const rows=[];
  const seen=new Set();

  for(const s of searchRows){
    const ticker=String(s.ticker||'').trim().toUpperCase();
    if(!ticker||seen.has(ticker)) continue;
    seen.add(ticker);
    const hist=readJson('data/history/'+ticker+'.json',null);
    const sessions=Array.isArray(hist?.sessions)?hist.sessions:[];
    const last=sessions.at(-1)||{};
    rows.push({
      ticker,
      companyNameAr:s.companyNameAr||hist?.companyNameAr||null,
      companyNameEn:s.companyNameEn||hist?.companyNameEn||null,
      isin:s.isin||hist?.isin||null,
      aliases:Array.isArray(s.aliases)?s.aliases:[],
      searchText:s.searchText||[ticker,s.companyNameAr,s.companyNameEn,s.isin].filter(Boolean).join(' '),
      active:s.active!==false,
      price:finite(last.close??s.price),
      priceSession:dateOnly(last.date||last.sessionDate||s.updatedAt),
      changePct:finite(s.changePct),
      volume:finite(last.volume??s.volume),
      liquidity:finite(s.turnover),
      historyAvailable:s.historyAvailable===true||sessions.length>0,
      historySessions:sessions.length,
      primarySource:hist?.primarySource||s.priceSource||null,
      freshness:hist?.staleData===true?'STALE':(last.date||s.price?'AVAILABLE':'UNAVAILABLE'),
      displayOnlyLegacyAnalytics:{
        technicalRank:finite(s.technicalRank),
        tier:s.tier||null,
        decisionCode:s.decisionCode||null,
        historicalSupport20:finite(s.historicalSupport20),
        historicalResistance20:finite(s.historicalResistance20),
        rsi14:finite(s.momentumMoneyFlow?.rsi14)
      }
    });
  }

  // Search index may include inactive/temporary listings. Preserve the full
  // searchable index but expose activeCount explicitly; never fabricate rows.
  const activeRows=rows.filter(x=>x.active!==false);
  return {
    records:rows.sort((a,b)=>a.ticker.localeCompare(b.ticker)),
    activeCount:activeRows.length,
    intendedActive:activeTarget,
    activeCoveragePct:activeTarget?round(Math.min(activeRows.length,activeTarget)/activeTarget*100,2):null,
    sourceIndex:'data/quant/market-search-index-v13-17.json'
  };
}

function main(){
  const appData=readJson('astra-prod/app/data.json');
  const handoff=readJson('data/ops/g22-main-app-handoff.json');
  if(handoff.final!==true||handoff.pagesPublished!==true) throw new Error('Immutable handoff is not final/published');
  if(!/^[0-9a-f]{40}$/.test(String(handoff.canonicalDataHead||''))) throw new Error('canonicalDataHead invalid');
  if(appData.sourceDecision.session!==handoff.sessionDate) throw new Error('Astra session/handoff session mismatch');
  if(appData.health.criticalUnresolved!==0) throw new Error('Current Astra decision has CRITICAL findings');

  const existing=readJson('astra-prod/app/intelligence/recommendation-ledger.json',{records:[]});
  const ledger=buildLedger(appData,handoff,existing);
  const outcomes=ledger.records.map(evaluateRecommendation);
  const summary=summarize(ledger.records,outcomes);
  const sessionRange=ledger.sessionRange;
  const meta={
    generatedAt:new Date().toISOString(),
    sourceSnapshot:ledger.sourceSnapshot,
    sessionRange,
    inputHashes:{ledger:sha256(ledger.records),outcomes:sha256(outcomes)}
  };

  const outcomeDoc={schemaVersion:'astra-recommendation-outcomes-1',...meta,records:outcomes};
  const summaryDoc={schemaVersion:'astra-performance-summary-1',...meta,...summary,currentOpportunities:(appData.decisionSnapshot.top5||[]).length};
  const byRank={schemaVersion:'astra-performance-by-rank-1',...meta,groups:aggregate(ledger.records,outcomes,r=>'RANK_'+r.rank)};
  const byRegime={schemaVersion:'astra-performance-by-regime-1',...meta,groups:aggregate(ledger.records,outcomes,r=>r.marketRegime||'UNKNOWN')};
  const byTicker={schemaVersion:'astra-ticker-performance-1',...meta,groups:aggregate(ledger.records,outcomes,r=>r.ticker)};
  const universeBuilt=buildMarketUniverse();
  const universe={schemaVersion:'astra-market-universe-2',...meta,...universeBuilt};

  if(!summary.reconciliation.pass) throw new Error('KPI reconciliation failed: '+JSON.stringify(summary.reconciliation));

  writeJson('astra-prod/app/intelligence/recommendation-ledger.json',ledger);
  writeJson('astra-prod/app/intelligence/recommendation-outcomes.json',outcomeDoc);
  writeJson('astra-prod/app/intelligence/performance-summary.json',summaryDoc);
  writeJson('astra-prod/app/intelligence/performance-by-rank.json',byRank);
  writeJson('astra-prod/app/intelligence/performance-by-regime.json',byRegime);
  writeJson('astra-prod/app/intelligence/ticker-performance.json',byTicker);
  writeJson('astra-prod/app/intelligence/market-universe.json',universe);

  console.log(JSON.stringify({status:'PASS',records:ledger.recordCount,outcomes:outcomes.length,reconciliation:summary.reconciliation,currentOpportunities:summaryDoc.currentOpportunities},null,2));
}

if(require.main===module) main();
module.exports={stableRecommendationId,recommendationRecord,buildLedger,evaluateRecommendation,summarize,aggregate,STATES};
