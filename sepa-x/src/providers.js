import { DEFAULT_CONFIG } from './config.js';
import { n } from './math.js';

const cache = globalThis.__SEPA_X_FETCH_CACHE__ ?? (globalThis.__SEPA_X_FETCH_CACHE__ = new Map());
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

export async function fetchJson(url, cfg=DEFAULT_CONFIG, {ttlMs=cfg.cache.ttlMs}={}) {
  const cached=cache.get(url), now=Date.now();
  if(cached?.expiresAt>now)return cached.data;
  let last;
  for(let i=0;i<=cfg.cache.retries;i++){
    const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),cfg.cache.timeoutMs);
    try{
      const r=await fetch(url,{headers:{'user-agent':'SEPA-X/1.0'},signal:ctl.signal});
      if(!r.ok){const e=new Error(`HTTP_${r.status}`);e.status=r.status;throw e;}
      const data=await r.json(); cache.set(url,{data,expiresAt:Date.now()+ttlMs}); return data;
    }catch(e){last=e;const retryable=e?.name==='AbortError'||e?.status===429||Number(e?.status)>=500||!e?.status;if(retryable&&i<cfg.cache.retries)await sleep(150*(2**i));else break;}
    finally{clearTimeout(timer);}
  }
  throw new Error(`FETCH_FAILED:${url}:${last?.message||'unknown'}`);
}

