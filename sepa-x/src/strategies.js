import { atr, clamp, mean, median, round, std, weightedAvailable } from './math.js';

const finite=(v)=>Number.isFinite(Number(v));
const out=(pass,score,reasonCodes=[],raw={})=>({pass:Boolean(pass),score:round(score,1),reasonCodes,raw});
const quantile=(xs,q)=>{const a=(xs||[]).map(Number).filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const p=(a.length-1)*q,l=Math.floor(p),h=Math.ceil(p);return l===h?a[l]:a[l]+(a[h]-a[l])*(p-l);};

function extrema(bars,r=2){
  const highs=[],lows=[];
  for(let i=r;i<bars.length-r;i++){
    const w=bars.slice(i-r,i+r+1),b=bars[i];
    if(b.high>=Math.max(...w.map(x=>x.high)))highs.push({i,value:b.high,date:b.date});
    if(b.low<=Math.min(...w.map(x=>x.low)))lows.push({i,value:b.low,date:b.date});
  }
  return {highs,lows};
}
function clusters(points,tol,minTouches=2){
  const candidates=[];
  for(const p of points){const members=points.filter(x=>Math.abs(x.value-p.value)<=tol);if(members.length>=minTouches)candidates.push({level:median(members.map(x=>x.value)),touches:members.length,lastIndex:Math.max(...members.map(x=>x.i))});}
  const res=[];
  for(const c of candidates.sort((a,b)=>b.touches-a.touches||b.lastIndex-a.lastIndex)){if(!res.some(x=>Math.abs(x.level-c.level)<=tol*.55))res.push(c);}
  return res;
}

function breakoutRetest(bars,cfg){
  const w=bars.slice(-Math.max(70,cfg.lookbackSessions??140)),n=w.length;if(n<60)return {pass:false,score:0,status:'INSUFFICIENT_HISTORY'};
  const last=w.at(-1),a=atr(w,14),tol=Math.max(last.close*(cfg.levelTolerancePct??1.2)/100,(a||0)*(cfg.levelToleranceAtr??.45));
  const levels=clusters(extrema(w,2).highs.filter(x=>x.i<n-3),tol,cfg.minTouches??2),candidates=[];
  for(const c of levels){
    const level=c.level;
    for(let j=Math.max(21,n-(cfg.breakoutSearchSessions??12)-1);j<n;j++){
      const b=w[j],prev=w[j-1],pre=w.slice(Math.max(0,j-20),j),avgVol=mean(pre.map(x=>x.volume)),vr=avgVol?b.volume/avgVol:null,aj=atr(w.slice(0,j+1),14)||a||0,buffer=aj*(cfg.breakoutBufferAtr??.15),closePos=(b.high-b.low)>0?(b.close-b.low)/(b.high-b.low):.5;
      if(!(b.volume>0&&prev?.close<=level+tol*.25&&b.close>level+buffer&&finite(vr)&&vr>=(cfg.minBreakoutVolumeRatio??1.2)&&closePos>=.55))continue;
      let retest=null;
      for(let k=j+1;k<=Math.min(n-1,j+(cfg.retestWindowSessions??8));k++){
        const r=w[k],maxBelow=Math.max(tol*.5,level*(cfg.maxRetestCloseBelowPct??.5)/100),touched=r.low<=level+tol&&r.low>=level-tol*2.2,held=r.close>=level-maxBelow;
        if(!(r.volume>0&&touched&&held))continue;
        const dist=Math.abs(r.low-level)/(tol||1),volToBreakout=b.volume?r.volume/b.volume:null;
        if(!retest||dist<retest.distance)retest={index:k,date:r.date,low:r.low,high:r.high,close:r.close,volume:r.volume,distance:dist,volumeToBreakout:volToBreakout};
      }
      let confirmation=null;
      if(retest){for(let k=retest.index+1;k<n;k++){const q=w[k],trigger=Math.max(level+Math.max(buffer*.5,tol*.10),retest.high*.995);if(q.volume>0&&q.close>=trigger){confirmation={index:k,date:q.date,close:q.close};break;}}}
      const touchScore=clamp(c.touches/4*100),volumeScore=clamp(45+(vr-(cfg.minBreakoutVolumeRatio??1.2))*55),breakoutScore=weightedAvailable([[volumeScore,60],[clamp(closePos*100),40]])??0,retestScore=retest?(weightedAvailable([[clamp(100-retest.distance*40),55],[finite(retest.volumeToBreakout)?clamp((1.2-retest.volumeToBreakout)*135):40,45]])??0):0;
      const score=weightedAvailable([[touchScore,20],[breakoutScore,30],[retestScore,30],[confirmation?100:0,20]])??0;
      candidates.push({pass:Boolean(retest&&confirmation),score,level,tol,touches:c.touches,breakout:{date:b.date,close:b.close,volumeRatio:vr,closePositionPct:closePos*100},retest,confirmation});
    }
  }
  const best=candidates.sort((a,b)=>Number(b.pass)-Number(a.pass)||b.score-a.score)[0];if(!best)return {pass:false,score:0,status:'NO_BREAKOUT_RETEST',level:null};
  return {pass:best.pass,score:round(best.score,1),status:best.pass?'BREAKOUT_RETEST_CONFIRMED':best.retest?'RETEST_WAITING_CONFIRMATION':'BREAKOUT_WAITING_RETEST',level:round(best.level,4),zone:{from:round(best.level-best.tol,4),to:round(best.level+best.tol,4)},touches:best.touches,breakout:{date:best.breakout.date,close:round(best.breakout.close,4),volumeRatio:round(best.breakout.volumeRatio,2),closePositionPct:round(best.breakout.closePositionPct,1)},retest:best.retest?{date:best.retest.date,low:round(best.retest.low,4),close:round(best.retest.close,4),volumeVsBreakout:round(best.retest.volumeToBreakout,2)}:null,confirmation:best.confirmation?{date:best.confirmation.date,close:round(best.confirmation.close,4)}:null};
}

