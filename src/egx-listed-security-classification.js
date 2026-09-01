function ci(row){return Object.fromEntries(Object.entries(row??{}).map(([k,v])=>[String(k).toLowerCase(),v]))}
function norm(v){return String(v??'').trim().toUpperCase()}
function categorySet(rows){return new Set((Array.isArray(rows)?rows:[]).map(r=>norm(ci(r).symbol_code)).filter(Boolean))}
function evidenceSet(values){
  const rows=Array.isArray(values)?values:values instanceof Set?[...values]:[];
  return new Set(rows.map(v=>norm(typeof v==='object'&&v!==null?v.isin:v)).filter(Boolean));
}
function evidenceMap(values,key='isin'){
  if(values instanceof Map) return new Map([...values].map(([k,v])=>[norm(k),v]));
  const rows=Array.isArray(values)?values:[];
  return new Map(rows.filter(v=>v&&typeof v==='object').map(v=>[norm(v[key]),v]).filter(([k])=>k));
}
function intersection(a,b){return [...a].filter(x=>b.has(x)).sort()}

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

export function describeEgxCategoryTopology(sets){
  const marketSets={MOST_ACTIVE:sets.mostActive??new Set(),MEDIUM_ACTIVITY:sets.medium??new Set(),MEDIUM_NO_MARGIN:sets.mediumNoMargin??new Set(),INACTIVE:sets.inactive??new Set(),SME:sets.sme??new Set()};
  const entries=Object.entries(marketSets), overlaps=[];
  for(let i=0;i<entries.length;i++) for(let j=i+1;j<entries.length;j++){
    const members=intersection(entries[i][1],entries[j][1]);
    if(members.length) overlaps.push(Object.freeze({left:entries[i][0],right:entries[j][0],count:members.length,members:Object.freeze(members)}));
  }
  return Object.freeze({
    membershipCounts:Object.freeze(Object.fromEntries(entries.map(([k,s])=>[k,s.size]))),
    shortSellingCount:sets.shortSelling?.size??0,
    overlaps:Object.freeze(overlaps),
    hasOverlaps:overlaps.length>0
  });
}

function resolveShareClass(instrumentClass,isin,shareClassEvidence){
  if(!['EGYPTIAN_EQUITY','FOREIGN_EQUITY'].includes(instrumentClass)) return 'NOT_APPLICABLE';
  const ev=shareClassEvidence instanceof Map?shareClassEvidence.get(isin):null;
  const declared=norm(ev?.shareClass);
  if(['PREFERRED_CONFIRMED','COMMON_CONFIRMED'].includes(declared)) return declared;
  return 'UNSPECIFIED_EQUITY_SHARE_CLASS';
}

export function classifyEgxListedSecurity(row,sets,{temporaryListingEvidence=new Set(),shareClassEvidence=new Map()}={}){
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

  const shareClass=resolveShareClass(instrumentClass,isin,shareClassEvidence);

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
  const tradableEquityState=['TRADABLE_MOST_ACTIVE','TRADABLE_MEDIUM_ACTIVITY','TRADABLE_MEDIUM_NO_MARGIN'].includes(listingState);
  return Object.freeze({
    isin,
    reuters:String(r.reuters??'').trim(),
    name:String(r.name??'').trim(),
    schedule,
    instrumentClass,
    shareClass,
    ordinaryCommonShareProven:shareClass==='COMMON_CONFIRMED',
    preferredShareProven:shareClass==='PREFERRED_CONFIRMED',
    marketMemberships:Object.freeze(markets),
    specializedEligibility:Object.freeze(specialized),
    listingState,
    intradayFlag:intraday,
    lastTradeDate:r.last_trade_date??null,
    lastPrice:r.last_cp??null,
    lastVolume:r.last_vol??null,
    productionTradableEquityCandidate:instrumentClass==='EGYPTIAN_EQUITY'&&tradableEquityState,
    productionOrdinaryCommonEquityCandidate:instrumentClass==='EGYPTIAN_EQUITY'&&tradableEquityState&&shareClass==='COMMON_CONFIRMED',
    productionAuthority:false
  });
}

