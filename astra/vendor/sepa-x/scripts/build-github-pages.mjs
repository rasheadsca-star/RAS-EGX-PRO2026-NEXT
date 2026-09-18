import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiHandler from '../api/index.js';
import { portfolioReadout } from '../src/portfolio-intelligence.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const out=path.resolve(process.argv[2]||path.join(root,'.github-pages'));

const readJson=(rel,fallback=null)=>{
  try{return JSON.parse(fs.readFileSync(path.join(root,rel),'utf8'));}
  catch{return fallback;}
};

function pagesFetchBridge(){
  return `(()=>{\n  if(globalThis.__SEPA_X_PAGES_FETCH_BRIDGE__)return;\n  globalThis.__SEPA_X_PAGES_FETCH_BRIDGE__=true;\n  const nativeFetch=globalThis.fetch.bind(globalThis);\n  const base=new URL('./',globalThis.location.href);\n  globalThis.fetch=(input,init)=>{\n    if(typeof input==='string'&&input.startsWith('/')) input=new URL(input.slice(1),base).href;\n    return nativeFetch(input,init);\n  };\n})();\n`;
}

function patchIndex(html){
  let outHtml=html
    .replace(/(href|src)="\//g,'$1="./')
    .replace(/const u='https:\/\/raw\.githubusercontent\.com\/rasheadsca-star\/RAS-EGX-PRO2026-NEXT\/develop\/sepax-isolated-v1\/sepa-x\/public\/app\.js\?ui_boot=3';/,
      "const u='./app.js?ui_boot=pages';");
  const marker='<meta name="description"';
  if(outHtml.includes(marker)&&!outHtml.includes('SEPA-X GitHub Pages static snapshot')){
    outHtml=outHtml.replace(marker,'<meta name="x-sepax-host" content="SEPA-X GitHub Pages static snapshot">\n  '+marker);
  }
  return outHtml;
}

function patchBacktestHtml(html){
  return String(html||'')
    .replace(/href="\/"/g,'href="../../../"')
    .replace(/href="\/backtest\/view"/g,'href="./"')
    .replace(/action="\/backtest\/view"/g,'action="./"');
}

async function invoke(route){
  let body='';
  const headers={};
  const req={url:`/?route=${encodeURIComponent(route)}`,method:'GET',headers:{host:'localhost'}};
  const res={
    statusCode:200,
    setHeader(name,value){headers[String(name).toLowerCase()]=String(value);},
    end(value=''){body=Buffer.isBuffer(value)?value.toString('utf8'):String(value??'');}
  };
  await apiHandler(req,res);
  return {status:res.statusCode,headers,body};
}

async function writeRoute(route,body){
  const dir=path.join(out,...route.split('/'));
  await fsp.mkdir(dir,{recursive:true});
  await fsp.writeFile(path.join(dir,'index.html'),body,'utf8');
}

await fsp.rm(out,{recursive:true,force:true});
await fsp.mkdir(out,{recursive:true});
await fsp.cp(path.join(root,'public'),out,{recursive:true});
await fsp.writeFile(path.join(out,'.nojekyll'),'','utf8');

const indexPath=path.join(out,'index.html');
const appPath=path.join(out,'app.js');
await fsp.writeFile(indexPath,patchIndex(await fsp.readFile(indexPath,'utf8')),'utf8');
await fsp.writeFile(appPath,pagesFetchBridge()+await fsp.readFile(appPath,'utf8'),'utf8');

const fixedRoutes=[
  'scan','universe','opportunities','opportunities/top','opportunities/review','opportunities/near',
  'opportunities/watch','opportunities/forming','opportunities/extended','opportunities/near-miss',
  'market/regime','engine/coverage','engine/performance','engine/history','engine/transitions','engine/errors',
  'health','engine/health','backtest','engine/backtest','backtest/trades','engine/backtest/trades',
  'engine/comparison','comparison'
];

const routeManifest=[];
for(const route of fixedRoutes){
  const result=await invoke(route);
  await writeRoute(route,result.body);
  routeManifest.push({route,sourceStatus:result.status,bytes:Buffer.byteLength(result.body)});
}

const backtestView=await invoke('backtest/view');
await writeRoute('backtest/view',patchBacktestHtml(backtestView.body));
routeManifest.push({route:'backtest/view',sourceStatus:backtestView.status,bytes:Buffer.byteLength(backtestView.body)});

const scan=readJson('data/current-scan.json',{all:[]});
const history=readJson('data/recommendation-history.json',{runs:[],recommendations:[]});
const recs=Array.isArray(history?.recommendations)?history.recommendations:[];
for(const row of Array.isArray(scan?.all)?scan.all:[]){
  const symbol=String(row?.symbol||'').trim().toUpperCase();
  if(!symbol)continue;
  await writeRoute(`stock/${symbol}/analysis`,JSON.stringify(row));
  const symbolHistory=recs.filter(r=>String(r?.symbol||'').toUpperCase()===symbol).slice(-200).reverse();
  await writeRoute(`stock/${symbol}/history`,JSON.stringify({symbol,history:symbolHistory,source:'GITHUB_PAGES_STATIC_SNAPSHOT',sourceError:null}));
}

const forward=readJson('data/research/full-structure-v3-forward.json',{signals:[]});
const forwardSignals=Array.isArray(forward?.signals)?forward.signals:[];
const portfolioRows=(Array.isArray(scan?.all)?scan.all:[]).map(core=>{
  const symbol=String(core?.symbol||'').toUpperCase();
  const signal=forwardSignals.filter(x=>String(x?.symbol||'').toUpperCase()===symbol)
    .sort((a,b)=>String(b?.observedAt||'').localeCompare(String(a?.observedAt||'')))[0]||null;
  return {
    symbol,
    core,
    rc2:null,
    rc2Error:'GitHub Pages static mode — RC2 live HTTP reference is not executed.',
    v3:core?.strategy_lab?.full_structure_v3??null,
    forwardSignal:signal,
    readout:portfolioReadout({core,rc2:null,forwardSignal:signal})
  };
});
await writeRoute('portfolio/intelligence',JSON.stringify({
  ok:true,
  generatedAt:new Date().toISOString(),
  researchOnly:true,
  automaticOrders:false,
  staticHosting:true,
  rc2Isolation:{mode:'STATIC_NO_RUNTIME_REFERENCE',runtimeImports:0,runtimeMutations:0,executionAllowed:false},
  sepaX:{generatedAt:scan?.generatedAt??null,source:'GITHUB_PAGES_STATIC_SNAPSHOT'},
  v3Forward:{updatedAt:forward?.updatedAt??null,source:forward?'LOCAL_BUNDLE':'UNAVAILABLE'},
  count:portfolioRows.length,
  rows:portfolioRows
}));

await fsp.writeFile(path.join(out,'pages-manifest.json'),JSON.stringify({
  generatedAt:new Date().toISOString(),
  engineId:scan?.engineId??'SEPA_X_ENGINE_V1',
  scanGeneratedAt:scan?.generatedAt??null,
  symbols:portfolioRows.length,
  routes:routeManifest,
  hosting:'GITHUB_PAGES_STATIC_SNAPSHOT',
  rc2RuntimeMutation:false,
  automaticOrders:false
},null,2),'utf8');

console.log(JSON.stringify({ok:true,out,scanGeneratedAt:scan?.generatedAt??null,symbols:portfolioRows.length,routes:routeManifest.length+1},null,2));
