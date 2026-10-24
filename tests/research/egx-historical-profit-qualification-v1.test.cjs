'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessQualification}=require('../../scripts/research/egx-historical-profit-qualification-v1.cjs');
test('positive event ledger does not qualify negative market-to-market portfolio',()=>{
 const x=assessQualification({filtered:[{variant:'trend_pullback',totalReturnPct:10}]},{periods:{all:{totalReturnPct:-1,markToMarketMaxDrawdownPct:12,staleMarks:2},laterDiagnosticNotIndependentOOS:{totalReturnPct:-4,executedTrades:7}}});
 assert.equal(x.qualified,false);assert.equal(x.checks.eventLedgerPortfolioPositive,true);assert.equal(x.checks.markToMarketWholePeriodPositive,false);
});
test('never claim untouched independent validation from previously inspected historical slice',()=>{
 const x=assessQualification({filtered:[{variant:'trend_pullback',totalReturnPct:12}]},{periods:{all:{totalReturnPct:8,markToMarketMaxDrawdownPct:4,staleMarks:0},laterDiagnosticNotIndependentOOS:{totalReturnPct:2,executedTrades:40}}});
 assert.equal(x.checks.independentHistoricalValidation,false);assert.equal(x.qualified,false);
});
