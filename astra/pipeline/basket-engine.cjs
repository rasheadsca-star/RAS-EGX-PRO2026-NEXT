'use strict';
const {VERSION,CONFIG,round,diagnostic}=require('./g09-shared.cjs');
const {riskPlan}=require('./position-sizing.cjs');

function basketPlan(ranked,capitalEgp,regime,basketSize,portfolioState=null){
  const members=[];const diagnostics=[];
  for(const candidate of ranked){const risk=riskPlan(candidate,capitalEgp,regime,basketSize,portfolioState);if(risk.ok)members.push({...candidate,risk:risk.plan});else diagnostics.push(risk.diagnostic)}
  const totalExposurePct=round(members.reduce((s,m)=>s+m.risk.exposurePct,0),4);
  if(totalExposurePct>CONFIG.productionStrategyApproval.maxTotalExposurePct+1e-9)return{ok:false,members:[],diagnostics:[...diagnostics,diagnostic('BASKET_CONSTRAINT_FAILED','ERROR',{reason:'TOTAL_EXPOSURE_EXCEEDED',totalExposurePct})]};
  return{ok:true,members,diagnostics,basket:{version:VERSION.basket,basketSizeRequested:basketSize,memberCount:members.length,totalExposurePct,cashReservePct:round(100-totalExposurePct,4),maxTotalExposurePct:CONFIG.productionStrategyApproval.maxTotalExposurePct,failedWeightPolicy:CONFIG.productionStrategyApproval.failedWeightPolicy,regime:regime.regime}};
}

module.exports={basketPlan};
