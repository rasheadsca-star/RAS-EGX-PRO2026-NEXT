import { atr, clamp, mean, median, pct, round, std, weightedAvailable } from './math.js';

const finite=(v)=>Number.isFinite(Number(v));
const result=(pass,score,reasonCodes=[],raw={})=>({pass:Boolean(pass),score:round(score,1),reasonCodes,raw});
const quantile=(xs,q)=>{
  const a=(xs||[]).map(Number).filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return null;
  const pos=(a.length-1)*q,lo=Math.floor(pos),hi=Math.ceil(pos);
  return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(pos-lo);
};

function localExtrema(bars,radius=2){
  const highs=[],lows=[];
  for(let i=radius;i<bars.length-radius;i++){
    const w=bars.slice(i-radius,i+radius+1),h=bars[i].high,l=bars[i].low;
    if(h>=Math.max(...w.map(x=>x.high)))highs.push({i,value:h,date:bars[i].date});
    if(l<=Math.min(...w.map(x=>x.low)))lows.push({i,value:l,date:bars[i].date});
  }
  return {highs,lows};
}

function levelClusters(points,tolerance,minTouches=2){
  const candidates=[];
  for(const p of points){
    const members=points.filter(x=>Math.abs(x.value-p.value)<=tolerance);
    if(members.length<minTouches)continue;
    candidates.push({
      level:median(members.map(x=>x.value)),
      touches:members.length,
      firstIndex:Math.min(...members.map(x=>x.i)),
      lastIndex:Math.max(...members.map(x=>x.i)),
      dates:[...new Set(members.map(x=>x.date))],
    });
  }
  const out=[];
  for(const c of candidates.sort((a,b)=>b.touches-a.touches||b.lastIndex-a.lastIndex)){
    if(out.some(x=>Math.abs(x.level-c.level)<=tolerance*0.55))continue;
    out.push(c);
  }
  return out;
}

function breakoutRetest(bars,cfg){
  const lookback=Math.max(70,cfg.lookbackSessions??140),w=bars.slice(-lookback),n=w.length;
  if(n<60)return {pass:false,score:0,status:'INSUFFICIENT_HISTORY'};
  const last=w.at(-1),a=atr(w,14),tol=Math.max(last.close*(cfg.levelTolerancePct??1.2)/100,(a||0)*(cfg.levelToleranceAtr??0.45));
  const ex=localExtrema(w,2),clusters=levelClusters(ex.highs.filter(x=>x.i<n-3),tol,cfg.minTouches??2);
  const search=Math.max(3,cfg.breakoutSearchSessions??12),retestWindow=Math.max(2,cfg.retestWindowSessions??8);
  const candidates=[];
  for(const c of clusters){
    const level=c.level;
    for(let j=Math.max(21,n-search-1);j<n;j++){
      const bar=w[j],prev=w[j-1],pre=w.slice(Math.max(0,j-20),j),avgVol=mean(pre.map(x=>x.volume));
      const vr=avgVol?bar.volume/avgVol:null,aj=atr(w.slice(0,j+1),14)||a||0,buffer=aj*(cfg.breakoutBufferAtr??0.15);
      const closePos=(bar.high-bar.low)>0?(bar.close-bar.low)/(bar.high-bar.low):0.5;
      const crossed=prev?.close<=level+tol*0.25&&bar.close>level+buffer;
      if(!crossed||!finite(vr)||vr<(cfg.minBreakoutVolumeRatio??1.2)||closePos<0.55)continue;
      let retest=null;
      const end=Math.min(n-1,j+retestWindow);
      for(let k=j+1;k<=end;k++){
        const r=w[k],maxBelow=Math.max(tol*0.5,level*(cfg.maxRetestCloseBelowPct??0.5)/100);
        const touched=r.low<=level+tol&&r.low>=level-tol*2.2;
        const held=r.close>=level-maxBelow;
        if(!touched||!held)continue;
        const dist=Math.abs(r.low-level)/(tol||1),volToBreakout=bar.volume?r.volume/bar.volume:null;
        if(!retest||dist<retest.distance)retest={index:k,date:r.date,low:r.low,high:r.high,close:r.close,volume:r.volume,distance:dist,volumeToBreakout:volToBreakout};
      }
      let confirmation=null;
      if(retest){
        for(let k=retest.index;k<n;k++){
          const q=w[k];
          if(q.close>level+Math.max(buffer*0.5,tol*0.10)&&q.close>=retest.close){confirmation={index:k,date:q.date,close:q.close};break;}
        }
      }
      const touchScore=clamp(c.touches/4*100),volumeScore=clamp(45+(vr-(cfg.minBreakoutVolumeRatio??1.2))*55),closeScore=clamp(closePos*100);
      const breakoutScore=weightedAvailable([[volumeScore,60],[closeScore,40]])??0;
      const retestScore=retest?weightedAvailable([[clamp(100-retest.distance*40),55],[finite(retest.volumeToBreakout)?clamp((1.25-retest.volumeToBreakout)*120):50,45]])??0:0;
      const score=weightedAvailable([[touchScore,20],[breakoutScore,30],[retest?retestScore:0,30],[confirmation?100:0,20]])??0;
      const pass=Boolean(retest&&confirmation);
      candidates.push({pass,score,level,tolerance:tol,cluster:c,breakout:{index:j,date:bar.date,close:bar.close,high:bar.high,low:bar.low,volumeRatio:vr,closePositionPct:closePos*100},retest,confirmation});
    }
  }
  const best=candidates.sort((a,b)=>Number(b.pass)-Number(a.pass)||b.score-a.score)[0];
  if(!best)return {pass:false,score:0,status:'NO_BREAKOUT_RETEST',level:null};
  return {
    pass:best.pass,score:round(best.score,1),status:best.pass?'BREAKOUT_RETEST_CONFIRMED':best.retest?'RETEST_WAITING_CONFIRMATION':'BREAKOUT_WAITING_RETEST',
    level:round(best.level,4),zone:{from:round(best.level-best.tolerance,4),to:round(best.level+best.tolerance,4)},touches:best.cluster.touches,
    breakout:{date:best.breakout.date,close:round(best.breakout.close,4),volumeRatio:round(best.breakout.volumeRatio,2),closePositionPct:round(best.breakout.closePositionPct,1)},
    retest:best.retest?{date:best.retest.date,low:round(best.retest.low,4),close:round(best.retest.close,4),volumeVsBreakout:round(best.retest.volumeToBreakout,2)}:null,
    confirmation:best.confirmation?{date:best.confirmation.date,close:round(best.confirmation.close,4)}:null,
  };
}

