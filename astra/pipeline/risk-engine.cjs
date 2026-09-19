'use strict';
const {VERSION,CONFIG,assertFiniteUnit,diagnostic}=require('./g09-shared.cjs');

function prepareRisk(candidate,capitalEgp,regime,basketSize){
  const entry=assertFiniteUnit(candidate.signal.entry.high,'entry',{positive:true}),stop=assertFiniteUnit(candidate.signal.stopLoss,'stopLoss',{positive:true});
  if(!(stop<entry))return{ok:false,diagnostic:diagnostic('RISK_PLAN_INVALID','ERROR',{ticker:candidate.ticker,reason:'STOP_NOT_BELOW_ENTRY'})};
  const perShareRisk=entry-stop;if(!(perShareRisk>0))return{ok:false,diagnostic:diagnostic('RISK_PLAN_INVALID','ERROR',{ticker:candidate.ticker,reason:'PER_SHARE_RISK_INVALID'})};
  const riskPct=regime.maxTradeRiskPct;if(!(riskPct>0))return{ok:false,diagnostic:diagnostic('RISK_PLAN_INVALID','ERROR',{ticker:candidate.ticker,reason:'REGIME_RISK_PERCENT_INVALID'})};
  const memberExposureCapPct=CONFIG.productionStrategyApproval.maxTotalExposurePct/basketSize;
  return{ok:true,base:{riskVersion:VERSION.risk,capitalEgp,riskPct,entry,stopLoss:stop,targets:candidate.signal.targets,perShareRisk,memberExposureCapPct,regimeRiskMultiplier:regime.riskMultiplier}};
}
module.exports={prepareRisk};
