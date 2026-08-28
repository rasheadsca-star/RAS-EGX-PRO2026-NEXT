(function(root,factory){
const api=factory();
if(typeof module==='object'&&module.exports)module.exports=api;else root.GFXRegimeGateV3=api;
})(typeof self!=='undefined'?self:this,function(){
'use strict';
const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number(n)||0));
const round=(n,d=2)=>{const x=Number(n);if(!Number.isFinite(x))return null;const p=10**d;return Math.round(x*p)/p};
function volatilityScore(r){r=Number(r);if(!Number.isFinite(r)||r<=0)return 50;if(r<=.85)return 100;if(r<=1)return 80;if(r<=1.2)return 60;if(r<=1.5)return 40;return 20}
function participationScore(p){p=Number(p)||0;if(p>=15)return 100;if(p>=10)return 80;if(p>=6)return 65;if(p>=3)return 50;if(p>=1)return 35;return 20}
function baseScore(s={}){return round(clamp(s.trendScore??50)*.35+clamp(s.breadthPct??50)*.30+volatilityScore(s.volatilityRatio)*.15+participationScore(s.participationPct)*.20,1)}
function deterioration(current={},previous={}){
 const curr=baseScore(current),prev=baseScore(previous);
 const breadthDelta=(Number(current.breadthPct)||0)-(Number(previous.breadthPct)||0);
 const participationDelta=(Number(current.participationPct)||0)-(Number(previous.participationPct)||0);
 const trendDelta=(Number(current.trendScore)||0)-(Number(previous.trendScore)||0);
 const volatilityDelta=(Number(current.volatilityRatio)||0)-(Number(previous.volatilityRatio)||0);
 const scoreDelta=curr-prev;
 const slope=Number(current.sma20SlopePct)||0;
 const flags={breadthFalling:breadthDelta<=-8,participationFalling:participationDelta<=-1.5,trendWeakening:trendDelta<=-10||slope<=-.5,volatilityRising:volatilityDelta>=.15,regimeScoreFalling:scoreDelta<=-7};
 return{count:Object.values(flags).filter(Boolean).length,flags,highVolatility:Number(current.volatilityRatio)>=1.25,deltas:{breadthDelta:round(breadthDelta),participationDelta:round(participationDelta),trendDelta:round(trendDelta),volatilityDelta:round(volatilityDelta,3),scoreDelta:round(scoreDelta),sma20SlopePct:round(slope,3)}};
}
function classify(current={},previous={}){
 const score=baseScore(current),det=deterioration(current,previous);let regime='RISK_OFF';
 if(score>=65)regime=det.count>=2?'RISK_ON_DETERIORATING':'RISK_ON';else if(score>=40)regime='RANGE';
 return{regime,score,deterioration:det,components:{trendScore:round(current.trendScore,1),breadthPct:round(current.breadthPct,1),participationPct:round(current.participationPct,1),volatilityRatio:round(current.volatilityRatio,3),sma20SlopePct:round(current.sma20SlopePct,3)}};
}
function decide(regimeInfo={},timingGrade){
 const r=regimeInfo.regime,grade=timingGrade||null,highVol=Boolean(regimeInfo.deterioration?.highVolatility);
 if(r==='RISK_OFF')return{action:'BLOCK',sizeMultiplier:0,reasonCode:'REGIME_RISK_OFF'};
 if(r==='RANGE')return grade==='A'?{action:'REDUCE_SIZE',sizeMultiplier:.5,reasonCode:'RANGE_A_ONLY'}:{action:'WAIT',sizeMultiplier:0,reasonCode:'RANGE_WAIT_CONFIRMATION'};
 if(r==='RISK_ON_DETERIORATING')return grade==='A'?{action:'REDUCE_SIZE',sizeMultiplier:.5,reasonCode:'DETERIORATING_A_ONLY'}:{action:'WAIT',sizeMultiplier:0,reasonCode:'DETERIORATING_WAIT'};
 if(highVol)return{action:'REDUCE_SIZE',sizeMultiplier:.5,reasonCode:'HIGH_VOLATILITY'};
 return{action:'ALLOW',sizeMultiplier:1,reasonCode:'RISK_ON_ALLOW'};
}
return{baseScore,deterioration,classify,decide,volatilityScore,participationScore};
});
