import { sha256 } from './hash.js';
import { buildResearchFeatureRecord } from './research-feature-engine.js';

export const RESEARCH_STRATEGY_PRESETS=Object.freeze([
  Object.freeze({id:'QUALITY_TREND',minScore:72,strongScore:82,momentumMin:2,momentumMax:30,rsiMin:48,rsiMax:72,relativeVolumeMin:0.8,medianTradedValueMin:3_000_000,atrPctMin:0.7,atrPctMax:6.5,nearHighMin:-8,maxAboveHighPct:8,maxCloseVsSma20Pct:12,requireBreakout:false,target1R:1.6,target2R:2.6,entryExpirySessions:3,horizonSessions:10,minNetRR:1.25}),
  Object.freeze({id:'LIQUID_TREND',minScore:70,strongScore:80,momentumMin:1,momentumMax:25,rsiMin:47,rsiMax:70,relativeVolumeMin:0.7,medianTradedValueMin:10_000_000,atrPctMin:0.6,atrPctMax:5.5,nearHighMin:-10,maxAboveHighPct:6,maxCloseVsSma20Pct:9,requireBreakout:false,target1R:1.45,target2R:2.4,entryExpirySessions:3,horizonSessions:10,minNetRR:1.15}),
  Object.freeze({id:'VOLUME_BREAKOUT',minScore:74,strongScore:83,momentumMin:3,momentumMax:35,rsiMin:50,rsiMax:74,relativeVolumeMin:1.15,medianTradedValueMin:5_000_000,atrPctMin:0.8,atrPctMax:7,nearHighMin:-3,maxAboveHighPct:10,maxCloseVsSma20Pct:14,requireBreakout:true,target1R:1.5,target2R:2.5,entryExpirySessions:2,horizonSessions:8,minNetRR:1.2}),
  Object.freeze({id:'STRICT_QUALITY',minScore:80,strongScore:86,momentumMin:5,momentumMax:22,rsiMin:52,rsiMax:68,relativeVolumeMin:1,medianTradedValueMin:15_000_000,atrPctMin:0.8,atrPctMax:5,nearHighMin:-5,maxAboveHighPct:5,maxCloseVsSma20Pct:8,requireBreakout:false,target1R:1.4,target2R:2.2,entryExpirySessions:3,horizonSessions:10,minNetRR:1.1}),
  Object.freeze({id:'CONTROLLED_PULLBACK',minScore:69,strongScore:79,momentumMin:1,momentumMax:20,rsiMin:46,rsiMax:66,relativeVolumeMin:0.65,medianTradedValueMin:5_000_000,atrPctMin:0.6,atrPctMax:5.5,nearHighMin:-12,maxAboveHighPct:3,maxCloseVsSma20Pct:5.5,requireBreakout:false,target1R:1.5,target2R:2.5,entryExpirySessions:4,horizonSessions:12,minNetRR:1.2})
]);

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null}
function round(v,d=4){return Number.isFinite(Number(v))?Number(Number(v).toFixed(d)):null}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function group(record,name){return record?.groups?.find(g=>g.name===name)?.payload??null}
function validBar(b){const o=finite(b?.open),h=finite(b?.high),l=finite(b?.low),c=finite(b?.close),v=finite(b?.volume);return Boolean(b&&/^\d{4}-\d{2}-\d{2}$/.test(String(b.session??''))&&o>0&&h>0&&l>0&&c>0&&v>=0&&h>=Math.max(o,c)&&l<=Math.min(o,c))}
function readyPrior(history,session){return (history?.sessions??[]).filter(b=>b?.researchState==='READY_RESEARCH'&&String(b.session)<session&&validBar(b)).map(b=>({session:String(b.session),open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close),volume:Number(b.volume)})).sort((a,b)=>a.session.localeCompare(b.session))}
function metricScore(feature){
  const t=group(feature,'TECHNICAL'),l=group(feature,'LIQUIDITY');if(!t||!l)return 0;
  let s=0;
  if(t.close>t.sma20)s+=12;if(t.sma20>t.sma50)s+=12;if(t.close>t.sma50)s+=8;
  if(t.momentum20Pct>=5&&t.momentum20Pct<=22)s+=15;else if(t.momentum20Pct>0&&t.momentum20Pct<=35)s+=9;
  if(t.rsi14>=52&&t.rsi14<=68)s+=13;else if(t.rsi14>=45&&t.rsi14<=74)s+=8;
  if(l.relativeVolume20>=1.5)s+=12;else if(l.relativeVolume20>=1)s+=8;else if(l.relativeVolume20>=0.7)s+=4;
  if(l.medianTradedValue20>=50_000_000)s+=12;else if(l.medianTradedValue20>=15_000_000)s+=9;else if(l.medianTradedValue20>=5_000_000)s+=6;else if(l.medianTradedValue20>=2_000_000)s+=3;
  if(t.breakoutAbovePrior20dHigh)s+=9;else if(t.distanceToPrior20dHighPct>=-4)s+=6;else if(t.distanceToPrior20dHighPct>=-10)s+=3;
  if(t.atrPct>=1&&t.atrPct<=4.5)s+=7;else if(t.atrPct>=0.5&&t.atrPct<=7)s+=4;
  return clamp(s,0,100);
}
function structuralReasons(feature,p){
  const t=group(feature,'TECHNICAL'),l=group(feature,'LIQUIDITY'),r=[];
  if(!t||!l)return ['FEATURE_GROUP_MISSING'];
  if(!(t.close>t.sma20&&t.sma20>t.sma50&&t.close>t.sma50))r.push('TREND_ALIGNMENT_FAILED');
  if(!(t.momentum20Pct>=p.momentumMin&&t.momentum20Pct<=p.momentumMax))r.push('MOMENTUM_WINDOW_FAILED');
  if(!(t.rsi14>=p.rsiMin&&t.rsi14<=p.rsiMax))r.push('RSI_WINDOW_FAILED');
  if(!(l.relativeVolume20>=p.relativeVolumeMin))r.push('RELATIVE_VOLUME_WEAK');
  if(!(l.medianTradedValue20>=p.medianTradedValueMin))r.push('LIQUIDITY_BELOW_THRESHOLD');
  if(!(t.atrPct>=p.atrPctMin&&t.atrPct<=p.atrPctMax))r.push('VOLATILITY_OUTSIDE_WINDOW');
  if(!(t.distanceToPrior20dHighPct>=p.nearHighMin&&t.distanceToPrior20dHighPct<=p.maxAboveHighPct))r.push('PRICE_STRUCTURE_OUTSIDE_WINDOW');
  if(!(t.closeVsSma20Pct>=0&&t.closeVsSma20Pct<=p.maxCloseVsSma20Pct))r.push('ENTRY_TOO_EXTENDED_FROM_SMA20');
  if(p.requireBreakout&&t.breakoutAbovePrior20dHigh!==true)r.push('BREAKOUT_REQUIRED');
  return r;
}

