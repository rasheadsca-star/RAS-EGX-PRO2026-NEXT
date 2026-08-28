#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'../..');
const DATA_DIR=path.join(ROOT,'gann-fusion-x','data');
const SNAP_PATH=path.join(DATA_DIR,'live-ui-current-v1.json');
const REPORT_PATH=path.join(DATA_DIR,'live-ui-browser-check-v1.json');
const base=process.env.GFX_LOCAL_URL||'http://127.0.0.1:4173/gann-fusion-x/app/index-v1.html';
const snap=JSON.parse(fs.readFileSync(SNAP_PATH,'utf8'));
const diag={
  schemaVersion:'live-ui-browser-check-v1',
  generatedAt:new Date().toISOString(),
  passed:false,
  critical:0,
  major:0,
  base,
  snapshotSchema:snap.schemaVersion||null,
  jsonRequests:[],
  pageErrors:[],
  consoleErrors:[],
  checks:[]
};
function check(condition,code,details){
  if(!condition){const e=new Error(code);e.code=code;e.details=details||null;throw e}
  diag.checks.push(code);
}
function writeReport(){fs.mkdirSync(DATA_DIR,{recursive:true});fs.writeFileSync(REPORT_PATH,JSON.stringify(diag,null,2)+'\n')}
function safeJsonRequest(url){try{return new URL(url).pathname==='/gann-fusion-x/data/live-ui-current-v1.json'}catch{return false}}
let browser=null,page=null;
(async()=>{
  check(snap.schemaVersion==='gann-fusion-x-live-ui-v1-ready-only','SNAPSHOT_SCHEMA_READY_ONLY');
  check(snap.publication?.status==='PUBLISHED_READY_GATED','SNAPSHOT_PUBLICATION_READY_GATED');
  check(snap.guardrails?.readinessGate===true&&snap.guardrails?.recommendationsReadyOnly===true&&snap.guardrails?.nonReadyAllocationZero===true,'SNAPSHOT_GUARDRAILS_ENFORCED');
  check(Number.isInteger(snap.coverage?.activeUniverse)&&snap.coverage.activeUniverse>0&&Number.isInteger(snap.coverage?.ready),'SNAPSHOT_COVERAGE_VALID');
  check(Array.isArray(snap.lists?.dailyTop),'SNAPSHOT_DAILY_LIST_VALID');
  check(Array.isArray(snap.stocks),'SNAPSHOT_STOCK_UNIVERSE_VALID');

  browser=await chromium.launch({headless:true});
  page=await browser.newPage();
  page.on('request',r=>{if(/\.json(?:\?|$)/.test(r.url()))diag.jsonRequests.push(r.url())});
  page.on('pageerror',e=>diag.pageErrors.push(String(e?.stack||e)));
  page.on('console',m=>{if(m.type()==='error')diag.consoleErrors.push(m.text())});

  const response=await page.goto(base,{waitUntil:'networkidle',timeout:20000});
  check(Boolean(response)&&response.ok(),'LIVE_UI_HTTP_OK',{status:response?.status()||null});
  const text=await page.locator('body').innerText();
  check(!text.includes('BLOCKED'),'LIVE_UI_NOT_BLOCKED');
  check(text.includes(`${snap.coverage.ready} من ${snap.coverage.activeUniverse}`),'LIVE_UI_COVERAGE_DISCLOSURE');
  const unsafe=diag.jsonRequests.filter(u=>!safeJsonRequest(u));
  check(unsafe.length===0,'LIVE_UI_ONLY_SAFE_JSON',{unsafe});
  check(diag.pageErrors.length===0,'LIVE_UI_NO_PAGE_ERRORS',{pageErrors:diag.pageErrors});

  await page.locator('[data-view="daily"]').click();
  const shown=await page.locator('tbody .ticker').allTextContents();
  check(JSON.stringify(shown)===JSON.stringify(snap.lists.dailyTop),'LIVE_UI_DAILY_PARITY',{shown,expected:snap.lists.dailyTop});

  const readyTicker=snap.lists.dailyTop[0];
  if(readyTicker){
    await page.locator('#searchInput').fill(readyTicker);
    await page.locator('#searchInput').press('Enter');
    await page.locator('#stockDialog').waitFor({state:'visible',timeout:5000});
    const d=await page.locator('#stockDialogBody').innerText();
    check(d.includes('READY')&&!d.includes('DATA_INCOMPLETE'),'READY_DETAIL_READY_ONLY',{ticker:readyTicker});
    await page.locator('#dialogClose').click();
  }

  const blocked=(snap.stocks||[]).find(s=>s.status!=='READY');
  check(Boolean(blocked),'NONREADY_SAMPLE_EXISTS');
  if(blocked){
    await page.locator('#searchInput').fill(blocked.ticker);
    await page.locator('#searchInput').press('Enter');
    await page.locator('#stockDialog').waitFor({state:'visible',timeout:5000});
    const d=await page.locator('#stockDialogBody').innerText();
    check(d.includes('DATA_INCOMPLETE')&&d.includes('0%'),'NONREADY_DETAIL_BLOCKED',{ticker:blocked.ticker});
    check(!/الدخول\s*[\d٠-٩]/.test(d),'NONREADY_NO_ENTRY_LEVEL',{ticker:blocked.ticker});
    await page.locator('#dialogClose').click();
  }

  await page.locator('[data-view="history"]').click();
  const f=await page.locator('#view').innerText();
  check(f.includes(snap.forward.status),'FORWARD_STATUS_VISIBLE',{status:snap.forward.status});
  if(snap.forward.performanceClaimAllowed===false)check(f.includes('لا تُعرض'),'FORWARD_CLAIM_BLOCK_VISIBLE');

  await page.locator('[data-view="backtest"]').click();
  const b=await page.locator('#view').innerText();
  check(b.includes('NOT_VALIDATED_HISTORICALLY'),'BACKTEST_CAVEAT_VISIBLE');
  check(diag.pageErrors.length===0,'LIVE_UI_NO_PAGE_ERRORS_FINAL',{pageErrors:diag.pageErrors});

  diag.passed=true;
  diag.major=0;
  diag.summary={daily:shown,coverage:snap.coverage,forward:snap.forward.status,backtest:snap.backtest.fullGannHistoricalStatus};
  writeReport();
  console.log(JSON.stringify(diag,null,2));
})().catch(e=>{
  diag.passed=false;
  diag.major=1;
  diag.failure={code:e?.code||'LIVE_UI_BROWSER_FAILURE',message:String(e?.message||e),details:e?.details||null,stack:String(e?.stack||'')};
  writeReport();
  console.error(JSON.stringify(diag,null,2));
  process.exitCode=1;
}).finally(async()=>{if(browser)await browser.close().catch(()=>{})});
