import { sha256 } from './hash.js';

function integer(v){return Number.isInteger(v)&&v>=0?v:null}
function text(v){return typeof v==='string'?v:''}
function rowIdentity(row){
  const isin=text(row?.isin??row?.isinCode).trim().toUpperCase();
  const ticker=text(row?.reuters??row?.reutersCode??row?.symbol??row?.ticker).trim().toUpperCase();
  return isin||ticker?`${isin}|${ticker}`:null;
}
function envelope(payload){
  const outer=payload&&typeof payload==='object'&&!Array.isArray(payload)?payload:null;
  const inner=outer?.data&&typeof outer.data==='object'&&!Array.isArray(outer.data)?outer.data:null;
  const rows=Array.isArray(inner?.data)?inner.data:null;
  return {outer,inner,rows};
}

export function inspectEgxMarketWatchPage(payload,{requestedPage=null,requestedPageSize=null}={}){
  const reasons=[];
  const {outer,inner,rows}=envelope(payload);
  if(!outer) reasons.push('INVALID_MARKET_WATCH_ENVELOPE');
  if(outer&&outer.success!==true) reasons.push('MARKET_WATCH_NOT_SUCCESSFUL');
  if(!inner) reasons.push('MISSING_PAGINATED_DATA_OBJECT');
  if(!rows) reasons.push('MISSING_MARKET_WATCH_ROWS');
  const innerTotal=integer(inner?.totalCount),outerTotal=integer(outer?.totalCount);
  const pageNumber=integer(inner?.pageNumber??outer?.pageNumber),pageSize=integer(inner?.pageSize??outer?.pageSize),totalPages=integer(inner?.totalPages??outer?.totalPages);
  if(innerTotal===null&&outerTotal===null) reasons.push('MISSING_TOTAL_COUNT');
  if(innerTotal!==null&&outerTotal!==null&&innerTotal!==outerTotal) reasons.push('INNER_OUTER_TOTAL_COUNT_MISMATCH');
  const totalCount=innerTotal??outerTotal;
  if(rows&&totalCount!==null&&rows.length===0&&totalCount>0) reasons.push('EMPTY_PAGE_WITH_POSITIVE_TOTAL_COUNT');
  if(requestedPage!==null&&pageNumber!==requestedPage) reasons.push('PAGE_NUMBER_MISMATCH');
  if(requestedPageSize!==null&&pageSize!==requestedPageSize) reasons.push('PAGE_SIZE_MISMATCH');
  const message=text(outer?.message);
  const match=message.match(/Retrieved\s+(\d+)\s+records\s+out\s+of\s+(\d+)/i);
  if(match){
    const returned=Number(match[1]),messageTotal=Number(match[2]);
    if(rows&&returned!==rows.length) reasons.push('MESSAGE_ROW_COUNT_MISMATCH');
    if(totalCount!==null&&messageTotal!==totalCount) reasons.push('MESSAGE_TOTAL_COUNT_MISMATCH');
  }
  const normalized={pageNumber,pageSize,totalPages,totalCount,rowCount:rows?.length??null,message,rowsHash:rows?sha256(rows):null};
  return Object.freeze({
    state:reasons.length?'SCHEMA_OR_RESPONSE_INCOHERENT':'READY_FOR_RESULT_SET_PAGINATION',
    reasons:[...new Set(reasons)].sort(),
    ...normalized,
    scopeClassification:'UNRESOLVED_BFF_RESULT_SET',
    allListedEquitiesProven:false,
    tradedSessionUniverseProven:false,
    universeAuthorityEligible:false,
    productionAuthority:false
  });
}