export function buildResearchRecommendation({featureRecord,history,currentRecord,preset=RESEARCH_STRATEGY_PRESETS[0],costBps=40}={}){
  const ticker=String(featureRecord?.ticker??'').toUpperCase(),session=String(featureRecord?.signalSession??'');
  const base={ticker,signalSession:session,authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,automaticOrders:false,strategyId:preset.id};
  if(featureRecord?.featureReady!==true)return Object.freeze({...base,decision:'WATCH',executableResearchPlan:false,reasons:['FEATURE_NOT_READY',...(featureRecord?.reasons??[])],qualityScore:null});
  if(currentRecord?.state!=='READY_RESEARCH'||currentRecord?.authoritativeResearch?.session!==session||!validBar(currentRecord?.authoritativeResearch))return Object.freeze({...base,decision:'WATCH',executableResearchPlan:false,reasons:['CURRENT_RESEARCH_BAR_NOT_READY'],qualityScore:null});
  const t=group(featureRecord,'TECHNICAL'),l=group(featureRecord,'LIQUIDITY'),score=metricScore(featureRecord),reasons=structuralReasons(featureRecord,preset);
  if(score<preset.minScore)reasons.push(`QUALITY_SCORE:${score}<${preset.minScore}`);
  const prior=readyPrior(history,session),atr=finite(t?.atr14),close=finite(t?.close);
  if(prior.length<20||!atr||atr<=0||!close)return Object.freeze({...base,decision:'WATCH',executableResearchPlan:false,reasons:[...reasons,'PLAN_GEOMETRY_INPUT_MISSING'],qualityScore:score});
  if(reasons.length)return Object.freeze({...base,decision:'WATCH',executableResearchPlan:false,reasons,qualityScore:score,diagnostics:{momentum20Pct:t.momentum20Pct,rsi14:t.rsi14,relativeVolume20:l.relativeVolume20,medianTradedValue20:l.medianTradedValue20,atrPct:t.atrPct,distanceToPrior20dHighPct:t.distanceToPrior20dHighPct}});
  const last5=prior.slice(-5),last10=prior.slice(-10),last60=prior.slice(-60),breakout=t.breakoutAbovePrior20dHigh===true;
  const entryLow=Math.max(Number(t.sma20),close-(breakout?0.28:0.48)*atr),entryHigh=close+(breakout?0.10:0.04)*atr,entryMid=(entryLow+entryHigh)/2;
  const recent5Low=Math.min(...last5.map(b=>b.low)),recent10Low=Math.min(...last10.map(b=>b.low));
  const supports=[Number(t.sma20),recent5Low,recent10Low].filter(x=>Number.isFinite(x)&&x<entryLow).sort((a,b)=>b-a);
  let stop=(supports[0]??(entryLow-1.15*atr))-0.22*atr;
  const minRisk=0.85*atr,maxRisk=1.75*atr;let risk=entryMid-stop;
  if(risk<minRisk){stop=entryMid-minRisk;risk=minRisk}if(risk>maxRisk){stop=entryMid-maxRisk;risk=maxRisk}
  const target1=entryMid+preset.target1R*risk,target2=entryMid+preset.target2R*risk;
  const cost=entryMid*(Number(costBps)/10000),netReward=target1-entryMid-2*cost,netRisk=entryMid-stop+2*cost,netRR=netRisk>0?netReward/netRisk:null;
  if(!(stop<entryLow&&entryLow<=entryHigh&&entryHigh<target1&&target1<target2)||!(netRR>=preset.minNetRR))return Object.freeze({...base,decision:'WATCH',executableResearchPlan:false,reasons:['EXECUTION_GEOMETRY_OR_NET_RR_FAILED'],qualityScore:score,netRiskReward:round(netRR)});
  const prior20High=Math.max(...prior.slice(-20).map(b=>b.high)),prior60High=Math.max(...last60.map(b=>b.high));
  const decision=score>=preset.strongScore?'BUY_CANDIDATE':'WAIT_FOR_ENTRY';
  const stable={...base,decision,executableResearchPlan:true,reasons:[],qualityScore:score,entryLow:round(entryLow),entryHigh:round(entryHigh),stop:round(stop),target1:round(target1),target2:round(target2),grossRiskReward:round((target1-entryMid)/risk),netRiskReward:round(netRR),entryExpirySessions:preset.entryExpirySessions,horizonSessions:preset.horizonSessions,costAssumptionBps:Number(costBps),targetBasis:'OUT_OF_SAMPLE_CALIBRATED_R_MULTIPLE',diagnostics:{close:round(close),sma20:round(t.sma20),sma50:round(t.sma50),rsi14:round(t.rsi14),atr14:round(atr),atrPct:round(t.atrPct),momentum20Pct:round(t.momentum20Pct),momentum60Pct:round(t.momentum60Pct),relativeVolume20:round(l.relativeVolume20),medianTradedValue20:round(l.medianTradedValue20,2),distanceToPrior20dHighPct:round(t.distanceToPrior20dHighPct),breakoutAbovePrior20dHigh:Boolean(breakout),recent5Low:round(recent5Low),recent10Low:round(recent10Low),prior20High:round(prior20High),prior60High:round(prior60High)}};
  return Object.freeze({...stable,planHash:sha256(stable)});
}