export class MarketDataProvider {
  constructor(cfg=DEFAULT_CONFIG){this.cfg=cfg;this.repo=cfg.market.repo;this.branch=cfg.market.universeSourceBranch;this.longHistoryBranch=cfg.market.longHistorySourceBranch||this.branch;}
  raw(path, branch=this.branch){return `https://raw.githubusercontent.com/${this.repo}/${branch}/${path}`;}
  async loadContext(){
    const paths=[
      ['symbolMap','data/symbol-map.json'],
      ['historySummary','data/history-summary.json'],
      ['fundamentals','data/v17/historical-recovery/fundamentals/current.json'],
      ['news','data/v17/historical-recovery/news/current.json'],
      ['longHistory','data/v17/historical-recovery/long-history/compact-market.json'],
      ['corporateActions','data/v17/historical-recovery/long-history/corporate-action-audit.json'],
      ['yahooOverrides','data/v17/historical-recovery/long-history/yahoo-mapping-overrides.json'],
    ];
    const out={};
    await Promise.all(paths.map(async([k,p])=>{try{out[k]=await fetchJson(this.raw(p),this.cfg);}catch{out[k]=null;}}));
    return out;
  }
  buildUniverse(ctx){
    const sm=ctx.symbolMap||{};
    const entries=Array.isArray(sm)?sm:(sm.symbols||sm.items||Object.values(sm));
    const summaryMap=new Map((ctx.historySummary?.symbols||[]).map(x=>[String(x.ticker).toUpperCase(),x]));
    const fundamentalMap=new Map((ctx.fundamentals?.results||[]).map(x=>[String(x.ticker).toUpperCase(),x]));
    const newsMap=new Map((ctx.news?.results||[]).map(x=>[String(x.ticker).toUpperCase(),x]));
    const longMap=new Map((ctx.longHistory?.results||[]).map(x=>[String(x.ticker).toUpperCase(),x]));
    const corpRows=ctx.corporateActions?.results||ctx.corporateActions?.symbols||[];
    const corpMap=new Map((Array.isArray(corpRows)?corpRows:[]).map(x=>[String(x.ticker).toUpperCase(),x]));
    const overrides=ctx.yahooOverrides?.mappings||ctx.yahooOverrides||{};
    return entries.filter(x=>x?.ticker&&x.active!==false).map(x=>{
      const ticker=String(x.ticker).toUpperCase(), summary=summaryMap.get(ticker)||null, override=overrides?.[ticker]||null;
      return {...x,...(override||{}),ticker,summary,fundamentals:fundamentalMap.get(ticker)||null,news:newsMap.get(ticker)||null,longHistory:longMap.get(ticker)||null,corporateAction:corpMap.get(ticker)||null};
    });
  }
  async loadShortHistory(ticker){
    return fetchJson(this.raw(`data/history/${ticker}.json`),this.cfg);
  }
  async loadOriginalLongHistory(ticker){
    return fetchJson(this.raw(`data/v17/historical-recovery/history/${ticker}.json`,this.longHistoryBranch),this.cfg,{ttlMs:30*60*1000});
  }
  async loadYahooHistory(symbol, range=this.cfg.market.longHistoryRange||'10y'){
    if(!symbol)throw new Error('YAHOO_SYMBOL_MISSING');
    const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&events=history&includeAdjustedClose=true`;
    const d=await fetchJson(url,this.cfg,{ttlMs:30*60*1000});
    const r=d?.chart?.result?.[0]; if(!r)throw new Error(d?.chart?.error?.description||'YAHOO_NO_RESULT');
    const q=r.indicators?.quote?.[0]||{}, adj=r.indicators?.adjclose?.[0]?.adjclose||[];
    const rows=(r.timestamp||[]).map((ts,i)=>({
      date:new Date(ts*1000).toISOString().slice(0,10),open:n(q.open?.[i]),high:n(q.high?.[i]),low:n(q.low?.[i]),close:n(q.close?.[i]),
      adjustedClose:n(adj?.[i]),volume:n(q.volume?.[i]),source:'YAHOO_CHART_API'
    })).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite));
    return {rows,meta:r.meta||{},source:'YAHOO_CHART_API',range};
  }
  adjustRows(rows=[]){
    return rows.map(x=>{
      const close=n(x.close), adj=n(x.adjustedClose);
      const factor=(close>0&&adj>0)?adj/close:1;
      return {
        date:String(x.date||x.sessionDate||'').slice(0,10),
        open:n(x.open)*factor, high:n(x.high)*factor, low:n(x.low)*factor, close:(adj>0?adj:n(x.close)),
        volume:Math.max(0,n(x.volume)||0), valueTraded:n(x.valueTraded??x.turnover), adjustmentFactor:factor,
        source:x.source||x.primarySource||x.provenance?.source||null
      };
    }).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&[x.open,x.high,x.low,x.close].every(v=>Number.isFinite(v)&&v>0)&&x.high>=Math.max(x.open,x.close)&&x.low<=Math.min(x.open,x.close));
  }
  mergeRows(...sets){
    const m=new Map();
    for(const rows of sets)for(const x of this.adjustRows(rows||[]))m.set(x.date,x);
    return [...m.values()].sort((a,b)=>a.date.localeCompare(b.date));
  }
  async loadStock(entry){
    const errors=[]; let short=null,originalLong=null,yahoo=null;
    try{short=await this.loadShortHistory(entry.ticker);}catch(e){errors.push(`SHORT_HISTORY:${e.message}`);}
    try{originalLong=await this.loadOriginalLongHistory(entry.ticker);}catch(e){
      // The original long-history working store is not always committed. This is expected;
      // fall through to the exact same 10y Yahoo source used by the original recovery engine.
      if(!String(e.message).includes('HTTP_404'))errors.push(`ORIGINAL_LONG_HISTORY:${e.message}`);
    }
    const originalRows=originalLong?.sessions||originalLong?.rows||[];
    if(originalRows.length<this.cfg.market.requiredHistorySessions){
      const ys=entry.yahooSymbol||entry.yahooAlternative||`${entry.ticker}.CA`;
      try{yahoo=await this.loadYahooHistory(ys,this.cfg.market.longHistoryRange||'10y');}catch(e){errors.push(`LONG_HISTORY:${e.message}`);}
    }
    const rows=this.mergeRows(originalRows,yahoo?.rows||[],short?.sessions||short?.rows||[]);
    const longSource=originalRows.length>=this.cfg.market.requiredHistorySessions?'ORIGINAL_V17_LONG_HISTORY_STORE':(yahoo?.rows?.length?'ORIGINAL_V17_EQUIVALENT_YAHOO_10Y':'UNAVAILABLE');
    return {
      entry,rows,errors,
      meta:{
        shortHistory:short,
        originalLongHistoryMeta:originalLong?{sessionCount:originalLong.sessionCount??originalRows.length,coverageStart:originalLong.coverageStart??originalRows[0]?.date??null,coverageEnd:originalLong.coverageEnd??originalRows.at(-1)?.date??null,source:originalLong.source??null}:null,
        yahooMeta:yahoo?.meta||null,
        expectedSessionDate:entry.summary?.lastSession||null,
        priceDataAsOf:rows.at(-1)?.date||null,
        fundamentalsAsOf:entry.fundamentals?.publicationDate||entry.fundamentals?.latestReportingPeriod||null,
        longHistorySource:longSource,
        longHistoryRange:yahoo?.range||originalLong?.requestedRange||null,
        sessionCount:rows.length,
      }
    };
  }
  async loadBenchmark(){
    try{
      const y=await this.loadYahooHistory(this.cfg.market.benchmarkYahooSymbol,this.cfg.market.longHistoryRange||'10y');
      return this.adjustRows(y.rows);
    }catch{return [];}
  }
}
