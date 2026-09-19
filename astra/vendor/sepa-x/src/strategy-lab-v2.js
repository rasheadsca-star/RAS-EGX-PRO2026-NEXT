import { atr, clamp, mean, median, round, std, weightedAvailable } from './math.js';

const finite=(v)=>Number.isFinite(Number(v));
const wilsonLower=(k,n,z=1.96)=>{if(!n)return null;const p=k/n,z2=z*z,den=1+z2/n,center=p+z2/(2*n),margin=z*Math.sqrt((p*(1-p)+z2/(4*n))/n);return Math.max(0,(center-margin)/den)*100;};
const result=(pass,score,reasonCodes,raw)=>({pass:Boolean(pass),score:round(score,1),reasonCodes:reasonCodes||[],raw});

function swingPoints(bars,r=2){
  const highs=[],lows=[];
  for(let i=r;i<bars.length-r;i++){
    const b=bars[i],w=bars.slice(i-r,i+r+1);
    if(b.high>=Math.max(...w.map(x=>x.high)))highs.push({i,value:b.high,date:b.date});
    if(b.low<=Math.min(...w.map(x=>x.low)))lows.push({i,value:b.low,date:b.date});
  }
  return {highs,lows};
}
function clusterLevels(points,tolerance,minTouches=2){
  const raw=[];
  for(const p of points){
    const members=points.filter(x=>Math.abs(x.value-p.value)<=tolerance);
    if(members.length>=minTouches)raw.push({level:median(members.map(x=>x.value)),touches:members.length,lastIndex:Math.max(...members.map(x=>x.i))});
  }
  const out=[];
  for(const x of raw.sort((a,b)=>b.touches-a.touches||b.lastIndex-a.lastIndex))if(!out.some(y=>Math.abs(y.level-x.level)<=tolerance*.55))out.push(x);
  return out;
}
function closePosition(bar){const range=Number(bar.high)-Number(bar.low);return range>0?(Number(bar.close)-Number(bar.low))/range:.5;}
function bodyAtr(bar,a){return a>0?Math.abs(Number(bar.close)-Number(bar.open))/a:0;}

