'use strict';
const {VERSION}=require('./g09-shared.cjs');

function agreementFor(signal,evidenceItems,farm,regime){
  const independent=evidenceItems.filter(x=>x.independent).length;
  const families=[...new Set(evidenceItems.map(x=>x.evidenceFamily))].sort();
  const contradictionFlags=[];
  const liquidity=evidenceItems.find(x=>x.evidenceType==='TURNOVER20');if(liquidity&&!liquidity.value.passed)contradictionFlags.push('LIQUIDITY_CONTRADICTION');
  if(['RISK_OFF','HIGH_VOLATILITY'].includes(regime.regime))contradictionFlags.push('REGIME_RISK_REDUCTION');
  if(independent<2)contradictionFlags.push('LOW_EVIDENCE_DIVERSITY');
  return{agreementVersion:VERSION.agreement,strategiesEvaluated:farm.productionStrategyIds.length,eligibleStrategies:1,positive:1,neutral:0,negativeRejecting:0,unavailableInsufficientData:0,agreementCount:1,disagreement:0,rawEvidenceCount:evidenceItems.length,independentEvidenceCount:independent,evidenceFamilies:families,contradictionFlags};
}

module.exports={agreementFor};