function supportReclaim(bars,cfg){
  const w=bars.slice(-Math.max(70,cfg.lookbackSessions??140)),n=w.length;if(n<60)return {pass:false,score:0,status:'INSUFFICIENT_HISTORY'};
  const last=w.at(-1),a=atr(w,14),tol=Math.max(last.close*(cfg.levelTolerancePct??1.2)/100,(a||0)*(cfg.levelToleranceAtr??.45)),levels=clusters(extrema(w,2).lows.filter(x=>x.i<n-2),tol,cfg.minTouches??2),candidates=[];
  for(const c of levels){
    const level=c.level;if(level>last.close*1.06||level<last.close*.78)continue;
    for(let j=Math.max(20,n-(cfg.supportSearchSessions??10));j<n-1;j++){
      const b=w[j],pre=w.slice(Math.max(0,j-20),j),avgVol=mean(pre.map(x=>x.volume)),touched=b.low<=level+tol&&b.low>=level-tol*2.5,reclaimed=b.close>=level,undercut=b.low<level-tol*.10;
      if(!(b.volume>0&&touched&&reclaimed))continue;
      let confirmation=null;for(let k=j+1;k<n;k++){const q=w[k],trigger=Math.max(level+tol*.08,b.high*1.002);if(q.volume>0&&q.close>=trigger){confirmation={index:k,date:q.date,close:q.close};break;}}
      const vr=avgVol?b.volume/avgVol:null,closePos=(b.high-b.low)>0?(b.close-b.low)/(b.high-b.low):.5,distance=Math.abs(b.low-level)/(tol||1),score=weightedAvailable([[clamp(c.touches/4*100),25],[clamp(100-distance*35),25],[clamp(closePos*100),20],[confirmation?100:0,20],[finite(vr)?clamp(55+(1-vr)*30):35,10]])??0;
      candidates.push({pass:Boolean(confirmation),score,level,tol,touches:c.touches,bar:{date:b.date,low:b.low,high:b.high,close:b.close,volumeRatio:vr},undercut,confirmation});
    }
  }
  const best=candidates.sort((a,b)=>Number(b.pass)-Number(a.pass)||b.score-a.score)[0];if(!best)return {pass:false,score:0,status:'NO_SUPPORT_RECLAIM',level:null};
  return {pass:best.pass,score:round(best.score,1),status:best.pass?(best.undercut?'FAILED_BREAKDOWN_RECLAIM_CONFIRMED':'SUPPORT_RETEST_CONFIRMED'):'SUPPORT_RETEST_WAITING_CONFIRMATION',level:round(best.level,4),zone:{from:round(best.level-best.tol,4),to:round(best.level+best.tol,4)},touches:best.touches,retest:{date:best.bar.date,low:round(best.bar.low,4),close:round(best.bar.close,4),volumeRatio:round(best.bar.volumeRatio,2),undercut:best.undercut},confirmation:best.confirmation?{date:best.confirmation.date,close:round(best.confirmation.close,4)}:null};
}