export function confirmedRetestReclaimV2(bars,cfg={}){
  const c=cfg?.strategies?.retestReclaimV2??cfg?.retestReclaimV2??cfg??{};
  const lookback=Math.max(100,c.lookbackSessions??180),search=c.breakoutSearchSessions??15,retestWindow=c.retestWindowSessions??8,confirmWindow=c.confirmWindowSessions??3,maxSignalAge=c.maxSignalAgeSessions??2;
  if(!Array.isArray(bars)||bars.length<90)return result(false,0,['INSUFFICIENT_HISTORY'],{version:'RETEST_RECLAIM_V2',promotionAllowed:false,status:'INSUFFICIENT_HISTORY'});
  const w=bars.slice(-lookback),n=w.length,last=w.at(-1),a=atr(w,14);
  if(!(a>0&&last?.close>0))return result(false,0,['ATR_UNAVAILABLE'],{version:'RETEST_RECLAIM_V2',promotionAllowed:false,status:'ATR_UNAVAILABLE'});
  const tol=Math.max(last.close*(c.levelTolerancePct??.8)/100,a*(c.levelToleranceAtr??.35));
  const highs=swingPoints(w,c.swingRadius??2).highs,candidates=[];
  for(let j=Math.max(30,n-search-1);j<n-1;j++){
    const priorHighs=highs.filter(x=>x.i<=j-(c.minimumLevelAgeSessions??3));
    const levels=clusterLevels(priorHighs,tol,c.minTouches??2).filter(x=>Math.abs(w[j-1].close-x.level)<=Math.max(tol*2,x.level*.06));
    const b=w[j],pre=w.slice(Math.max(0,j-20),j),baseVol=mean(pre.map(x=>x.volume)),aj=atr(w.slice(0,j+1),14)||a,buffer=aj*(c.breakoutBufferAtr??.20),cp=closePosition(b),vr=baseVol?b.volume/baseVol:null,body=bodyAtr(b,aj);
    for(const levelInfo of levels){
      const level=levelInfo.level;
      const breakoutOk=b.volume>0&&w[j-1]?.close<=level+tol*.20&&b.close>=level+buffer&&finite(vr)&&vr>=(c.minBreakoutVolumeRatio??1.30)&&cp>=(c.minBreakoutClosePosition??.62)&&body>=(c.minBreakoutBodyAtr??.12);
      if(!breakoutOk)continue;
      let retest=null;
      for(let k=j+1;k<=Math.min(n-1,j+retestWindow);k++){
        const r=w[k],depthAtr=(level-r.low)/aj,volVsBreakout=b.volume?r.volume/b.volume:null,volVsBase=baseVol?r.volume/baseVol:null;
        const touched=r.low<=level+tol*.75&&r.high>=level-tol*.75,held=r.close>=level-Math.min(tol*.35,aj*(c.maxRetestCloseBelowAtr??.12)),depthOk=depthAtr<=(c.maxRetestDepthAtr??.65),dry=finite(volVsBreakout)&&volVsBreakout<=(c.maxRetestVolumeVsBreakout??.85)&&(!finite(volVsBase)||volVsBase<=(c.maxRetestVolumeVsBase??1.05));
        if(!(r.volume>0&&touched&&held&&depthOk&&dry))continue;
        const quality=(clamp(100-Math.max(0,depthAtr)*55)*.45)+(clamp((1.05-volVsBreakout)*120)*.35)+(closePosition(r)*100*.20);
        if(!retest||quality>retest.quality)retest={index:k,date:r.date,low:r.low,high:r.high,close:r.close,volume:r.volume,volVsBreakout,volVsBase,depthAtr,quality};
      }
      let reclaim=null;
      if(retest)for(let k=retest.index+1;k<=Math.min(n-1,retest.index+confirmWindow);k++){
        const q=w[k],qBase=mean(w.slice(Math.max(0,k-20),k).map(x=>x.volume)),qVr=qBase?q.volume/qBase:null,trigger=Math.max(level+buffer*.35,retest.high+aj*(c.reclaimAboveRetestAtr??.03));
        if(q.volume>0&&q.close>=trigger&&closePosition(q)>=(c.minReclaimClosePosition??.58)&&(!finite(qVr)||qVr>=(c.minReclaimVolumeRatio??.85))){reclaim={index:k,date:q.date,close:q.close,high:q.high,low:q.low,volumeRatio:qVr,trigger};break;}
      }
      const fresh=Boolean(reclaim&&n-1-reclaim.index<=maxSignalAge),entryRef=reclaim?.close??null,stop=retest?Math.min(retest.low-aj*(c.stopBufferAtr??.12),level-aj*(c.minimumStopBelowLevelAtr??.25)):null,risk=finite(entryRef)&&finite(stop)?entryRef-stop:null,riskPct=risk>0?risk/entryRef*100:null,riskOk=finite(riskPct)&&riskPct>=(c.minRiskPct??2.5)&&riskPct<=(c.maxRiskPct??8),p1=risk>0?entryRef+risk*(c.precisionTargetR??.8):null;
      const score=weightedAvailable([[clamp(levelInfo.touches/4*100),12],[clamp(45+(vr-(c.minBreakoutVolumeRatio??1.30))*70),18],[cp*100,10],[retest?.quality??0,25],[reclaim?clamp(60+(reclaim.volumeRatio??1)*25):0,20],[fresh?100:0,8],[riskOk?100:0,7]])??0;
      candidates.push({pass:Boolean(retest&&reclaim&&fresh&&riskOk),score,levelInfo,breakout:{index:j,date:b.date,close:b.close,volumeRatio:vr,closePosition:cp,bodyAtr:body},retest,reclaim,fresh,entryRef,stop,riskPct,p1,atr:aj});
    }
  }
  const best=candidates.sort((a,b)=>Number(b.pass)-Number(a.pass)||b.score-a.score)[0];
  if(!best)return result(false,0,['NO_QUALIFIED_BREAKOUT'],{version:'RETEST_RECLAIM_V2',promotionAllowed:false,status:'NO_QUALIFIED_BREAKOUT'});
  const reasonCodes=[];if(!best.retest)reasonCodes.push('RETEST_NOT_CONFIRMED');if(best.retest&&!best.reclaim)reasonCodes.push('RECLAIM_NOT_CONFIRMED');if(best.reclaim&&!best.fresh)reasonCodes.push('SIGNAL_STALE');if(best.reclaim&&!finite(best.riskPct))reasonCodes.push('INVALID_RISK');else if(best.reclaim&&!best.pass)reasonCodes.push('RISK_OUTSIDE_RESEARCH_BAND');
  const entryWidth=best.atr*(c.entryZoneWidthAtr??.20),entryLow=best.entryRef?Math.max(best.levelInfo.level,best.entryRef-entryWidth):null,entryHigh=best.entryRef?best.entryRef+entryWidth:null;
  return result(best.pass,best.score,reasonCodes,{version:'RETEST_RECLAIM_V2',promotionAllowed:false,automaticEligibilityImpact:'NONE',status:best.pass?'RETEST_RECLAIM_CONFIRMED':reasonCodes[0]||'FORMING',level:round(best.levelInfo.level,4),touches:best.levelInfo.touches,zone:{from:round(best.levelInfo.level-tol,4),to:round(best.levelInfo.level+tol,4)},breakout:{date:best.breakout.date,close:round(best.breakout.close,4),volumeRatio:round(best.breakout.volumeRatio,2),closePositionPct:round(best.breakout.closePosition*100,1),bodyAtr:round(best.breakout.bodyAtr,2)},retest:best.retest?{date:best.retest.date,low:round(best.retest.low,4),close:round(best.retest.close,4),depthAtr:round(best.retest.depthAtr,2),volumeVsBreakout:round(best.retest.volVsBreakout,2),volumeVsBase:round(best.retest.volVsBase,2)}:null,reclaim:best.reclaim?{date:best.reclaim.date,close:round(best.reclaim.close,4),volumeRatio:round(best.reclaim.volumeRatio,2),trigger:round(best.reclaim.trigger,4),signalAgeSessions:n-1-best.reclaim.index}:null,plan:best.entryRef&&best.stop&&best.p1?{valid:true,entryZone:{from:round(entryLow,4),to:round(entryHigh,4)},referenceEntry:round(best.entryRef,4),stopLoss:round(best.stop,4),riskPct:round(best.riskPct,2),precisionTarget:{r:c.precisionTargetR??.8,price:round(best.p1,4)},targets:[2,3,4].map(r=>({r,price:round(best.entryRef+(best.entryRef-best.stop)*r,4)}))}:null});
}

