'use strict';

const fs=require('fs');
const path=require('path');
const {chromium}=require('playwright-core');
const {scanLegacyDependencies}=require('./legacy-isolation.cjs');

const ROOT=path.resolve(__dirname,'../..');
const WRITE=process.argv.includes('--write');
const BASE_URL=String(process.env.G17_PRODUCTION_URL||'https://rasheadsca-star.github.io/RAS-EGX-PRO2026-NEXT/astra-prod/').replace(/\/$/,'');
const RUNTIME_URL=String(process.env.G17_RUNTIME_URL||BASE_URL+'/runtime/v18/index.html');
const SITE_ROOT=BASE_URL.replace(/\/astra-prod$/,'');
const CHROME_BIN=process.env.CHROME_BIN||'';
const SOURCE_HEAD=process.env.G17_SOURCE_HEAD||'';
const WORKFLOW_RUN_ID=Number(process.env.G17_WORKFLOW_RUN_ID||0);
const NONCE=`${WORKFLOW_RUN_ID||'local'}-${Date.now()}`;

function readJson(rel){return JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8'))}
function writeJson(rel,value){fs.writeFileSync(path.join(ROOT,rel),JSON.stringify(value,null,2)+'\n')}
function gateMap(g){return new Map((g.gates||[]).map(x=>[x.id,x.status]))}
function sameOrigin(url){try{return new URL(url).origin===new URL(BASE_URL).origin}catch{return false}}
function failNames(obj){return Object.entries(obj).filter(([,v])=>v!==true).map(([k])=>k)}
function expectedTruth(){
  const pipeline=readJson('docs/astra/G11_CURRENT_PIPELINE_RUN.json');
  const metrics=readJson('docs/astra/G11_DATA_HEALTH_METRICS.json');
  const issues=readJson('docs/astra/G11_DATA_HEALTH_ISSUES.json');
  const guard=readJson('docs/astra/G11_GUARD37_EVIDENCE.json');
  return{pipeline,metrics,issues,guard};
}

async function fetchBytes(url){
  const sep=url.includes('?')?'&':'?';
  const response=await fetch(`${url}${sep}g17=${encodeURIComponent(NONCE)}`,{cache:'no-store',redirect:'follow',headers:{'cache-control':'no-cache','pragma':'no-cache'}});
  if(!response.ok)throw new Error(`LIVE_FETCH_FAILED ${response.status} ${url}`);
  return{buffer:Buffer.from(await response.arrayBuffer()),status:response.status,finalUrl:response.url};
}

async function verifyLiveBytes(){
  const runtimePairs=[
    ['astra/runtime/v18/index.html',BASE_URL+'/runtime/v18/index.html'],
    ['astra/runtime/v18/resource-client.js',BASE_URL+'/runtime/v18/resource-client.js'],
    ['astra/runtime/v18/app.js',BASE_URL+'/runtime/v18/app.js']
  ];
  const truthNames=['G11_CURRENT_PIPELINE_RUN.json','G11_DATA_HEALTH_METRICS.json','G11_DATA_HEALTH_ISSUES.json','G11_GUARD37_EVIDENCE.json'];
  const runtime=[];
  for(const [local,live] of runtimePairs){
    const got=await fetchBytes(live),expected=fs.readFileSync(path.join(ROOT,local));
    runtime.push({file:local,url:live,status:got.status,match:Buffer.compare(expected,got.buffer)===0,bytes:got.buffer.length});
  }
  const truth=[];
  for(const name of truthNames){
    const local='docs/astra/'+name,live=SITE_ROOT+'/docs/astra/'+name;
    const got=await fetchBytes(live),expected=fs.readFileSync(path.join(ROOT,local));
    truth.push({file:local,url:live,status:got.status,match:Buffer.compare(expected,got.buffer)===0,bytes:got.buffer.length});
  }
  const manifestFetch=await fetchBytes(BASE_URL+'/G16_DEPLOYMENT_MANIFEST.json');
  const manifest=JSON.parse(manifestFetch.buffer.toString('utf8'));
  const manifestChecks={
    isolatedPath:manifest.isolatedPath==='astra-prod/',
    publicEntrypointUnchanged:manifest.publicEntrypointChanged===false,
    productionCutoverDisabled:manifest.productionCutover===false,
    zeroLegacyRuntime:manifest.runtimeLegacyDependencyCount===0,
    zeroExternalReferences:manifest.runtimeExternalReferences===0
  };
  return{
    runtime,
    truth,
    runtimeAllExact:runtime.every(x=>x.match&&x.status===200),
    truthAllExact:truth.every(x=>x.match&&x.status===200),
    manifest,
    manifestChecks,
    manifestValid:failNames(manifestChecks).length===0
  };
}

function renderedSnapshot(){
  return()=>({
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
  });
}

async function captureProfile(browser,profile,{throughRoot=false}={}){
  const {pipeline,metrics,issues,guard}=expectedTruth();
  const context=await browser.newContext({
    viewport:profile.viewport,
    isMobile:Boolean(profile.isMobile),
    locale:'ar-EG',
    extraHTTPHeaders:{'Cache-Control':'no-cache','Pragma':'no-cache'}
  });
  const page=await context.newPage();
  const externalRequests=[];
  const pageErrors=[];
  const consoleErrors=[];
  const badResponses=[];
  page.on('request',req=>{if(!sameOrigin(req.url()))externalRequests.push(req.url())});
  page.on('pageerror',err=>pageErrors.push(String(err)));
  page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text())});
  page.on('response',res=>{if(sameOrigin(res.url())&&res.status()>=400)badResponses.push({url:res.url(),status:res.status()})});

  const target=throughRoot?`${BASE_URL}/?g17=${encodeURIComponent(NONCE)}`:`${RUNTIME_URL}?g17=${encodeURIComponent(NONCE)}-${profile.name}`;
  const response=await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  if(throughRoot)await page.waitForURL(url=>url.pathname.endsWith('/astra-prod/runtime/v18/index.html'),{timeout:20000});
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent!=='جارٍ التحميل',null,{timeout:20000});
  const rendered=await page.evaluate(renderedSnapshot());
  const checks={
    navigationHttpOk:Boolean(response&&response.ok()),
    finalRuntimePath:new URL(page.url()).pathname.endsWith('/astra-prod/runtime/v18/index.html'),
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
    zeroConsoleErrors:consoleErrors.length===0,
    zeroBadSameOriginResponses:badResponses.length===0,
    noHorizontalOverflow:rendered.scrollWidth<=rendered.clientWidth+1,
    viewportBounded:rendered.mainWidth<=profile.viewport.width+1
  };
  const result={
    name:profile.name,
    throughRoot,
    viewport:profile.viewport,
    isMobile:Boolean(profile.isMobile),
    requestedUrl:target,
    finalUrl:page.url(),
    status:failNames(checks).length?'FAIL':'PASS',
    checks,
    failedChecks:failNames(checks),
    rendered,
    externalRequests,
    pageErrors,
    consoleErrors,
    badResponses
  };
  await context.close();
  return result;
}

