#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const http=require('http');
const net=require('net');
const os=require('os');
const crypto=require('crypto');
const {spawn,spawnSync}=require('child_process');

const root=path.resolve(process.env.GITHUB_WORKSPACE||'.');
const P=rel=>path.join(root,rel);
const readJson=rel=>JSON.parse(fs.readFileSync(P(rel),'utf8'));
const failures=[];
const checks={};
const check=(name,ok,detail=null)=>{checks[name]={ok:Boolean(ok),detail};if(!ok)failures.push(name);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sha256=buf=>crypto.createHash('sha256').update(buf).digest('hex');

function mime(file){const ext=path.extname(file).toLowerCase();return({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'}[ext]||'application/octet-stream');}
function staticServer(){return http.createServer((req,res)=>{try{const u=new URL(req.url,'http://127.0.0.1');let rel=decodeURIComponent(u.pathname).replace(/^\/+/, '');if(!rel)rel='v20/index.html';if(rel==='favicon.ico'){res.writeHead(204,{'cache-control':'no-store'});return res.end();}if(rel.includes('..')){res.writeHead(403);return res.end('Forbidden');}let file=P(rel);if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404,{'content-type':'text/plain'});return res.end('Not found');}res.writeHead(200,{'content-type':mime(file),'cache-control':'no-store','access-control-allow-origin':'*'});fs.createReadStream(file).pipe(res);}catch(error){res.writeHead(500,{'content-type':'text/plain'});res.end(error.message);}});}
function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.unref();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
function findChrome(){for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){const r=spawnSync('which',[name],{encoding:'utf8'});if(r.status===0&&r.stdout.trim())return r.stdout.trim();}return null;}
async function waitHttp(url,timeoutMs=10000,proc=null){const end=Date.now()+timeoutMs;let lastError=null;while(Date.now()<end){if(proc&&proc.exitCode!==null)throw new Error(`Chrome exited before DevTools became ready (exit ${proc.exitCode})`);try{const r=await fetch(url);if(r.ok)return r;lastError=new Error(`HTTP ${r.status}`);}catch(e){lastError=e;}await sleep(150);}throw new Error(`Timed out waiting for ${url}${lastError?` (${lastError.message})`:''}`);}
async function startChrome(chrome){
  const attempts=[{name:'headless-new',flag:'--headless=new'},{name:'headless-compat',flag:'--headless'}];
  const diagnostics=[];
  for(const attempt of attempts){
    const debugPort=await freePort();
    const profileDir=fs.mkdtempSync(path.join(os.tmpdir(),`egx-v20-v17-centric-${attempt.name}-`));
    const args=[attempt.flag,'--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--hide-scrollbars','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profileDir}`,'about:blank'];
    const proc=spawn(chrome,args,{stdio:['ignore','ignore','pipe']});
    let stderr='';
    proc.stderr.on('data',d=>{stderr+=String(d);});
    try{
      const version=await (await waitHttp(`http://127.0.0.1:${debugPort}/json/version`,25000,proc)).json();
      return{proc,debugPort,profileDir,version,mode:attempt.name,stderr};
    }catch(error){
      diagnostics.push({mode:attempt.name,error:error.message,exitCode:proc.exitCode,stderr:stderr.slice(-5000)});
      try{proc.kill('SIGTERM');}catch{}
      await sleep(200);
      try{fs.rmSync(profileDir,{recursive:true,force:true});}catch{}
    }
  }
  throw new Error(`Chrome DevTools bootstrap failed after controlled retry:\n${JSON.stringify(diagnostics,null,2)}`);
}

class Cdp{
  constructor(wsUrl){this.wsUrl=wsUrl;this.ws=null;this.nextId=1;this.pending=new Map();this.waiters=new Map();this.consoleErrors=[];}
  async connect(){this.ws=new WebSocket(this.wsUrl);await new Promise((resolve,reject)=>{this.ws.addEventListener('open',resolve,{once:true});this.ws.addEventListener('error',reject,{once:true});});this.ws.addEventListener('message',event=>{const msg=JSON.parse(String(event.data));if(msg.id){const p=this.pending.get(msg.id);if(!p)return;this.pending.delete(msg.id);if(msg.error)p.reject(new Error(msg.error.message));else p.resolve(msg.result||{});return;}const list=this.waiters.get(msg.method)||[];this.waiters.set(msg.method,[]);for(const w of list)w(msg.params||{});if(msg.method==='Runtime.exceptionThrown')this.consoleErrors.push({type:'exception',text:msg.params?.exceptionDetails?.text||'Runtime exception'});if(msg.method==='Runtime.consoleAPICalled'&&msg.params?.type==='error')this.consoleErrors.push({type:'console.error',text:(msg.params.args||[]).map(x=>x.value??x.description??'').join(' ')});if(msg.method==='Log.entryAdded'&&msg.params?.entry?.level==='error'){const e=msg.params.entry,text=e.text||'',url=e.url||'';if(!/favicon\.ico/i.test(`${url} ${text}`))this.consoleErrors.push({type:'log.error',text,url});}});}
  send(method,params={}){const id=this.nextId++;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);reject(new Error(`CDP timeout: ${method}`));}},10000);});}
  waitEvent(method,timeoutMs=10000){return new Promise((resolve,reject)=>{const arr=this.waiters.get(method)||[];arr.push(resolve);this.waiters.set(method,arr);setTimeout(()=>{const current=this.waiters.get(method)||[];const i=current.indexOf(resolve);if(i>=0)current.splice(i,1);reject(new Error(`Event timeout: ${method}`));},timeoutMs);});}
  async eval(expression){const r=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text||'Runtime.evaluate failed');return r.result?.value;}
  async navigate(url){const loaded=this.waitEvent('Page.loadEventFired',15000).catch(()=>null);await this.send('Page.navigate',{url});await loaded;await sleep(300);}
  async waitFor(expression,timeoutMs=12000){const end=Date.now()+timeoutMs;while(Date.now()<end){try{if(await this.eval(expression))return true;}catch{}await sleep(100);}return false;}
  async viewport(width,height){await this.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<=430,screenWidth:width,screenHeight:height});}
  async screenshot(file){const r=await this.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});const buf=Buffer.from(r.data,'base64');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,buf);return{sha256:sha256(buf),bytes:buf.length};}
  close(){try{this.ws?.close();}catch{}}
}

