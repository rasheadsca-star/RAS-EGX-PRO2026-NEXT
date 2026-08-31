import { sha256 } from './hash.js';
import { stampResearchRecord,assertResearchOnly } from './research-source-policy.js';

const MONTHS=new Map([['january',1],['february',2],['march',3],['april',4],['may',5],['june',6],['july',7],['august',8],['september',9],['october',10],['november',11],['december',12]]);
function n(v){if(v==null||v==='')return null;const x=Number(String(v).replace(/,/g,'').replace(/[^0-9.+-]/g,''));return Number.isFinite(x)?x:null}
function ticker(v){return String(v??'').trim().toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9._-]/g,'')}
function validBar(x){return x&&x.open>0&&x.high>0&&x.low>0&&x.close>0&&x.high>=x.open&&x.high>=x.close&&x.high>=x.low&&x.low<=x.open&&x.low<=x.close&&(x.volume==null||x.volume>=0)}
function pct(a,b){return a>0&&b>0?Math.abs(a/b-1)*100:null}
function cairoDateFromUnix(ts){if(!Number.isFinite(ts))return null;const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ts*1000)).reduce((a,x)=>(a[x.type]=x.value,a),{});return p.year&&p.month&&p.day?`${p.year}-${p.month}-${p.day}`:null}
function text(html){return String(html??'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,'\n').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n').trim()}
function parseDate(v){const s=String(v??'').trim();const iso=s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);if(iso)return `${iso[1]}-${iso[2]}-${iso[3]}`;const m=s.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);if(!m)return null;const mon=MONTHS.get(m[2].toLowerCase());return `${m[3]}-${String(mon).padStart(2,'0')}-${String(Number(m[1])).padStart(2,'0')}`}

export function parseYahooResearchPayload(payload,{ticker:inputTicker,requestedSymbol=`${ticker(inputTicker)}.CA`,sourceUrl=null,fetchedAt=null}={}){
  const result=payload?.chart?.result?.[0];if(payload?.chart?.error||!result)return{state:'BLOCKED',reasons:['YAHOO_CHART_RESULT_MISSING'],sessions:[],meta:null};
  const meta=result.meta??{},returned=String(meta.symbol??'').toUpperCase(),expected=String(requestedSymbol).toUpperCase(),currency=String(meta.currency??'').toUpperCase();
  const exchangeText=[meta.exchangeName,meta.fullExchangeName,meta.exchangeTimezoneName,meta.timezone].filter(Boolean).join(' ');
  const reasons=[];if(returned!==expected)reasons.push(`YAHOO_SYMBOL_MISMATCH:${returned||'MISSING'}`);if(currency&&currency!=='EGP')reasons.push(`YAHOO_CURRENCY_MISMATCH:${currency}`);if(!/(cai|cairo|egypt|egx)/i.test(exchangeText)&&!expected.endsWith('.CA'))reasons.push('YAHOO_EXCHANGE_NOT_CONFIRMED');
  if(reasons.length)return{state:'BLOCKED',reasons,sessions:[],meta};
  const quote=result.indicators?.quote?.[0]??{},adj=result.indicators?.adjclose?.[0]?.adjclose??[],timestamps=Array.isArray(result.timestamp)?result.timestamp:[],rows=[];
  for(let i=0;i<timestamps.length;i++){
    const bar={ticker:ticker(inputTicker),session:cairoDateFromUnix(n(timestamps[i])),open:n(quote.open?.[i]),high:n(quote.high?.[i]),low:n(quote.low?.[i]),close:n(quote.close?.[i]),adjustedClose:n(adj?.[i]),volume:n(quote.volume?.[i]),currency:currency||'EGP',sourceUrl,fetchedAt};
    if(!bar.session||!validBar(bar))continue;
    const stamped=stampResearchRecord({...bar,researchState:'READY_RESEARCH',verificationState:'SINGLE_SOURCE',rowHash:sha256(bar)},{sourceId:'YAHOO_RESEARCH'});assertResearchOnly(stamped);rows.push(stamped);
  }
  return{state:rows.length?'READY':'SOURCE_UNAVAILABLE',reasons:rows.length?[]:['YAHOO_NO_VALID_SESSIONS'],sessions:rows,meta:{symbol:returned,currency:currency||null,exchangeText}};
}

