import { POLICY } from '../src/policy.js';
import { backtestHistory, summarizeBacktest } from '../src/backtest.js';
import { DATA_SOURCES, fetchJson, rawUrl, loadHistory, loadUniverse } from '../src/repository.js';
import { evaluatePublishedRecommendation, summarizePublishedHistory, toPublishedHistoryCsv } from '../src/recommendationHistory.js';

const ARCHIVE_PATH = 'data/rc2/recommendation-history.json';
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = globalThis.__RC2_RECOMMENDATION_HISTORY_CACHE__ ?? (globalThis.__RC2_RECOMMENDATION_HISTORY_CACHE__ = new Map());

const runtimeSourceCommit = () => process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || process.env.TFE_SOURCE_COMMIT || null;

function headers(res, contentType='application/json; charset=utf-8') {
  res.setHeader('content-type', contentType);
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-tfe-engine', POLICY.engineId);
  const c = runtimeSourceCommit();
  if (c) res.setHeader('x-tfe-source-commit', c);
}

function json(res, status, body) {
  res.statusCode = status;
  headers(res);
  res.end(JSON.stringify(body));
}

function logInternal(scope, error, context=null) {
  const payload = context ? ` ${JSON.stringify(context)}` : '';
  console.error(`[${scope}]${payload}`, error?.stack ?? error?.message ?? error);
}

async function cached(key, loader) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit?.expiresAt > now) return hit.data;
  const data = await loader();
  cache.set(key, { data, expiresAt: now + CACHE_TTL_MS });
  return data;
}

async function loadPublishedArchive() {
  try {
    const data = await fetchJson(rawUrl(DATA_SOURCES.alphaDataBranch, ARCHIVE_PATH), { ttlMs: CACHE_TTL_MS });
    return {
      schemaVersion: data?.schemaVersion ?? null,
      updatedAt: data?.updatedAt ?? null,
      records: Array.isArray(data?.records) ? data.records : [],
      notes: Array.isArray(data?.notes) ? data.notes : [],
    };
  } catch (e) {
    logInternal('RC2_HISTORY_ARCHIVE_LOAD', e);
    return { schemaVersion:null, updatedAt:null, records:[], notes:['SERVER_ARCHIVE_NOT_AVAILABLE'] };
  }
}

async function buildPublishedHistory() {
  return cached('published', async () => {
    const archive = await loadPublishedArchive();
    const tickers = [...new Set(archive.records.map((x) => String(x?.ticker ?? '').trim().toUpperCase()).filter(Boolean))];
    const histories = new Map();
    const errors = [];
    for (let i=0; i<tickers.length; i+=12) {
      const batch = await Promise.all(tickers.slice(i,i+12).map(async (ticker) => {
        try { const h = await loadHistory(ticker); return { ticker, rows:h.rows }; }
        catch (e) { logInternal('RC2_HISTORY_TICKER_LOAD', e, {ticker}); return { ticker, error:'DATA_SOURCE_ERROR' }; }
      }));
      for (const item of batch) {
        if (item.error) errors.push({ticker:item.ticker,error:item.error});
        else histories.set(item.ticker,item.rows);
      }
    }
    const rows = archive.records.map((record) => {
      const ticker = String(record?.ticker ?? '').trim().toUpperCase();
      const history = histories.get(ticker);
      if (!history) return { ...record, outcome:'DATA_SOURCE_ERROR', outcomeLabelAr:'تعذر قراءة التاريخ', entered:false };
      return evaluatePublishedRecommendation(record, history);
    }).sort((a,b) => String(b.sessionDate ?? '').localeCompare(String(a.sessionDate ?? '')) || Number(a.rank ?? 999)-Number(b.rank ?? 999) || String(a.ticker).localeCompare(String(b.ticker)));
    return {
      archive: { schemaVersion:archive.schemaVersion, updatedAt:archive.updatedAt, recordCount:archive.records.length, notes:archive.notes },
      summary: summarizePublishedHistory(rows),
      rows,
      errors,
    };
  });
}

function replayRowFromTrade(t) {
  return {
    sourceType:'HISTORICAL_REPLAY',
    sessionDate:t.signalDate,
    ticker:t.ticker,
    publicationState:'HISTORICAL_REPLAY_NOT_LIVE_PUBLISHED',
    decision:'RC2_BACKTEST_SIGNAL',
    outcome:t.outcome,
    outcomeLabelAr:t.outcome==='TARGET1'?'حقق T1':String(t.outcome).startsWith('STOP')?'إيقاف':'خروج زمني',
    entered:true,
    entryDate:t.entryDate,
    exitDate:t.exitDate,
    netPct:t.netPct,
    target1Hit:t.outcome==='TARGET1',
    stopHit:String(t.outcome).startsWith('STOP'),
    timeExit:t.outcome==='TIME_EXIT',
    technicalScore:t.signalTechnicalScore,
    researchScore:t.signalResearchScore,
    structuralNetRR:t.structuralNetRR,
  };
}

