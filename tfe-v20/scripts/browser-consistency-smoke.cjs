#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, firefox, webkit } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const LIVE_URL = String(process.env.RC2_SMOKE_URL || '').trim().replace(/\/$/, '');
const EXPECTED_COMMIT = String(process.env.RC2_EXPECTED_COMMIT || '').trim();
const BYPASS = String(process.env.VERCEL_PROTECTION_BYPASS || '').trim();
const TRUSTED_OIDC = String(process.env.RC2_TRUSTED_OIDC_TOKEN || '').trim();
const ENGINE_NAMES = String(process.env.RC2_BROWSER_ENGINES || 'chromium,firefox,webkit')
  .split(',').map((x) => x.trim()).filter(Boolean);
const ENGINES = { chromium, firefox, webkit };
const SESSION = '2026-08-27';

function rec(ticker, rank, fusion, price) {
  return {
    ticker, rank, nameAr:`سهم ${ticker}`, nameEn:`Stock ${ticker}`, sessionDate:SESSION,
    price, decision:'RESEARCH_BUY_ZONE', publicationEligible:true, publicationState:'RESEARCH_CANDIDATE',
    quality:{state:'TRUSTED', score:96}, liquidity:{eligible:true, score:82},
    supportResistance:{score:76, methodCount:3},
    tradePlan:{entryLow:price*0.985, entryHigh:price*0.995, stop:price*0.95, target1:price*1.05, target2:price*1.1, structuralNetRR:1.7, alignmentState:'IN_ENTRY_RANGE'},
    scores:{core:78, research:81, fusionRank:fusion},
    historicalConfidence:{confidenceWilsonLower95Pct:68, historicalTradeCount:24},
    reasonCodes:[]
  };
}

const FIXTURE_RECS = [rec('AAAA', 1, 88.4, 10.25), rec('BBBB', 2, 84.1, 21.5)];
const FIXTURES = {
  health: {
    ok:true, sourceCommit:'fixture-browser-consistency', engine:'TFE_V20_FUSION_RC2',
    technicalCore:'ORIGINAL_SCOREBARS_PRESERVED',
    policy:{permissions:{executionAllowed:false, automaticOrders:false, productionAllocation:false, automaticChampionPromotion:false}}
  },
  scan: {
    ok:true, sourceCommit:'fixture-browser-consistency', generatedAt:'2026-08-27T12:30:00.000Z',
    universe:{sessionDate:SESSION,currentVerifiedCandidates:2,v20NativeSessionDate:SESSION},
    summary:{scanned:2,publicationEligibleTotal:2,technicalEligibleTotal:2,withheldForPriceReconciliation:0},
    ranking:{hardGatesBeforeHistoricalConfidence:true}, recommendations:FIXTURE_RECS,
    withheldForReconciliation:[], v17:{sessionDate:SESSION,executionReady:false}
  },
  market: {ok:true,sessionDate:SESSION,symbols:FIXTURE_RECS.map((x)=>({ticker:x.ticker,companyNameAr:x.nameAr,companyNameEn:x.nameEn,qualityState:'TRUSTED'}))},
  simulate: {ok:true,summary:{entered:24,target1Pct:72,profitFactor:2.1,wilson95LowerTarget1Pct:61}},
  decisionLog: {ok:true,rows:[]},
  ablation: {ok:true,summary:{}},
  sessionMonitor: {ok:true,generatedAt:'2026-08-27T12:31:00.000Z',delayedMinutes:15,quotes:[],errors:[]},
};

function headers() {
  const out = { accept:'application/json', 'cache-control':'no-cache' };
  if (BYPASS) {
    out['x-vercel-protection-bypass'] = BYPASS;
    out['x-vercel-set-bypass-cookie'] = 'true';
  }
  if (TRUSTED_OIDC) out['x-vercel-trusted-oidc-idp-token'] = TRUSTED_OIDC;
  return out;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers:headers(), redirect:'follow', cache:'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const body = await res.json();
  if (!body?.ok) throw new Error(`API_NOT_OK ${url}: ${body?.error || 'unknown'}`);
  return body;
}

