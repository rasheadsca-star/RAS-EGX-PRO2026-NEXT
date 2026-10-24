'use strict';
const fs=require('node:fs'),path=require('node:path');
const {loadUniverse}=require('./egx-strategy-challengers-v1.cjs');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
function audit(universe,trades){
 const issues={missingEntry:0,missingExit:0,missingIntermediate:0,nonPositiveEntry:0,exitBeforeEntry:0,unrealisticClosedReturn:0},examples=[];
 const coverage=[],gapDetails=[];
 const marketDates=[...new Set(Object.values(universe).flatMap(rows=>rows.map(r=>r.date)))].sort();
 const genuineMarketGaps=[];
 for(const t of trades){
  const rows=universe[t.ticker]||[],between=rows.filter(x=>x.date>=t.entryDate&&x.date<=t.exitDate),a=between[0],z=between.at(-1);
  const missingEntry=!a||a.date!==t.entryDate,missingExit=!z||z.date!==t.exitDate;
  const dateGap=between.some((x,i)=>i>0&&(Date.parse(x.date)-Date.parse(between[i-1].date)>7*86400000));
  const gaps=between.slice(1).flatMap((x,i)=>{const days=Math.round((Date.parse(x.date)-Date.parse(between[i].date))/86400000);return days>7?[{from:between[i].date,to:x.date,calendarDays:days}]:[]});
  const findings=[];
  if(missingEntry){issues.missingEntry++;findings.push('missingEntry')}
  if(missingExit){issues.missingExit++;findings.push('missingExit')}
  if(dateGap){issues.missingIntermediate++;findings.push('longGapOver7CalendarDays');gapDetails.push({ticker:t.ticker,variant:t.variant,entryDate:t.entryDate,exitDate:t.exitDate,gaps})}
  for(const gap of gaps){const missingMarketDates=marketDates.filter(d=>d>gap.from&&d<gap.to);if(missingMarketDates.length)genuineMarketGaps.push({ticker:t.ticker,variant:t.variant,from:gap.from,to:gap.to,marketSessionsAbsent:missingMarketDates.length,firstMissingDates:missingMarketDates.slice(0,6)})}
  if(a&&a.open<=0){issues.nonPositiveEntry++;findings.push('nonPositiveEntry')}
  if(t.exitDate<t.entryDate){issues.exitBeforeEntry++;findings.push('exitBeforeEntry')}
  if(!Number.isFinite(t.netReturnPct)||Math.abs(t.netReturnPct)>50){issues.unrealisticClosedReturn++;findings.push('returnOutOfBounds')}
  if(findings.length&&examples.length<20)examples.push({ticker:t.ticker,variant:t.variant,entryDate:t.entryDate,exitDate:t.exitDate,gaps,findings});
  coverage.push(between.length);
 }
 return {schemaVersion:'egx-historical-trade-ledger-audit-1',tradeCount:trades.length,issues,examples,gapDetails,marketGapAssessment:{suspiciousGapTrades:gapDetails.length,marketTradingGapInstances:genuineMarketGaps.length,examples:genuineMarketGaps.slice(0,30)},minBarsWithinTrade:coverage.length?Math.min(...coverage):null,conclusion:Object.values(issues).some(x=>x>0)?'REVIEW_REQUIRED':'BASIC_LEDGER_COVERAGE_CHECKS_PASS',limitations:['Missing-intermediate heuristic reports gaps over seven calendar days; weekends and local holidays can have longer gaps','Trade returns, stop/target order, corporate actions and slippage cannot be fully verified from this ledger alone','Coverage check does not certify execution accuracy']};
}
if(require.main===module){const {universe}=loadUniverse(),ledger=JSON.parse(fs.readFileSync(path.join(root,'data/research/egx-comparable-three-strategy-v1.json'),'utf8'));const r=audit(universe,ledger.trades);const p=path.join(root,'data/research/egx-historical-trade-ledger-audit-v1.json');fs.writeFileSync(p,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r,null,2))}
module.exports={audit};
