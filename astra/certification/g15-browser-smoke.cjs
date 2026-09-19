'use strict';

const fs=require('fs');
const path=require('path');
const {chromium}=require('playwright-core');
const {scanLegacyDependencies}=require('./legacy-isolation.cjs');

const ROOT=path.resolve(__dirname,'../..');
const WRITE=process.argv.includes('--write');
const BASE_URL=String(process.env.G15_BASE_URL||'http://127.0.0.1:4173').replace(/\/$/,'');
const CHROME_BIN=process.env.CHROME_BIN||'';
const SOURCE_HEAD=process.env.G15_SOURCE_HEAD||'';
const WORKFLOW_RUN_ID=Number(process.env.G15_WORKFLOW_RUN_ID||0);

function readJson(rel){return JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8'))}
function writeJson(rel,value){fs.writeFileSync(path.join(ROOT,rel),JSON.stringify(value,null,2)+'\n')}
function gateMap(g){return new Map((g.gates||[]).map(x=>[x.id,x.status]))}
function sameOrigin(url){try{return new URL(url).origin===new URL(BASE_URL).origin}catch{return false}}
function failNames(obj){return Object.entries(obj).filter(([,v])=>v!==true).map(([k])=>k)}

const gates=readJson('04_ACCEPTANCE_GATES.json');
const state=readJson('docs/astra/WORK_STATE.json');
const g14=readJson('docs/astra/G14_CERTIFICATION.json');
const pipeline=readJson('docs/astra/G11_CURRENT_PIPELINE_RUN.json');
const metrics=readJson('docs/astra/G11_DATA_HEALTH_METRICS.json');
const issues=readJson('docs/astra/G11_DATA_HEALTH_ISSUES.json');
const guard=readJson('docs/astra/G11_GUARD37_EVIDENCE.json');
const map=gateMap(gates);
const legacy=scanLegacyDependencies(ROOT);

async function captureProfile(browser,profile){
  const context=await browser.newContext({
    viewport:profile.viewport,
    isMobile:Boolean(profile.isMobile),
    locale:'ar-EG'
  });
  const page=await context.newPage();
  const externalRequests=[];
  const pageErrors=[];
  const consoleErrors=[];
  const badResponses=[];
  page.on('request',req=>{if(!sameOrigin(req.url()))externalRequests.push(req.url())});
  page.on('pageerror',err=>pageErrors.push(String(err)));
  page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text())});
  page.on('response',res=>{
    const u=res.url();
    if(sameOrigin(u)&&res.status()>=400)badResponses.push({url:u,status:res.status()});
  });
  const response=await page.goto(BASE_URL+'/astra/runtime/v18/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent!=='جارٍ التحميل',null,{timeout:20000});
  const rendered=await page.evaluate(()=>({
    status:document.querySelector('#status')?.textContent||'',
    session:document.querySelector('#session')?.textContent||'',
    opportunities:document.querySelector('#opportunities')?.textContent||'',
    decisionReady:document.querySelector('#decisionReady')?.textContent||'',
    active:document.querySelector('#active')?.textContent||'',
    current:document.querySelector('#current')?.textContent||'',
    critical:document.querySelector('#critical')?.textContent||'',
    high:document.querySelector('#high')?.textContent||'',
    snapshotId:document.querySelector('#snapshotId')?.textContent||'',
    snapshotHash:document.querySelector('#snapshotHash')?.textContent||'',
    guard:document.querySelector('#guard')?.textContent||'',
    isolation:document.querySelector('#isolation')?.textContent||'',
    footer:document.querySelector('#footer')?.textContent||'',
    resourceIds:globalThis.AstraRuntimeResources?.sourceIds||null,
    mainWidth:document.querySelector('main')?.getBoundingClientRect().width||0,
    scrollWidth:document.documentElement.scrollWidth,
    clientWidth:document.documentElement.clientWidth
  }));
  const generic404='Failed to load resource: the server responded with a status of 404 (File not found)';
  const benignBrowser404Diagnostics=badResponses.length===0?consoleErrors.filter(x=>x===generic404):[];
  const actionableConsoleErrors=consoleErrors.filter(x=>x!==generic404||badResponses.length>0);
  const checks={
    navigationHttpOk:Boolean(response&&response.ok()),
    readyStatus:rendered.status===pipeline.status,
    sessionMatches:rendered.session===pipeline.session,
    opportunitiesMatch:rendered.opportunities===String(pipeline.opportunities),
    decisionReadyMatches:rendered.decisionReady===`${pipeline.decisionReadyUniverse}/${pipeline.activeUniverse}`,
    activeMatches:rendered.active===String(pipeline.activeUniverse),
    currentMatches:rendered.current===`${pipeline.currentValidCanonicalUniverse}/${pipeline.activeUniverse}`,
    criticalMatches:rendered.critical===String(issues.criticalUnresolved),
    highMatches:rendered.high===String(issues.highProductionRelevantUnresolved),
    snapshotIdMatches:rendered.snapshotId===pipeline.decisionSnapshotId,
    snapshotHashMatches:rendered.snapshotHash===pipeline.semanticDecisionHash,
    guardMatches:rendered.guard===`${guard.status} · ${guard.selfTests.passed}/${guard.selfTests.total}`,
    isolationDeclaresNoCutover:/LOCAL_ARTIFACTS_ONLY/.test(rendered.isolation)&&/productionCutover=false/.test(rendered.isolation),
    footerMatchesHealth:rendered.footer.includes(`G11 ${metrics.sessionFreshnessStatus}`)&&rendered.footer.includes(`Decision pipeline ${metrics.decisionPipeline.status}`),
    sameOriginResourceContract:Boolean(rendered.resourceIds)&&Object.values(rendered.resourceIds).every(x=>typeof x==='string'&&!/^[a-z][a-z0-9+.-]*:/i.test(x)&&!String(x).startsWith('//')),
    zeroExternalRequests:externalRequests.length===0,
    zeroPageErrors:pageErrors.length===0,
    zeroActionableConsoleErrors:actionableConsoleErrors.length===0,
    browser404NoiseBounded:benignBrowser404Diagnostics.length<=1,
    zeroBadSameOriginResponses:badResponses.length===0,
    noHorizontalOverflow:rendered.scrollWidth<=rendered.clientWidth+1,
    viewportBounded:rendered.mainWidth<=profile.viewport.width+1
  };
  await context.close();
  return{
    name:profile.name,
    viewport:profile.viewport,
    isMobile:Boolean(profile.isMobile),
    status:failNames(checks).length?'FAIL':'PASS',
    checks,
    failedChecks:failNames(checks),
    rendered,
    externalRequests,
    pageErrors,
    consoleErrors,
    actionableConsoleErrors,
    benignBrowser404Diagnostics,
    badResponses
  };
}

