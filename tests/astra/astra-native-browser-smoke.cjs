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
      const external=[],errors=[],bad=[],requests=[];
      page.on('request',r=>{requests.push(r.url());try{if(new URL(r.url()).origin!==new URL(BASE).origin)external.push(r.url())}catch{}});
      page.on('pageerror',e=>errors.push(String(e)));
      page.on('response',r=>{if(r.status()>=400)bad.push({url:r.url(),status:r.status()})});
      await page.goto(BASE+'/astra-prod/app/index.html?devsmoke='+Date.now(),{waitUntil:'domcontentloaded',timeout:30000});
      await page.waitForFunction(()=>window.__ASTRA_PERF_HISTORY__==='READY'&&window.__ASTRA_MARKET_PORTFOLIO__==='READY'&&window.__ASTRA_PRO_ANALYTICS__==='READY',null,{timeout:30000});
      assert.equal(await page.locator('#proStaticBanner').count(),1,name+' static PRO v2 banner missing on index');
      assert.match(await page.locator('#proStaticBanner').innerText(),/PRO ANALYTICS v2 — LIVE/);

      assert.equal(await page.locator('#astraProHome').count(),1,name+' visible Professional Analytics home panel missing');
      const proHomeText=await page.locator('#astraProHome').innerText();
      assert.match(proHomeText,/Astra Professional Analytics/);
      assert.match(proHomeText,/PRO ANALYTICS v2/);
      assert.match(proHomeText,/Multi-Pane Candlesticks/);
      assert.match(proHomeText,/Auto Price Channel/);
      assert.match(proHomeText,/Technical Signature/);
      assert.match(proHomeText,/Risk \/ Reward Visualizer/);
      assert.equal(await page.locator('#proBuildBadge').innerText(),'PRO v2',name+' PRO v2 badge missing');
      assert.match(await page.locator('[data-view="technical"]').innerText(),/NEW/);

      const nav=page.locator('[data-view="performance"]');
      assert.equal(await nav.count(),1,name+' performance nav missing');
      await nav.click();
      await page.waitForSelector('#view-performance.active');
      assert.match(await page.locator('#view-performance').innerText(),/Astra Performance Intelligence/);
      assert.match(await page.locator('#astraKpiCommand').innerText(),/Performance Command Center/);
      assert.match(await page.locator('#astraKpiCommand').innerText(),/TARGETS ↔ STOPS/);
      assert.match(await page.locator('#astraKpiCommand').innerText(),/Target 2 Rate/);

      const proNav=page.locator('[data-view="technical"]');
      assert.equal(await proNav.count(),1,name+' Technical Lab nav missing');
      await proNav.click();
      await page.waitForSelector('#view-technical.active');
      await page.locator('#proTicker').selectOption('ABUK');
      await page.waitForSelector('#proSvg');
      const labText=await page.locator('#proLabBody').innerText();
      assert.match(labText,/Technical Signature/);
      assert.match(labText,/Channel Quality/);
      assert.match(labText,/Relative Volume/);
      assert.match(labText,/Risk \/ Reward Visualizer/);
      assert.match(labText,/IMMUTABLE PLAN/);
      const chartText=await page.locator('#proSvg').textContent();
      assert.match(chartText,/PRICE · Candlesticks/);
      assert.match(chartText,/VOLUME/);
      assert.match(chartText,/RSI \(14\)/);
      assert.match(chartText,/MACD \(12,26,9\)/);
      assert.equal(await page.locator('[data-pa-layer="channel"]').count(),1,name+' channel toggle missing');
      assert.equal(await page.locator('[data-pa-layer="fib"]').count(),1,name+' fibonacci toggle missing');
      assert.equal(await page.locator('[data-pa-layer="astra"]').count(),1,name+' Astra plan toggle missing');
      const beforeGour=requests.filter(u=>u.includes('/data/history/GOUR.json')).length;
      await page.locator('#proTicker').selectOption('GOUR');
      await page.waitForTimeout(250);
      assert.match(await page.locator('#proLabBody').innerText(),/لا توجد Daily OHLC موثقة/);
      assert.equal(requests.filter(u=>u.includes('/data/history/GOUR.json')).length,beforeGour,name+' Technical Lab must not request unavailable GOUR history');

      await page.locator('[data-view="history"]').click();
      await page.waitForSelector('#view-history.active');
      const historyRows=await page.locator('#astraHistRows tr').count();
      assert.equal(historyRows,3,name+' Astra history must contain current 3 immutable recommendations');

      await page.locator('[data-view="search"]').click();
      await page.waitForSelector('#view-search.active');
      const badgeEl=page.locator('#view-search [data-universe-active]').first();
      const badge=await badgeEl.innerText();
      const active=await badgeEl.getAttribute('data-universe-active');
      const intended=await badgeEl.getAttribute('data-universe-intended');
      assert.equal(active,'224',name+' active universe must be 224');
      assert.equal(intended,'224',name+' intended universe must be 224');
      await page.locator('#astraMarketQ').fill('GOUR');
      await page.waitForTimeout(100);
      assert.match(await page.locator('#astraMarketRows').innerText(),/GOUR/);
      assert.match(await page.locator('#astraMarketRows').innerText(),/ليس ضمن فرص Astra/);
      await page.locator('[data-native-stock="GOUR"]').click();
      await page.waitForFunction(()=>document.querySelector('#astraStock h2')?.textContent.includes('GOUR'));
      assert.match(await page.locator('#astraStock').innerText(),/لا توجد بيانات Daily OHLC موثقة/);
      assert.equal(requests.some(u=>u.includes('/data/history/GOUR.json')),false,name+' must not request unavailable GOUR history');

      await page.locator('#astraMarketQ').fill('TMGH');
      await page.waitForTimeout(100);
      await page.locator('[data-native-stock="TMGH"]').click();
      await page.waitForFunction(()=>document.querySelector('#astraStock h2')?.textContent.includes('TMGH'));
      const tmghBoxes=await page.locator('#astraStock .stock-box').allTextContents();
      const tmghSupport=tmghBoxes.find(x=>x.includes('Support20'))||'';
      const tmghResistance=tmghBoxes.find(x=>x.includes('Resistance20'))||'';
      assert.ok(!tmghSupport.includes('غير متاح')&&!tmghSupport.includes('—'),name+' TMGH Support20 must use available history');
      assert.ok(!tmghResistance.includes('غير متاح')&&!tmghResistance.includes('—'),name+' TMGH Resistance20 must use available history');
      assert.equal(requests.some(u=>u.includes('/data/history/TMGH.json')),true,name+' TMGH history request missing');

      await page.locator('[data-view="portfolio"]').click();
      await page.waitForSelector('#view-portfolio.active');
      assert.match(await page.locator('#view-portfolio').innerText(),/LOCAL ONLY/);

      const direct=await ctx.newPage();
      await direct.goto(BASE+'/astra-prod/app/pro-v2.html?directsmoke='+Date.now(),{waitUntil:'domcontentloaded',timeout:30000});
      await direct.waitForFunction(()=>window.__ASTRA_PRO_ANALYTICS__==='READY',null,{timeout:30000});
      assert.match(await direct.title(),/PRO ANALYTICS v2/);
      assert.equal(await direct.locator('#proStaticBanner').count(),1,name+' direct PRO v2 banner missing');
      assert.match(await direct.locator('#proStaticBanner').innerText(),/DIRECT PRO ENTRY/);
      assert.equal(await direct.locator('#proBuildBadge').innerText(),'PRO v2',name+' direct PRO v2 runtime badge missing');
      await direct.close();

      const v3=await ctx.newPage();
      const v3Errors=[];
      v3.on('pageerror',e=>v3Errors.push(String(e)));
      await v3.goto(BASE+'/astra-prod/app/pro-v3.html?v3smoke='+Date.now(),{waitUntil:'domcontentloaded',timeout:30000});
      await v3.waitForFunction(()=>window.__ASTRA_PRO_V3__?.status==='READY'&&Boolean(window.__ASTRA_G22_READY__),null,{timeout:30000});
      assert.match(await v3.title(),/PRO ANALYTICS v3/);
      assert.equal(await v3.locator('#proStaticBanner').count(),1,name+' PRO v3 static banner missing');
      assert.match(await v3.locator('#proStaticBanner').innerText(),/DIRECT PRO V3 ENTRY/);
      assert.match(await v3.locator('#proV3BootStatus').innerText(),/Legacy cache bypass active/);
      assert.equal(await v3.locator('#proBuildBadge').innerText(),'PRO v3',name+' PRO v3 runtime badge missing');
      assert.equal(await v3.locator('text=تعذر تحميل Astra Full Application').count(),0,name+' legacy full-app collapse message must be impossible on PRO v3');
      const v3Bundles=await v3.evaluate(()=>window.__ASTRA_PRO_V3__.bundles);
      assert.deepEqual(v3Bundles,['astra-core-pro-v3.js','astra-performance-pro-v3.js','astra-portfolio-pro-v3.js','astra-analytics-pro-v3.js']);
      assert.equal(v3Errors.length,0,name+' PRO v3 page errors '+JSON.stringify(v3Errors));
      await v3.close();

      const dims=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));
      assert.ok(dims.sw<=dims.cw+2,name+' horizontal overflow '+JSON.stringify(dims));
      assert.equal(external.length,0,name+' external requests '+JSON.stringify(external));
      assert.equal(errors.length,0,name+' page errors '+JSON.stringify(errors));
      assert.equal(bad.filter(x=>!x.url.includes('favicon')).length,0,name+' bad responses '+JSON.stringify(bad));
      results.push({name,width,height,historyRows,universe:badge,professionalAnalytics:true,professionalHomeVisible:true,staticProV2Banner:true,directProV2Entry:true,directProV3Entry:true,legacyCacheBypass:true,proV2Badge:true,multiPaneChart:true,priceChannel:true,technicalSignature:true,riskReward:true,missingHistoryNo404:true,availableHistoryAnalytics:true,externalRequests:0,pageErrors:0,overflow:0});
      await ctx.close();
    }
    const degraded=await browser.newContext({viewport:{width:390,height:844},locale:'ar-EG'});
    await degraded.route('**/data/quant/stock-intelligence-index.json**',route=>route.abort('failed'));
    const degradedPage=await degraded.newPage();
    const degradedErrors=[];
    degradedPage.on('pageerror',e=>degradedErrors.push(String(e)));
    await degradedPage.goto(BASE+'/astra-prod/app/pro-v2.html?degraded='+Date.now(),{waitUntil:'domcontentloaded',timeout:30000});
    await degradedPage.waitForFunction(()=>Boolean(window.__ASTRA_G22_READY__),null,{timeout:30000});
    assert.match(await degradedPage.locator('#view-home').innerText(),/تشغيل جزئي آمن/);
    const bootHealth=await degradedPage.evaluate(()=>window.__ASTRA_G22_READY__.bootSources);
    assert.equal(bootHealth.data.status,'READY');
    assert.equal(bootHealth['stock-intelligence'].status,'UNAVAILABLE');
    assert.equal(await degradedPage.locator('text=تعذر تحميل Astra Full Application').count(),0,'optional source failure must not collapse the application');
    assert.equal(degradedErrors.length,0,'degraded safe boot page errors '+JSON.stringify(degradedErrors));
    await degraded.close();
    results.push({profile:'degraded-optional-source',safeBoot:true,criticalDataReady:true,optionalSourceUnavailable:true});

  } finally { await browser.close(); }
  console.log(JSON.stringify({status:'PASS',profiles:results},null,2));
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
