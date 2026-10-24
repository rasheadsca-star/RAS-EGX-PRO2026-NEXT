'use strict';
const fs=require('node:fs'),path=require('node:path');
if(process.env.EGX_ENABLE_LIVE_TRADING==='true')throw Error('No live trading with central research archive');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const {loadResearchOnlyCentral}=require('./egx-central-research-ohlcv-gateway-v1.cjs');
const {computeSignals,replay}=require('./egx-aqm-research-v1.cjs');
function evaluateResearch(){
 const r=loadResearchOnlyCentral();
 const strict=computeSignals(r.universe,{marketMode:'strict'});
 const diagnostics=[];
 for(const liquidity of [30000000,10000000]){
  const scan=computeSignals(r.universe,{marketMode:'technicalDiagnostic',liquidityEgp:liquidity});
  const strategies=['aqm_pullback','aqm_breakout'].map(variant=>{
   const x=replay(r.universe,scan.signals,variant,{riskPerTradePct:.5});
   return {variant,signals:scan.signals.filter(s=>s.variant===variant).length,closedTrades:x.closedTrades,
    diagnosticReturnPct:x.portfolioReturnPct,certifiedReturnPct:x.reportableCertifiedPortfolioReturnPct,
    markIntegrity:x.markIntegrity,maximumDiagnosticDrawdownPct:x.maxDrawdownPct,staleMarks:x.staleMarkSessions,
    openPositions:x.openPositions,winRatePct:x.winRatePct,qualification:'RESEARCH_ONLY_NOT_CERTIFIED'}
  });
  diagnostics.push({minimumTurnoverEgp:liquidity,strategies,assessedTradeDates:scan.datesWithLongHistory});
 }
 return {schemaVersion:'egx-aqm-central-long-history-research-1',generatedAt:new Date().toISOString(),
  input:'egx-research-ledger/raw-long-history-gzip/*.json.gz',
  provenance:'Existing V17 10-year source collector and reconciliation quality report',
  coverage:r.audit,
  strictSignals:strict.signals.length,productionEligible:false,independentOOS:false,marksMustBeFreshForCertification:true,
  results:diagnostics,limitations:r.limitations.concat([
   'Only 33 of the 242 rehydrated source files initially pass internal matching rules; this is NOT a complete contemporaneous EGX universe',
   'The central history was retrieved and inspected before this diagnostic, so no date is a newly untouched historical holdout',
   'Any apparent positive return must be separately checked for cross-universe survivor bias, source conflicts and price continuity'] )};
}
if(require.main===module){const x=evaluateResearch();fs.writeFileSync(path.join(root,'data/research/egx-aqm-central-long-history-research-v1.json'),JSON.stringify(x,null,2)+'\n');console.log(JSON.stringify({centralUsableSymbols:x.coverage.usableSymbols,strictSignals:x.strictSignals,results:x.results,productionEligible:x.productionEligible},null,2))}
module.exports={evaluateResearch};