function fixtureFor(urlString) {
  const u = new URL(urlString, 'http://fixture.local');
  if (u.pathname === '/api/intraday') return {ok:true,results:[],errors:[],generatedAt:'2026-08-27T12:31:00.000Z'};
  if (u.pathname === '/api/fundamental') return {ok:true,module:'RC2_AUTO_FUNDAMENTALS_V1',ticker:u.searchParams.get('ticker')||null,data:null,scoringImpact:'NONE'};
  if (u.pathname === '/api/recommendation-history') return {ok:true,rows:[],summary:{},scoringImpact:'NONE'};
  if (u.pathname !== '/api/index') return {ok:true};
  const route = u.searchParams.get('route');
  if (route === 'health') return FIXTURES.health;
  if (route === 'scan') return FIXTURES.scan;
  if (route === 'market-index') return FIXTURES.market;
  if (route === 'simulate') return FIXTURES.simulate;
  if (route === 'decision-log') return FIXTURES.decisionLog;
  if (route === 'ablation') return FIXTURES.ablation;
  if (route === 'session-monitor') return FIXTURES.sessionMonitor;
  if (route === 'analyze') {
    const ticker = String(u.searchParams.get('ticker')||'').toUpperCase();
    return {ok:true,result:FIXTURE_RECS.find((x)=>x.ticker===ticker)||rec(ticker||'ZZZZ',99,50,5)};
  }
  if (route === 'history') return {ok:true,lastSession:SESSION,bars:[]};
  return {ok:true};
}

const MIME = new Map([
  ['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.mjs','text/javascript; charset=utf-8'],
  ['.css','text/css; charset=utf-8'],['.json','application/json; charset=utf-8'],['.svg','image/svg+xml'],['.png','image/png'],['.ico','image/x-icon']
]);