function replayRowFromExpired(t) {
  return {
    sourceType:'HISTORICAL_REPLAY',
    sessionDate:t.signalDate,
    ticker:t.ticker ?? null,
    publicationState:'HISTORICAL_REPLAY_NOT_LIVE_PUBLISHED',
    decision:'RC2_BACKTEST_SIGNAL',
    outcome:'EXPIRED_NO_ENTRY',
    outcomeLabelAr:'انتهت بدون دخول',
    entered:false,
    entryDate:null,
    exitDate:null,
    netPct:null,
    target1Hit:false,
    stopHit:false,
    timeExit:false,
  };
}

async function buildReplayHistory(maxSymbols=220) {
  const n = Math.max(1, Math.min(220, Number(maxSymbols) || 220));
  return cached(`replay:${n}`, async () => {
    const { candidates } = await loadUniverse();
    const selected = candidates.slice(0,n);
    const allTrades=[], allExpired=[], errors=[], perTicker=[];
    for (let i=0;i<selected.length;i+=16) {
      const batch = await Promise.all(selected.slice(i,i+16).map(async (d) => {
        try { const h=await loadHistory(d.ticker); return {ticker:d.ticker,bt:backtestHistory({ticker:d.ticker,rows:h.rows,historyMeta:h.meta})}; }
        catch (e) { logInternal('RC2_HISTORY_REPLAY',e,{ticker:d.ticker}); return {ticker:d.ticker,error:'DATA_SOURCE_ERROR'}; }
      }));
      for (const r of batch) {
        if (r.error) { errors.push({ticker:r.ticker,error:r.error}); continue; }
        allTrades.push(...r.bt.trades);
        allExpired.push(...r.bt.expired.map((x)=>({ticker:r.ticker,...x})));
        perTicker.push({ticker:r.ticker,...r.bt.summary});
      }
    }
    const summary = summarizeBacktest(allTrades,allExpired).summary;
    const rows = [
      ...allTrades.map(replayRowFromTrade),
      ...allExpired.map(replayRowFromExpired),
    ].sort((a,b)=>String(b.sessionDate??'').localeCompare(String(a.sessionDate??''))||String(a.ticker??'').localeCompare(String(b.ticker??'')));
    return {
      summary: { ...summary, totalSignals:rows.length, expiredNoEntry:allExpired.length },
      rows,
      errors,
      perTicker:perTicker.filter((x)=>x.entered>0).sort((a,b)=>(b.target1Pct??-1)-(a.target1Pct??-1)||b.entered-a.entered),
      methodology:{
        type:'HISTORICAL_REPLAY_NOT_LIVE_PUBLISHED',
        noLookahead:true,
        entryAfterSignal:true,
        entryExpirySessions:POLICY.entryExpirySessions,
        maxHoldSessions:POLICY.maxHoldSessions,
        sameBarAmbiguity:'STOP_FIRST',
        roundTripCostPct:POLICY.roundTripCostPct,
        scoringImpact:'NONE',
      },
    };
  });
}

const CSV_COLUMNS = ['sourceType','sessionDate','rank','ticker','publicationState','decision','outcome','outcomeLabelAr','entryDate','entryPrice','exitDate','exitPrice','netPct','target1Hit','target2Hit','stopHit','sessionsToEntry','sessionsToExit','entryLow','entryHigh','stop','target1','target2','fusionRankScore','researchScore','technicalScore'];
function csvEsc(v){const s=v==null?'':String(v);return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s}
function combinedCsv(rows){return '\uFEFF'+[CSV_COLUMNS.join(','),...rows.map(r=>CSV_COLUMNS.map(c=>csvEsc(r[c])).join(','))].join('\r\n')+'\r\n'}

export default async function handler(req,res) {
  if (req.method && !['GET','HEAD'].includes(req.method)) {
    res.statusCode=405; headers(res); return res.end(JSON.stringify({ok:false,error:'METHOD_NOT_ALLOWED'}));
  }
  try {
    const url=new URL(req.url,`https://${req.headers.host}`);
    const scope=String(url.searchParams.get('scope')??'all').toLowerCase();
    const format=String(url.searchParams.get('format')??'json').toLowerCase();
    const [published,replay]=await Promise.all([
      scope==='replay'?Promise.resolve(null):buildPublishedHistory(),
      scope==='published'?Promise.resolve(null):buildReplayHistory(url.searchParams.get('symbols')??220),
    ]);
    const publishedRows=published?.rows??[];
    const replayRows=replay?.rows??[];
    if (format==='csv') {
      res.statusCode=200; headers(res,'text/csv; charset=utf-8');
      return res.end(scope==='published'?toPublishedHistoryCsv(publishedRows):combinedCsv(scope==='replay'?replayRows:[...publishedRows,...replayRows]));
    }
    return json(res,200,{
      ok:true,
      engine:POLICY.engineId,
      sourceCommit:runtimeSourceCommit(),
      generatedAt:new Date().toISOString(),
      scope,
      published,
      replay,
      separation:{
        published:'Actual RC2 snapshots persisted from production/immutable evidence and evaluated forward without changing the original plan.',
        replay:'Historical backtest signals generated with no-lookahead rules; they are not claimed as live-published recommendations.',
        scoringImpact:'NONE',
        recommendationMutationAllowed:false,
        executionAllowed:false,
        automaticOrders:false,
      },
    });
  } catch (e) {
    logInternal('RC2_RECOMMENDATION_HISTORY_API',e);
    return json(res,500,{ok:false,engine:POLICY.engineId,error:'INTERNAL_SERVER_ERROR'});
  }
}