async function captureFailClosed(browser){
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ar-EG',extraHTTPHeaders:{'Cache-Control':'no-cache','Pragma':'no-cache'}});
  const page=await context.newPage();
  const pageErrors=[];
  const consoleErrors=[];
  const externalRequests=[];
  page.on('pageerror',err=>pageErrors.push(String(err)));
  page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text())});
  page.on('request',req=>{if(!sameOrigin(req.url()))externalRequests.push(req.url())});
  await page.route('**/docs/astra/G11_CURRENT_PIPELINE_RUN.json*',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
  await page.goto(`${RUNTIME_URL}?g17-fail=${encodeURIComponent(NONCE)}`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='FAIL-CLOSED',null,{timeout:20000});
  const view=await page.evaluate(()=>({status:document.querySelector('#status')?.textContent||'',footer:document.querySelector('#footer')?.textContent||''}));
  const checks={
    failClosedStatus:view.status==='FAIL-CLOSED',
    resourceFailureExposed:/HTTP 503/.test(view.footer),
    expectedBootErrorLogged:consoleErrors.some(x=>x.includes('ASTRA_LOCAL_V18_BOOT_FAILED')),
    zeroUncaughtPageErrors:pageErrors.length===0,
    zeroExternalRequests:externalRequests.length===0
  };
  const result={status:failNames(checks).length?'FAIL':'PASS',checks,failedChecks:failNames(checks),view,pageErrors,consoleErrors,externalRequests};
  await context.close();
  return result;
}

