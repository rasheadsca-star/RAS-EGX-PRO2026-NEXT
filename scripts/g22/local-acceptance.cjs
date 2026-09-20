'use strict';

const fs=require('fs');
const path=require('path');
const {chromium}=require('playwright-core');

const ROOT=path.resolve(__dirname,'../..');
const WRITE=process.argv.includes('--write');
const BASE=String(process.env.G22_LOCAL_BASE_URL||'http://127.0.0.1:4173').replace(/\/$/,'');
const CHROME_BIN=process.env.CHROME_BIN||'';
const SOURCE_HEAD=process.env.G22_SOURCE_HEAD||'';
const RUN=Number(process.env.G22_WORKFLOW_RUN_ID||0);

const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const write=(p,v)=>fs.writeFileSync(path.join(ROOT,p),JSON.stringify(v,null,2)+'\n');
const failed=o=>Object.entries(o).filter(([,v])=>v!==true).map(([k])=>k);
const sameOrigin=u=>{try{return new URL(u).origin===new URL(BASE).origin}catch{return false}};

async function profile(browser,name,viewport,isMobile,ticker){
  const ctx=await browser.newContext({viewport,isMobile:Boolean(isMobile),locale:'ar-EG'});
  const page=await ctx.newPage();
  const external=[],pageErrors=[],bad=[];
  page.on('request',r=>{if(!sameOrigin(r.url()))external.push(r.url())});
  page.on('pageerror',e=>pageErrors.push(String(e)));
  page.on('response',r=>{if(sameOrigin(r.url())&&r.status()>=400)bad.push({url:r.url(),status:r.status()})});
  await page.goto(BASE+'/deploy/g22-full-app/index.html?g22='+RUN+'-'+name,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>document.documentElement.dataset.g22Ready==='true',null,{timeout:30000});
  const ready=await page.evaluate(()=>globalThis.__ASTRA_G22_READY__);

  await page.click('[data-view="recommendations"]');
  const recRows=await page.locator('#view-recommendations tbody tr').count();

  await page.click('[data-view="search"]');
  await page.fill('#marketSearch',ticker);
  await page.click('#searchBtn');
  await page.waitForSelector('[data-stock]',{timeout:10000});
  await page.locator('[data-stock]').first().click();
  await page.waitForFunction(t=>document.querySelector('#stockDetail')?.textContent?.includes(t),ticker,{timeout:10000});
  const stockText=await page.locator('#stockDetail').innerText();

  await page.click('[data-view="portfolio"]');
  await page.selectOption('#pfTicker',ticker);
  await page.fill('#pfQty','100');
  await page.fill('#pfAvg','10');
  await page.click('#pfAdd');
  const portfolioText=await page.locator('#pfRows').innerText();
  const portfolioStored=await page.evaluate(()=>JSON.parse(localStorage.getItem('egx-astra-g22-portfolio')||'[]').length>0);

  await page.click('[data-view="history"]');
  const historyRows=await page.locator('#view-history tbody tr').count();

  await page.click('[data-view="health"]');
  const healthText=await page.locator('#view-health').innerText();

  const layout=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,nav:document.querySelectorAll('#nav button').length}));
  await page.evaluate(()=>localStorage.removeItem('egx-astra-g22-portfolio'));

  const checks={
    readyObject:Boolean(ready?.snapshotId&&ready?.semanticDecisionHash),
    recommendationCountMatches:recRows===Number(ready?.recommendations||0)&&recRows>0,
    searchFoundRecommendation:stockText.includes(ticker)&&stockText.includes('ضمن توصيات Astra الحالية'),
    portfolioLocalLifecycle:portfolioText.includes(ticker)&&portfolioStored,
    recommendationHistoryVisible:historyRows>0,
    healthShowsDecisionIdentity:healthText.includes(ready.snapshotId)&&healthText.includes(ready.semanticDecisionHash),
    sixPrimaryViews:layout.nav===6,
    zeroExternalRequests:external.length===0,
    zeroPageErrors:pageErrors.length===0,
    zeroBadResponses:bad.length===0,
    noHorizontalOverflow:layout.sw<=layout.cw+1
  };
  const out={name,status:failed(checks).length?'FAIL':'PASS',checks,failedChecks:failed(checks),ready,externalRequests:external,pageErrors,badResponses:bad,layout};
  await ctx.close();
  return out;
}

