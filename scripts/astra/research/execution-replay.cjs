'use strict';

// Research-only execution accounting. No strategy ranking or live order changes.
const round = (n, digits=4) => Number(n.toFixed(digits));
function fill(bar, plan) {
  if (bar.open >= plan.entryLow && bar.open <= plan.entryHigh) return bar.open;
  if (bar.open > plan.entryHigh && bar.low <= plan.entryHigh) return plan.entryHigh;
  return null;
}

function evaluatePlan(signal, bars, policy) {
  const {entryExpirySessions, maxHoldSessions, roundTripCostPct} = policy;
  if (!Number.isInteger(entryExpirySessions) || entryExpirySessions < 1 ||
      !Number.isInteger(maxHoldSessions) || maxHoldSessions < 1 ||
      !Number.isFinite(roundTripCostPct) || roundTripCostPct < 0) throw new Error('Invalid execution policy');
  if (![signal.entryLow, signal.entryHigh, signal.stop, signal.target1].every(v=>Number.isFinite(v)&&v>0) ||
      signal.entryLow > signal.entryHigh || signal.stop >= signal.entryLow || signal.target1 <= signal.entryHigh) {
    throw new Error('Invalid trade plan');
  }
  const future = bars.filter(b=>b.date>signal.signalDate).sort((a,b)=>a.date.localeCompare(b.date));
  const seen = new Set();
  for (const b of future) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || seen.has(b.date) ||
        ![b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0) ||
        b.high<Math.max(b.open,b.low,b.close) || b.low>Math.min(b.open,b.high,b.close)) throw new Error('Invalid OHLC '+b.date);
    seen.add(b.date);
  }
  const observedThrough = future.at(-1)?.date || signal.signalDate;
  let entry;
  for (let j=0;j<Math.min(future.length,entryExpirySessions);j++) {
    const price=fill(future[j],signal);
    if (price!==null) {entry={j,price,date:future[j].date};break;}
  }
  if (!entry) {
    const expired=future.length>=entryExpirySessions;
    return {...signal,state:expired?'EXPIRED':'WAITING_FOR_ENTRY',observedThrough,
      terminalDate:expired?future[entryExpirySessions-1].date:null,
      blockedThrough:expired?future[entryExpirySessions-1].date:observedThrough,netPct:null};
  }
  const common={...signal,entryDate:entry.date,entryPrice:entry.price,observedThrough};
  const lastIndex=Math.min(future.length-1,entry.j+maxHoldSessions-1);
  let exit;
  for(let j=entry.j;j<=lastIndex;j++) {
    const b=future[j];
    // The position already exists at the next open; an adverse gap cannot fill
    // at a better stop level that the market has skipped.
    if(j>entry.j && b.open<=signal.stop) {exit={date:b.date,price:b.open,outcome:'STOP_GAP'};break;}
    // Conservative target limit fill: no invented positive gap improvement.
    if(j>entry.j && b.open>=signal.target1) {exit={date:b.date,price:signal.target1,outcome:'TARGET1'};break;}
    const stop=b.low<=signal.stop,target=b.high>=signal.target1;
    if(j===entry.j && b.open>signal.entryHigh && target && !stop) {
      return {...common,state:'AMBIGUOUS_INTRADAY_PATH',outcome:null,netPct:null,
        terminalDate:null,blockedThrough:observedThrough,
        reason:'Target may precede intraday entry; daily OHLC cannot resolve ordering'};
    }
    if(stop) {exit={date:b.date,price:signal.stop,outcome:target?'STOP_SAME_BAR':'STOP'};break;}
    if(target) {exit={date:b.date,price:signal.target1,outcome:'TARGET1'};break;}
  }
  if(!exit && lastIndex-entry.j+1<maxHoldSessions) {
    return {...common,state:'OPEN',terminalDate:null,blockedThrough:observedThrough,netPct:null};
  }
  if(!exit) exit={date:future[lastIndex].date,price:future[lastIndex].close,outcome:'TIME_EXIT'};
  return {...common,state:'CLOSED',exitDate:exit.date,exitPrice:exit.price,terminalDate:exit.date,
    blockedThrough:exit.date,outcome:exit.outcome,
    netPct:round((exit.price/entry.price-1)*100-roundTripCostPct)};
}

function summarize(episodes) {
  const closed=episodes.filter(e=>e.state==='CLOSED');
  const gains=closed.reduce((s,e)=>s+Math.max(0,e.netPct),0);
  const losses=closed.reduce((s,e)=>s+Math.max(0,-e.netPct),0);
  return {issued:episodes.length,closed:closed.length,
    open:episodes.filter(e=>e.state==='OPEN').length,
    ambiguous:episodes.filter(e=>e.state==='AMBIGUOUS_INTRADAY_PATH').length,
    waiting:episodes.filter(e=>e.state==='WAITING_FOR_ENTRY').length,
    expired:episodes.filter(e=>e.state==='EXPIRED').length,
    suppressed:episodes.filter(e=>e.state==='SUPPRESSED_OVERLAP').length,
    wins:closed.filter(e=>e.netPct>0).length,
    averageNetPct:closed.length?round(closed.reduce((s,e)=>s+e.netPct,0)/closed.length):null,
    profitFactor:losses?round(gains/losses):null,
    metricDenominator:'CLOSED_WITH_NUMERIC_NET_RETURN'};
}

module.exports={evaluatePlan,summarize};