function supportReclaim(bars,cfg){
  const lookback=Math.max(70,cfg.lookbackSessions??140),w=bars.slice(-lookback),n=w.length;
  if(n<60)return {pass:false,score:0,status:'INSUFFICIENT_HISTORY'};
  const last=w.at(-1),a=atr(w,14),tol=Math.max(last.close*(cfg.levelTolerancePct??1.2)/100,(a||0)*(cfg.levelToleranceAtr??0.45));
  const ex=localExtrema(w,2),clusters=levelClusters(ex.lows.filter(x=>x.i<n-2),tol,cfg.minTouches??2);
  const search=Math.max(4,cfg.supportSearchSessions??10),candidates=[];
  for(const c of clusters){
    const level=c.level;
    if(level>last.close*1.06||level<last.close*0.78)continue;
    for(let j=Math.max(20,n-search);j<n;j++){
      const bar=w[j],pre=w.slice(Math.max(0,j-20),j),avgVol=mean(pre.map(x=>x.volume));
      const touched=bar.low<=level+tol&&bar.low>=level-tol*2.5,reclaimed=bar.close>=level,undercut=bar.low<level-tol*0.10;
      if(!touched||!reclaimed)continue;
      let confirmation=null;
      for(let k=j;k<n;k++)if(w[k].close>=Math.max(level,w[j].high*0.995)){confirmation={index:k,date:w[k].date,close:w[k].close};break;}
      const volRatio=avgVol?bar.volume/avgVol:null,closePos=(bar.high-bar.low)>0?(bar.close-bar.low)/(bar.high-bar.low):0.5;
      const distance=Math.abs(bar.low-level)/(tol||1);
      const score=weightedAvailable([[clamp(c.touches/4*100),25],[clamp(100-distance*35),25],[clamp(closePos*100),20],[confirmation?100:0,20],[finite(volRatio)?clamp(55+(1-volRatio)*30):50,10]])??0;
      candidates.push({pass:Boolean(confirmation),score,level,tolerance:tol,cluster:c,bar:{date:bar.date,low:bar.low,close:bar.close,volumeRatio:volRatio},undercut,confirmation});
    }
  }
  const best=candidates.sort((a,b)=>Number(b.pass)-Number(a.pass)||b.score-a.score)[0];
  if(!best)return {pass:false,score:0,status:'NO_SUPPORT_RECLAIM',level:null};
  return {
    pass:best.pass,score:round(best.score,1),status:best.pass?(best.undercut?'FAILED_BREAKDOWN_RECLAIM_CONFIRMED':'SUPPORT_RETEST_CONFIRMED'):'SUPPORT_RETEST_WAITING_CONFIRMATION',
    level:round(best.level,4),zone:{from:round(best.level-best.tolerance,4),to:round(best.level+best.tolerance,4)},touches:best.cluster.touches,
    retest:{date:best.bar.date,low:round(best.bar.low,4),close:round(best.bar.close,4),volumeRatio:round(best.bar.volumeRatio,2),undercut:best.undercut},
    confirmation:best.confirmation?{date:best.confirmation.date,close:round(best.confirmation.close,4)}:null,
  };
}

