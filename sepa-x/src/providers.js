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
      if(!r.ok)throw new Error(`HTTP_${r.status}`);
      const data=await r.json(); cache.set(url,{data,expiresAt:Date.now()+ttlMs}); return data;
    }catch(e){last=e;if(i<cfg.cache.retries)await sleep(150*(2**i));}
    finally{clearTimeout(timer);}
  }
  throw new Error(`FETCH_FAILED:${url}:${last?.message||'unknown'}`);
}

export class MarketDataProvider {
  constructor(cfg=DEFAULT_CONFIG){this.cfg=cfg;this.repo=cfg.market.repo;this.branch=cfg.market.universeSourceBranch;}
  raw(path, branch=this.branch){return `https://raw.githubusercontent.com/${this.repo}/${branch}/${path}`;}
  async loadContext(){
    const paths=[
      ['symbolMap','data/symbol-map.json'],
      ['historySummary','data/history-summary.json'],
      ['fundamentals','data/v17/historical-recovery/fundamentals/current.json'],
      ['news','data/v17/historical-recovery/news/current.json'],
      ['longHistory','data/v17/historical-recovery/long-history/compact-market.json'],
      ['corporateActions','data/v17/historical-recovery/long-history/corporate-action-audit.json'],
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
    return entries.filter(x=>x?.ticker&&x.active!==false).map(x=>{
      const ticker=String(x.ticker).toUpperCase(), summary=summaryMap.get(ticker)||null;
      return {...x,ticker,summary,fundamentals:fundamentalMap.get(ticker)||null,news:newsMap.get(ticker)||null,longHistory:longMap.get(ticker)||null,corporateAction:corpMap.get(ticker)||null};
    });
  }
  async loadShortHistory(ticker){
    return fetchJson(this.raw(`data/history/${ticker}.json`),this.cfg);
  }
  async loadYahooHistory(symbol, range='2y'){
    if(!symbol)throw new Error('YAHOO_SYMBOL_MISSING');
    const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&events=history&includeAdjustedClose=true`;
    const d=await fetchJson(url,this.cfg,{ttlMs:30*60*1000});
    const r=d?.chart?.result?.[0]; if(!r)throw new Error(d?.chart?.error?.description||'YAHOO_NO_RESULT');
    const q=r.indicators?.quote?.[0]||{}, adj=r.indicators?.adjclose?.[0]?.adjclose||[];
    const rows=(r.timestamp||[]).map((ts,i)=>({
      date:new Date(ts*1000).toISOString().slice(0,10),open:n(q.open?.[i]),high:n(q.high?.[i]),low:n(q.low?.[i]),close:n(q.close?.[i]),
      adjustedClose:n(adj?.[i]),volume:n(q.volume?.[i]),source:'YAHOO_CHART_API'
    })).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite));
    return {rows,meta:r.meta||{},source:'YAHOO_CHART_API'};
  }
  adjustRows(rows=[]){
    return rows.map(x=>{
      const close=n(x.close), adj=n(x.adjustedClose);
      const factor=(close>0&&adj>0)?adj/close:1;
      return {
        date:String(x.date||x.sessionDate||'').slice(0,10),
        open:n(x.open)*factor, high:n(x.high)*factor, low:n(x.low)*factor, close:(adj>0?adj:n(x.close)),
        volume:Math.max(0,n(x.volume)||0), valueTraded:n(x.valueTraded??x.turnover), adjustmentFactor:factor,
        source:x.source||x.primarySource||null
      };
    }).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&[x.open,x.high,x.low,x.close].every(v=>Number.isFinite(v)&&v>0)&&x.high>=Math.max(x.open,x.close)&&x.low<=Math.min(x.open,x.close));
  }
  mergeRows(...sets){
    const m=new Map();
    for(const rows of sets)for(const x of this.adjustRows(rows||[]))m.set(x.date,x);
    return [...m.values()].sort((a,b)=>a.date.localeCompare(b.date));
  }
  async loadStock(entry){
    const errors=[]; let short=null,yahoo=null;
    try{short=await this.loadShortHistory(entry.ticker);}catch(e){errors.push(`SHORT_HISTORY:${e.message}`);}
    const ys=entry.yahooSymbol||entry.yahooAlternative||`${entry.ticker}.CA`;
    try{yahoo=await this.loadYahooHistory(ys,'2y');}catch(e){errors.push(`LONG_HISTORY:${e.message}`);}
    const rows=this.mergeRows(yahoo?.rows||[],short?.sessions||short?.rows||[]);
    return {
      entry,rows,errors,
      meta:{
        shortHistory:short,
        yahooMeta:yahoo?.meta||null,
        expectedSessionDate:entry.summary?.lastSession||null,
        priceDataAsOf:rows.at(-1)?.date||null,
        fundamentalsAsOf:entry.fundamentals?.publicationDate||entry.fundamentals?.latestReportingPeriod||null,
      }
    };
  }
  async loadBenchmark(){
    try{
      const y=await this.loadYahooHistory(this.cfg.market.benchmarkYahooSymbol,'2y');
      return this.adjustRows(y.rows);
    }catch{return [];}
  }
}
