'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto');
const {chromium}=require('playwright-core');
const {scanLegacyDependencies}=require('./legacy-isolation.cjs');
const ROOT=path.resolve(__dirname,'../..'),WRITE=process.argv.includes('--write');
const CHROME_BIN=process.env.CHROME_BIN||'',SOURCE_HEAD=process.env.G18_SOURCE_HEAD||'';
const RUN=Number(process.env.G18_WORKFLOW_RUN_ID||0),BASELINE=process.env.G18_BASELINE_ROOT_FILE||'';
const MAIN=process.env.G18_PRODUCTION_MAIN_HEAD||'',EXPECTED=process.env.G18_EXPECTED_MAIN_HEAD||'';
const read=r=>JSON.parse(fs.readFileSync(path.join(ROOT,r),'utf8'));
const write=(r,v)=>fs.writeFileSync(path.join(ROOT,r),JSON.stringify(v,null,2)+'\n');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fails=o=>Object.entries(o).filter(([,v])=>v!==true).map(([k])=>k);
const gates=()=>new Map(read('04_ACCEPTANCE_GATES.json').gates.map(x=>[x.id,x.status]));
const TRUTH=()=>({p:read('docs/astra/G11_CURRENT_PIPELINE_RUN.json'),i:read('docs/astra/G11_DATA_HEALTH_ISSUES.json')});
const legacyRoutes=['/v18-live/legacy-remote-shell','/legacy/v19-remote-challenger','/legacy/v20-native-pages','/legacy/quant-edge-api','/legacy/sepa-x-api','/deploy/rc2-safe-shell/legacy-proxy','/legacy/sepa-cross-branch-build'];
const hosts=['raw.githubusercontent.com','cdn.jsdelivr.net','quant-edge-shadow.vercel.app','sepax-strategy-stable.vercel.app','egx-tfe-v20-fusion-rc2.vercel.app'];
function forbiddenRefs(){const out=[];for(const f of ['astra/runtime/v18/index.html','astra/runtime/v18/resource-client.js','astra/runtime/v18/app.js']){const s=fs.readFileSync(path.join(ROOT,f),'utf8');for(const h of hosts)if(s.includes(h))out.push({file:f,host:h})}return out}
function server(baseline){
 let mode='baseline',fail=false;
 const s=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1'),p=u.pathname;
  if(legacyRoutes.includes(p)){res.writeHead(410,{'content-type':'text/plain'});return res.end('LEGACY_DISABLED')}
  if(p==='/'||p==='/index.html'){
   if(mode==='cutover'){res.writeHead(302,{location:'/astra-prod/runtime/v18/index.html'});return res.end()}
   res.writeHead(200,{'content-type':'text/html'});return res.end(baseline)
  }
  const map={
   '/astra-prod/runtime/v18/index.html':'astra/runtime/v18/index.html',
   '/astra-prod/runtime/v18/resource-client.js':'astra/runtime/v18/resource-client.js',
   '/astra-prod/runtime/v18/app.js':'astra/runtime/v18/app.js',
   '/docs/astra/G11_CURRENT_PIPELINE_RUN.json':'docs/astra/G11_CURRENT_PIPELINE_RUN.json',
   '/docs/astra/G11_DATA_HEALTH_METRICS.json':'docs/astra/G11_DATA_HEALTH_METRICS.json',
   '/docs/astra/G11_DATA_HEALTH_ISSUES.json':'docs/astra/G11_DATA_HEALTH_ISSUES.json',
   '/docs/astra/G11_GUARD37_EVIDENCE.json':'docs/astra/G11_GUARD37_EVIDENCE.json'
  };
  if(fail&&p==='/docs/astra/G11_CURRENT_PIPELINE_RUN.json'){res.writeHead(503,{'content-type':'application/json'});return res.end('{}')}
  const rel=map[p];if(!rel){res.writeHead(404);return res.end('NOT_FOUND')}
  const body=fs.readFileSync(path.join(ROOT,rel)),ct=rel.endsWith('.html')?'text/html':rel.endsWith('.js')?'text/javascript':'application/json';
  res.writeHead(200,{'content-type':ct,'cache-control':'no-store'});res.end(body)
 });
 return{s,setMode:x=>mode=x,setFail:x=>fail=x};
}
async function get(url){const r=await fetch(url,{redirect:'manual',cache:'no-store'});return{status:r.status,body:Buffer.from(await r.arrayBuffer())}}
async function scenario(browser,base,mobile,failClosed){
 const t=TRUTH(),ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,locale:'ar-EG'});
 const page=await ctx.newPage(),external=[],errors=[],bad=[];
 page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url())});
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('response',r=>{if(new URL(r.url()).origin===new URL(base).origin&&r.status()>=400)bad.push({url:r.url(),status:r.status()})});
 const nav=await page.goto(base+'/?g18='+RUN+(mobile?'-m':'-d'),{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForURL(u=>u.pathname.endsWith('/astra-prod/runtime/v18/index.html'),{timeout:15000});
 await page.waitForFunction(()=>document.querySelector('#status')?.textContent!=='جارٍ التحميل',null,{timeout:15000});
 const v=await page.evaluate(()=>({status:document.querySelector('#status')?.textContent||'',id:document.querySelector('#snapshotId')?.textContent||'',h:document.querySelector('#snapshotHash')?.textContent||'',iso:document.querySelector('#isolation')?.textContent||'',sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));
 const c=failClosed?{
  finalRuntimePath:new URL(page.url()).pathname.endsWith('/astra-prod/runtime/v18/index.html'),failClosed:v.status==='FAIL-CLOSED',zeroExternal:external.length===0,zeroPageErrors:errors.length===0,expected503:bad.some(x=>x.status===503)
 }:{
  finalRuntimePath:new URL(page.url()).pathname.endsWith('/astra-prod/runtime/v18/index.html'),ready:v.status===t.p.status,id:v.id===t.p.decisionSnapshotId,hash:v.h===t.p.semanticDecisionHash,noRealCutover:/productionCutover=false/.test(v.iso),zeroExternal:external.length===0,zeroPageErrors:errors.length===0,zeroBad:bad.length===0,noOverflow:v.sw<=v.cw+1
 };
 const out={status:fails(c).length?'FAIL':'PASS',checks:c,failedChecks:fails(c),view:v,externalRequests:external,pageErrors:errors,badResponses:bad};await ctx.close();return out
}
(async()=>{
 if(!BASELINE||!fs.existsSync(BASELINE))throw Error('baseline root missing');
 const baseline=fs.readFileSync(BASELINE),bh=hash(baseline),m=gates(),a=read('05_WORK_STATE.json'),b=read('docs/astra/WORK_STATE.json'),g17=read('docs/astra/G17_CERTIFICATION.json'),plan=read('docs/astra/LEGACY_REMOVAL_PLAN.json'),legacy=scanLegacyDependencies(ROOT),refs=forbiddenRefs(),t=TRUTH();
 const pre={
  sourceHead:Boolean(SOURCE_HEAD),chromium:Boolean(CHROME_BIN),
  g01to17:Array.from({length:17},(_,i)=>m.get('G'+String(i+1).padStart(2,'0'))).every(x=>x==='GREEN'),
  g18Pending:m.get('G18')==='PENDING',g19Pending:m.get('G19')==='PENDING',
  stateAligned:a.current_gate==='G18'&&a.last_green_gate==='G17'&&a.current_phase==='G18_PENDING'&&b.current_gate==='G18'&&b.last_green_gate==='G17'&&b.current_phase==='G18_PENDING',
  g17Green:g17.status==='GREEN'&&g17.productionCutover===false&&g17.runtimeLegacyDependencyCount===0&&g17.externalRequests===0,
  mainPinned:Boolean(MAIN)&&MAIN===EXPECTED,eightClosed:plan.dependencies.length===8&&plan.dependencies.every(x=>x.status==='CLOSED'),
  zeroLegacy:legacy.clean===true&&legacy.runtimeLegacyDependencyCount===0&&(legacy.matches||[]).length===0,noForbiddenRefs:refs.length===0,
  truthSafe:t.p.productionCutover===false&&t.p.legacyNetworkCalls===0&&t.i.criticalUnresolved===0&&t.i.highProductionRelevantUnresolved===0
 };
 if(fails(pre).length)throw Error('G18_PRECHECK '+fails(pre).join(','));
 const ctl=server(baseline);await new Promise((ok,no)=>{ctl.s.once('error',no);ctl.s.listen(0,'127.0.0.1',ok)});
 const base='http://127.0.0.1:'+ctl.s.address().port;let browser;
 try{
  const before=await get(base+'/'),baselineChecks={status200:before.status===200,hashExact:hash(before.body)===bh};
  ctl.setMode('cutover');
  const disabled=[];for(const r of legacyRoutes){const x=await get(base+r);disabled.push({route:r,status:x.status,disabled:x.status===410})}
  browser=await chromium.launch({headless:true,executablePath:CHROME_BIN,args:['--no-sandbox']});
  const desktop=await scenario(browser,base,false,false),mobile=await scenario(browser,base,true,false);
  ctl.setFail(true);const failClosed=await scenario(browser,base,false,true);ctl.setFail(false);
  ctl.setMode('baseline');const rb=await get(base+'/'),rollbackChecks={status200:rb.status===200,baselineHashRestored:hash(rb.body)===bh};
  const checks={...pre,baselinePreserved:fails(baselineChecks).length===0,desktopPass:desktop.status==='PASS',mobilePass:mobile.status==='PASS',allLegacyDisabled:disabled.every(x=>x.disabled),failClosedPass:failClosed.status==='PASS',rollbackExact:fails(rollbackChecks).length===0,simulationOnly:true,productionCutoverFalse:true};
  const failed=fails(checks),e={schemaVersion:'astra-g18-legacy-off-cutover-simulation-1',generatedAt:new Date().toISOString(),sourceHead:SOURCE_HEAD,workflowRunId:RUN||null,status:failed.length?'FAIL':'PASS',checks,failedChecks:failed,production:{mainHeadBefore:MAIN,expectedMainHead:EXPECTED,mutated:false},baseline:{rootSha256:bh,checks:baselineChecks},cutoverSimulation:{mode:'IN_MEMORY_LOCAL_ROUTING_ONLY',rootTarget:'/astra-prod/runtime/v18/index.html',legacyDependencyIds:plan.dependencies.map(x=>x.dependencyId),legacyRoutes:disabled,prohibitedHostReferences:refs,desktop,mobile,failClosed},rollback:{rootSha256:hash(rb.body),checks:rollbackChecks},strictLegacyScan:{clean:legacy.clean,runtimeLegacyDependencyCount:legacy.runtimeLegacyDependencyCount,matches:(legacy.matches||[]).length},decisionSnapshotId:t.p.decisionSnapshotId,semanticDecisionHash:t.p.semanticDecisionHash,externalRequests:0,runtimeLegacyDependencyCount:0,runtimeExternalReferences:0,productionCutover:false,g19Increment:0};
  if(WRITE&&!failed.length){write('docs/astra/G18_CUTOVER_SIMULATION_EVIDENCE.json',e);fs.writeFileSync(path.join(ROOT,'docs/astra/G18_CUTOVER_SIMULATION_REPORT.md'),['# G18 Legacy-off Cutover Simulation','','- Status: **PASS**','- Mode: **simulation only / in-memory local routing**','- Source HEAD: '+SOURCE_HEAD,'- Workflow run: **'+(RUN||'LOCAL')+'**','- Production main: '+MAIN,'- Legacy families disabled: **8/8**','- Desktop: **PASS**','- Mobile: **PASS**','- Fail-closed: **PASS**','- Rollback baseline byte-exact: **PASS**','- External requests: **0**','- Runtime legacy dependencies: **0**','- Production cutover: **false**','- G19 increment: **0**'].join('\n')+'\n')}
  console.log(JSON.stringify(e,null,2));if(failed.length)process.exitCode=1
 }finally{if(browser)await browser.close();await new Promise(ok=>ctl.s.close(ok))}
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
