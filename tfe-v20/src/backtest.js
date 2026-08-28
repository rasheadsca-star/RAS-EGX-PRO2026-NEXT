import { POLICY } from './policy.js';
import { analyzeTickerBase } from './engine.js';
import { normalizeBars, assessDataReadiness } from './quality.js';
import { round, avg } from './math.js';

function fill(bar,plan){
  if(bar.open>=plan.entryLow&&bar.open<=plan.entryHigh)return bar.open;
  if(bar.open>plan.entryHigh&&bar.low<=plan.entryHigh)return plan.entryHigh;
  if(bar.open<plan.entryLow)return null;
  if(bar.low<=plan.entryHigh&&bar.high>=plan.entryLow)return plan.entryHigh;
  return null;
}

export function backtestHistory({ticker,rows,minBars=POLICY.minBars,historyMeta={}}){
  const normalized=normalizeBars(rows),bars=normalized.bars,trades=[],expired=[];
  const dataReadiness=assessDataReadiness({
    bars,
    normalizedRejected:normalized.rejected,
    updateFailed:historyMeta.updateFailed,
    staleData:historyMeta.staleData,
    symbolVerified:historyMeta.symbolVerified,
    symbolVerification:historyMeta.symbolVerification,
    requireVerifiedIdentity:historyMeta.symbolVerified !== undefined || historyMeta.symbolVerification !== undefined,
    requireAllVolume:true,
  });
  if(!dataReadiness.readyForBacktest){
    return {
      ...summarizeBacktest([],[]),
      dataReadiness,
      skipped:true,
      skipReason:'DATA_NOT_READY',
    };
  }
  let i=minBars-1;
  while(i<bars.length-1){
    const a=analyzeTickerBase({ticker,rows:bars.slice(0,i+1),historyMeta:{warnings:[]},expectedSessionDate:null,includeOverlay:false});
    if(!a.eligible||!a.tradePlan){i++;continue;}
    let entry=null;
    const end=Math.min(bars.length-1,i+POLICY.entryExpirySessions);
    for(let j=i+1;j<=end;j++){
      const p=fill(bars[j],a.tradePlan);
      if(p!=null){entry={j,price:p};break;}
    }
    if(!entry){expired.push({signalDate:bars[i].date});i=end+1;continue;}
    const maxExit=Math.min(bars.length-1,entry.j+POLICY.maxHoldSessions-1);
    let exit=null;
    for(let j=entry.j;j<=maxExit;j++){
      const b=bars[j],stop=b.low<=a.tradePlan.stop,t1=b.high>=a.tradePlan.target1;
      if(stop&&t1){exit={j,price:a.tradePlan.stop,outcome:'STOP_SAME_BAR'};break;}
      if(stop){exit={j,price:a.tradePlan.stop,outcome:'STOP'};break;}
      if(t1){exit={j,price:a.tradePlan.target1,outcome:'TARGET1'};break;}
    }
    if(!exit)exit={j:maxExit,price:bars[maxExit].close,outcome:'TIME_EXIT'};
    trades.push({
      ticker,
      signalDate:bars[i].date,
      entryDate:bars[entry.j].date,
      exitDate:bars[exit.j].date,
      outcome:exit.outcome,
      netPct:round((exit.price-entry.price)/entry.price*100-POLICY.roundTripCostPct,2),
      signalResearchScore:a.scores.research,
      signalTechnicalScore:a.scores.core,
      structuralNetRR:a.tradePlan.structuralNetRR,
    });
    i=exit.j+1;
  }
  return {...summarizeBacktest(trades,expired),dataReadiness,skipped:false,skipReason:null};
}

export function summarizeBacktest(trades,expired=[]){
  const n=trades.length;
  if(!n)return{trades:[],expired,summary:{entered:0,target1Pct:null,stopPct:null,positivePct:null,avgNetPct:null,profitFactor:null,wilson95LowerTarget1Pct:null}};
  const t1=trades.filter(x=>x.outcome==='TARGET1').length;
  const stop=trades.filter(x=>x.outcome.startsWith('STOP')).length;
  const wins=trades.filter(x=>x.netPct>0),losses=trades.filter(x=>x.netPct<0);
  const gp=wins.reduce((s,x)=>s+x.netPct,0),gl=Math.abs(losses.reduce((s,x)=>s+x.netPct,0));
  const p=t1/n,z=1.96,den=1+z*z/n;
  const lower=Math.max(0,(p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/den);
  return{trades,expired,summary:{
    entered:n,
    target1Pct:round(t1/n*100,1),
    stopPct:round(stop/n*100,1),
    positivePct:round(wins.length/n*100,1),
    avgNetPct:round(avg(trades.map(x=>x.netPct)),2),
    profitFactor:gl?round(gp/gl,2):gp>0?'INF':null,
    wilson95LowerTarget1Pct:round(lower*100,1)
  }};
}
