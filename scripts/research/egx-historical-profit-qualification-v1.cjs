'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const policy=Object.freeze({minimumLaterTrades:30,maximumMarkToMarketDrawdownPct:10,requireNonnegativeWholePeriod:true,requirePositiveLaterDiagnostic:true,requireNoStaleMarks:true,requireUntouchedIndependentValidation:true});
function assessQualification(regime,markToMarket){
 const exploratory=(regime?.filtered||[]).find(x=>x.variant==='trend_pullback');
 const all=markToMarket?.periods?.all,later=markToMarket?.periods?.laterDiagnosticNotIndependentOOS;
 if(!exploratory||!all||!later)throw Error('Missing research results for qualification gate');
 const flags={
  eventLedgerPortfolioPositive:exploratory.totalReturnPct>0,
  markToMarketWholePeriodPositive:all.totalReturnPct>0,
  laterDiagnosticPositive:later.totalReturnPct>0,
  laterHasMinimumTrades:later.executedTrades>=policy.minimumLaterTrades,
  drawdownAcceptable:all.markToMarketMaxDrawdownPct<=policy.maximumMarkToMarketDrawdownPct,
  noStaleMarkSubstitutions:all.staleMarks===0,
  independentHistoricalValidation:false
 };
 return {schemaVersion:'egx-historical-profit-qualification-v1',researchOnly:true,qualified:false,reason:Object.entries(flags).filter(([,ok])=>!ok).map(([key])=>key),requirements:policy,checks:flags,results:{eventLedgerPortfolioReturnPct:exploratory.totalReturnPct,wholePeriodMarkedToMarketReturnPct:all.totalReturnPct,laterDiagnosticReturnPct:later.totalReturnPct,laterTradeCount:later.executedTrades,wholePeriodMaxDrawdownPct:all.markToMarketMaxDrawdownPct,staleMarks:all.staleMarks},note:'Historical slice is already viewed, so positive subsequent tests on the same slice cannot be called untouched OOS. Research gate stays closed until a genuinely unexamined period becomes available.'};
}
if(require.main===module){
 const regime=JSON.parse(fs.readFileSync(path.join(root,'data/research/egx-topfour-breadth-regime-v1.json'),'utf8'));
 const mtm=JSON.parse(fs.readFileSync(path.join(root,'data/research/egx-pullback-breadth-mtm-diagnostic-v1.json'),'utf8'));
 const r=assessQualification(regime,mtm),file=path.join(root,'data/research/egx-historical-profit-qualification-v1.json');
 fs.writeFileSync(file,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r,null,2));
}
module.exports={assessQualification};