export function parseMubasherStockPage(html,{ticker:inputTicker,sourceUrl=null,fetchedAt=null}={}){
  const s=text(html),t=ticker(inputTicker),title=s.match(new RegExp(`(?:^|\\n)[^\\n]*\\(${t}\\)(?:\\n|$)`,'i'));
  const after=s.match(/Last update:\s*([^\n]*)\n\s*([0-9][0-9,.]*)/i);const last=n(after?.[2]);
  const find=(label)=>n(s.match(new RegExp(`(?:^|\\n)${label}\\s+([0-9][0-9,.]*)`,'i'))?.[1]);
  const row={ticker:t,session:null,open:find('Open'),previousClose:find('Previous Close'),high:find('High'),low:find('Low'),close:last,volume:find('Volume'),turnover:find('Turnover'),sourceUrl,fetchedAt,marketTimeText:after?.[1]?.trim()||null};
  const reasons=[];if(!title)reasons.push('MUBASHER_TICKER_IDENTITY_NOT_FOUND');if(!validBar(row))reasons.push('MUBASHER_INVALID_OHLCV');
  return{state:reasons.length?'BLOCKED':'READY_WITHOUT_SESSION',reasons,row};
}

export function parseMubasherVolumeStatistics(html){
  const s=text(html);const dateText=s.match(/(?:^|\n)Last Update\s*(?:\||:)??\s*([^\n]+)/i)?.[1]?.trim()||null;const volume=n(s.match(/(?:^|\n)Volume\s*(?:\||:)??\s*([0-9][0-9,]*)/i)?.[1]);return{session:parseDate(dateText),dateText,volume};
}

export function bindMubasherSession(stockResult,stats,{volumeTolerancePct=0.5}={}){
  if(stockResult?.state!=='READY_WITHOUT_SESSION'||!stockResult.row)return{state:'BLOCKED',reasons:['MUBASHER_STOCK_ROW_NOT_READY'],observation:null};
  const reasons=[];if(!stats?.session)reasons.push('MUBASHER_EXPLICIT_SESSION_MISSING');const volumeConflict=pct(stockResult.row.volume,stats?.volume);if(volumeConflict==null||volumeConflict>volumeTolerancePct)reasons.push(`MUBASHER_VOLUME_EVIDENCE_MISMATCH:${volumeConflict==null?'NA':volumeConflict.toFixed(4)}%`);
  if(reasons.length)return{state:'BLOCKED',reasons,observation:null};
  const body={...stockResult.row,session:stats.session,volumeEvidence:stats.volume,volumeEvidenceDateText:stats.dateText,researchState:'READY_RESEARCH',verificationState:'EXPLICIT_SESSION_VOLUME_MATCH'};const stamped=stampResearchRecord({...body,rowHash:sha256(body)},{sourceId:'MUBASHER_RESEARCH'});assertResearchOnly(stamped);return{state:'READY',reasons:[],observation:stamped};
}