export function structureRetestEngine(bars,cfg={}){
  const c=cfg?.strategies?.structureRetest??cfg?.structureRetest??cfg??{};if(!Array.isArray(bars)||bars.length<60)return out(false,0,['INSUFFICIENT_HISTORY'],{activeSetup:null,resistance:null,support:null});
  const resistance=breakoutRetest(bars,c),support=supportReclaim(bars,c),active=[{id:'BREAKOUT_RETEST',...resistance},{id:'SUPPORT_RECLAIM',...support}].sort((a,b)=>Number(b.pass)-Number(a.pass)||(b.score??0)-(a.score??0))[0];
  return out(Boolean(active?.pass),active?.score??0,active?.pass?[]:[resistance.status,support.status].filter(Boolean),{activeSetup:active?.id??null,resistance,support});
}

function compressLows(lows,minSep){const res=[];for(const x of lows){const p=res.at(-1);if(!p||x.i-p.i>=minSep)res.push({...x});else if(x.value<p.value)res[res.length-1]={...x};}return res;}
function hasExtremeSingleSessionMove(segment,maxPct){for(let i=1;i<segment.length;i++){const p=segment[i-1].close,c=segment[i].close;if(p>0&&Math.abs(c/p-1)*100>maxPct)return true;}return false;}

export function historicalCycleEngine(bars,cfg={}){
  const c=cfg?.strategies?.historicalCycle??cfg?.historicalCycle??cfg??{},minSamples=c.minSamples??3,maxLookback=c.maxLookbackSessions??900,minSep=c.minBottomSeparationSessions??15,maxCycle=c.maxCycleSessions??180,minAdvance=c.minAdvancePct??8,maxAdvance=c.maxAdvancePct??120,maxOneDay=c.maxSingleSessionMovePct??35;
  if(!Array.isArray(bars)||bars.length<120)return out(false,0,['INSUFFICIENT_CYCLE_HISTORY'],{calibratedProbability:false,samples:0});
  const w=bars.slice(-maxLookback),lows=compressLows(extrema(w,c.swingRadius??3).lows,minSep),cycles=[];let rejectedAnomalousCycles=0;
  for(let i=0;i<lows.length-1;i++){
    const low=lows[i],next=lows[i+1],cycleSessions=next.i-low.i;if(cycleSessions<minSep||cycleSessions>maxCycle)continue;
    const seg=w.slice(low.i,next.i+1);if(!seg.length||hasExtremeSingleSessionMove(seg,maxOneDay)){rejectedAnomalousCycles++;continue;}
    let peakOffset=0;for(let j=1;j<seg.length;j++)if(seg[j].high>seg[peakOffset].high)peakOffset=j;const peak=seg[peakOffset],advance=(peak.high/low.value-1)*100;
    if(advance<minAdvance||advance>maxAdvance){if(advance>maxAdvance)rejectedAnomalousCycles++;continue;}
    cycles.push({bottomDate:low.date,bottom:round(low.value,4),peakDate:peak.date,peak:round(peak.high,4),nextBottomDate:next.date,bottomToPeakSessions:peakOffset,bottomToBottomSessions:cycleSessions,advancePct:round(advance,2),retracementPct:round((peak.high-next.value)/peak.high*100,2)});
  }
  const history=cycles.slice(-(c.maxSamples??12));if(history.length<minSamples)return out(false,clamp(history.length/minSamples*50),['INSUFFICIENT_VALID_CYCLES'],{calibratedProbability:false,samples:history.length,rejectedAnomalousCycles,cycles:history});
  const peakLens=history.map(x=>x.bottomToPeakSessions),cycleLens=history.map(x=>x.bottomToBottomSessions),advances=history.map(x=>x.advancePct),medPeak=median(peakLens),medCycle=median(cycleLens),medAdvance=median(advances),q25=quantile(peakLens,.25),q75=quantile(peakLens,.75),sdCycle=std(cycleLens),lastLow=lows.at(-1),age=lastLow?w.length-1-lastLow.i:null,last=w.at(-1),rebound=lastLow?(last.close/lastLow.value-1)*100:null,consistency=medCycle?clamp(100-(sdCycle/medCycle)*160):0;
  let windowScore=0,phase='UNKNOWN';if(finite(age)&&finite(q25)&&finite(q75)){if(age<q25){windowScore=clamp(age/Math.max(1,q25)*85);phase='BEFORE_TYPICAL_PEAK_WINDOW';}else if(age<=q75){windowScore=100;phase='IN_TYPICAL_PEAK_WINDOW';}else{windowScore=clamp(100-(age-q75)/Math.max(1,medCycle-q75)*100);phase='LATE_CYCLE';}}
  const reboundScore=finite(rebound)&&medAdvance?clamp(rebound/medAdvance*100):0,ma10=mean(w.slice(-10).map(x=>x.close)),trendConfirm=finite(ma10)&&last.close>ma10?100:35,score=weightedAvailable([[consistency,40],[windowScore,30],[reboundScore,20],[trendConfirm,10]])??0,pass=history.length>=minSamples&&score>=(c.minAlignmentScore??60);
  return out(pass,score,pass?[]:['CYCLE_ALIGNMENT_WEAK'],{calibratedProbability:false,interpretation:'HISTORICAL_ALIGNMENT_SCORE_NOT_PROBABILITY',samples:history.length,rejectedAnomalousCycles,cycle_phase:phase,cycle_alignment_score:round(score,1),median_bottom_to_peak_sessions:round(medPeak,1),median_bottom_to_bottom_sessions:round(medCycle,1),typical_peak_window_sessions_from_bottom:{from:round(q25,1),to:round(q75,1)},median_advance_pct:round(medAdvance,2),cycle_length_consistency_score:round(consistency,1),current_cycle:{lastBottomDate:lastLow?.date??null,lastBottom:round(lastLow?.value,4),ageSessions:age,reboundPct:round(rebound,2),price:round(last.close,4)},cycles:history});
}

