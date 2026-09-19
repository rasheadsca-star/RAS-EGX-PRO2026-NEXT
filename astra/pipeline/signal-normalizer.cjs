'use strict';

function normalizeCandidateSignals(execution){
  return(execution?.rawOutput?.candidates||[]).map(c=>({ticker:c.ticker,strategyExecutionId:execution.strategyExecutionId,strategyId:execution.strategyId,strategyVersion:execution.strategyVersion,rawSignal:'V16_9_BASKET_MEMBER',normalizedSignal:'BUY',rawScore:c.sourceSelectionScore,entry:{low:c.entryLow,high:c.entryHigh},stopLoss:c.stopLoss,targets:[c.target1],originalDiagnostics:execution.diagnostics,sourceCandidate:c}));
}

module.exports={normalizeCandidateSignals};
