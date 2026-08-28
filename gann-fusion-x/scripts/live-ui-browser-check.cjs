#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'../..');
const snap=JSON.parse(fs.readFileSync(path.join(ROOT,'gann-fusion-x','data','live-ui-current-v1.json'),'utf8'));
const base=process.env.GFX_LOCAL_URL||'http://127.0.0.1:4173/gann-fusion-x/app/index-v1.html';
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  const jsonRequests=[];page.on('request',r=>{if(/\.json(?:\?|$)/.test(r.url()))jsonRequests.push(r.url())});
  await page.goto(base,{waitUntil:'networkidle'});
  const text=await page.locator('body').innerText();
  if(text.includes('BLOCKED'))throw new Error('LIVE_UI_BROWSER_BLOCKED');
  if(!text.includes(`${snap.coverage.ready} من ${snap.coverage.activeUniverse}`))throw new Error('LIVE_UI_COVERAGE_DISCLOSURE_MISSING');
  const unsafe=jsonRequests.filter(u=>!u.endsWith('/gann-fusion-x/data/live-ui-current-v1.json'));
  if(unsafe.length)throw new Error('LIVE_UI_UNSAFE_JSON_REQUESTS '+unsafe.join(','));
  await page.locator('[data-view="daily"]').click();
  const shown=await page.locator('tbody .ticker').allTextContents();
  if(JSON.stringify(shown)!==JSON.stringify(snap.lists.dailyTop))throw new Error(`LIVE_UI_DAILY_PARITY ${JSON.stringify({shown,expected:snap.lists.dailyTop})}`);
  const readyTicker=snap.lists.dailyTop[0];
  if(readyTicker){await page.locator('#searchInput').fill(readyTicker);await page.locator('#searchInput').press('Enter');await page.locator('#stockDialog').waitFor({state:'visible'});const d=await page.locator('#stockDialogBody').innerText();if(!d.includes('READY')||d.includes('DATA_INCOMPLETE'))throw new Error('READY_DETAIL_NOT_READY');await page.locator('#dialogClose').click()}
  const blocked=(snap.stocks||[]).find(s=>s.status!=='READY');
  if(blocked){await page.locator('#searchInput').fill(blocked.ticker);await page.locator('#searchInput').press('Enter');await page.locator('#stockDialog').waitFor({state:'visible'});const d=await page.locator('#stockDialogBody').innerText();if(!d.includes('DATA_INCOMPLETE')||!d.includes('0%'))throw new Error('NONREADY_DETAIL_NOT_BLOCKED');if(/الدخول\s*[\d٠-٩]/.test(d))throw new Error('NONREADY_ENTRY_LEVEL_VISIBLE');await page.locator('#dialogClose').click()}
  await page.locator('[data-view="history"]').click();const f=await page.locator('#view').innerText();if(!f.includes(snap.forward.status))throw new Error('FORWARD_STATUS_NOT_VISIBLE');if(snap.forward.performanceClaimAllowed===false&&!f.includes('لا تُعرض'))throw new Error('FORWARD_CLAIM_BLOCK_NOT_VISIBLE');
  await page.locator('[data-view="backtest"]').click();const b=await page.locator('#view').innerText();if(!b.includes('NOT_VALIDATED_HISTORICALLY'))throw new Error('BACKTEST_CAVEAT_NOT_VISIBLE');
  console.log(JSON.stringify({ok:true,jsonRequests,daily:shown,coverage:snap.coverage,forward:snap.forward.status,backtest:snap.backtest.fullGannHistoricalStatus},null,2));
  await browser.close();
})().catch(async e=>{console.error(e);process.exit(1)});