export function structureRetestEngine(bars,cfg={}){
  const c=cfg?.strategies?.structureRetest??cfg?.structureRetest??cfg??{};
  if(!Array.isArray(bars)||bars.length<60)return result(false,0,['INSUFFICIENT_HISTORY'],{activeSetup:null,resistance:null,support:null});
  const resistance=breakoutRetest(bars,c),support=supportReclaim(bars,c);
  const active=[{id:'BREAKOUT_RETEST',...resistance},{id:'SUPPORT_RECLAIM',...support}].sort((a,b)=>Number(b.pass)-Number(a.pass)||(b.score??0)-(a.score??0))[0];
  const pass=Boolean(active?.pass),reasons=pass?[]:[resistance.status,support.status].filter(Boolean);
  return result(pass,active?.score??0,reasons,{activeSetup:active?.id??null,resistance,support});
}

function compressLows(lows,minSeparation){
  const out=[];
  for(const low of lows){
    const prev=out.at(-1);
    if(!prev||low.i-prev.i>=minSeparation){out.push({...low});continue;}
    if(low.value<prev.value)out[out.length-1]={...low};
  }
  return out;
}

export function historicalCycleEngine(bars,cfg={}){
  const c=cfg?.strategies?.historicalCycle??cfg?.historicalCycle??cfg??{};
  const minSamples=c.minSamples??3,maxLookback=c.maxLookbackSessions??900,minSep=c.minBottomSeparationSessions??15,maxCycle=c.maxCycleSessions??180,minAdvance=c.minAdvancePct??8;
  if(!Array.isArray(bars)||bars.length<120)return result(false,0,['INSUFFICIENT_CYCLE_HISTORY'],{calibratedProbability:false,samples:0});
  const w=bars.slice(-maxLookback),ex=localExtrema(w,c.swingRadius??3),lows=compressLows(ex.lows,minSep),cycles=[];
  for(let i=0;i<lows.length-1;i++){
    const low=lows[i],next=lows[i+1],cycleSessions=next.i-low.i;
    if(cycleSessions<minSep||cycleSessions>maxCycle)continue;
    const segment=w.slice(low.i,next.i+1);if(!segment.length)continue;
    let peakOffset=0;for(let j=1;j<segment.length;j++)if(segment[j].high>segment[peakOffset].high)peakOffset=j;
    const peak=segment[peakOffset],advance=(peak.high/low.value-1)*100;
    if(advance<minAdvance)continue;
    cycles.push({bottomDate:low.date,bottom:round(low.value,4),peakDate:peak.date,peak:round(peak.high,4),nextBottomDate:next.date,bottomToPeakSessions:peakOffset,bottomToBottomSessions:cycleSessions,advancePct:round(advance,2),retracementPct:round((peak.high-next.value)/peak.high*100,2)});
  }
  const history=cycles.slice(-(c.maxSamples??12));
  if(history.length<minSamples)return result(false,clamp(history.length/minSamples*50),['INSUFFICIENT_VALID_CYCLES'],{calibratedProbability:false,samples:history.length,cycles:history});
  const peakLens=history.map(x=>x.bottomToPeakSessions),cycleLens=history.map(x=>x.bottomToBottomSessions),advances=history.map(x=>x.advancePct);
  const medPeak=median(peakLens),medCycle=median(cycleLens),medAdvance=median(advances),q25=quantile(peakLens,.25),q75=quantile(peakLens,.75),sdCycle=std(cycleLens);
  const lastLow=lows.at(-1),age=lastLow?w.length-1-lastLow.i:null,last=w.at(-1),rebound=lastLow?(last.close/lastLow.value-1)*100:null;
  const consistency=medCycle?clamp(100-(sdCycle/medCycle)*160):0;
  let windowScore=0,phase='UNKNOWN';
  if(finite(age)&&finite(q25)&&finite(q75)){
    if(age<q25){windowScore=clamp(age/Math.max(1,q25)*85);phase='BEFORE_TYPICAL_PEAK_WINDOW';}
    else if(age<=q75){windowScore=100;phase='IN_TYPICAL_PEAK_WINDOW';}
    else{windowScore=clamp(100-(age-q75)/Math.max(1,medCycle-q75)*100);phase='LATE_CYCLE';}
  }
  const reboundScore=finite(rebound)&&medAdvance?clamp(rebound/medAdvance*100):0;
  const ma10=mean(w.slice(-10).map(x=>x.close)),trendConfirm=finite(ma10)&&last.close>ma10?100:35;
  const score=weightedAvailable([[consistency,40],[windowScore,30],[reboundScore,20],[trendConfirm,10]])??0;
  const pass=history.length>=minSamples&&score>=(c.minAlignmentScore??60);
  return result(pass,score,pass?[]:['CYCLE_ALIGNMENT_WEAK'],{
    calibratedProbability:false,interpretation:'HISTORICAL_ALIGNMENT_SCORE_NOT_PROBABILITY',samples:history.length,cycle_phase:phase,cycle_alignment_score:round(score,1),
    median_bottom_to_peak_sessions:round(medPeak,1),median_bottom_to_bottom_sessions:round(medCycle,1),typical_peak_window_sessions_from_bottom:{from:round(q25,1),to:round(q75,1)},median_advance_pct:round(medAdvance,2),cycle_length_consistency_score:round(consistency,1),
    current_cycle:{lastBottomDate:lastLow?.date??null,lastBottom:round(lastLow?.value,4),ageSessions:age,reboundPct:round(rebound,2),price:round(last.close,4)},cycles:history,
  });
}

