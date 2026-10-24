'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const STANDARD=Object.freeze({minimumClosedTrades:30,maximumDrawdownPct:10,minimumCleanMarkCoveragePct:100,
  minimumFutureUntouchedSessions:60,minimumIndependentMarketSources:2});
function qualify({research,conflicts,sourceQuality}, {cutoffDate='2026-10-24'}={}){
 if(research?.schemaVersion!=='egx-aqm-central-long-history-research-1')throw Error('Unexpected AQM report schema');
 if(conflicts?.schemaVersion!=='egx-central-price-conflict-attribution-v1')throw Error('Unexpected conflict report schema');
 if(sourceQuality?.schemaVersion!=='egx-central-long-history-restore-quality-1')throw Error('Unexpected long-history quality schema');
 const evidence={sourceFiles:sourceQuality.summary.examined,sourceFilesWith250CleanBars:sourceQuality.summary.retrievedWith250Bars,
  internallyResearchEligible:sourceQuality.summary.structurallyCandidate,
  actuallyReadByAQM:research.coverage.usableSymbols,
  tickersWithUnresolvedPriceConflicts:conflicts.totals.stocksWithConflicts,
  unresolvedDatePriceDisagreements:conflicts.totals.conflictDays,
  historicalCutoffDate:cutoffDate,postFreezeSessionsIndependentlyObserved:0,
  egx30HistoryCertifiedAsOf:false,earningsCertifiedAsOf:false,corporateActionsCertifiedAsOf:false,
  historicalTradeAndHaltEventsCertifiedAsOf:false,sectorClassificationCertifiedAsOf:false,
  crossFeedDisagreementsIndependentlyResolved:false,untouchedForwardOosValidated:false};
 const commonBlockers=['INDEPENDENT_UNTOUCHED_OOS_NOT_OBSERVED',
  'EGX30_FUNDAMENTALS_EVENTS_SECTORS_NOT_VERIFIED_AS_OF',
  'HISTORICAL_CORPORATE_ACTIONS_NOT_OFFICIALLY_CERTIFIED',
  'UNRESOLVED_CROSS_FEED_PRICE_DISAGREEMENTS',
  'HISTORICAL_SOURCE_AND_SURVIVOR_UNIVERSE_RISK'];
 const scenarios=research.results.flatMap(x=>x.strategies.map(s=>{
  const blockers=[...commonBlockers];
  if(s.signals===0)blockers.push('NO_EXECUTABLE_SIGNAL');
  if(s.closedTrades<STANDARD.minimumClosedTrades)blockers.push('INSUFFICIENT_CLOSED_TRADES');
  if(!s.markIntegrity?.completeSessionMarks)blockers.push('STALE_DAILY_VALUATIONS');
  if(!(s.diagnosticReturnPct>0))blockers.push('NON_POSITIVE_RESEARCH_RETURN');
  if(!(s.maximumDiagnosticDrawdownPct<=STANDARD.maximumDrawdownPct))blockers.push('MAXIMUM_DRAWDOWN_EXCEEDED');
  return {liquidityFloorEgp:x.minimumTurnoverEgp,variant:s.variant,
   signals:s.signals,closedTrades:s.closedTrades,diagnosticReturnPct:s.diagnosticReturnPct,
   stalePositionSessions:s.markIntegrity?.stalePositionSessions??null,
   closedTradesEnough:s.closedTrades>=STANDARD.minimumClosedTrades,
   researchPositive:s.diagnosticReturnPct>0,markIntegrityPass:s.markIntegrity?.completeSessionMarks===true,
   capitalEligible:false,blockers};
 }));
 return {schemaVersion:'egx-aqm-single-trading-readiness-gate-v1',generatedAt:new Date().toISOString(),
  status:'BLOCKED_RESEARCH_ONLY',canIssueExecutableBuyRecommendations:false,
  canConnectBrokerOrTradeLive:false,approvedStrategies:0,
  standard:STANDARD,evidence,scenarioCount:scenarios.length,scenarios,
  validationStatement:'No paper-replay historical return has cleared provenance, point-in-time market/fundamental data, complete marks and post-freeze OOS. This is an auditable research gate, not an investment recommendation.'};
}
if(require.main===module){
 const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
 const report=qualify({research:read('data/research/egx-aqm-central-long-history-research-v1.json'),
  conflicts:read('data/research/egx-central-price-conflict-attribution-v1.json'),
  sourceQuality:read('sources/central-ledger/raw-long-history-quality.json')});
 const f=path.join(root,'data/research/egx-aqm-single-trading-readiness-gate-v1.json');fs.writeFileSync(f,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,canIssueExecutableBuyRecommendations:report.canIssueExecutableBuyRecommendations,
  evidence:report.evidence,scenarios:report.scenarios.map(x=>({floor:x.liquidityFloorEgp,variant:x.variant,blockers:x.blockers}))},null,2));
}
module.exports={qualify,STANDARD};
