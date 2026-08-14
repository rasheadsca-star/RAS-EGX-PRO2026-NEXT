#!/usr/bin/env node
'use strict';

const fs=require('fs'),path=require('path'),http=require('http');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r),OUT='data/v17/browser-runtime-critic.json';
function read(rel,d={}){try{return JSON.parse(fs.readFileSync(P(rel),'utf8'))}catch{return d}}
function write(rel,value){const f=P(rel);fs.mkdirSync(path.dirname(f),{recursive:true});const t=f+'.tmp';fs.writeFileSync(t,JSON.stringify(value,null,2)+'\n','utf8');JSON.parse(fs.readFileSync(t,'utf8'));fs.renameSync(t,f)}
const findings=[];const add=(severity,code,message,location=null)=>findings.push({severity,code,message:String(message||''),location});
const contentTypes={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.webp':'image/webp'};
function safeFile(urlPath){const decoded=decodeURIComponent(String(urlPath||'/').split('?')[0]);const normalized=path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');const file=path.resolve(root,'.'+path.sep+normalized.replace(/^[/\\]+/,''));return file.startsWith(root+path.sep)?file:null;}
function startServer(){return new Promise((resolve,reject)=>{const server=http.createServer((req,res)=>{const pathname=(req.url||'/').split('?')[0];const file=safeFile(pathname);if(!file){res.writeHead(403);return res.end('Forbidden');}let target=file;try{if(fs.statSync(target).isDirectory())target=path.join(target,'index.html');}catch{}fs.readFile(target,(err,data)=>{if(err){res.writeHead(404,{'content-type':'text/plain'});return res.end('Not found');}res.writeHead(200,{'content-type':contentTypes[path.extname(target).toLowerCase()]||'application/octet-stream','cache-control':'no-store'});res.end(data);});});server.listen(0,'127.0.0.1',()=>{const address=server.address();resolve({server,origin:`http://127.0.0.1:${address.port}`});});server.on('error',reject);});}
async function visibleText(page,selector,min=1){try{const loc=page.locator(selector);await loc.first().waitFor({state:'visible',timeout:8000});const value=(await loc.first().innerText()).trim();return value.length>=min?value:null;}catch{return null;}}
async function testViewport(browser,origin,viewport,label){
  const context=await browser.newContext({viewport,locale:'ar-EG'});const page=await context.newPage();const consoleErrors=[],pageErrors=[],failedRequests=[],badResponses=[];
  page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text())});
  page.on('pageerror',err=>pageErrors.push(String(err?.message||err)));
  page.on('requestfailed',req=>failedRequests.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText||'failed'}`));
  page.on('response',res=>{if(res.status()>=400&&!/favicon\.ico(?:\?|$)/.test(res.url()))badResponses.push(`${res.status()} ${res.url()}`)});
  try{
    await page.goto(`${origin}/preview-v17/app/index.html`,{waitUntil:'networkidle',timeout:30000});
    await page.waitForFunction(()=>document.getElementById('snapshotStatus')?.textContent?.trim().length>0,{timeout:12000});
    const snapshot=await visibleText(page,'#snapshotStatus');if(!snapshot)add('CRITICAL','BROWSER_SNAPSHOT_STATUS_EMPTY',`${label}: snapshot status did not render`,label);
    const session=await visibleText(page,'#sessionMetrics');if(!session)add('CRITICAL','BROWSER_SESSION_METRICS_EMPTY',`${label}: session metrics did not render`,label);
    const rec=await visibleText(page,'#recommendationGrid');if(!rec)add('CRITICAL','BROWSER_RECOMMENDATIONS_EMPTY',`${label}: recommendation grid did not render`,label);
    const title=await page.title();if(!/EGX/i.test(title))add('MINOR','BROWSER_TITLE_UNEXPECTED',`${label}: ${title}`,label);
    const appState=await page.evaluate(()=>({bodyText:document.body.innerText.slice(0,4000),activeViews:[...document.querySelectorAll('.view.active')].map(x=>x.id),ready:document.readyState,htmlLang:document.documentElement.lang,dir:document.documentElement.dir}));
    if(/فشل تحميل|خطأ عند تحميل|HTTP\s+\d{3}/i.test(appState.bodyText))add('CRITICAL','BROWSER_VISIBLE_LOAD_ERROR',`${label}: visible data-load failure`,label);
    if(appState.activeViews.length!==1)add('MAJOR','BROWSER_ACTIVE_VIEW_COUNT',`${label}: activeViews=${JSON.stringify(appState.activeViews)}`,label);
    if(appState.dir!=='rtl'||appState.htmlLang!=='ar')add('MINOR','BROWSER_RTL_CONTRACT',`${label}: lang=${appState.htmlLang}; dir=${appState.dir}`,label);

    for(const name of ['dashboard','market','portfolio','evidence','health']){
      const button=page.locator(`.nav-button[data-view="${name}"]`).first();
      if(await button.count()===0){add('CRITICAL','BROWSER_NAV_MISSING',`${label}: ${name}`,label);continue;}
      await button.click();await page.waitForTimeout(120);
      const active=await page.locator(`#view-${name}`).evaluate(el=>el.classList.contains('active')&&getComputedStyle(el).display!=='none');
      if(!active)add('CRITICAL','BROWSER_NAV_DID_NOT_SWITCH',`${label}: ${name}`,label);
    }

    await page.locator('.nav-button[data-view="market"]').first().click();
    const search=page.locator('#marketSearch');
    if(await search.count()){
      const marketData=read('data/market.json',{rows:[]});const rows=Array.isArray(marketData.rows)?marketData.rows:[];const symbol=String(rows.find(r=>r?.symbol)?.symbol||'COMI').trim().toUpperCase();
      await search.fill(symbol);await page.waitForTimeout(180);
      const marketText=(await page.locator('#marketRows').innerText()).toUpperCase();
      if(!marketText.includes(symbol))add('MAJOR','BROWSER_MARKET_SEARCH_FAILED',`${label}: ${symbol} not found after search`,label);
      await search.fill('');
    }else add('CRITICAL','BROWSER_MARKET_SEARCH_MISSING',`${label}: #marketSearch absent`,label);

    await page.locator('.nav-button[data-view="evidence"]').first().click();
    for(const id of ['nativeEvidence','researchEvidence'])if(!await visibleText(page,`#${id}`))add('MAJOR','BROWSER_EVIDENCE_EMPTY',`${label}: #${id}`,label);
    await page.locator('.nav-button[data-view="health"]').first().click();
    if(!await visibleText(page,'#healthChecks'))add('MAJOR','BROWSER_HEALTH_EMPTY',`${label}: health checks empty`,label);

    if(label==='mobile'){
      const mobile=await page.evaluate(()=>({vw:innerWidth,body:document.body.scrollWidth,html:document.documentElement.scrollWidth,navButtons:[...document.querySelectorAll('.nav-button')].map(b=>{const r=b.getBoundingClientRect();return{w:r.width,h:r.height,text:(b.textContent||'').trim()}})}));
      if(Math.max(mobile.body,mobile.html)>mobile.vw+36)add('MINOR','BROWSER_MOBILE_GLOBAL_OVERFLOW',`viewport=${mobile.vw}; body=${mobile.body}; html=${mobile.html}`,label);
      if(mobile.navButtons.some(b=>b.w<32||b.h<32||!b.text))add('MINOR','BROWSER_MOBILE_NAV_TAP_TARGET',JSON.stringify(mobile.navButtons),label);
    }
  }catch(error){add('CRITICAL','BROWSER_RUNTIME_EXCEPTION',`${label}: ${error?.stack||error}`,label);}
  for(const error of consoleErrors)add('MAJOR','BROWSER_CONSOLE_ERROR',`${label}: ${error}`.slice(0,800),label);
  for(const error of pageErrors)add('CRITICAL','BROWSER_PAGE_ERROR',`${label}: ${error}`.slice(0,800),label);
  for(const error of failedRequests.filter(x=>!x.includes('favicon.ico')))add('MAJOR','BROWSER_REQUEST_FAILED',`${label}: ${error}`.slice(0,800),label);
  for(const error of badResponses)add('MAJOR','BROWSER_BAD_RESPONSE',`${label}: ${error}`.slice(0,800),label);
  await context.close();
  return {label,viewport,consoleErrors:consoleErrors.length,pageErrors:pageErrors.length,failedRequests:failedRequests.length,badResponses:badResponses.length};
}

