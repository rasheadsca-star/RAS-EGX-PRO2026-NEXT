#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'../..');
const DATA_DIR=path.join(ROOT,'gann-fusion-x','data');
const SNAP_PATH=path.join(DATA_DIR,'live-ui-current-v1.json');
const reportFromEnv=process.env.GANN_FUSION_AUDIT_REPORT||'gann-fusion-x/data/live-ui-browser-check-v1.json';
const REPORT_PATH=path.isAbsolute(reportFromEnv)?reportFromEnv:path.join(ROOT,reportFromEnv);
const configuredUrl=process.env.GANN_FUSION_UI_URL||process.env.GANN_FUSION_LOCAL_UI_URL||process.env.GANN_FUSION_LIVE_URL||process.env.GFX_LOCAL_URL||'http://127.0.0.1:4173/gann-fusion-x/app/index-v1.html';
const base=new URL(String(configuredUrl).trim()).toString();
const expectedDataUrl=new URL('../data/live-ui-current-v1.json',base);
const snap=JSON.parse(fs.readFileSync(SNAP_PATH,'utf8'));
const diag={schemaVersion:'live-ui-browser-check-v1',generatedAt:new Date().toISOString(),passed:false,critical:0,major:0,base,expectedDataUrl:expectedDataUrl.toString(),snapshotSchema:snap.schemaVersion||null,jsonRequests:[],pageErrors:[],consoleErrors:[],checks:[]};
function check(condition,code,details){if(!condition){const e=new Error(code);e.code=code;e.details=details||null;throw e}diag.checks.push(code)}
function writeReport(){fs.mkdirSync(path.dirname(REPORT_PATH),{recursive:true});fs.writeFileSync(REPORT_PATH,JSON.stringify(diag,null,2)+'\n')}
function safeJsonRequest(url){try{const actual=new URL(url);return actual.origin===expectedDataUrl.origin&&actual.pathname===expectedDataUrl.pathname}catch{return false}}
async function searchAndRead(page,ticker){const input=page.locator('#searchInput');await input.fill(ticker);await input.press('Enter');const dialog=page.locator('#stockDialog');await dialog.waitFor({state:'visible',timeout:5000});return page.locator('#stockDialogBody').innerText()}
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
  check(unsafe.length===0,'LIVE_UI_ONLY_SAFE_JSON',{unsafe,expectedDataUrl:expectedDataUrl.toString()});
  check(diag.pageErrors.length===0,'LIVE_UI_NO_PAGE_ERRORS',{pageErrors:diag.pageErrors});
  await page.locator('[data-view="daily"]').click();
  const shown=await page.locator('tbody .ticker').allTextContents();
  check(JSON.stringify(shown)===JSON.stringify(snap.lists.dailyTop),'LIVE_UI_DAILY_PARITY',{shown,expected:snap.lists.dailyTop});
  const readyTicker=snap.lists.dailyTop[0];
  if(readyTicker){const d=await searchAndRead(page,readyTicker);check(d.includes('READY')&&!d.includes('DATA_INCOMPLETE'),'READY_DETAIL_READY_ONLY',{ticker:readyTicker});check(page.url()===base,'SEARCH_ENTER_NO_NAVIGATION',{ticker:readyTicker,url:page.url(),base});await page.locator('#dialogClose').click()}
  const blocked=(snap.stocks||[]).find(s=>s.status!=='READY');
  check(Boolean(blocked),'NONREADY_SAMPLE_EXISTS');
  if(blocked){const d=await searchAndRead(page,blocked.ticker);check(d.includes('DATA_INCOMPLETE')&&d.includes('0%'),'NONREADY_DETAIL_BLOCKED',{ticker:blocked.ticker});check(!/الدخول\s*[\d٠-٩]/.test(d),'NONREADY_NO_ENTRY_LEVEL',{ticker:blocked.ticker});await page.locator('#dialogClose').click()}
  await page.locator('[data-view="history"]').click();
  const f=await page.locator('#view').innerText();
  check(f.includes(snap.forward.status),'FORWARD_STATUS_VISIBLE',{status:snap.forward.status});
  if(snap.forward.performanceClaimAllowed===false)check(f.includes('لا تُعرض'),'FORWARD_CLAIM_BLOCK_VISIBLE');
  await page.locator('[data-view="backtest"]').click();
  const b=await page.locator('#view').innerText();
  check(b.includes('NOT_VALIDATED_HISTORICALLY'),'BACKTEST_CAVEAT_VISIBLE');
  check(diag.pageErrors.length===0,'LIVE_UI_NO_PAGE_ERRORS_FINAL',{pageErrors:diag.pageErrors});
  diag.passed=true;diag.major=0;diag.summary={daily:shown,coverage:snap.coverage,forward:snap.forward.status,backtest:snap.backtest.fullGannHistoricalStatus};writeReport();console.log(JSON.stringify(diag,null,2));
})().catch(e=>{diag.passed=false;diag.major=1;diag.failure={code:e?.code||'LIVE_UI_BROWSER_FAILURE',message:String(e?.message||e),details:e?.details||null,stack:String(e?.stack||'')};writeReport();console.error(JSON.stringify(diag,null,2));process.exitCode=1}).finally(async()=>{if(browser)await browser.close().catch(()=>{})});