export function metaStrategyEngine(row,cfg={}){
  const challenger=cfg?.strategies?.challengerMode!==false;
  const s=row?.structureRetest?.raw??{},cycle=row?.historicalCycle;
  const candidates=[
    {id:'BREAKOUT_RETEST',score:s.resistance?.score??0,confirmed:Boolean(s.resistance?.pass),status:s.resistance?.status??null},
    {id:'SUPPORT_RECLAIM',score:s.support?.score??0,confirmed:Boolean(s.support?.pass),status:s.support?.status??null},
    {id:'HISTORICAL_CYCLE',score:cycle?.score??0,confirmed:Boolean(cycle?.pass),status:cycle?.raw?.cycle_phase??null},
    {id:'PIVOT_BREAKOUT',score:row?.entry?.score??0,confirmed:['READY NOW','BREAKOUT CONFIRMED'].includes(row?.entry?.raw?.status),status:row?.entry?.raw?.status??null},
    {id:'VCP_COMPRESSION',score:row?.vcp?.score??0,confirmed:Boolean(row?.vcp?.pass),status:row?.vcp?.pass?'CONFIRMED':'FORMING'},
  ].sort((a,b)=>Number(b.confirmed)-Number(a.confirmed)||(b.score??0)-(a.score??0));
  const best=candidates[0]??null,confirmationCount=candidates.filter(x=>x.confirmed&&Number(x.score)>=60).length;
  const agreement=clamp(confirmationCount/3*100),score=weightedAvailable([[best?.score??0,75],[agreement,25]])??0;
  return {
    mode:challenger?'CHALLENGER':'ACTIVE',calibrated:false,eligibilityImpact:challenger?'NONE_CHALLENGER_MODE':'CONFIGURED_ACTIVE',
    bestStrategy:best?.id??null,bestStrategyStatus:best?.status??null,bestStrategyScore:round(best?.score,1),confirmationCount,strategyEdgeScore:round(score,1),candidates,
  };
}