export function classifyEgxListedUniverse(stockInfoPayload,categoryPayload,{temporaryListingEvidence=[],smeTamayuzEvidence=[],shareClassEvidence=[],inferSmeNileFromComplement=false}={}){
  const rows=Array.isArray(stockInfoPayload?.data)?stockInfoPayload.data:[];
  const sets=buildEgxCategorySets(categoryPayload);
  const topology=describeEgxCategoryTopology(sets);
  const tempEvidence=evidenceSet(temporaryListingEvidence), tamayuzEvidence=evidenceSet(smeTamayuzEvidence), shareEvidence=evidenceMap(shareClassEvidence);
  const invalidTamayuzEvidence=[...tamayuzEvidence].filter(isin=>!sets.sme.has(isin)).sort();
  const invalidShareClassEvidence=[...shareEvidence.keys()].filter(isin=>!rows.some(r=>norm(ci(r).isin)===isin)).sort();
  const classified=rows.map(r=>classifyEgxListedSecurity(r,sets,{temporaryListingEvidence:tempEvidence,shareClassEvidence:shareEvidence}));
  const byIsin=new Map(classified.map(x=>[x.isin,x]));
  const smeOnly=[];
  for(const isin of [...sets.sme].sort()){
    if(byIsin.has(isin)) continue;
    const marketMemberships=['SME'];
    if(sets.inactive.has(isin)) marketMemberships.push('INACTIVE');
    let smeSegment='UNRESOLVED';
    if(tamayuzEvidence.has(isin)) smeSegment='TAMAYUZ_INDEPENDENT_EVIDENCE';
    else if(inferSmeNileFromComplement&&tamayuzEvidence.size>0&&invalidTamayuzEvidence.length===0) smeSegment='NILE_INFERRED_FROM_OFFICIAL_SME_MINUS_TAMAYUZ';
    smeOnly.push(Object.freeze({
      isin,
      listingState:'SME_IDENTITY_ONLY_FROM_CATEGORY_FEED',
      marketMemberships:Object.freeze(marketMemberships),
      smeSegment,
      productionAuthority:false
    }));
  }
  const counts={}; for(const x of classified) counts[x.listingState]=(counts[x.listingState]??0)+1;
  const instruments={}; for(const x of classified) instruments[x.instrumentClass]=(instruments[x.instrumentClass]??0)+1;
  const shareClasses={}; for(const x of classified.filter(x=>['EGYPTIAN_EQUITY','FOREIGN_EQUITY'].includes(x.instrumentClass))) shareClasses[x.shareClass]=(shareClasses[x.shareClass]??0)+1;
  const egyptianEquities=classified.filter(x=>x.instrumentClass==='EGYPTIAN_EQUITY');
  const equityPartition={}; for(const x of egyptianEquities) equityPartition[x.listingState]=(equityPartition[x.listingState]??0)+1;
  const smeSegmentCounts={}; for(const x of smeOnly) smeSegmentCounts[x.smeSegment]=(smeSegmentCounts[x.smeSegment]??0)+1;
  return Object.freeze({
    state:rows.length?'CLASSIFIED_FAIL_CLOSED':'BLOCKED',
    rows:Object.freeze(classified),
    smeOnly:Object.freeze(smeOnly),
    counts:Object.freeze(counts),
    instrumentCounts:Object.freeze(instruments),
    shareClassCounts:Object.freeze(shareClasses),
    stockInfoEquityPartition:Object.freeze(equityPartition),
    categoryTopology:topology,
    smeSegmentCounts:Object.freeze(smeSegmentCounts),
    invalidTamayuzEvidence:Object.freeze(invalidTamayuzEvidence),
    invalidShareClassEvidence:Object.freeze(invalidShareClassEvidence),
    stockInfoCount:rows.length,
    stockInfoEgyptianEquityCount:egyptianEquities.length,
    smeCategoryCount:sets.sme.size,
    productionTradableEquityCandidateCount:classified.filter(x=>x.productionTradableEquityCandidate).length,
    productionOrdinaryCommonEquityCandidateCount:classified.filter(x=>x.productionOrdinaryCommonEquityCandidate).length,
    preferredShareConfirmedCount:classified.filter(x=>x.preferredShareProven).length,
    unresolvedEquityShareClassCount:classified.filter(x=>x.shareClass==='UNSPECIFIED_EQUITY_SHARE_CLASS').length,
    unresolvedTemporaryEvidenceCount:classified.filter(x=>x.listingState==='UNSEGMENTED_NONTRADING_LISTING_CANDIDATE').length,
    temporaryListingConfirmedCount:classified.filter(x=>x.listingState==='TEMPORARY_LISTING_CONFIRMED').length,
    productionAuthority:false
  });
}