export function certifyEgxMarketWatchPagination(pages,{requestedPageSize=10}={}){
  const reasons=[];
  if(!Array.isArray(pages)||!pages.length) return Object.freeze({state:'BLOCKED',reasons:['PAGES_REQUIRED'],rows:[],scopeClassification:'UNRESOLVED_BFF_RESULT_SET',universeAuthorityEligible:false,productionAuthority:false});
  const inspected=pages.map((payload,index)=>inspectEgxMarketWatchPage(payload,{requestedPage:index+1,requestedPageSize}));
  inspected.forEach((r,index)=>{if(r.state!=='READY_FOR_RESULT_SET_PAGINATION') reasons.push(...r.reasons.map(x=>`PAGE_${index+1}:${x}`))});
  const totals=new Set(inspected.map(x=>x.totalCount).filter(x=>x!==null));
  const pageTotals=new Set(inspected.map(x=>x.totalPages).filter(x=>x!==null));
  if(totals.size!==1) reasons.push('TOTAL_COUNT_NOT_STABLE');
  if(pageTotals.size!==1) reasons.push('TOTAL_PAGES_NOT_STABLE');
  const expectedPages=inspected[0]?.totalPages;
  if(expectedPages!==pages.length) reasons.push('PAGINATION_INCOMPLETE');
  const rows=pages.flatMap(p=>envelope(p).rows??[]);
  const totalCount=inspected[0]?.totalCount;
  if(totalCount!==null&&rows.length!==totalCount) reasons.push('FULL_ROW_COUNT_MISMATCH');
  const ids=rows.map(rowIdentity).filter(Boolean);
  if(ids.length!==rows.length) reasons.push('MISSING_ROW_IDENTITY');
  if(new Set(ids).size!==ids.length) reasons.push('DUPLICATE_ROW_IDENTITY');
  return Object.freeze({
    state:reasons.length?'BLOCKED':'READY_FOR_BFF_RESULT_SET_RECONCILIATION',
    reasons:[...new Set(reasons)].sort(),
    rows,
    totalCount:totalCount??null,
    resultSetHash:sha256(rows),
    scopeClassification:'BFF_MARKET_WATCH_RESULT_SET_ONLY',
    allListedEquitiesProven:false,
    tradedSessionUniverseProven:false,
    independentScopeCrossCheckRequired:true,
    universeAuthorityEligible:false,
    productionAuthority:false
  });
}

export function inspectEgxPriceVolumePoints(payload){
  const reasons=[];
  if(!payload||typeof payload!=='object'||Array.isArray(payload)) reasons.push('INVALID_PRICE_VOLUME_ENVELOPE');
  if(payload?.success!==true) reasons.push('PRICE_VOLUME_NOT_SUCCESSFUL');
  if(!Array.isArray(payload?.data)) reasons.push('PRICE_VOLUME_ROWS_REQUIRED');
  const rows=Array.isArray(payload?.data)?payload.data:[];
  const required=['isinCode','tradeDate','closePrice','tradeVolume'];
  for(const [index,row] of rows.entries()) for(const key of required) if(row?.[key]===undefined||row?.[key]===null||row?.[key]==='') reasons.push(`ROW_${index}:MISSING_${key.toUpperCase()}`);
  const hasOpen=rows.some(x=>x?.openPrice!==undefined||x?.open!==undefined),hasHigh=rows.some(x=>x?.highPrice!==undefined||x?.high!==undefined),hasLow=rows.some(x=>x?.lowPrice!==undefined||x?.low!==undefined);
  const fullOhlcv=rows.length>0&&hasOpen&&hasHigh&&hasLow;
  return Object.freeze({
    state:reasons.length?'BLOCKED':'READY_FOR_CLOSE_VOLUME_HISTORY_VALIDATION',
    reasons:[...new Set(reasons)].sort(),
    rowCount:rows.length,
    contentHash:sha256(rows),
    capability:'CLOSE_VOLUME_HISTORY',
    hasClose:true,
    hasVolume:true,
    hasOpen,
    hasHigh,
    hasLow,
    ohlcvComplete:fullOhlcv,
    ohlcvAuthorityEligible:false,
    productionAuthority:false
  });
}