async function main(){
  const contract=readJson('data/v20/final-decision-contract.json');
  const core=readJson('data/v20/v17-production-decision-core.json');
  const native=readJson('data/v20/native-current.json');
  check('canonicalArchitecture',contract.architecture==='V17_CENTRIC_V20_NATIVE_DISCOVERY',contract.architecture);
  check('v17ProductionAuthority',core.policy?.v17IsAuthoritativeForProductionEligibility===true,core.policy||null);
  check('nativeDiscoveryOnly',native.executionPermission===false&&native.legacyScoringContributionPct===0,{executionPermission:native.executionPermission,legacyScoringContributionPct:native.legacyScoringContributionPct});
  check('closedGateCanonicalNoActionable',contract.sessionStatus==='EXECUTION_GRADE'||(contract.summary?.productionActionableCount===0&&contract.summary?.productionNewExposurePct===0),contract.summary||null);

  const chrome=findChrome();check('chromeExecutableAvailable',Boolean(chrome),chrome||'not found');if(!chrome)throw new Error('Chrome/Chromium executable not found');
  const server=staticServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const appPort=server.address().port;
  let boot=null;let cdp;const screenshots=[];const viewportResults=[];const shotDir=path.join(os.tmpdir(),'v20-v17-centric-browser');
  try{
    boot=await startChrome(chrome);
    check('chromeDevToolsBootstrap',true,{mode:boot.mode,debugPort:boot.debugPort,product:boot.version?.Browser||null});
    const targets=await (await waitHttp(`http://127.0.0.1:${boot.debugPort}/json/list`,5000,boot.proc)).json();const page=targets.find(x=>x.type==='page');check('pageTargetAvailable',Boolean(page?.webSocketDebuggerUrl));if(!page?.webSocketDebuggerUrl)throw new Error('No Chrome page target');
    cdp=new Cdp(page.webSocketDebuggerUrl);await cdp.connect();await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Log.enable');
    const base=`http://127.0.0.1:${appPort}`;

    await cdp.viewport(1440,1000);await cdp.navigate(`${base}/v20/index.html`);
    check('decisionBoardLoaded',await cdp.waitFor("document.querySelector('#decisionBoardPanel[data-primary-decision-board=\"true\"]') && document.querySelectorAll('#decisionRows tr').length > 0",15000));
    check('decisionBoardNoLoadError',await cdp.eval("!document.querySelector('#decisionError')?.textContent?.trim()"));
    check('decisionBoardIsPrimary',await cdp.eval("document.querySelector('#decisionBoardPanel .decision-primary-badge')?.textContent?.includes('الواجهة الأساسية للقرار')"));
    check('decisionPipelineFourStages',await cdp.eval("document.querySelectorAll('#decisionPipeline .decision-stage').length === 4"));
    check('nativeDiscoveryStageVisible',await cdp.eval("document.querySelector('#decisionPipeline')?.innerText?.includes('V20 Native Discovery')"));
    check('v17EligibilityStageVisible',await cdp.eval("document.querySelector('#decisionPipeline')?.innerText?.includes('V17 Per-stock Eligibility')"));
    check('v17GlobalGateStageVisible',await cdp.eval("document.querySelector('#decisionPipeline')?.innerText?.includes('V17 Global Gate')"));
    check('finalCanonicalDecisionStageVisible',await cdp.eval("document.querySelector('#decisionPipeline')?.innerText?.includes('Final Canonical Decision')"));
    check('legacyWorkspaceSecondary',await cdp.eval("document.querySelector('.opportunities-panel')?.classList?.contains('legacy-secondary-panel') === true"));
    check('nativeScoreSeparationVisible',await cdp.eval("document.querySelector('#decisionBoardPanel')?.innerText?.includes('Native Score') && document.querySelector('#decisionBoardPanel')?.innerText?.includes('Execution Permission')"));
    check('evidenceStripLoaded',await cdp.eval("document.querySelectorAll('[data-decision-evidence-strip=\"true\"] .decision-evidence-box').length === 3"));
    check('allCanonicalRowsRendered',await cdp.eval(`document.querySelectorAll('#decisionRows tr').length === ${Number(contract.rows?.length||0)}`),{expected:contract.rows?.length||0});
    if(contract.sessionStatus!=='EXECUTION_GRADE')check('closedGateUiNoActionable',await cdp.eval("document.querySelectorAll('#decisionBoardPanel [data-state=\"ACTIONABLE\"]').length === 0"));
    check('desktopNoHorizontalOverflow',await cdp.eval('document.documentElement.scrollWidth <= window.innerWidth + 1'));

    await cdp.eval("document.querySelector('#decisionRows tr')?.click()");await sleep(150);
    check('stockDossierOpened',await cdp.eval("document.querySelector('#decisionDossier')?.open === true"));
    check('stockDossierLabelVisible',await cdp.eval("document.querySelector('#decisionDossierBody')?.innerText?.includes('Stock Dossier')"));
    check('nativeScoreNotConfidenceVisible',await cdp.eval("document.querySelector('#decisionDossierBody')?.innerText?.includes('Native Score ≠ Confidence')"));
    check('technicalSourceVsProductionVisible',await cdp.eval("document.querySelector('#decisionDossierBody')?.innerText?.includes('Technical Source Eligible') && document.querySelector('#decisionDossierBody')?.innerText?.includes('Technical Production Ready')"));
    check('srSourceVsProductionVisible',await cdp.eval("document.querySelector('#decisionDossierBody')?.innerText?.includes('S/R Source Eligible') && document.querySelector('#decisionDossierBody')?.innerText?.includes('S/R Production Ready')"));
    check('corporateActionSafetyVisible',await cdp.eval("document.querySelector('#decisionDossierBody')?.innerText?.includes('Corporate Action')"));
    check('globalGateVisibleInDossier',await cdp.eval("document.querySelector('#decisionDossierBody')?.innerText?.includes('Global Gate') && document.querySelector('#decisionDossierBody')?.innerText?.includes('Execution Grade')"));
    check('provenanceVisible',await cdp.eval("document.querySelector('#decisionDossierBody')?.innerText?.includes('V17 SHA:') && document.querySelector('#decisionDossierBody')?.innerText?.includes('Freeze:')"));
    check('legacyContributionZeroVisible',await cdp.eval("document.querySelector('#decisionDossierBody')?.innerText?.includes('Legacy scoring') && document.querySelector('#decisionDossierBody')?.innerText?.includes('0%')"));
    check('nativeExecutionPermissionDeniedVisible',await cdp.eval("document.querySelector('#decisionDossierBody')?.innerText?.includes('Execution Permission')"));
    check('dossierNoHorizontalOverflow1440',await cdp.eval('document.querySelector("#decisionDossier").scrollWidth <= document.querySelector("#decisionDossier").clientWidth + 1'));
    screenshots.push({name:'decision-dossier-1440',...(await cdp.screenshot(path.join(shotDir,'decision-dossier-1440.png')))});
    await cdp.eval("document.querySelector('#decisionDossier .decision-dossier-close')?.click()");await sleep(80);

    for(const [width,height] of [[1440,1000],[1024,900],[768,900],[430,900],[390,844]]){
      await cdp.viewport(width,height);await cdp.navigate(`${base}/v20/index.html`);const ready=await cdp.waitFor("document.querySelector('#decisionBoardPanel') && document.querySelectorAll('#decisionRows tr').length > 0",12000);const overflow=ready?await cdp.eval('document.documentElement.scrollWidth > window.innerWidth + 1'):true;let dialogOverflow=null;
      if(ready&&width<=430){await cdp.eval("(document.querySelector('#decisionCards [data-symbol]')||document.querySelector('#decisionRows tr'))?.click()");await sleep(120);dialogOverflow=await cdp.eval('document.querySelector("#decisionDossier").scrollWidth > document.querySelector("#decisionDossier").clientWidth + 1');}
      const screen=await cdp.screenshot(path.join(shotDir,`decision-board-${width}.png`));screenshots.push({name:`decision-board-${width}`,...screen});viewportResults.push({width,height,ready,horizontalOverflow:overflow,dialogHorizontalOverflow:dialogOverflow,screenshotSha256:screen.sha256,screenshotBytes:screen.bytes});check(`responsive_${width}_noPageOverflow`,ready&&overflow===false);if(width<=430)check(`responsive_${width}_noDossierOverflow`,dialogOverflow===false);
    }

    const consoleErrors=cdp.consoleErrors.filter(e=>!/favicon\.ico/i.test(`${e.url||''} ${e.text||''}`));check('noRuntimeOrConsoleErrors',consoleErrors.length===0,consoleErrors);
    const report={schemaVersion:'20.0.0-v17-centric-browser-certification-1',generatedAt:new Date().toISOString(),ok:failures.length===0,failedCount:failures.length,failures,browser:{executable:chrome,product:boot.version?.Browser||null,protocolVersion:boot.version?.['Protocol-Version']||null,bootstrapMode:boot.mode},sessionDate:contract.sessionDate,architecture:contract.architecture,sessionStatus:contract.sessionStatus,checks,viewportResults,screenshots,consoleErrors,limitations:['RUNTIME_AND_LAYOUT_ACCEPTANCE_NOT_HUMAN_PIXEL_REVIEW','SCREENSHOTS_RECORDED_BY_HASH_ONLY']};
    fs.writeFileSync(P('data/v20/decision-board-browser-certification.json'),`${JSON.stringify(report,null,2)}\n`,'utf8');
    const failedChecks=Object.fromEntries(Object.entries(report.checks).filter(([,value])=>value?.ok!==true));
    console.log(JSON.stringify({ok:report.ok,sessionDate:report.sessionDate,failedCount:report.failedCount,failures:report.failures,failedChecks,viewportResults:report.viewportResults,consoleErrors:report.consoleErrors,chromeBootstrapMode:boot.mode},null,2));
    if(!report.ok)process.exitCode=1;
  }finally{cdp?.close();try{boot?.proc?.kill('SIGTERM');}catch{}await new Promise(resolve=>server.close(resolve));try{if(boot?.profileDir)fs.rmSync(boot.profileDir,{recursive:true,force:true});}catch{}}
}

main().catch(error=>{console.error(error.stack||error.message);process.exit(1);});