async function captureBootstrap(browser){
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ar-EG'});
  const page=await context.newPage();
  const externalRequests=[];
  const pageErrors=[];
  page.on('request',req=>{if(!sameOrigin(req.url()))externalRequests.push(req.url())});
  page.on('pageerror',err=>pageErrors.push(String(err)));
  await page.goto(BASE_URL+'/v18-live/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForURL(url=>url.pathname.endsWith('/astra/runtime/v18/index.html'),{timeout:20000});
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='DECISION_SNAPSHOT_READY',null,{timeout:20000});
  const finalUrl=page.url();
  const checks={
    redirectsToLocalAstra:new URL(finalUrl).pathname.endsWith('/astra/runtime/v18/index.html'),
    sameOriginFinal:sameOrigin(finalUrl),
    zeroExternalRequests:externalRequests.length===0,
    zeroPageErrors:pageErrors.length===0
  };
  await context.close();
  return{status:failNames(checks).length?'FAIL':'PASS',checks,failedChecks:failNames(checks),finalUrl,externalRequests,pageErrors};
}

async function captureFailClosed(browser){
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ar-EG'});
  const page=await context.newPage();
  const pageErrors=[];
  const consoleErrors=[];
  const externalRequests=[];
  page.on('pageerror',err=>pageErrors.push(String(err)));
  page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text())});
  page.on('request',req=>{if(!sameOrigin(req.url()))externalRequests.push(req.url())});
  await page.route('**/docs/astra/G11_CURRENT_PIPELINE_RUN.json',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
  await page.goto(BASE_URL+'/astra/runtime/v18/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='FAIL-CLOSED',null,{timeout:20000});
  const view=await page.evaluate(()=>({
    status:document.querySelector('#status')?.textContent||'',
    footer:document.querySelector('#footer')?.textContent||''
  }));
  const checks={
    failClosedStatus:view.status==='FAIL-CLOSED',
    resourceFailureExposed:/HTTP 503/.test(view.footer),
    expectedBootErrorLogged:consoleErrors.some(x=>x.includes('ASTRA_LOCAL_V18_BOOT_FAILED')),
    zeroUncaughtPageErrors:pageErrors.length===0,
    zeroExternalRequests:externalRequests.length===0
  };
  await context.close();
  return{status:failNames(checks).length?'FAIL':'PASS',checks,failedChecks:failNames(checks),view,pageErrors,consoleErrors,externalRequests};
}

(async()=>{
  const preChecks={
    sourceHeadProvided:Boolean(SOURCE_HEAD),
    chromiumExecutableProvided:Boolean(CHROME_BIN),
    g01ThroughG14Green:Array.from({length:14},(_,i)=>map.get('G'+String(i+1).padStart(2,'0'))).every(x=>x==='GREEN'),
    g15PendingBeforeCertification:map.get('G15')==='PENDING',
    g16Pending:map.get('G16')==='PENDING',
    stateAligned:state.current_gate==='G15'&&state.last_green_gate==='G14'&&state.current_phase==='G15_PENDING',
    g14CertifiedGreen:g14.status==='GREEN'&&g14.productionCutover===false,
    persistedRuntimeSafe:pipeline.productionCutover===false&&pipeline.legacyNetworkCalls===0&&issues.criticalUnresolved===0&&issues.highProductionRelevantUnresolved===0&&guard.status==='PASS',
    strictZeroLegacy:legacy.clean===true&&legacy.runtimeLegacyDependencyCount===0&&Array.isArray(legacy.matches)&&legacy.matches.length===0
  };
  if(failNames(preChecks).length)throw new Error('G15_PRECHECK_FAILED '+failNames(preChecks).join(','));

  const browser=await chromium.launch({headless:true,executablePath:CHROME_BIN,args:['--no-sandbox']});
  const browserVersion=browser.version();
  let desktop,mobile,bootstrap,failClosed;
  try{
    desktop=await captureProfile(browser,{name:'chromium-desktop',viewport:{width:1440,height:1000}});
    mobile=await captureProfile(browser,{name:'chromium-mobile',viewport:{width:390,height:844},isMobile:true});
    bootstrap=await captureBootstrap(browser);
    failClosed=await captureFailClosed(browser);
  }finally{
    await browser.close();
  }

  const checks={
    ...preChecks,
    desktopPass:desktop.status==='PASS',
    mobilePass:mobile.status==='PASS',
    bootstrapLocalOnly:bootstrap.status==='PASS',
    failClosedPass:failClosed.status==='PASS',
    zeroExternalRequests:[desktop,mobile,bootstrap,failClosed].every(x=>(x.externalRequests||[]).length===0),
    renderedDecisionTruthMatches:desktop.checks.snapshotIdMatches&&desktop.checks.snapshotHashMatches&&mobile.checks.snapshotIdMatches&&mobile.checks.snapshotHashMatches,
    productionCutoverDisabled:pipeline.productionCutover===false&&g14.productionCutover===false
  };
  const failedChecks=failNames(checks);
  const evidence={
    schemaVersion:'astra-g15-browser-smoke-1',
    generatedAt:new Date().toISOString(),
    sourceHead:SOURCE_HEAD,
    workflowRunId:WORKFLOW_RUN_ID||null,
    gateStatusBeforeCertification:map.get('G15'),
    status:failedChecks.length?'FAIL':'PASS',
    checks,
    failedChecks,
    browser:{engine:'Chromium',version:browserVersion,executablePath:CHROME_BIN,profiles:['chromium-desktop','chromium-mobile']},
    target:{baseUrl:BASE_URL,surface:'astra/runtime/v18/index.html',bootstrap:'v18-live/index.html'},
    persistedTruth:{
      session:pipeline.session,
      status:pipeline.status,
      opportunities:pipeline.opportunities,
      decisionSnapshotId:pipeline.decisionSnapshotId,
      semanticDecisionHash:pipeline.semanticDecisionHash,
      activeUniverse:pipeline.activeUniverse,
      currentValidCanonicalUniverse:pipeline.currentValidCanonicalUniverse,
      decisionReadyUniverse:pipeline.decisionReadyUniverse
    },
    scenarios:{desktop,mobile,bootstrap,failClosed},
    strictLegacyScan:{clean:legacy.clean,runtimeLegacyDependencyCount:legacy.runtimeLegacyDependencyCount,matches:(legacy.matches||[]).length},
    productionCutover:false
  };

  if(WRITE&&failedChecks.length===0){
    writeJson('docs/astra/G15_BROWSER_SMOKE_EVIDENCE.json',evidence);
    const report=[
      '# G15 Chromium Browser Smoke',
      '',
      '- Status: **PASS**',
      '- Source HEAD: `'+SOURCE_HEAD+'`',
      '- Workflow run: **'+(WORKFLOW_RUN_ID||'LOCAL')+'**',
      '- Chromium: **'+browserVersion+'**',
      '- Desktop viewport: **1440 × 1000**',
      '- Mobile viewport: **390 × 844**',
      '- External requests: **0**',
      '- Uncaught page errors on happy paths: **0**',
      '- DecisionSnapshot ID: `'+pipeline.decisionSnapshotId+'`',
      '- Semantic decision hash: `'+pipeline.semanticDecisionHash+'`',
      '- Fail-closed resource outage scenario: **PASS**',
      '- Legacy runtime dependencies: **0**',
      '- Production cutover: **false**',
      '',
      '## Browser acceptance boundary',
      '',
      'The standalone Astra V18 local surface rendered persisted G11 decision truth in real Chromium on desktop and mobile, used same-origin resources only, redirected the former V18 live bootstrap to the local surface, and failed closed when the primary pipeline resource was unavailable.'
    ].join('\n')+'\n';
    fs.writeFileSync(path.join(ROOT,'docs/astra/G15_BROWSER_SMOKE_REPORT.md'),report);
  }

  console.log(JSON.stringify(evidence,null,2));
  if(failedChecks.length)process.exitCode=1;
})().catch(error=>{
  console.error(error&&error.stack||error);
  process.exit(1);
});