export function reconcileResearchObservations({ticker:inputTicker,yahooObservation=null,mubasherObservation=null,maxCloseConflictPct=1,maxVolumeConflictPct=20}={}){
  const t=ticker(inputTicker),reasons=[];if(!yahooObservation&&!mubasherObservation)return{state:'SOURCE_UNAVAILABLE',reasons:['NO_RESEARCH_OBSERVATIONS'],ticker:t,session:null,authoritativeResearch:null,evidence:null};
  const sessions=[yahooObservation?.session,mubasherObservation?.session].filter(Boolean);const latest=[...sessions].sort().at(-1)??null;
  let selected=yahooObservation?.session===latest?yahooObservation:(mubasherObservation?.session===latest?mubasherObservation:null);let verificationState=selected?.sourceId==='YAHOO_RESEARCH'?'SINGLE_SOURCE_YAHOO':'SINGLE_SOURCE_MUBASHER';
  const comparisons={closeConflictPct:null,volumeConflictPct:null};
  if(yahooObservation&&mubasherObservation&&yahooObservation.session===mubasherObservation.session){
    comparisons.closeConflictPct=pct(yahooObservation.close,mubasherObservation.close);comparisons.volumeConflictPct=pct(yahooObservation.volume,mubasherObservation.volume);
    if(comparisons.closeConflictPct!=null&&comparisons.closeConflictPct>maxCloseConflictPct)reasons.push(`CLOSE_CONFLICT:${comparisons.closeConflictPct.toFixed(4)}%`);
    if(comparisons.volumeConflictPct!=null&&comparisons.volumeConflictPct>maxVolumeConflictPct)reasons.push(`VOLUME_CONFLICT:${comparisons.volumeConflictPct.toFixed(4)}%`);
    selected=yahooObservation;verificationState='YAHOO_MUBASHER_CROSSCHECK';
  } else if(yahooObservation&&mubasherObservation) reasons.push(`SESSION_MISMATCH:YAHOO=${yahooObservation.session}:MUBASHER=${mubasherObservation.session}`);
  const conflicting=reasons.some(x=>x.startsWith('CLOSE_CONFLICT:')||x.startsWith('VOLUME_CONFLICT:'));
  const body={...(selected??{}),ticker:t,researchState:conflicting?'QUARANTINED_RESEARCH':'READY_RESEARCH',verificationState,quarantineReasons:conflicting?[...reasons]:[],researchReconciliation:{sources:[yahooObservation?.sourceId,mubasherObservation?.sourceId].filter(Boolean),comparisons,reasons:[...reasons]}};
  delete body.rowHash;const authoritativeResearch=stampResearchRecord({...body,rowHash:sha256(body)},{sourceId:selected?.sourceId??'YAHOO_RESEARCH'});
  return{state:conflicting?'DATA_CONFLICT':'READY_RESEARCH',reasons,ticker:t,session:authoritativeResearch.session,authoritativeResearch,evidence:{yahoo:yahooObservation,mubasher:mubasherObservation,comparisons}};
}

async function fetchText(url,{timeoutMs=15000}={}){const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(timeoutMs),headers:{accept:'text/html,application/xhtml+xml,application/json,*/*','accept-language':'en-US,en;q=0.9','cache-control':'no-cache','user-agent':'Mozilla/5.0 EGX-ONE-Research/0.5'}});if(!r.ok)throw new Error(`HTTP_${r.status}`);return{url:r.url,text:await r.text()}}
export async function fetchYahooResearch(t,{range='1mo',timeoutMs=15000}={}){const symbol=`${ticker(t)}.CA`,q=`range=${encodeURIComponent(range)}&interval=1d&events=history&includeAdjustedClose=true`;let lastError;for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){const url=`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${q}`;try{const r=await fetch(url,{signal:AbortSignal.timeout(timeoutMs),headers:{accept:'application/json','user-agent':'Mozilla/5.0 EGX-ONE-Research/0.5'}});if(!r.ok)throw new Error(`HTTP_${r.status}`);return parseYahooResearchPayload(await r.json(),{ticker:t,requestedSymbol:symbol,sourceUrl:r.url,fetchedAt:new Date().toISOString()})}catch(e){lastError=e}}return{state:'SOURCE_UNAVAILABLE',reasons:[`YAHOO_FETCH_FAILED:${lastError?.message??'UNKNOWN'}`],sessions:[]}}
export async function fetchMubasherResearch(t,{timeoutMs=15000}={}){const base=`https://english.mubasher.info/markets/EGX/stocks/${encodeURIComponent(ticker(t))}`;try{const [stock,stats]=await Promise.all([fetchText(base,{timeoutMs}),fetchText(`${base}/volume-statistics`,{timeoutMs})]);return bindMubasherSession(parseMubasherStockPage(stock.text,{ticker:t,sourceUrl:stock.url,fetchedAt:new Date().toISOString()}),parseMubasherVolumeStatistics(stats.text))}catch(e){return{state:'SOURCE_UNAVAILABLE',reasons:[`MUBASHER_FETCH_FAILED:${e.message}`],observation:null}}}