async function startStaticServer() {
  const server = http.createServer(async (req,res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
      rel = rel.replace(/^\/+/, '');
      const file = path.resolve(PUBLIC_DIR, rel);
      if (!(file === PUBLIC_DIR || file.startsWith(PUBLIC_DIR + path.sep))) {
        res.writeHead(403); res.end('forbidden'); return;
      }
      const data = await fs.readFile(file);
      res.writeHead(200, {'content-type':MIME.get(path.extname(file))||'application/octet-stream','cache-control':'no-store'});
      res.end(data);
    } catch {
      res.writeHead(404, {'content-type':'text/plain; charset=utf-8'}); res.end('not found');
    }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address = server.address();
  return { server, url:`http://127.0.0.1:${address.port}` };
}

async function liveReference(baseUrl) {
  const health = await fetchJson(`${baseUrl}/api/index?route=health&t=${Date.now()}`);
  if (!EXPECTED_COMMIT) throw new Error('RC2_EXPECTED_COMMIT is required for live preview smoke');
  if (health.sourceCommit !== EXPECTED_COMMIT) throw new Error(`HEALTH_SHA_MISMATCH expected=${EXPECTED_COMMIT} actual=${health.sourceCommit}`);
  const p = health?.policy?.permissions || {};
  if (p.executionAllowed !== false || p.automaticOrders !== false || p.productionAllocation !== false) {
    throw new Error('EXECUTION_LOCK_MISSING');
  }
  const scan = await fetchJson(`${baseUrl}/api/index?route=scan&limit=50&t=${Date.now()}`);
  if (scan.sourceCommit && scan.sourceCommit !== EXPECTED_COMMIT) throw new Error(`SCAN_SHA_MISMATCH ${scan.sourceCommit}`);
  if (!(Number(scan?.summary?.scanned) > 0)) throw new Error('SCAN_EMPTY_OR_INVALID');
  return { health, scan, tickers:(scan.recommendations||[]).map((x)=>String(x.ticker)) };
}

async function readUi(page, expectedCount) {
  await page.waitForFunction((count) => {
    const grid = document.querySelector('#recommendationGrid');
    if (!grid) return false;
    const cards = grid.querySelectorAll('.rec-card').length;
    return count > 0 ? cards >= count : Boolean(grid.querySelector('.empty'));
  }, expectedCount, {timeout:120000});
  return page.evaluate((count) => {
    const cards = [...document.querySelectorAll('#recommendationGrid .rec-card')].slice(0,count||undefined);
    return {
      tickers:cards.map((c)=>c.querySelector('h3')?.textContent?.trim()||''),
      ranks:cards.map((c)=>c.querySelector('.rec-rank')?.textContent?.trim()||''),
      stage:document.querySelector('#productStage')?.textContent?.trim()||'',
      lastUpdate:document.querySelector('#lastUpdate')?.textContent?.trim()||'',
      executionLock:document.body.innerText.includes('Execution مقفول') || document.body.innerText.includes('التنفيذ الآلي مقفول')
    };
  }, expectedCount);
}

async function waitRefreshSettled(page) {
  await page.waitForFunction(() => {
    const text = document.querySelector('#lastUpdate')?.textContent || '';
    return text && !text.includes('جارٍ تحديث') && !text.includes('تعذر التحديث');
  }, null, {timeout:120000});
}

async function runEngine(name, browserType, baseUrl, expectedTickers, useFixture) {
  const pageErrors = [], consoleErrors = [], failedEssential = [], apiRequests = [];
  const browser = await browserType.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:1000},locale:'ar-EG',extraHTTPHeaders:headers()});
  const page = await context.newPage();

  if (useFixture) {
    await page.route('**/api/**', async (route) => {
      const body = fixtureFor(route.request().url());
      await route.fulfill({status:200,contentType:'application/json; charset=utf-8',body:JSON.stringify(body),headers:{'cache-control':'no-store'}});
    });
  }

  page.on('pageerror', (e)=>pageErrors.push(String(e?.stack||e)));
  page.on('console', (m)=>{if(m.type()==='error') consoleErrors.push(m.text());});
  page.on('request', (req)=>{
    try { if (new URL(req.url()).pathname.startsWith('/api/')) apiRequests.push({method:req.method(),url:req.url()}); } catch {}
  });
  page.on('requestfailed', (req)=>{
    try {
      const u = new URL(req.url());
      const base = new URL(baseUrl);
      if (u.origin === base.origin && ['script','stylesheet','xhr','fetch'].includes(req.resourceType())) {
        failedEssential.push(`${req.resourceType()} ${req.url()} :: ${req.failure()?.errorText||'failed'}`);
      }
    } catch {}
  });

  try {
    const response = await page.goto(baseUrl+'/', {waitUntil:'domcontentloaded',timeout:120000});
    if (!response || !response.ok()) throw new Error(`NAVIGATION_${response?.status()||'NO_RESPONSE'}`);
    await waitRefreshSettled(page);
    const before = await readUi(page, expectedTickers.length);
    assert.deepEqual(before.tickers, expectedTickers, `${name}: DOM ranking differs from reference`);
    assert.ok(before.stage.includes('Research') || before.stage.includes('Shadow'), `${name}: research stage missing`);
    assert.equal(before.executionLock, true, `${name}: execution lock banner missing`);

    await page.locator('#refreshBtn').click();
    await waitRefreshSettled(page);
    const after = await readUi(page, expectedTickers.length);
    assert.deepEqual(after.tickers, before.tickers, `${name}: ranking changed after refresh on same snapshot`);
    assert.deepEqual(after.ranks, before.ranks, `${name}: displayed ranks changed after refresh`);

    const forbidden = apiRequests.filter((x)=>x.method !== 'GET' || /\b(execute|order|broker|promote|trade)\b/i.test(x.url));
    assert.deepEqual(forbidden, [], `${name}: forbidden API request observed`);
    assert.deepEqual(pageErrors, [], `${name}: page errors detected`);
    assert.deepEqual(consoleErrors, [], `${name}: console errors detected`);
    assert.deepEqual(failedEssential, [], `${name}: essential request failures detected`);

    return {name,before,after,apiRequestCount:apiRequests.length};
  } finally {
    await context.close();
    await browser.close();
  }
}

(async()=>{
  for (const name of ENGINE_NAMES) if (!ENGINES[name]) throw new Error(`UNKNOWN_BROWSER_ENGINE:${name}`);
  let local = null;
  const useFixture = !LIVE_URL;
  const baseUrl = LIVE_URL || (local = await startStaticServer()).url;
  try {
    const reference = useFixture ? {tickers:FIXTURE_RECS.map((x)=>x.ticker)} : await liveReference(baseUrl);
    const results = [];
    for (const name of ENGINE_NAMES) results.push(await runEngine(name, ENGINES[name], baseUrl, reference.tickers, useFixture));
    const canonical = results[0]?.after?.tickers || [];
    for (const result of results.slice(1)) assert.deepEqual(result.after.tickers, canonical, `cross-browser ranking mismatch: ${result.name}`);
    console.log(JSON.stringify({ok:true,mode:useFixture?'deterministic-fixture':'live-preview',baseUrl:useFixture?'LOCAL_STATIC_FIXTURE':baseUrl,expectedCommit:EXPECTED_COMMIT||null,browsers:results},null,2));
  } finally {
    if (local?.server) await new Promise((resolve)=>local.server.close(resolve));
  }
})().catch((error)=>{
  console.error(JSON.stringify({ok:false,error:String(error?.stack||error)},null,2));
  process.exit(1);
});