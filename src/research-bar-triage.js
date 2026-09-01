const norm=v=>String(v??'').trim().toUpperCase();

export function validateResearchBarTriageRegistry(registry,{session,expectedTickers=[]}={}){
  const reasons=[];
  if(!registry||typeof registry!=='object') return Object.freeze({state:'BLOCKED',ready:false,reasons:Object.freeze(['REGISTRY_REQUIRED']),productionAuthority:false});
  if(registry.authorityMode!=='RESEARCH_TRIAGE_ONLY') reasons.push('AUTHORITY_MODE_NOT_RESEARCH_TRIAGE_ONLY');
  if(registry.productionAuthority!==false) reasons.push('PRODUCTION_AUTHORITY_MUST_BE_FALSE');
  if(registry.phase4Open!==false) reasons.push('PHASE4_MUST_BE_FALSE');
  if(session&&registry.session!==session) reasons.push('SESSION_MISMATCH');
  const records=Array.isArray(registry.records)?registry.records:[];
  if(!records.length) reasons.push('RECORDS_REQUIRED');
  const tickers=records.map(x=>norm(x?.ticker)).filter(Boolean);
  const isins=records.map(x=>norm(x?.isin)).filter(Boolean);
  if(tickers.length!==records.length) reasons.push('MISSING_TICKER');
  if(isins.length!==records.length) reasons.push('MISSING_ISIN');
  if(new Set(tickers).size!==tickers.length) reasons.push('DUPLICATE_TICKER');
  if(new Set(isins).size!==isins.length) reasons.push('DUPLICATE_ISIN');
  for(const row of records){
    const ticker=norm(row?.ticker)||'UNKNOWN';
    if(!(Number(row?.officialEgx?.volume)>0)) reasons.push(`NONPOSITIVE_OFFICIAL_VOLUME:${ticker}`);
    if(row?.trueOhlcvResearchEligible!==false) reasons.push(`TRUE_OHLCV_RESEARCH_ELIGIBLE_NOT_FALSE:${ticker}`);
    if(!String(row?.state??'').trim()) reasons.push(`STATE_REQUIRED:${ticker}`);
    if(!Array.isArray(row?.blockers)||!row.blockers.length) reasons.push(`BLOCKERS_REQUIRED:${ticker}`);
    if(!Array.isArray(row?.evidence)||!row.evidence.length) reasons.push(`EVIDENCE_REQUIRED:${ticker}`);
    for(const ev of row?.evidence??[]){
      if(!String(ev?.provider??'').trim()) reasons.push(`EVIDENCE_PROVIDER_REQUIRED:${ticker}`);
      if(!String(ev?.url??'').startsWith('https://')) reasons.push(`EVIDENCE_HTTPS_URL_REQUIRED:${ticker}`);
      if(ev?.productionAuthority===true) reasons.push(`EVIDENCE_PRODUCTION_AUTHORITY_FORBIDDEN:${ticker}`);
    }
  }
  if(expectedTickers.length){
    const expected=[...new Set(expectedTickers.map(norm).filter(Boolean))].sort();
    const actual=[...new Set(tickers)].sort();
    const es=new Set(expected),as=new Set(actual);
    const missing=expected.filter(x=>!as.has(x)),unexpected=actual.filter(x=>!es.has(x));
    if(missing.length) reasons.push(`EXPECTED_TICKERS_MISSING:${missing.join(',')}`);
    if(unexpected.length) reasons.push(`UNEXPECTED_TICKERS:${unexpected.join(',')}`);
  }
  const productionTrueOhlcvReady=records.filter(x=>x?.trueOhlcvResearchEligible===true).length;
  if(registry?.summary?.productionTrueOhlcvReady!==0) reasons.push('SUMMARY_PRODUCTION_TRUE_OHLCV_READY_MUST_BE_ZERO');
  if(productionTrueOhlcvReady!==0) reasons.push('TRUE_OHLCV_READY_RECORD_FORBIDDEN');
  return Object.freeze({
    state:reasons.length?'BLOCKED':'READY_RESEARCH_TRIAGE_ONLY',
    ready:reasons.length===0,
    recordCount:records.length,
    productionTrueOhlcvReady,
    reasons:Object.freeze([...new Set(reasons)]),
    productionAuthority:false,
    phase4Open:false
  });
}

export function deriveResearchBarTriageSummary(registry){
  const records=Array.isArray(registry?.records)?registry.records:[];
  return Object.freeze({
    records:records.length,
    openConflict:records.filter(x=>String(x?.state??'').includes('CONFLICT_OPEN')).length,
    microTrade:records.filter(x=>String(x?.state??'').includes('MICRO_TRADE')).length,
    volumeMissing:records.filter(x=>(x?.blockers??[]).some(b=>String(b).includes('VOLUME_MISSING'))).length,
    staleOrIncomplete:records.filter(x=>String(x?.state??'').includes('STALE')||String(x?.state??'').includes('INCOMPLETE')||String(x?.state??'').includes('SESSION_ROW_MISSING')).length,
    trueOhlcvResearchEligible:records.filter(x=>x?.trueOhlcvResearchEligible===true).length,
    productionAuthority:false
  });
}