export function simulateResearchPlan(plan,futureBars=[]){
  if(plan?.executableResearchPlan!==true)return Object.freeze({state:'NOT_ELIGIBLE',rMultiple:null});
  const bars=(futureBars??[]).filter(validBar).slice(0,plan.horizonSessions),expiry=Math.min(plan.entryExpirySessions,bars.length);let trigger=-1;
  for(let i=0;i<expiry;i++){if(bars[i].low<=plan.entryHigh&&bars[i].high>=plan.entryLow){trigger=i;break}}
  if(trigger<0)return Object.freeze({state:'NOT_TRIGGERED',rMultiple:0});
  const fill=Number(plan.entryHigh),risk=fill-Number(plan.stop);if(!(risk>0))return Object.freeze({state:'INVALID_PLAN',rMultiple:null});
  for(let i=trigger;i<bars.length;i++){
    const b=bars[i],stopHit=b.low<=plan.stop,t1Hit=b.high>=plan.target1,t2Hit=b.high>=plan.target2;
    if(stopHit)return Object.freeze({state:'STOP',triggerOffset:trigger,exitOffset:i,fill:round(fill),exit:round(plan.stop),rMultiple:-1});
    if(t2Hit)return Object.freeze({state:'TARGET2',triggerOffset:trigger,exitOffset:i,fill:round(fill),exit:round(plan.target2),rMultiple:round((plan.target2-fill)/risk)});
    if(t1Hit)return Object.freeze({state:'TARGET1',triggerOffset:trigger,exitOffset:i,fill:round(fill),exit:round(plan.target1),rMultiple:round((plan.target1-fill)/risk)});
  }
  const last=bars.at(-1);return Object.freeze({state:'TIMEOUT',triggerOffset:trigger,exitOffset:bars.length-1,fill:round(fill),exit:round(last?.close),rMultiple:last?round((last.close-fill)/risk):0});
}

