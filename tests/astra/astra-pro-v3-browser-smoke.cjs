'use strict';
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');

const BASE=process.env.ASTRA_PRO_BASE||'http://127.0.0.1:4173';
const CHROME=process.env.CHROME_BIN;
const CYCLE=process.env.ASTRA_REVIEW_CYCLE||'single';
if(!CHROME) throw new Error('CHROME_BIN required');

const profiles=[['mobile',390,844],['desktop',1440,1000]];

async function expectTechnical(page,ticker,label){
  await page.waitForSelector('#view-technical.active',{timeout:15000});
  await page.waitForFunction(t=>document.querySelector('#proTicker')?.value===t,ticker,{timeout:15000});
  await page.waitForFunction(t=>document.querySelector('#proLabBody h2')?.textContent.includes(t),ticker,{timeout:15000});
  assert.equal(await page.locator('#proTicker').inputValue(),ticker,label+' wrong selected ticker');
  assert.match(await page.locator('#proLabBody').innerText(),new RegExp(ticker),label+' chart workspace missing ticker');
  const marketPrice=await page.locator('#proLabBody .pro-box').filter({hasText:'Validated Market Price'}).count();
  const entry=await page.locator('#proLabBody .pro-box').filter({hasText:'Recommendation Entry'}).count();
  const regime=await page.locator('#proLabBody .pro-box').filter({hasText:'Market Regime'}).count();
  assert.equal(marketPrice,1,label+' validated market price missing');
  assert.equal(entry,1,label+' recommendation entry distinction missing');
  assert.equal(regime,1,label+' market regime missing');
}