(async()=>{
  const data=read('deploy/g22-full-app/data.json');
  const baseline=read('docs/astra/G22_BASELINE.json');
  const first=data.decisionSnapshot?.top5?.[0]?.ticker;
  if(!first)throw new Error('G22_LOCAL_NO_RECOMMENDATION');
  const preChecks={
    sourceHeadProvided:Boolean(SOURCE_HEAD),
    chromeProvided:Boolean(CHROME_BIN),
    exactRebuild:data.integrity?.rebuildExact===true,
    decisionIdMatches:data.sourceDecision?.decisionSnapshotId===baseline.decisionSnapshotId,
    semanticHashMatches:data.sourceDecision?.semanticDecisionHash===baseline.semanticDecisionHash,
    zeroLegacyNetworkCalls:data.integrity?.zeroLegacyNetworkCalls===true,
    zeroQuantEdgeLiveInfluence:Number(data.integrity?.quantEdgeLiveInfluence||0)===0,
    noSyntheticRecommendations:data.uiPolicy?.noSyntheticRecommendations===true,
    noLegacyDecisionSource:data.uiPolicy?.noLegacyDecisionSource===true
  };
  const pf=failed(preChecks);if(pf.length)throw new Error('G22_LOCAL_PRECHECK '+pf.join(','));

  const browser=await chromium.launch({headless:true,executablePath:CHROME_BIN,args:['--no-sandbox']});
  const version=browser.version();
  let desktop,mobile;
  try{
    desktop=await profile(browser,'desktop',{width:1440,height:1000},false,first);
    mobile=await profile(browser,'mobile',{width:390,height:844},true,first);
  }finally{await browser.close()}

  const checks={...preChecks,desktopPass:desktop.status==='PASS',mobilePass:mobile.status==='PASS'};
  const fail=failed(checks);
  const evidence={
    schemaVersion:'astra-g22-local-ui-acceptance-1',
    generatedAt:new Date().toISOString(),
    sourceHead:SOURCE_HEAD,
    workflowRunId:RUN||null,
    status:fail.length?'FAIL':'PASS',
    checks,
    failedChecks:fail,
    browser:{engine:'Chromium',version,desktop,mobile},
    decisionSnapshotId:data.sourceDecision.decisionSnapshotId,
    semanticDecisionHash:data.sourceDecision.semanticDecisionHash,
    recommendations:data.decisionSnapshot.top5.length,
    views:['home','recommendations','search','portfolio','history','health'],
    productionMutated:false
  };
  if(WRITE&&!fail.length){
    write('docs/astra/G22_LOCAL_UI_EVIDENCE.json',evidence);
    fs.writeFileSync(path.join(ROOT,'docs/astra/G22_LOCAL_UI_REPORT.md'),[
      '# G22 Full Application Local Acceptance','',
      '- Status: **PASS**',
      '- DecisionSnapshot exact rebuild: **PASS**',
      '- Recommendations rendered: **'+evidence.recommendations+'**',
      '- Desktop Chromium: **PASS**',
      '- Mobile Chromium: **PASS**',
      '- Full-market search & stock detail: **PASS**',
      '- Local portfolio lifecycle: **PASS**',
      '- Recommendation history: **PASS**',
      '- System health: **PASS**',
      '- External requests: **0**',
      '- Production mutated: **false**'
    ].join('\n')+'\n');
  }
  console.log(JSON.stringify(evidence,null,2));
  if(fail.length)process.exitCode=1;
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
