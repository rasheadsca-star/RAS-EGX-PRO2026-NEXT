#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const readJson = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const failures = [];
const checks = {};
const check = (name, ok, detail = null) => {
  checks[name] = { ok: Boolean(ok), detail };
  if (!ok) failures.push(name);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return ({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'}[ext] || 'application/octet-stream');
}
function staticServer() {
  return http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      if (!rel) rel = 'v20/index.html';
      if (rel === 'favicon.ico') { res.writeHead(204, {'cache-control':'no-store'}); return res.end(); }
      if (rel.includes('..')) { res.writeHead(403); return res.end('Forbidden'); }
      let file = P(rel);
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, {'content-type':'text/plain'}); return res.end('Not found'); }
      res.writeHead(200, {'content-type':mime(file),'cache-control':'no-store','access-control-allow-origin':'*'});
      fs.createReadStream(file).pipe(res);
    } catch (error) { res.writeHead(500, {'content-type':'text/plain'}); res.end(error.message); }
  });
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer(); s.unref(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function findChrome() {
  for (const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']) {
    const r = spawnSync('which', [name], {encoding:'utf8'});
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}
async function waitHttp(url, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return r; } catch {}
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class Cdp {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.ws = null; this.nextId = 1; this.pending = new Map(); this.waiters = new Map(); this.consoleErrors = []; }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => { this.ws.addEventListener('open', resolve, {once:true}); this.ws.addEventListener('error', reject, {once:true}); });
    this.ws.addEventListener('message', event => {
      const msg = JSON.parse(String(event.data));
      if (msg.id) {
        const p = this.pending.get(msg.id); if (!p) return; this.pending.delete(msg.id); if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result || {}); return;
      }
      const list = this.waiters.get(msg.method) || []; this.waiters.set(msg.method, []); for (const w of list) w(msg.params || {});
      if (msg.method === 'Runtime.exceptionThrown') this.consoleErrors.push({type:'exception', text:msg.params?.exceptionDetails?.text || 'Runtime exception'});
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') this.consoleErrors.push({type:'console.error', text:(msg.params.args||[]).map(x=>x.value ?? x.description ?? '').join(' ')});
      if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
        const entry = msg.params.entry; const text = entry.text || ''; const url = entry.url || '';
        if (!/favicon\.ico/i.test(`${url} ${text}`)) this.consoleErrors.push({type:'log.error', text, url});
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++; return new Promise((resolve, reject) => { this.pending.set(id, {resolve,reject}); this.ws.send(JSON.stringify({id,method,params})); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); } }, 10000); });
  }
  waitEvent(method, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const arr = this.waiters.get(method) || []; arr.push(resolve); this.waiters.set(method, arr);
      setTimeout(() => { const current = this.waiters.get(method) || []; const i = current.indexOf(resolve); if (i >= 0) current.splice(i,1); reject(new Error(`Event timeout: ${method}`)); }, timeoutMs);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true, userGesture:true});
    if (r.exceptionDetails) {
      const detail = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'Runtime.evaluate failed';
      throw new Error(detail);
    }
    return r.result?.value;
  }
  async navigate(url) {
    const loaded = this.waitEvent('Page.loadEventFired', 15000).catch(() => null);
    await this.send('Page.navigate', {url}); await loaded; await sleep(250);
  }
  async waitFor(expression, timeoutMs = 10000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) { try { if (await this.eval(expression)) return true; } catch {} await sleep(100); }
    return false;
  }
  async viewport(width, height) { await this.send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:width<=430,screenWidth:width,screenHeight:height}); }
  async screenshot(file) {
    const r = await this.send('Page.captureScreenshot', {format:'png',fromSurface:true,captureBeyondViewport:false});
    const buf = Buffer.from(r.data, 'base64'); fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, buf); return {sha256:sha256(buf),bytes:buf.length};
  }
  close() { try { this.ws?.close(); } catch {} }
}