function compressLows(points,minSep){const out=[];for(const x of points){const p=out.at(-1);if(!p||x.i-p.i>=minSep)out.push({...x});else if(x.value<p.value)out[out.length-1]={...x};}return out;}
function featureAt(bars,end,window=24){
  if(end<window-1)return null;const s=bars.slice(end-window+1,end+1),cl=s.map(x=>Number(x.close)),vol=s.map(x=>Number(x.volume));if(cl.some(x=>!(x>0)))return null;
  const start=cl[0],last=cl.at(-1),hi=Math.max(...s.map(x=>x.high)),lo=Math.min(...s.map(x=>x.low)),a=atr(s,Math.min(14,s.length)),r5=cl.length>5?(last/cl.at(-6)-1)*100:0,rAll=(last/start-1)*100,dd=hi>0?(hi-last)/hi*100:0,range=hi>lo?(last-lo)/(hi-lo):.5,prevVol=mean(vol.slice(-20,-5)),recentVol=mean(vol.slice(-5)),volRatio=prevVol?recentVol/prevVol:1,firstRange=mean(s.slice(0,Math.min(8,s.length)).map(x=>x.high-x.low)),lastRange=mean(s.slice(-5).map(x=>x.high-x.low)),compression=firstRange?lastRange/firstRange:1;
  return {returnWindow:rAll,return5:r5,distanceFromHighPct:dd,rangePosition:range,atrPct:a?Number(a)/last*100:null,volumeRatio:volRatio,rangeCompression:compression};
}
function similarity(a,b){if(!a||!b)return null;const parts=[[a.returnWindow-b.returnWindow,14,1.1],[a.return5-b.return5,8,1],[a.distanceFromHighPct-b.distanceFromHighPct,10,1],[(a.rangePosition-b.rangePosition)*100,35,.9],[a.atrPct-b.atrPct,3,.8],[a.volumeRatio-b.volumeRatio,.75,.7],[a.rangeCompression-b.rangeCompression,.8,.7]];let num=0,den=0;for(const [delta,scale,weight] of parts)if(finite(delta)){num+=Math.min(3,Math.abs(delta)/scale)*weight;den+=weight;}if(!den)return null;return clamp(100*Math.exp(-.72*(num/den)));}
function evaluateForward(bars,start,horizon,targetPct,stopPct){const entry=Number(bars[start]?.close);if(!(entry>0))return null;const target=entry*(1+targetPct/100),stop=entry*(1-stopPct/100),end=Math.min(bars.length-1,start+horizon);let maxAdvance=-Infinity,maxDraw=Infinity;for(let i=start+1;i<=end;i++){const b=bars[i],targetTouched=b.high>=target,stopTouched=b.low<=stop;maxAdvance=Math.max(maxAdvance,(b.high/entry-1)*100);maxDraw=Math.min(maxDraw,(b.low/entry-1)*100);if(stopTouched)return {hit:false,stopped:true,sessions:i-start,maxAdvancePct:maxAdvance,maxDrawdownPct:maxDraw};if(targetTouched)return {hit:true,stopped:false,sessions:i-start,maxAdvancePct:maxAdvance,maxDrawdownPct:maxDraw};}return {hit:false,stopped:false,sessions:null,maxAdvancePct:maxAdvance,maxDrawdownPct:maxDraw};}

