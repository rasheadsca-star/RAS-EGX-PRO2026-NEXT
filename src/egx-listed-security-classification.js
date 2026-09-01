function ci(row){return Object.fromEntries(Object.entries(row??{}).map(([k,v])=>[String(k).toLowerCase(),v]))}
function norm(v){return String(v??'').trim().toUpperCase()}
function categorySet(rows){return new Set((Array.isArray(rows)?rows:[]).map(r=>norm(ci(r).symbol_code)).filter(Boolean))}

export function buildEgxCategorySets(payload){
  const data=payload?.data&&typeof payload.data==='object'?payload.data:payload;
  return Object.freeze({
    mostActive:categorySet(data?.categoryA),
    medium:categorySet(data?.categoryB),
    mediumNoMargin:categorySet(data?.categoryC),
    inactive:categorySet(data?.categoryD),
    shortSelling:categorySet(data?.shortSelling),
    sme:categorySet(data?.sme)
  });
}

export function classifyEgxListedSecurity(row,sets,{temporaryListingEvidence=new Set()}={}){
  const r=ci(row), isin=norm(r.isin), schedule=String(r.schedule??'').trim();
  const markets=[];
  if(sets.mostActive?.has(isin)) markets.push('MOST_ACTIVE');
  if(sets.medium?.has(isin)) markets.push('MEDIUM_ACTIVITY');
  if(sets.mediumNoMargin?.has(isin)) markets.push('MEDIUM_NO_MARGIN');
  if(sets.inactive?.has(isin)) markets.push('INACTIVE');
  if(sets.sme?.has(isin)) markets.push('SME');
  const specialized=[];
  if(sets.shortSelling?.has(isin)) specialized.push('SHORT_SELLING_ELIGIBLE');

  let instrumentClass='UNKNOWN';
  if(schedule==='Egyptian securities-Stocks') instrumentClass='EGYPTIAN_EQUITY';
  else if(schedule==='Foreign securities-Stocks') instrumentClass='FOREIGN_EQUITY';
  else if(schedule==='Egyptian securities-Funds') instrumentClass='FUND_CERTIFICATE';
  else if(schedule==='ETF') instrumentClass='ETF';
  else if(schedule==='Trading Rights issue') instrumentClass='RIGHTS_ISSUE';

  let listingState='UNRESOLVED';
  if(instrumentClass==='RIGHTS_ISSUE') listingState='RIGHTS';
  else if(instrumentClass==='EGYPTIAN_EQUITY'&&markets.includes('MOST_ACTIVE')) listingState='TRADABLE_MOST_ACTIVE';
  else if(instrumentClass==='EGYPTIAN_EQUITY'&&markets.includes('MEDIUM_ACTIVITY')) listingState='TRADABLE_MEDIUM_ACTIVITY';
  else if(instrumentClass==='EGYPTIAN_EQUITY'&&markets.includes('MEDIUM_NO_MARGIN')) listingState='TRADABLE_MEDIUM_NO_MARGIN';
  else if(instrumentClass==='EGYPTIAN_EQUITY'&&markets.includes('INACTIVE')) listingState='INACTIVE_LISTED_EQUITY';
  else if(instrumentClass==='EGYPTIAN_EQUITY'&&markets.includes('SME')) listingState='SME_LISTED_EQUITY';
  else if(instrumentClass==='EGYPTIAN_EQUITY'&&markets.length===0){
    listingState=temporaryListingEvidence.has(isin)?'TEMPORARY_LISTING_CONFIRMED':'UNSEGMENTED_NONTRADING_LISTING_CANDIDATE';
  } else if(markets.length) listingState='LISTED_SPECIAL_INSTRUMENT';

  const intraday=String(r.intraday??'').toUpperCase()==='Y';
  return Object.freeze({
    isin,
    reuters:String(r.reuters??'').trim(),
    name:String(r.name??'').trim(),
    schedule,
    instrumentClass,
    marketMemberships:markets,
    specializedEligibility:specialized,
    listingState,
    intradayFlag:intraday,
    lastTradeDate:r.last_trade_date??null,
    lastPrice:r.last_cp??null,
    lastVolume:r.last_vol??null,
    productionTradableEquityCandidate:
      instrumentClass==='EGYPTIAN_EQUITY'&&['TRADABLE_MOST_ACTIVE','TRADABLE_MEDIUM_ACTIVITY','TRADABLE_MEDIUM_NO_MARGIN'].includes(listingState),
    productionAuthority:false
  });
}

export function classifyEgxListedUniverse(stockInfoPayload,categoryPayload,{temporaryListingEvidence=[]}={}){
  const rows=Array.isArray(stockInfoPayload?.data)?stockInfoPayload.data:[];
  const sets=buildEgxCategorySets(categoryPayload);
  const evidence=new Set(temporaryListingEvidence.map(norm));
  const classified=rows.map(r=>classifyEgxListedSecurity(r,sets,{temporaryListingEvidence:evidence}));
  const byIsin=new Map(classified.map(x=>[x.isin,x]));
  const smeOnly=[];
  for(const isin of sets.sme){
    if(!byIsin.has(isin)) smeOnly.push(Object.freeze({isin,listingState:'SME_IDENTITY_ONLY_FROM_CATEGORY_FEED',marketMemberships:['SME'],productionAuthority:false}));
  }
  const counts={}; for(const x of classified) counts[x.listingState]=(counts[x.listingState]??0)+1;
  const instruments={}; for(const x of classified) instruments[x.instrumentClass]=(instruments[x.instrumentClass]??0)+1;
  return Object.freeze({
    state:rows.length?'CLASSIFIED_FAIL_CLOSED':'BLOCKED',
    rows:classified,
    smeOnly,
    counts:Object.freeze(counts),
    instrumentCounts:Object.freeze(instruments),
    stockInfoCount:rows.length,
    smeCategoryCount:sets.sme.size,
    productionTradableEquityCandidateCount:classified.filter(x=>x.productionTradableEquityCandidate).length,
    unresolvedTemporaryEvidenceCount:classified.filter(x=>x.listingState==='UNSEGMENTED_NONTRADING_LISTING_CANDIDATE').length,
    productionAuthority:false
  });
}
