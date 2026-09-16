'use strict';
const strict=require('./g08-strict-overlay.cjs');
const core=require('./g08-internal-strategies.cjs');
const SOURCE_COMMIT='1ed10bc0e3c1d19659d12b7daebc4c06a6a41f61';
const SOURCE_PATH='scripts/quant/v13-4-quant-engine.cjs';
const POLICY_PATH='data/v13-4-quant-policy.json';
const STRATEGIES=new Set(['TREND_FOLLOW','BREAKOUT','PULLBACK']);
const clone=x=>JSON.parse(JSON.stringify(x));
const round=(x,d=1)=>Number.isFinite(Number(x))?Number(Number(x).toFixed(d)):null;
const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,Number(x)||0));
const finite=(x,d=null)=>Number.isFinite(Number(x))?Number(x):d;
const V13_VARIANTS=Object.freeze({
 TREND_FOLLOW:Object.freeze({
  balanced:{id:'balanced',minRsi:50,maxRsi:70,minVolumeRatio:.8,minRelativeStrength20:0,minResistanceUpsidePct:1.5},
  strict:{id:'strict',minRsi:52,maxRsi:68,minVolumeRatio:1,minRelativeStrength20:2,minResistanceUpsidePct:2},
  momentum:{id:'momentum',minRsi:55,maxRsi:72,minVolumeRatio:1.2,minRelativeStrength20:3,minResistanceUpsidePct:.5}
 }),
 BREAKOUT:Object.freeze({
  early:{id:'early',breakoutBufferPct:0,minVolumeRatio:1,minRsi:52,maxRsi:75,minRelativeStrength20:0},
  balanced:{id:'balanced',breakoutBufferPct:.2,minVolumeRatio:1.2,minRsi:55,maxRsi:75,minRelativeStrength20:1},
  strict:{id:'strict',breakoutBufferPct:.5,minVolumeRatio:1.5,minRsi:58,maxRsi:72,minRelativeStrength20:2}
 }),
 PULLBACK:Object.freeze({
  wide:{id:'wide',maxDistanceSma20Pct:3.5,minRsi:40,maxRsi:62,minVolumeRatio:.6,minRelativeStrength20:-3},
  balanced:{id:'balanced',maxDistanceSma20Pct:2.5,minRsi:42,maxRsi:60,minVolumeRatio:.7,minRelativeStrength20:-2},
  strict:{id:'strict',maxDistanceSma20Pct:1.8,minRsi:45,maxRsi:58,minVolumeRatio:.9,minRelativeStrength20:0}
 })
});
const DEFAULT_VARIANT=Object.freeze({TREND_FOLLOW:'balanced',BREAKOUT:'balanced',PULLBACK:'balanced'});
const SPECS=Object.fromEntries(Object.entries(strict.SPECS).map(([k,v])=>[k,clone(v)]));
for(const id of STRATEGIES){
 SPECS[id]={...SPECS[id],sourceCommit:SOURCE_COMMIT,sourcePaths:[SOURCE_PATH,POLICY_PATH],minimumBars:56,preferredBars:80,parameters:{...SPECS[id].parameters,defaultVariant:DEFAULT_VARIANT[id],variants:V13_VARIANTS[id],featureWarmupSessions:55,minimumAverageTurnover20Egp:100000,minimumNonZeroVolumeSessions20:8,minimumLatestVolumeRatio:.6},parameterProvenance:[{parameter:'variants',sourceCommit:SOURCE_COMMIT,sourcePath:POLICY_PATH,strategyVersion:'13.4.0'},{parameter:'scoring',sourceCommit:SOURCE_COMMIT,sourcePath:SOURCE_PATH,strategyVersion:'13.4.0'}]};
}
function semantic(spec,input,variant,out){
 const identity={snapshotId:input?.snapshot?.snapshotId||null,sessionDate:input?.snapshot?.sessionDate||null,ticker:input?.snapshot?.ticker||null,historyHash:core.hash((input?.history||[]).map(r=>({sessionDate:r.sessionDate||r.date,close:r.close??r.ohlc?.close,volume:r.volume,turnover:r.turnover,validationStatus:r.validationStatus,migrationValidationStatus:r.migrationValidationStatus}))),variant};
 const raw={...out,legacyVariant:variant};
 const h={strategyId:spec.strategyId,strategyVersion:`${SOURCE_COMMIT}:${variant}`,config:V13_VARIANTS[spec.strategyId][variant],inputIdentity:identity,rawOutput:raw};
 const executionHash=core.hash(h);
 return{strategyExecutionId:`G08-${executionHash.slice(0,24)}`,strategyId:spec.strategyId,strategyVersion:`${SOURCE_COMMIT}:${variant}`,eligibility:out.eligible?'ELIGIBLE':'INELIGIBLE',eligibilityReason:out.reason||null,rawSignal:out.rawSignal,normalizedSignal:out.normalizedSignal,rawScore:out.rawScore,componentScores:out.components||{},evidenceItems:out.evidenceItems||[],entryData:null,stopData:null,targets:[],invalidation:null,warnings:out.warnings||[],diagnostics:out.diagnostics||[],provenance:{sourceEngine:'V13_4_QUANT_ENGINE',sourceBranch:'main',sourceCommit:SOURCE_COMMIT,sourcePaths:[SOURCE_PATH,POLICY_PATH],reconstructionStatus:'RECONSTRUCTED',legacyVariant:variant},executionHash};
}
function conditionMap(input,variant,id){
 const i=input.indicators||{};
 const history=input.history||[];
 const nonZero=finite(i.nonZeroVolumeSessions20,history.slice(-20).filter(r=>finite(r.volume,0)>0).length);
 const turnover=finite(i.avgTurnover20,finite(i.averageTurnover20Egp,0));
 const atr14=finite(i.atr14,finite(input.atr14));
 const common={warmup:history.length>=56,turnover:turnover>=100000,volumeSessions:nonZero>=8,volumeRatioFloor:finite(i.volumeRatio20,0)>=.6,atr:finite(atr14,0)>0&&finite(i.atrPct,0)>0,relativeStrength:finite(i.relativeStrength20,-Infinity)>=variant.minRelativeStrength20};
 if(id==='TREND_FOLLOW')return{...common,trendStructure:finite(i.close)>finite(i.sma20)&&finite(i.sma20)>finite(i.sma50),sma20Slope:finite(i.sma20Slope5Pct,-Infinity)>0,rsiRange:finite(i.rsi14)>=variant.minRsi&&finite(i.rsi14)<=variant.maxRsi,volumeRatio:finite(i.volumeRatio20)>=variant.minVolumeRatio,resistanceRoom:finite(i.resistanceUpsidePct,-Infinity)>=variant.minResistanceUpsidePct||finite(i.breakoutPct,-Infinity)>0};
 if(id==='BREAKOUT')return{...common,trendStructure:finite(i.close)>finite(i.sma20)&&finite(i.sma20)>finite(i.sma50),breakout:finite(i.breakoutPct,-Infinity)>=variant.breakoutBufferPct,volumeRatio:finite(i.volumeRatio20)>=variant.minVolumeRatio,rsiRange:finite(i.rsi14)>=variant.minRsi&&finite(i.rsi14)<=variant.maxRsi,positiveClose:finite(i.return1,-Infinity)>0};
 const near=finite(i.distanceSma20Pct,-Infinity)>=-1.5&&finite(i.distanceSma20Pct,Infinity)<=variant.maxDistanceSma20Pct;
 return{...common,trendStructure:finite(i.close)>finite(i.sma50)&&finite(i.sma20)>finite(i.sma50),nearSma20:near,touchedZone:finite(i.low,input?.snapshot?.ohlc?.low)<=finite(i.sma20)*1.015,rsiRange:finite(i.rsi14)>=variant.minRsi&&finite(i.rsi14)<=variant.maxRsi,rsiRecovery:finite(i.rsi14)>finite(i.previousRsi14,Infinity),volumeRatio:finite(i.volumeRatio20)>=variant.minVolumeRatio};
}
function score(id,input){
 const i=input.indicators||{};
 if(id==='TREND_FOLLOW')return round(clamp(25*(finite(i.close)>finite(i.sma20)&&finite(i.sma20)>finite(i.sma50)?1:0)+clamp(finite(i.sma20Slope5Pct,0)*8,0,15)+clamp(15-Math.abs(finite(i.rsi14,50)-60)*.8,0,15)+clamp(finite(i.volumeRatio20,0)*10,0,15)+clamp(finite(i.relativeStrength20,0)*2+8,0,20)+clamp(finite(i.resistanceUpsidePct,0)*2,0,10)),1);
 if(id==='BREAKOUT')return round(clamp(20*(finite(i.close)>finite(i.sma20)&&finite(i.sma20)>finite(i.sma50)?1:0)+clamp(finite(i.breakoutPct,0)*12+12,0,25)+clamp(finite(i.volumeRatio20,0)*12,0,20)+clamp(15-Math.abs(finite(i.rsi14,60)-64)*.7,0,15)+clamp(finite(i.relativeStrength20,0)*2+8,0,20)),1);
 return round(clamp(25*(finite(i.close)>finite(i.sma50)&&finite(i.sma20)>finite(i.sma50)?1:0)+clamp(20-Math.abs(finite(i.distanceSma20Pct,0))*6,0,20)+clamp(15-Math.abs(finite(i.rsi14,50)-50)*.8,0,15)+(finite(i.rsi14)>finite(i.previousRsi14,Infinity)?15:0)+clamp(finite(i.relativeStrength20,0)*2+8,0,15)+clamp(finite(i.volumeRatio20,0)*7,0,10)),1);
}
function executeV13(id,input={},config={}){
 const spec=SPECS[id];
 const q=core.quarantine(input,spec);
 if(q)return semantic(spec,input,config.variant||DEFAULT_VARIANT[id],{eligible:false,reason:q.code,rawSignal:'UNKNOWN',normalizedSignal:'UNKNOWN',rawScore:null,components:{},diagnostics:[{code:q.code,detail:q.detail}]});
 const requested=String(config.variant||input.strategyVariant||DEFAULT_VARIANT[id]);
 const variant=V13_VARIANTS[id][requested];
 if(!variant)return semantic(spec,input,requested,{eligible:false,reason:'UNKNOWN_HISTORICAL_VARIANT',rawSignal:'UNKNOWN',normalizedSignal:'UNKNOWN',rawScore:null,components:{},diagnostics:[{code:'UNKNOWN_HISTORICAL_VARIANT',detail:{strategyId:id,variant:requested}}]});
 const parts=conditionMap(input,variant,id);const pass=Object.values(parts).every(Boolean);
 return semantic(spec,input,requested,{eligible:pass,reason:pass?'RULES_PASSED':'STRATEGY_CONDITION_FAILED',rawSignal:pass?'BUY':'NO_SIGNAL',normalizedSignal:pass?'BUY':'NO_SIGNAL',rawScore:score(id,input),components:parts,diagnostics:pass?[]:[{code:'STRATEGY_CONDITION_FAILED',failed:Object.entries(parts).filter(([,v])=>!v).map(([k])=>k)}]});
}
function executeStrategy(id,input={},config={}){if(STRATEGIES.has(id))return executeV13(id,input,config);return strict.executeStrategy(id,input,config)}
module.exports={SPECS,executeStrategy,V13_VARIANTS,DEFAULT_VARIANT,executeV13};