export function summarizeOutcomes(outcomes=[]){
  const eligible=outcomes.filter(x=>x&&x.state!=='NOT_ELIGIBLE'&&x.state!=='INVALID_PLAN'),triggered=eligible.filter(x=>!['NOT_TRIGGERED'].includes(x.state)),wins=triggered.filter(x=>x.state==='TARGET1'||x.state==='TARGET2'),stops=triggered.filter(x=>x.state==='STOP'),timeouts=triggered.filter(x=>x.state==='TIMEOUT'),rs=triggered.map(x=>Number(x.rMultiple)).filter(Number.isFinite);const pos=rs.filter(x=>x>0).reduce((a,b)=>a+b,0),neg=Math.abs(rs.filter(x=>x<0).reduce((a,b)=>a+b,0));
  return Object.freeze({eligible:eligible.length,triggered:triggered.length,notTriggered:eligible.length-triggered.length,target1OrBetter:wins.length,target2:wins.filter(x=>x.state==='TARGET2').length,stops:stops.length,timeouts:timeouts.length,target1HitRatePct:triggered.length?round(wins.length/triggered.length*100,2):0,stopRatePct:triggered.length?round(stops.length/triggered.length*100,2):0,expectancyR:rs.length?round(rs.reduce((a,b)=>a+b,0)/rs.length,4):0,profitFactor:neg>0?round(pos/neg,3):(pos>0?999:null)});
}

export function buildHistoricalFeature({ticker,history,currentBar,decisionCutoff}){
  const signalSession=String(currentBar.session),currentRecord={ticker,state:'READY_RESEARCH',authoritativeResearch:{...currentBar,rowHash:sha256(currentBar)}};
  return buildResearchFeatureRecord({ticker,history,currentRecord,signalSession,decisionCutoff,minPriorSessions:60,corporateActionJumpPct:20.5});
}
