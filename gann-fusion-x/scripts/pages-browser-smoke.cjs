#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');

const url = process.env.GANN_PAGE_URL || 'https://rasheadsca-star.github.io/RAS-EGX-PRO2026-NEXT/gann-fusion-x/app/index-v1.html';
const fatal = [];
const consoleErrors = [];
const failedRequests = [];
const essentialFailures = [];
const essentialPatterns = [
  '/gann-fusion-x/engine/planner.js',
  '/gann-fusion-x/app/session-dashboard.js',
  '/data/quant/market-search-index-v13-17.json',
  '/gann-fusion-x/data/sepa-x-snapshot.json'
];
const result = { ok:false, url, title:null, viewTitle:null, sessionBadge:null, funnelText:null, actionable:false, watch:false, rejected:false, etel:false, dialogOpened:false, analyzedText:null, consoleErrors:[], failedRequests:[], essentialFailures:[] };

(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000}, locale:'ar-EG'});
  page.on('pageerror', e => fatal.push(String(e && e.stack || e)));
  page.on('console', msg => { if(msg.type()==='error') consoleErrors.push(msg.text()); });
  page.on('requestfailed', req => {
    const entry = `${req.method()} ${req.url()} :: ${req.failure()?.errorText||'failed'}`;
    failedRequests.push(entry);
    if(essentialPatterns.some(p=>req.url().includes(p))) essentialFailures.push(entry);
  });
  const response = await page.goto(url,{waitUntil:'domcontentloaded',timeout:120000});
  if(!response || !response.ok()) throw new Error(`navigation HTTP ${response?.status()||'NO_RESPONSE'}`);
  await page.waitForFunction(()=>document.querySelector('#viewTitle')?.textContent?.includes('Funnel'),null,{timeout:180000});
  await page.waitForFunction(()=>document.body.innerText.includes('ACTIONABLE') && document.body.innerText.includes('WATCH') && document.body.innerText.includes('REJECTED'),null,{timeout:180000});
  await page.waitForFunction(()=>document.body.innerText.includes('ETEL'),null,{timeout:180000});
  result.title = await page.title();
  result.viewTitle = (await page.locator('#viewTitle').innerText()).trim();
  result.sessionBadge = (await page.locator('#sessionBadge').innerText()).trim();
  const body = await page.locator('body').innerText();
  result.funnelText = body.includes('Funnel القرار المضاربي') ? 'present' : 'missing';
  result.actionable = body.includes('ACTIONABLE');
  result.watch = body.includes('WATCH');
  result.rejected = body.includes('REJECTED');
  result.etel = body.includes('ETEL');
  const analyzedMatch = body.match(/Full Market Scan\s*([\d٠-٩]+)/);
  result.analyzedText = analyzedMatch ? analyzedMatch[1] : null;
  const openButton = page.locator('.planner-open').first();
  if(await openButton.count()){
    await openButton.click();
    await page.waitForFunction(()=>document.querySelector('#stockDialog')?.open===true,null,{timeout:10000});
    result.dialogOpened = true;
  }
  result.consoleErrors = consoleErrors.slice(0,20);
  result.failedRequests = failedRequests.slice(0,30);
  result.essentialFailures = essentialFailures;
  if(fatal.length) throw new Error(`page errors: ${fatal.join(' | ')}`);
  if(essentialFailures.length) throw new Error(`essential request failures: ${essentialFailures.join(' | ')}`);
  if(!result.viewTitle.includes('Funnel') || !result.actionable || !result.watch || !result.rejected || !result.etel || !result.dialogOpened) throw new Error('required UI assertions failed');
  result.ok = true;
  console.log(JSON.stringify(result,null,2));
  await browser.close();
})().catch(async e=>{
  result.error=String(e && e.stack || e);
  result.consoleErrors=consoleErrors.slice(0,20);
  result.failedRequests=failedRequests.slice(0,30);
  result.essentialFailures=essentialFailures;
  console.error(JSON.stringify(result,null,2));
  process.exit(1);
});