(async()=>{
  const gates=readJson('04_ACCEPTANCE_GATES.json');
  const primary=readJson('05_WORK_STATE.json');
  const docsState=readJson('docs/astra/WORK_STATE.json');
  const g16=readJson('docs/astra/G16_CERTIFICATION.json');
  const {pipeline,issues,guard}=expectedTruth();
  const map=gateMap(gates);
  const legacy=scanLegacyDependencies(ROOT);
  const preChecks={
    sourceHeadProvided:Boolean(SOURCE_HEAD),
    chromiumExecutableProvided:Boolean(CHROME_BIN),
    g01ThroughG16Green:Array.from({length:16},(_,i)=>map.get('G'+String(i+1).padStart(2,'0'))).every(x=>x==='GREEN'),
    g17PendingBeforeCertification:map.get('G17')==='PENDING',
    laterGatesPending:map.get('G18')==='PENDING'&&map.get('G19')==='PENDING',
    stateAligned:primary.current_gate==='G17'&&primary.last_green_gate==='G16'&&primary.current_phase==='G17_PENDING'&&docsState.current_gate==='G17'&&docsState.last_green_gate==='G16'&&docsState.current_phase==='G17_PENDING',
    g16CertifiedGreen:g16.status==='GREEN'&&g16.productionCutover===false&&g16.runtimeLegacyDependencyCount===0&&g16.runtimeExternalReferences===0&&g16.deployment?.provider==='GITHUB_PAGES',
    productionUrlPinned:g16.deployment?.productionUrl===BASE_URL+'/'&&g16.deployment?.runtimeUrl===RUNTIME_URL,
    persistedTruthSafe:pipeline.productionCutover===false&&pipeline.legacyNetworkCalls===0&&issues.criticalUnresolved===0&&issues.highProductionRelevantUnresolved===0&&guard.status==='PASS',
    strictZeroLegacy:legacy.clean===true&&legacy.runtimeLegacyDependencyCount===0&&Array.isArray(legacy.matches)&&legacy.matches.length===0
  };
  const preFailed=failNames(preChecks);
  if(preFailed.length)throw new Error('G17_PRECHECK_FAILED '+preFailed.join(','));

  const liveBytes=await verifyLiveBytes();
  if(!liveBytes.runtimeAllExact||!liveBytes.truthAllExact||!liveBytes.manifestValid)throw new Error('G17_LIVE_BYTES_OR_MANIFEST_FAILED');

  const browser=await chromium.launch({headless:true,executablePath:CHROME_BIN,args:['--no-sandbox']});
  const browserVersion=browser.version();
  let root,desktop,mobile,failClosed;
  try{
    root=await captureProfile(browser,{name:'production-root-desktop',viewport:{width:1440,height:1000}},{throughRoot:true});
    desktop=await captureProfile(browser,{name:'chromium-desktop',viewport:{width:1440,height:1000}});
    mobile=await captureProfile(browser,{name:'chromium-mobile',viewport:{width:390,height:844},isMobile:true});
    failClosed=await captureFailClosed(browser);
  }finally{
    await browser.close();
  }

  const checks={
    ...preChecks,
    liveRuntimeByteExact:liveBytes.runtimeAllExact,
    livePersistedTruthByteExact:liveBytes.truthAllExact,
    deploymentManifestSafe:liveBytes.manifestValid,
    productionRootPass:root.status==='PASS',
    desktopPass:desktop.status==='PASS',
    mobilePass:mobile.status==='PASS',
    failClosedPass:failClosed.status==='PASS',
    zeroExternalRequests:[root,desktop,mobile,failClosed].every(x=>(x.externalRequests||[]).length===0),
    renderedDecisionTruthMatches:[root,desktop,mobile].every(x=>x.checks.snapshotIdMatches&&x.checks.snapshotHashMatches),
    productionCutoverDisabled:pipeline.productionCutover===false&&g16.productionCutover===false&&liveBytes.manifest.productionCutover===false
  };
  const failedChecks=failNames(checks);
  const evidence={
    schemaVersion:'astra-g17-live-production-verification-1',
    generatedAt:new Date().toISOString(),
    sourceHead:SOURCE_HEAD,
    workflowRunId:WORKFLOW_RUN_ID||null,
    gateStatusBeforeCertification:map.get('G17'),
    status:failedChecks.length?'FAIL':'PASS',
    checks,
    failedChecks,
    browser:{engine:'Chromium',version:browserVersion,executablePath:CHROME_BIN,profiles:['production-root-desktop','chromium-desktop','chromium-mobile']},
    target:{provider:'GITHUB_PAGES',productionUrl:BASE_URL+'/',runtimeUrl:RUNTIME_URL,siteRoot:SITE_ROOT,isolatedPath:'astra-prod/'},
    persistedTruth:{session:pipeline.session,status:pipeline.status,opportunities:pipeline.opportunities,decisionSnapshotId:pipeline.decisionSnapshotId,semanticDecisionHash:pipeline.semanticDecisionHash,activeUniverse:pipeline.activeUniverse,currentValidCanonicalUniverse:pipeline.currentValidCanonicalUniverse,decisionReadyUniverse:pipeline.decisionReadyUniverse},
    liveBytes,
    scenarios:{root,desktop,mobile,failClosed},
    strictLegacyScan:{clean:legacy.clean,runtimeLegacyDependencyCount:legacy.runtimeLegacyDependencyCount,matches:(legacy.matches||[]).length},
    productionCutover:false
  };

  if(WRITE&&failedChecks.length===0){
    writeJson('docs/astra/G17_LIVE_PRODUCTION_EVIDENCE.json',evidence);
    const report=[
      '# G17 Live Production Verification','',
      '- Status: **PASS**',
      '- Provider: **GitHub Pages**',
      '- Source HEAD: `'+SOURCE_HEAD+'`',
      '- Workflow run: **'+(WORKFLOW_RUN_ID||'LOCAL')+'**',
      '- Production URL: '+BASE_URL+'/',
      '- Runtime URL: '+RUNTIME_URL,
      '- Chromium: **'+browserVersion+'**',
      '- Production root redirect: **PASS**',
      '- Desktop live runtime: **PASS**',
      '- Mobile live runtime: **PASS**',
      '- Live runtime files byte-exact: **PASS**',
      '- Persisted Decision Truth byte-exact: **PASS**',
      '- External requests: **0**',
      '- DecisionSnapshot ID: `'+pipeline.decisionSnapshotId+'`',
      '- Semantic decision hash: `'+pipeline.semanticDecisionHash+'`',
      '- Fail-closed live resource outage scenario: **PASS**',
      '- Legacy runtime dependencies: **0**',
      '- Production cutover: **false**','',
      '## Acceptance boundary','',
      'G17 verifies the already deployed isolated Astra production path in a real Chromium browser. It does not change or exercise a legacy/public cutover. The live surface must render the certified persisted decision truth, remain same-origin only, match certified runtime/truth bytes, and fail closed when the primary decision resource is unavailable.'
    ].join('\n')+'\n';
    fs.writeFileSync(path.join(ROOT,'docs/astra/G17_LIVE_PRODUCTION_REPORT.md'),report);
  }

  console.log(JSON.stringify(evidence,null,2));
  if(failedChecks.length)process.exitCode=1;
})().catch(error=>{console.error(error&&error.stack||error);process.exit(1)});