(async()=>{
  let chromium;
  try{({chromium}=require('playwright'));}catch(error){add('CRITICAL','PLAYWRIGHT_UNAVAILABLE',String(error?.message||error),'tooling');const counts=findings.reduce((a,f)=>(a[f.severity]=(a[f.severity]||0)+1,a),{CRITICAL:0,MAJOR:0,MINOR:0,INFO:0});const report={schemaVersion:'17.0.0-browser-runtime-critic-1',generatedAt:new Date().toISOString(),critic:'V17_REAL_CHROMIUM_RUNTIME_CRITIC',verdict:'COMMENTS_FOUND',counts,totalFindings:findings.length,findings,checks:[]};write(OUT,report);console.log(JSON.stringify(report,null,2));process.exit(2);}
  const {server,origin}=await startServer();let browser;const checks=[];
  try{browser=await chromium.launch({headless:true});checks.push(await testViewport(browser,origin,{width:1440,height:900},'desktop'));checks.push(await testViewport(browser,origin,{width:390,height:844},'mobile'));}
  catch(error){add('CRITICAL','CHROMIUM_LAUNCH_OR_TEST_FAILURE',String(error?.stack||error),'browser');}
  finally{if(browser)await browser.close().catch(()=>{});await new Promise(resolve=>server.close(resolve));}
  const counts=findings.reduce((a,f)=>(a[f.severity]=(a[f.severity]||0)+1,a),{CRITICAL:0,MAJOR:0,MINOR:0,INFO:0});
  const report={schemaVersion:'17.0.0-browser-runtime-critic-1',generatedAt:new Date().toISOString(),critic:'V17_REAL_CHROMIUM_RUNTIME_CRITIC',verdict:findings.length===0?'NO_COMMENTS':'COMMENTS_FOUND',counts,totalFindings:findings.length,findings,checks,coverage:{realJavascriptExecution:true,consoleErrors:true,pageErrors:true,networkFailures:true,dynamicCurrentSnapshot:true,allPrimaryViews:true,marketSearch:true,evidenceAndHealth:true,desktop:true,mobile:true},rule:'Zero tolerance: any browser/runtime/mobile finding blocks stability sign-off.'};
  write(OUT,report);console.log(JSON.stringify(report,null,2));if(findings.length)process.exitCode=2;
})().catch(error=>{add('CRITICAL','BROWSER_CRITIC_FATAL',String(error?.stack||error),'browser');const counts=findings.reduce((a,f)=>(a[f.severity]=(a[f.severity]||0)+1,a),{CRITICAL:0,MAJOR:0,MINOR:0,INFO:0});const report={schemaVersion:'17.0.0-browser-runtime-critic-1',generatedAt:new Date().toISOString(),critic:'V17_REAL_CHROMIUM_RUNTIME_CRITIC',verdict:'COMMENTS_FOUND',counts,totalFindings:findings.length,findings};write(OUT,report);console.error(error);process.exitCode=2;});