async function returnContext(page,view,label){
  const btn=page.locator('#proReturnContextBtn');
  assert.equal(await btn.count(),1,label+' return-context button missing');
  await btn.click();
  await page.waitForSelector('#view-'+view+'.active',{timeout:10000});
}

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:CHROME,args:['--no-sandbox']});
  const results=[];
  try{
    for(const [name,width,height] of profiles){
      const ctx=await browser.newContext({viewport:{width,height},locale:'ar-EG'});
      const page=await ctx.newPage();
      const errors=[],bad=[],external=[];
      page.on('pageerror',e=>errors.push(String(e)));
      page.on('response',r=>{if(r.status()>=400)bad.push({url:r.url(),status:r.status()})});
      page.on('request',r=>{try{if(new URL(r.url()).origin!==new URL(BASE).origin)external.push(r.url())}catch{}});
      await page.goto(BASE+'/astra-prod/app/pro-v3.html?audit='+Date.now(),{waitUntil:'domcontentloaded',timeout:30000});
      await page.waitForFunction(()=>window.__ASTRA_PRO_V3__?.status==='READY'&&window.__ASTRA_PRO_ANALYTICS__==='READY'&&window.__ASTRA_PERF_HISTORY__==='READY'&&window.__ASTRA_MARKET_PORTFOLIO__==='READY',null,{timeout:30000});
      assert.equal(await page.evaluate(()=>typeof window.openStockChart),'function',name+' canonical openStockChart missing');

      const live=await page.evaluate(async()=>{
        const [d,u,l,p]=await Promise.all([
          fetch('./data.json',{cache:'no-store'}).then(r=>r.json()),
          fetch('./intelligence/market-universe.json',{cache:'no-store'}).then(r=>r.json()),
          fetch('./intelligence/recommendation-ledger.json',{cache:'no-store'}).then(r=>r.json()),
          fetch('./intelligence/performance-summary.json',{cache:'no-store'}).then(r=>r.json())
        ]);
        return {d,u,l,p};
      });
      const d=live.d, recs=d?.decisionSnapshot?.top5||d?.decisionSnapshot?.opportunities||[];
      assert.match(String(d?.sourceDecision?.session||''),/^\d{4}-\d{2}-\d{2}$/,name+' invalid decision session');
      assert.equal(d?.decisionSnapshot?.sessionDate,d?.sourceDecision?.session,name+' snapshot session drift');
      assert.equal(d?.sourceDecision?.upstream?.sessionDate,d?.sourceDecision?.session,name+' source session drift');
      assert.equal(d?.sourceDecision?.upstream?.final,true,name+' upstream not final');
      assert.equal(d?.sourceDecision?.upstream?.pagesPublished,true,name+' upstream not published');
      assert.equal(d?.sourceDecision?.decisionSnapshotId,d?.decisionSnapshot?.decisionSnapshotId,name+' snapshot id drift');
      assert.equal(d?.sourceDecision?.semanticDecisionHash,d?.decisionSnapshot?.semanticDecisionHash,name+' decision hash drift');
      assert.ok(recs.length<=5,name+' recommendations forced above five');
      assert.equal(new Set(recs.map(x=>x.ticker)).size,recs.length,name+' duplicate recommendation ticker');
      for(const r of recs){
        const lo=Number(r.entryPlan?.low),hi=Number(r.entryPlan?.high),stop=Number(r.stopLoss),targets=(r.targets||[]).map(Number);
        assert.ok(Number.isFinite(lo)&&Number.isFinite(hi)&&lo<=hi,name+' invalid entry '+r.ticker);
        assert.ok(Number.isFinite(stop)&&stop<lo,name+' invalid stop '+r.ticker);
        assert.ok(targets.length&&targets.every(t=>Number.isFinite(t)&&t>hi),name+' invalid target '+r.ticker);
      }
      assert.equal(live.p?.reconciliation?.pass,true,name+' KPI reconciliation failed');
      assert.equal(live.l?.records?.length,recs.length,name+' ledger/recommendation mismatch');
      assert.ok(Number(live.u?.activeCount||live.u?.records?.length)>0,name+' universe empty');

      await page.locator('[data-view="recommendations"]').click();
      await page.waitForSelector('#view-recommendations.active');
      const recTicker=(await page.locator('#view-recommendations .ticker').first().innerText()).trim().toUpperCase();
      await page.locator('#view-recommendations .ticker').first().focus();
      await page.keyboard.press('Enter');
      await expectTechnical(page,recTicker,name+' recommendation');
      await returnContext(page,'recommendations',name+' recommendation');

      await page.locator('[data-view="search"]').click();
      await page.waitForSelector('#view-search.active');
      await page.locator('#astraMarketQ').fill('TMGH');
      await page.waitForFunction(()=>document.querySelector('#astraMarketRows .ticker')?.textContent.includes('TMGH'));
      await page.locator('#astraMarketRows .ticker').first().click();
      await expectTechnical(page,'TMGH',name+' search');
      await returnContext(page,'search',name+' search');

      await page.locator('[data-view="portfolio"]').click();
      await page.waitForSelector('#view-portfolio.active');
      await page.locator('#astraPfT').selectOption('TMGH');
      await page.locator('#astraPfP').fill('50');
      await page.locator('#astraPfQ').fill('10');
      await page.locator('#astraPfA').click();
      await page.waitForFunction(()=>document.querySelector('#astraPfB .ticker')?.textContent.includes('TMGH'));
      await page.locator('#astraPfB .ticker').first().click();
      await expectTechnical(page,'TMGH',name+' portfolio');
      await returnContext(page,'portfolio',name+' portfolio');

      await page.locator('[data-view="history"]').click();
      await page.waitForSelector('#view-history.active');
      const histTicker=(await page.locator('#astraHistRows .ticker').first().innerText()).trim().toUpperCase();
      await page.locator('#astraHistRows .ticker').first().click();
      await expectTechnical(page,histTicker,name+' history');
      await returnContext(page,'history',name+' history');

      const dims=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));
      assert.ok(dims.sw<=dims.cw+2,name+' horizontal page overflow '+JSON.stringify(dims));
      assert.equal(external.length,0,name+' external requests '+JSON.stringify(external));
      assert.equal(errors.length,0,name+' page errors '+JSON.stringify(errors));
      assert.equal(bad.filter(x=>!x.url.includes('favicon')).length,0,name+' bad responses '+JSON.stringify(bad));
      results.push({cycle:CYCLE,profile:name,session:d.sourceDecision.session,recommendations:recs.map(x=>x.ticker),universalChart:true,errors:0});
      await ctx.close();
    }
  } finally {await browser.close()}
  console.log(JSON.stringify({status:'PASS',cycle:CYCLE,profiles:results},null,2));
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