export function metaStrategyEngine(row,cfg={}){
  const challenger=cfg?.strategies?.challengerMode!==false,s=row?.structureRetest?.raw??{},cycle=row?.historicalCycle,corpReview=(row?.data?.reasonCodes||[]).includes('CORPORATE_ACTION_REVIEW_REQUIRED'),trusted=!corpReview;
  const candidates=[
    {id:'BREAKOUT_RETEST',score:s.resistance?.score??0,confirmed:Boolean(trusted&&s.resistance?.pass),status:s.resistance?.status??null},
    {id:'SUPPORT_RECLAIM',score:s.support?.score??0,confirmed:Boolean(trusted&&s.support?.pass),status:s.support?.status??null},
    {id:'HISTORICAL_CYCLE',score:cycle?.score??0,confirmed:Boolean(trusted&&cycle?.pass),status:cycle?.raw?.cycle_phase??null},
    {id:'PIVOT_BREAKOUT',score:row?.entry?.score??0,confirmed:['READY NOW','BREAKOUT CONFIRMED'].includes(row?.entry?.raw?.status),status:row?.entry?.raw?.status??null},
    {id:'VCP_COMPRESSION',score:row?.vcp?.score??0,confirmed:Boolean(row?.vcp?.pass),status:row?.vcp?.pass?'CONFIRMED':'FORMING'},
  ].sort((a,b)=>Number(b.confirmed)-Number(a.confirmed)||(b.score??0)-(a.score??0));
  const best=candidates[0]??null,count=candidates.filter(x=>x.confirmed&&Number(x.score)>=60).length,agreement=clamp(count/3*100),score=weightedAvailable([[best?.score??0,75],[agreement,25]])??0;
  return {mode:challenger?'CHALLENGER':'ACTIVE',calibrated:false,trustedForPromotion:trusted,trustReason:trusted?null:'CORPORATE_ACTION_REVIEW_REQUIRED',eligibilityImpact:challenger?'NONE_CHALLENGER_MODE':'CONFIGURED_ACTIVE',bestStrategy:best?.id??null,bestStrategyStatus:best?.status??null,bestStrategyScore:round(best?.score,1),confirmationCount:count,strategyEdgeScore:round(score,1),candidates};
}
