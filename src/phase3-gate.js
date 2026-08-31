const BLOCKING_READINESS=new Set(['BLOCKED','STALE','DATA_CONFLICT','CORPORATE_ACTION_REVIEW','SOURCE_UNAVAILABLE']);
const VALID_NONTRADABLE=new Set(['SUSPENDED','ILLIQUID','INSUFFICIENT_HISTORY']);

export function evaluatePhase3Gate({universe,registry,sessionAuthority,acquisitionPlans=[]}={}){
  const blockers=[]; const warnings=[];
  if(!universe||universe.state!=='READY') blockers.push(`UNIVERSE:${universe?.state??'MISSING'}`);
  if(!sessionAuthority||sessionAuthority.state!=='READY') blockers.push(`SESSION_AUTHORITY:${sessionAuthority?.state??'MISSING'}`);
  if(!registry) blockers.push('REGISTRY:MISSING');
  if(blockers.length) return verdict(blockers,warnings,registry);

  const uTickers=universe.rows.map(x=>x.ticker).sort();
  const rTickers=registry.rows.map(x=>x.ticker).sort();
  if(universe.total!==registry.total) blockers.push(`UNIVERSE_REGISTRY_TOTAL_MISMATCH:${universe.total}:${registry.total}`);
  if(JSON.stringify(uTickers)!==JSON.stringify(rTickers)) blockers.push('UNIVERSE_REGISTRY_TICKER_MISMATCH');
  if(universe.asOfDate&&sessionAuthority.currentSession&&universe.asOfDate!==sessionAuthority.currentSession) blockers.push(`UNIVERSE_SESSION_MISMATCH:${universe.asOfDate}:${sessionAuthority.currentSession}`);

  const planByTicker=new Map(acquisitionPlans.map(x=>[x.ticker,x]));
  for(const row of registry.rows){
    if(BLOCKING_READINESS.has(row.readiness)) blockers.push(`${row.ticker}:${row.readiness}`);
    else if(VALID_NONTRADABLE.has(row.readiness)) warnings.push(`${row.ticker}:${row.readiness}`);
    else if(row.readiness!=='READY') blockers.push(`${row.ticker}:UNKNOWN_READINESS:${row.readiness}`);
    if(row.readiness!=='SUSPENDED'){
      const plan=planByTicker.get(row.ticker);
      if(!plan||plan.state!=='READY') blockers.push(`${row.ticker}:ACQUISITION_PLAN:${plan?.state??'MISSING'}`);
    }
  }
  return verdict(blockers,warnings,registry);
}

function verdict(blockers,warnings,registry){
  const counts=registry?.counts??{};
  return Object.freeze({phase:'PHASE_3_DATA_READINESS',verdict:blockers.length?'FAIL':'PASS',baselineAuthorized:blockers.length===0,blockers:[...new Set(blockers)].sort(),warnings:[...new Set(warnings)].sort(),readinessCounts:counts,readyCount:counts.READY??0,total:registry?.total??0});
}
