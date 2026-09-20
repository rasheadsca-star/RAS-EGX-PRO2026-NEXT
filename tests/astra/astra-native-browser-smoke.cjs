'use strict';
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');

const BASE=process.env.ASTRA_DEV_BASE||'http://127.0.0.1:4173';
const CHROME=process.env.CHROME_BIN;
if(!CHROME) throw new Error('CHROME_BIN required');

const profiles=[
  ['w320',320,760],['w360',360,780],['w390',390,844],
  ['w414',414,896],['w768',768,1024],['desktop',1440,1000]
];

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:CHROME,args:['--no-sandbox']});
  const results=[];
  try{
    for(const [name,width,height] of profiles){
      const ctx=await browser.newContext({viewport:{width,height},locale:'ar-EG'});
      const page=await ctx.newPage();
      const external=[],errors=[],bad=[];
      page.on('request',r=>{try{if(new URL(r.url()).origin!==new URL(BASE).origin)external.push(r.url())}catch{}});
      page.on('pageerror',e=>errors.push(String(e)));
      page.on('response',r=>{if(r.status()>=400)bad.push({url:r.url(),status:r.status()})});
      await page.goto(BASE+'/astra-prod/app/index.html?devsmoke='+Date.now(),{waitUntil:'domcontentloaded',timeout:30000});
      await page.waitForFunction(()=>window.__ASTRA_PERF_HISTORY__==='READY'&&window.__ASTRA_MARKET_PORTFOLIO__==='READY',null,{timeout:30000});

      const nav=page.locator('[data-view="performance"]');
      assert.equal(await nav.count(),1,name+' performance nav missing');
      await nav.click();
      await page.waitForSelector('#view-performance.active');
      assert.match(await page.locator('#view-performance').innerText(),/Astra Performance Intelligence/);

      await page.locator('[data-view="history"]').click();
      await page.waitForSelector('#view-history.active');
      const historyRows=await page.locator('#astraHistRows tr').count();
      assert.equal(historyRows,3,name+' Astra history must contain current 3 immutable recommendations');

      await page.locator('[data-view="search"]').click();
      await page.waitForSelector('#view-search.active');
      const badge=await page.locator('#view-search .tag.good').first().innerText();
      assert.match(badge,/224\s*\/\s*224/,name+' full active universe must be 224/224');
      await page.locator('#astraMarketQ').fill('GOUR');
      await page.waitForTimeout(100);
      assert.match(await page.locator('#astraMarketRows').innerText(),/GOUR/);
      assert.match(await page.locator('#astraMarketRows').innerText(),/ليس ضمن فرص Astra/);

      await page.locator('[data-view="portfolio"]').click();
      await page.waitForSelector('#view-portfolio.active');
      assert.match(await page.locator('#view-portfolio').innerText(),/LOCAL ONLY/);

      const dims=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));
      assert.ok(dims.sw<=dims.cw+2,name+' horizontal overflow '+JSON.stringify(dims));
      assert.equal(external.length,0,name+' external requests '+JSON.stringify(external));
      assert.equal(errors.length,0,name+' page errors '+JSON.stringify(errors));
      assert.equal(bad.filter(x=>!x.url.includes('favicon')).length,0,name+' bad responses '+JSON.stringify(bad));
      results.push({name,width,height,historyRows,universe:badge,externalRequests:0,pageErrors:0,overflow:0});
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(JSON.stringify({status:'PASS',profiles:results},null,2));
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
