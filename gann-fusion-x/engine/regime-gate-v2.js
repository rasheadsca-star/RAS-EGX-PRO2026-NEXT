(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.GFXRegimeGateV2=api;
})(typeof self!=='undefined'?self:this,function(){
'use strict';

const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number(n)||0));
const round=(n,d=2)=>{const x=Number(n);if(!Number.isFinite(x))return null;const p=10**d;return Math.round(x*p)/p};

function volatilityScore(ratio){
  const r=Number(ratio);
  if(!Number.isFinite(r)||r<=0)return 50;
  if(r<=0.85)return 100;
  if(r<=1.00)return 80;
  if(r<=1.20)return 60;
  if(r<=1.50)return 40;
  return 20;
}
function participationScore(pct){
  const p=Number(pct)||0;
  if(p>=15)return 100;
  if(p>=10)return 80;
  if(p>=6)return 65;
  if(p>=3)return 50;
  if(p>=1)return 35;
  return 20;
}
function baseScore(stats={}){
  const trend=clamp(stats.trendScore??50),breadth=clamp(stats.breadthPct??50);
  const vol=volatilityScore(stats.volatilityRatio),participation=participationScore(stats.participationPct);
  return round(trend*.35+breadth*.30+vol*.15+participation*.20,1);
}
function deteriorationSignals(current={},previous={}){
  const currScore=baseScore(current),prevScore=baseScore(previous);
  const breadthDelta=round((Number(current.breadthPct)||0)-(Number(previous.breadthPct)||0),2);
  const participationDelta=round((Number(current.participationPct)||0)-(Number(previous.participationPct)||0),2);
  const trendDelta=round((Number(current.trendScore)||0)-(Number(previous.trendScore)||0),2);
  const volatilityDelta=round((Number(current.volatilityRatio)||0)-(Number(previous.volatilityRatio)||0),3);
  const scoreDelta=round(currScore-prevScore,2);
  const sma20SlopePct=Number.isFinite(Number(current.sma20SlopePct))?Number(current.sma20SlopePct):0;
  const flags={
    breadthFalling:breadthDelta<=-8,
    participationFalling:participationDelta<=-1.5,
    trendWeakening:trendDelta<=-10||sma20SlopePct<=-0.5,
    volatilityRising:volatilityDelta>=0.15||Number(current.volatilityRatio)>=1.25,
    regimeScoreFalling:scoreDelta<=-7
  };
  const count=Object.values(flags).filter(Boolean).length;
  return{count,flags,deltas:{breadthDelta,participationDelta,trendDelta,volatilityDelta,scoreDelta,sma20SlopePct:round(sma20SlopePct,3)}};
}
function classify(current={},previous={}){
  const score=baseScore(current),det=deteriorationSignals(current,previous);
  let regime='RISK_OFF',regimeAr='دفاعي / تجنب المضاربة الجديدة';
  if(score>=65){
    if(det.count>=2){regime='RISK_ON_DETERIORATING';regimeAr='إيجابي ظاهريًا لكن الزخم السوقي يتدهور';}
    else{regime='RISK_ON';regimeAr='اتجاه إيجابي / مشاركة سوق داعمة';}
  }else if(score>=40){regime='RANGE';regimeAr='محايد / عرضي';}
  return{regime,regimeAr,score,deterioration:det,components:{trendScore:round(current.trendScore,1),breadthPct:round(current.breadthPct,1),participationPct:round(current.participationPct,1),volatilityRatio:round(current.volatilityRatio,3),sma20SlopePct:round(current.sma20SlopePct,3)}};
}
function weightsFor(regime){
  if(regime==='RISK_ON')return{sepaSelection:.30,tradeability:.30,executionQuality:.20,gannTiming:.20};
  if(regime==='RISK_ON_DETERIORATING')return{sepaSelection:.40,tradeability:.35,executionQuality:.20,gannTiming:.05};
  if(regime==='RANGE')return{sepaSelection:.40,tradeability:.35,executionQuality:.20,gannTiming:.05};
  return{sepaSelection:0,tradeability:0,executionQuality:0,gannTiming:0};
}
function combine(parts={},regime){
  const w=weightsFor(regime);
  const score=clamp(clamp(parts.sepaSelection)*w.sepaSelection+clamp(parts.tradeability)*w.tradeability+clamp(parts.executionQuality)*w.executionQuality+clamp(parts.gannTiming)*w.gannTiming);
  return{score:round(score,1),weights:w};
}
function allowTiming(regime,timingGrade,tradeability){
  if(regime==='RISK_OFF')return false;
  if(regime==='RISK_ON_DETERIORATING')return timingGrade!=='B'&&Number(tradeability)>=65;
  return Number(tradeability)>=55;
}
return{classify,baseScore,deteriorationSignals,weightsFor,combine,allowTiming,volatilityScore,participationScore};
});
