'use strict';
const {round,diagnostic}=require('./g09-shared.cjs');
const {prepareRisk}=require('./risk-engine.cjs');

function riskPlan(candidate,capitalEgp,regime,basketSize){
  const prepared=prepareRisk(candidate,capitalEgp,regime,basketSize);
  if(!prepared.ok)return prepared;
  const b=prepared.base;
  const riskBudget=b.capitalEgp*b.riskPct/100;
  const byRisk=Math.floor(riskBudget/b.perShareRisk),byExposure=Math.floor((b.capitalEgp*b.memberExposureCapPct/100)/b.entry),quantity=Math.max(0,Math.min(byRisk,byExposure));
  if(!Number.isFinite(quantity)||quantity<=0)return{ok:false,diagnostic:diagnostic('RISK_PLAN_INVALID','ERROR',{ticker:candidate.ticker,reason:'NON_POSITIVE_QUANTITY'})};
  const maxLoss=round(quantity*b.perShareRisk,2),exposureEgp=round(quantity*b.entry,2),exposurePct=round(exposureEgp/b.capitalEgp*100,4);
  if(!(maxLoss>=0&&exposureEgp>=0&&exposurePct>=0&&exposurePct<=b.memberExposureCapPct+1e-9))return{ok:false,diagnostic:diagnostic('RISK_PLAN_INVALID','ERROR',{ticker:candidate.ticker,reason:'EXPOSURE_OR_LOSS_INVALID'})};
  return{ok:true,plan:{riskVersion:b.riskVersion,capitalEgp:b.capitalEgp,riskPct:b.riskPct,entry:b.entry,stopLoss:b.stopLoss,targets:b.targets,perShareRisk:round(b.perShareRisk,4),quantity,maxLossEgp:maxLoss,exposureEgp,exposurePct,memberExposureCapPct:b.memberExposureCapPct,regimeRiskMultiplier:b.regimeRiskMultiplier,units:{capital:'EGP',entry:'EGP_PER_SHARE',stopLoss:'EGP_PER_SHARE',perShareRisk:'EGP_PER_SHARE',maxLossEgp:'EGP',exposureEgp:'EGP',riskPct:'PERCENT',exposurePct:'PERCENT'}}};
}
module.exports={riskPlan};