async function main() {
  const chrome = findChrome(); check('chromeExecutableAvailable', Boolean(chrome), chrome || 'not found');
  if (!chrome) throw new Error('Chrome/Chromium executable not found on runner');
  const server = staticServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const appPort = server.address().port;
  const debugPort = await freePort(); const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'egx-v20-chrome-'));
  const chromeProc = spawn(chrome, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--hide-scrollbars',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profileDir}`,'about:blank'], {stdio:['ignore','ignore','pipe']});
  let chromeStderr=''; chromeProc.stderr.on('data', d => { chromeStderr += String(d); });
  let cdp;
  try {
    const versionRes = await waitHttp(`http://127.0.0.1:${debugPort}/json/version`, 12000); const version = await versionRes.json();
    const targetsRes = await waitHttp(`http://127.0.0.1:${debugPort}/json/list`, 5000); const targets = await targetsRes.json(); const page = targets.find(x => x.type === 'page');
    check('pageTargetAvailable', Boolean(page?.webSocketDebuggerUrl)); if (!page?.webSocketDebuggerUrl) throw new Error('No Chrome page target');
    cdp = new Cdp(page.webSocketDebuggerUrl); await cdp.connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
    const base = `http://127.0.0.1:${appPort}`; const shotDir = path.join(os.tmpdir(),'v20-browser-smoke'); const screenshots = []; const viewportResults = [];

    await cdp.viewport(1440, 1000); await cdp.navigate(`${base}/v20/index.html`);
    check('indexLoadedWithOpportunities', await cdp.waitFor("document.querySelectorAll('#opportunityRows tr').length > 0", 12000));
    check('executionBadgeRendered', await cdp.eval("document.querySelector('#executionBadge')?.textContent?.trim() === 'بحث فقط'"));
    check('researchScoreHeaderRendered', await cdp.eval("document.querySelector('.opportunities-panel thead th:nth-child(5)')?.textContent?.includes('Research Score')"));
    check('evidenceTopNavigationRendered', await cdp.eval("document.querySelectorAll('#v20TopNav a').length === 3"));
    check('indexNoHorizontalOverflow1440', await cdp.eval('document.documentElement.scrollWidth <= window.innerWidth + 1'));

    await cdp.eval("document.querySelector('#opportunityRows tr')?.click()"); await sleep(150);
    check('opportunityDialogOpened', await cdp.eval("document.querySelector('#stockDialog')?.open === true"));
    check('decisionSeparationVisible', await cdp.eval("document.querySelector('#stockDialogBody')?.innerText?.includes('Score ≠ Confidence ≠ Execution Permission')"));
    check('researchScoreVisibleForOpportunity', await cdp.eval("document.querySelector('#stockDialogBody')?.innerText?.includes('V20 Research Decision Score')"));
    check('uncalibratedDisclosureVisible', await cdp.eval("document.querySelector('#stockDialogBody')?.innerText?.includes('غير مُعايرة')"));
    check('modelConfidenceNotDerivedDisclosureVisible', await cdp.eval("document.querySelector('#stockDialogBody')?.innerText?.includes('لا يتم اشتقاق Model Confidence')"));
    check('decisionComponentsRendered', await cdp.eval("document.querySelectorAll('#stockDialogBody .decision-component').length === 7"));
    check('stockWorkbenchNoHorizontalOverflow1440', await cdp.eval('document.querySelector("#stockDialog").scrollWidth <= document.querySelector("#stockDialog").clientWidth + 1'));
    screenshots.push({name:'opportunity-1440',...(await cdp.screenshot(path.join(shotDir,'opportunity-1440.png')))});
    await cdp.eval("document.querySelector('#closeDialog')?.click()"); await sleep(80);

    const market = readJson('data/v20/market-explorer.json'); const marketOnly = (market.rows||[]).find(row => row.decision?.scope === 'MARKET_ONLY');
    check('marketOnlyFixtureAvailable', Boolean(marketOnly?.ticker), marketOnly?.ticker || null);
    if (marketOnly?.ticker) {
      const ticker = JSON.stringify(marketOnly.ticker);
      await cdp.eval(`(()=>{const x=document.querySelector('#marketSearchInput');x.value=${ticker};x.dispatchEvent(new Event('input',{bubbles:true}));return true})()`); await sleep(100);
      check('marketOnlySearchReturnsRow', await cdp.eval("document.querySelectorAll('#marketRows tr').length === 1"));
      await cdp.eval("document.querySelector('#marketRows tr')?.click()"); await sleep(100);
      check('marketOnlyDialogOpened', await cdp.eval("document.querySelector('#stockDialog')?.open === true"));
      check('marketOnlyNoResearchScoreDisclosure', await cdp.eval("document.querySelector('#stockDialogBody')?.innerText?.includes('لا توجد V20 Research Decision Score لهذا السهم')"));
      check('marketOnlyNoFakeScoreScopeDisclosure', await cdp.eval("document.querySelector('#stockDialogBody')?.innerText?.includes('لا يتم اختلاق Score أو Tier أو Model Confidence')"));
      check('marketOnlyResearchScoreWidgetAbsent', await cdp.eval("document.querySelector('#stockDialogBody .research-score') === null"));
      await cdp.eval("document.querySelector('#closeDialog')?.click()"); await sleep(80);
    }

    for (const [width,height] of [[1440,1000],[1024,900],[768,900],[430,900],[390,844]]) {
      await cdp.viewport(width,height); await cdp.navigate(`${base}/v20/index.html`); const ready=await cdp.waitFor("document.querySelectorAll('#opportunityRows tr').length > 0",10000);
      const overflow = ready ? await cdp.eval('document.documentElement.scrollWidth > window.innerWidth + 1') : true;
      let dialogOverflow = null;
      if (ready && width <= 430) { await cdp.eval("document.querySelector('#opportunityRows tr')?.click()"); await sleep(100); dialogOverflow = await cdp.eval('document.querySelector("#stockDialog").scrollWidth > document.querySelector("#stockDialog").clientWidth + 1'); }
      const screen = await cdp.screenshot(path.join(shotDir,`index-${width}.png`)); screenshots.push({name:`index-${width}`,...screen}); viewportResults.push({width,height,ready,horizontalOverflow:overflow,dialogHorizontalOverflow:dialogOverflow,screenshotSha256:screen.sha256,screenshotBytes:screen.bytes});
      check(`responsive_${width}_noPageOverflow`, ready && overflow === false); if (width <= 430) check(`responsive_${width}_noDialogOverflow`, dialogOverflow === false);
    }

    await cdp.viewport(1024,900); await cdp.navigate(`${base}/v20/health.html`);
    check('healthPageLoaded', await cdp.waitFor("document.querySelector('#healthTitle')?.textContent?.trim().length > 0 && !document.querySelector('#healthError')?.textContent",10000));
    check('healthShowsAuthoritativeBlockers', await cdp.eval("document.querySelector('#blockerCount')?.textContent?.trim() !== '—' && document.querySelector('#blockerGrid')?.innerText?.length > 0"));
    check('healthNoHorizontalOverflow', await cdp.eval('document.documentElement.scrollWidth <= window.innerWidth + 1'));
    screenshots.push({name:'health-1024',...(await cdp.screenshot(path.join(shotDir,'health-1024.png')))});

    await cdp.navigate(`${base}/v20/performance.html`);
    check('performancePageLoaded', await cdp.waitFor("document.querySelector('#performanceGrid')?.children?.length > 0",10000));
    check('performanceNoHeadlineReturnWidget', await cdp.eval("document.querySelector('#performanceHeadlineReturn') === null"));
    check('performanceNoHorizontalOverflow', await cdp.eval('document.documentElement.scrollWidth <= window.innerWidth + 1'));
    screenshots.push({name:'performance-1024',...(await cdp.screenshot(path.join(shotDir,'performance-1024.png')))});

    const consoleErrors = cdp.consoleErrors.filter(e => !/favicon\.ico/i.test(`${e.url || ''} ${e.text || ''}`));
    check('noRuntimeOrConsoleErrors', consoleErrors.length === 0, consoleErrors);
    const report = {
      schemaVersion:'20.0.0-browser-smoke-1', generatedAt:new Date().toISOString(), ok:failures.length===0, failedCount:failures.length, failures,
      browser:{executable:chrome, product:version.Browser || null, protocolVersion:version['Protocol-Version'] || null},
      sessionDate:readJson('data/v20/current.json').sessionDate, checks, viewportResults, screenshots,
      consoleErrors, limitations:['RUNTIME_AND_LAYOUT_OVERFLOW_ACCEPTANCE_NOT_HUMAN_PIXEL_REVIEW','SCREENSHOTS_CAPTURED_ON_RUNNER_AND_RECORDED_BY_HASH_ONLY'],
    };
    fs.writeFileSync(P('data/v20/browser-smoke.json'),`${JSON.stringify(report,null,2)}\n`,'utf8');
    console.log(JSON.stringify(report,null,2));
    if (!report.ok) {
      process.exitCode=1;
    } else {
      require('./final-acceptance-runner.cjs');
    }
  } finally {
    try { cdp?.close(); } catch {} try { chromeProc.kill('SIGTERM'); } catch {} await new Promise(resolve => server.close(resolve)); try { fs.rmSync(profileDir,{recursive:true,force:true}); } catch {}
    if (chromeProc.exitCode && chromeProc.exitCode !== 0 && !fs.existsSync(P('data/v20/browser-smoke.json'))) console.error(chromeStderr.slice(-4000));
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