export function cyclePatternSimilarityEngine(bars,cfg={}){
  const c=cfg?.strategies?.cyclePatternSimilarity??cfg?.cyclePatternSimilarity??cfg??{},minHistory=c.minHistorySessions??260,maxLookback=c.maxLookbackSessions??1200,minSep=c.minBottomSeparationSessions??18,horizon=c.forwardHorizonSessions??15,targetPct=c.launchTargetPct??6,stopPct=c.failureStopPct??4,window=c.featureWindowSessions??24;
  if(!Array.isArray(bars)||bars.length<minHistory)return result(false,0,['INSUFFICIENT_HISTORY'],{version:'CYCLE_PATTERN_SIMILARITY_V1',promotionAllowed:false,samples:0});
  const w=bars.slice(-maxLookback),n=w.length,lows=compressLows(swingPoints(w,c.swingRadius??3).lows,minSep),lastLow=lows.at(-1);if(!lastLow)return result(false,0,['NO_RECENT_SWING_LOW'],{version:'CYCLE_PATTERN_SIMILARITY_V1',promotionAllowed:false,samples:0});
  const currentAge=n-1-lastLow.i,maxCurrentAge=c.maxCurrentCycleAgeSessions??90;if(currentAge>maxCurrentAge)return result(false,0,['CURRENT_CYCLE_TOO_OLD'],{version:'CYCLE_PATTERN_SIMILARITY_V1',promotionAllowed:false,currentCycleAgeSessions:currentAge,samples:0});
  const current=featureAt(w,n-1,window);if(!current)return result(false,0,['CURRENT_FEATURES_UNAVAILABLE'],{version:'CYCLE_PATTERN_SIMILARITY_V1',promotionAllowed:false,samples:0});
  const analogs=[];
  for(let x=0;x<lows.length-1;x++){
    const low=lows[x],end=low.i+currentAge;if(end<window-1||end+horizon>=n-(c.antiLeakGapSessions??3))continue;const nextLow=lows[x+1];if(nextLow&&end>=nextLow.i)continue;
    const f=featureAt(w,end,window),sim=similarity(current,f);if(!finite(sim)||sim<(c.minimumSimilarity??52))continue;const outcome=evaluateForward(w,end,horizon,targetPct,stopPct);if(!outcome)continue;analogs.push({bottomDate:low.date,asOfDate:w[end].date,similarity:sim,hit:outcome.hit,stopped:outcome.stopped,sessionsToTarget:outcome.hit?outcome.sessions:null,maxAdvancePct:outcome.maxAdvancePct,maxDrawdownPct:outcome.maxDrawdownPct});
  }
  analogs.sort((a,b)=>b.similarity-a.similarity);const selected=analogs.slice(0,c.maxAnalogs??16),minSamples=c.minSamples??6;
  if(selected.length<minSamples)return result(false,clamp(selected.length/minSamples*50),['INSUFFICIENT_SIMILAR_ANALOGS'],{version:'CYCLE_PATTERN_SIMILARITY_V1',promotionAllowed:false,currentCycle:{lastBottomDate:lastLow.date,ageSessions:currentAge},samples:selected.length,analogs:selected.map(x=>({...x,similarity:round(x.similarity,1)}))});
  const weights=selected.map(x=>Math.max(.01,x.similarity/100)**2),weightTotal=weights.reduce((a,b)=>a+b,0),weightedHit=selected.reduce((s,x,i)=>s+(x.hit?weights[i]:0),0)/weightTotal*100,hits=selected.filter(x=>x.hit).length,rawHit=hits/selected.length*100,wilson=wilsonLower(hits,selected.length),medianSim=median(selected.map(x=>x.similarity)),medianSessions=median(selected.filter(x=>x.hit).map(x=>x.sessionsToTarget)),medianAdvance=median(selected.map(x=>x.maxAdvancePct)),medianDraw=median(selected.map(x=>x.maxDrawdownPct));
  const cycleLens=[];for(let i=0;i<lows.length-1;i++){const d=lows[i+1].i-lows[i].i;if(d>=minSep&&d<=(c.maxCycleSessions??180))cycleLens.push(d);}const medCycle=median(cycleLens),sdCycle=std(cycleLens),cycleConsistency=medCycle&&finite(sdCycle)?clamp(100-sdCycle/medCycle*150):50,phaseScore=medCycle?clamp((1-Math.abs(currentAge-medCycle*.45)/Math.max(1,medCycle*.55))*100):50;
  const score=weightedAvailable([[weightedHit,38],[medianSim,24],[wilson,14],[clamp(selected.length/(c.sampleFullScoreAt??12)*100),10],[cycleConsistency,8],[phaseScore,6]])??0,pass=selected.length>=minSamples&&weightedHit>=(c.minWeightedHitPct??62)&&medianSim>=(c.minMedianSimilarity??58)&&score>=(c.minScore??64);
  return result(pass,score,pass?[]:['SIMILARITY_EDGE_NOT_CONFIRMED'],{version:'CYCLE_PATTERN_SIMILARITY_V1',promotionAllowed:false,automaticEligibilityImpact:'NONE',interpretation:'EMPIRICAL_ANALOG_HIT_RATE_NOT_GUARANTEED_PROBABILITY',currentCycle:{lastBottomDate:lastLow.date,lastBottom:round(lastLow.value,4),ageSessions:currentAge,medianHistoricalBottomToBottomSessions:round(medCycle,1),cycleConsistencyScore:round(cycleConsistency,1),phaseScore:round(phaseScore,1)},samples:selected.length,empiricalHitPct:round(rawHit,1),similarityWeightedHitPct:round(weightedHit,1),wilson95LowerHitPct:round(wilson,1),medianSimilarity:round(medianSim,1),medianSessionsToLaunch:round(medianSessions,1),medianForwardMaxAdvancePct:round(medianAdvance,2),medianForwardDrawdownPct:round(medianDraw,2),launchDefinition:{targetPct,stopPct,horizonSessions:horizon,sameBarAmbiguity:'STOP_FIRST'},analogs:selected.map(x=>({bottomDate:x.bottomDate,asOfDate:x.asOfDate,similarity:round(x.similarity,1),hit:x.hit,stopped:x.stopped,sessionsToTarget:x.sessionsToTarget,maxAdvancePct:round(x.maxAdvancePct,2),maxDrawdownPct:round(x.maxDrawdownPct,2)}))});
}
