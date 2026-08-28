(function(root,factory){
const api=factory();
if(typeof module==='object'&&module.exports)module.exports=api;
else root.GFXRegimeGate=api;
})(typeof self!=='undefined'?self:this,function(){
'use strict';

const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number(n)||0));
const round=(n,d=1)=>{const p=10**d;return Math.round((Number(n)||0)*p)/p};

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

function classify(input={}){
  const trend=clamp(input.trendScore??50);
  const breadth=clamp(input.breadthPct??50);
  const vol=volatilityScore(input.volatilityRatio);
  const participation=participationScore(input.participationPct);
  const score=round(trend*.35+breadth*.30+vol*.15+participation*.20,1);
  let regime='RISK_OFF',regimeAr='دفاعي / تجنب المضاربة الجديدة';
  if(score>=65){regime='RISK_ON';regimeAr='اتجاه إيجابي / مشاركة سوق داعمة';}
  else if(score>=40){regime='RANGE';regimeAr='محايد / عرضي';}
  return{regime,regimeAr,score,components:{trendScore:round(trend),breadthPct:round(breadth),volatilityRatio:round(input.volatilityRatio,3),volatilityScore:vol,participationPct:round(input.participationPct),participationScore:participation}};
}

function weightsFor(regime){
  if(regime==='RISK_ON')return{sepaSelection:.30,tradeability:.30,executionQuality:.20,gannTiming:.20};
  if(regime==='RANGE')return{sepaSelection:.40,tradeability:.35,executionQuality:.20,gannTiming:.05};
  return{sepaSelection:0,tradeability:0,executionQuality:0,gannTiming:0};
}

function combine(parts={},regime){
  const w=weightsFor(regime),score=clamp(
    clamp(parts.sepaSelection)*w.sepaSelection+
    clamp(parts.tradeability)*w.tradeability+
    clamp(parts.executionQuality)*w.executionQuality+
    clamp(parts.gannTiming)*w.gannTiming
  );
  return{score:round(score,1),weights:w};
}

return{classify,weightsFor,combine,volatilityScore,participationScore};
});
