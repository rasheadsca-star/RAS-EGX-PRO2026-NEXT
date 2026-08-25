import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performanceAnalytics } from '../src/performance.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { selectConcentratedRecommendations, selectReviewQueue } from '../src/concentration.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const readJson=(name,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,'data',name),'utf8'));}catch{return fallback;}};
const load=()=>readJson('current-scan.json',null);
const readHistory=()=>readJson('recommendation-history.json',null);
const readHistoricalSimulator=()=>readJson('research/historical-simulator-summary.json',null);
const readComparison=()=>readJson('research/engine-comparison.json',null);
const send=(res,status,obj)=>{res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(obj));};
const concentrated=(scan)=>{
  if(Array.isArray(scan?.top_recommendations)&&scan.top_recommendations.length)return scan.top_recommendations.slice(0,5);
  if(Array.isArray(scan?.all)&&scan.all.length)return selectConcentratedRecommendations(scan.all,DEFAULT_CONFIG.concentration);
  return Array.isArray(scan?.top5_now)?scan.top5_now.slice(0,5):[];
};
const reviewQueue=(scan)=>Array.isArray(scan?.all)&&scan.all.length?selectReviewQueue(scan.all,DEFAULT_CONFIG.concentration):[];

const GITHUB_DATA_BASE='https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/develop/sepax-isolated-v1/sepa-x/data';
const GITHUB_SCAN_URL=`${GITHUB_DATA_BASE}/current-scan.json`;
const GITHUB_HISTORY_URL=`${GITHUB_DATA_BASE}/recommendation-history.json`;
const GITHUB_HISTORICAL_URL=`${GITHUB_DATA_BASE}/research/historical-simulator-summary.json`;
const GITHUB_COMPARISON_URL=`${GITHUB_DATA_BASE}/research/engine-comparison.json`;
const LIVE_SCAN_URL='https://egx-sepa-x-live-runner.vercel.app/api/live';
const REMOTE_TTL_MS=45_000;
const EVIDENCE_TTL_MS=300_000;
let remoteCache={scan:null,source:null,expiresAt:0};
let remoteInFlight=null;
const evidenceCache=new Map();

const looksLikeScan=(x)=>Boolean(x&&typeof x==='object'&&Array.isArray(x.all)&&x.market_coverage&&x.market_status);
const unwrapLiveScan=(payload)=>[
  payload?.scan,
  payload?.result?.scan,
  payload?.result,
  payload?.data?.scan,
  payload?.data,
  payload
].find(looksLikeScan)||null;

async function fetchJsonDocument(url,{timeoutMs=20_000,errorPrefix='REMOTE_JSON'}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url,{cache:'no-store',signal:controller.signal,headers:{accept:'application/json'}});
    if(!response.ok)throw new Error(`${errorPrefix}_HTTP_${response.status}`);
    return await response.json();
  }finally{clearTimeout(timer);}
}

async function fetchJsonWithTimeout(url,{timeoutMs=20_000,unwrap=x=>x,errorPrefix='REMOTE_SCAN'}={}){
  const payload=await fetchJsonDocument(url,{timeoutMs,errorPrefix});
  const scan=unwrap(payload);
  if(!looksLikeScan(scan))throw new Error(`${errorPrefix}_INVALID_PAYLOAD`);
  return scan;
}

async function loadEvidence(key,localValue,url,fallback=null){
  if(localValue!==null&&localValue!==undefined)return {value:localValue,source:'LOCAL_BUNDLE',error:null};
  const cached=evidenceCache.get(key);
  if(cached&&Date.now()<cached.expiresAt)return {value:cached.value,source:cached.source,error:null};
  try{
    const value=await fetchJsonDocument(url,{timeoutMs:12_000,errorPrefix:`GITHUB_${key.toUpperCase()}`});
    if(!value||typeof value!=='object')throw new Error(`GITHUB_${key.toUpperCase()}_INVALID_PAYLOAD`);
    const source='GITHUB_BRANCH_SNAPSHOT';
    evidenceCache.set(key,{value,source,expiresAt:Date.now()+EVIDENCE_TTL_MS});
    return {value,source,error:null};
  }catch(error){
    return {value:fallback,source:'UNAVAILABLE',error:String(error?.message||error)};
  }
}

async function fetchRemoteScan(){
  if(remoteCache.scan&&Date.now()<remoteCache.expiresAt)return {scan:remoteCache.scan,source:remoteCache.source};
  if(remoteInFlight)return remoteInFlight;
  remoteInFlight=(async()=>{
    const errors=[];
    try{
      const scan=await fetchJsonWithTimeout(GITHUB_SCAN_URL,{errorPrefix:'GITHUB_SCAN'});
      remoteCache={scan,source:'GITHUB_BRANCH_SNAPSHOT',expiresAt:Date.now()+REMOTE_TTL_MS};
      return {scan,source:remoteCache.source,error:null};
    }catch(error){errors.push(String(error?.message||error));}
    try{
      const scan=await fetchJsonWithTimeout(LIVE_SCAN_URL,{timeoutMs:45_000,unwrap:unwrapLiveScan,errorPrefix:'LIVE_SCAN'});
      remoteCache={scan,source:'LIVE_RUNNER',expiresAt:Date.now()+REMOTE_TTL_MS};
      return {scan,source:remoteCache.source,error:null};
    }catch(error){errors.push(String(error?.message||error));}
    return {scan:null,source:'UNAVAILABLE',error:errors.join(' | ')||'REMOTE_SCAN_UNAVAILABLE'};
  })();
  try{return await remoteInFlight;}finally{remoteInFlight=null;}
}

async function loadScan(){
  const local=load();
  if(local)return {scan:local,source:'LOCAL_CURRENT_SCAN',error:null};
  return fetchRemoteScan();
}

const loadHistory=()=>loadEvidence('history',readHistory(),GITHUB_HISTORY_URL,{runs:[],recommendations:[]});
const loadHistorical=()=>loadEvidence('historical_simulator',readHistoricalSimulator(),GITHUB_HISTORICAL_URL,null);
const loadComparison=()=>loadEvidence('engine_comparison',readComparison(),GITHUB_COMPARISON_URL,null);

export default async function handler(req,res){
  const u=new URL(req.url,'http://localhost');
  const route=(u.searchParams.get('route')||u.pathname.replace(/^\/+/, '')).replace(/^api\/index\/?/,'');

  if(route==='backtest'||route==='engine/backtest'){
    const historical=await loadHistorical();
    if(!historical.value)return send(res,503,{ok:false,error:'HISTORICAL_SIMULATOR_RESULT_NOT_AVAILABLE',source:historical.source,sourceError:historical.error,frameworkReady:true,lookAheadGuard:true,walkForward:true,execution:false});
    return send(res,200,{...historical.value,ok:true,source:historical.source});
  }
  if(route==='engine/comparison'||route==='comparison'){
    const comparison=await loadComparison();
    if(!comparison.value)return send(res,503,{ok:false,error:'ENGINE_COMPARISON_NOT_AVAILABLE',source:comparison.source,sourceError:comparison.error});
    return send(res,200,{...comparison.value,ok:true,source:comparison.source});
  }

  const {scan,source:scanSource,error:scanError}=await loadScan();

  if(route==='health'||route==='engine/health'){
    const [historical,comparison]=await Promise.all([loadHistorical(),loadComparison()]);
    return send(res,200,{
      ok:true,
      engineId:'SEPA_X_ENGINE_V1',
      isolatedFromRc2:true,
      scanAvailable:Boolean(scan),
      scanSource,
      scanError:scan?null:scanError,
      historicalSimulatorAvailable:Boolean(historical.value),
      historicalSimulatorSource:historical.source,
      historicalSimulatorError:historical.value?null:historical.error,
      comparisonAvailable:Boolean(comparison.value),
      comparisonSource:comparison.source,
      comparisonError:comparison.value?null:comparison.error,
      fullMarket:Boolean(scan?.market_coverage?.TotalListed&&scan?.market_coverage?.TotalEligible===scan?.market_coverage?.TotalListed),
      generatedAt:scan?.generatedAt||null,
      completeCoreHistory:scan?.market_coverage?.CompleteSMA200R252Week52??null,
      totalListed:scan?.market_coverage?.TotalListed??null,
      concentrationPolicy:DEFAULT_CONFIG.concentration
    });
  }

  if(route==='engine/performance'){
    const history=await loadHistory();
    return send(res,200,{...performanceAnalytics(history.value||{runs:[],recommendations:[]}),source:history.source,sourceError:history.error});
  }
  if(route==='engine/history'){
    const history=await loadHistory(),hist=history.value||{runs:[],recommendations:[]};
    return send(res,200,{runs:(hist.runs||[]).slice(-50).reverse(),recommendations:(hist.recommendations||[]).slice(-300).reverse(),count:(hist.recommendations||[]).length,source:history.source,sourceError:history.error});
  }

  if(!scan)return send(res,503,{ok:false,error:'NO_SCAN_AVAILABLE',scanSource,scanError,message:'Live SEPA-X scan is temporarily unavailable. No mock data is served.'});
  const top=concentrated(scan),review=reviewQueue(scan);

  if(route==='scan')return send(res,200,{engineId:scan.engineId,generatedAt:scan.generatedAt,scan_source:scanSource,market_status:scan.market_status,market_coverage:scan.market_coverage,concentration_policy:scan.concentration_policy||{mode:'TOP_3_OR_5_HIGH_CONVICTION',selected:top.length,baseCount:3,maxCount:5},review_required_count:review.length,no_high_conviction_setup:top.length<3});
  if(route==='universe')return send(res,200,{count:(scan.all||[]).length,rows:(scan.all||[]).map(x=>({symbol:x.symbol,name:x.name,rank:x.market_rank,percentile:x.market_percentile,status:x.status,action:x.action,score:x.final_score,rs:x.rs_percentile,pivot:x.pivot,distance:x.distance_to_pivot_pct,rr:x.reward_risk,classification:x.classification,historyComplete:Boolean(x.history_metrics?.complete)}))});
  if(route==='opportunities')return send(res,200,{top,review,near:scan.near_breakout||[],forming:scan.forming_leaders||[],extended:scan.strong_but_extended||[],near_miss:scan.near_miss||[],policy:{baseCount:3,maxCount:5,paddingLowQualityCandidates:false,targetRMultiples:[2,3,4],reviewQueueExecutionAllowed:false}});
  if(route==='opportunities/top')return send(res,200,top);
  if(route==='opportunities/review')return send(res,200,review);
  if(route==='opportunities/near')return send(res,200,scan.near_breakout||[]);
  if(route==='opportunities/watch'||route==='opportunities/forming')return send(res,200,scan.forming_leaders||[]);
  if(route==='opportunities/extended')return send(res,200,scan.strong_but_extended||[]);
  if(route==='opportunities/near-miss')return send(res,200,scan.near_miss||[]);
  if(route==='market/regime')return send(res,200,scan.market_status);
  if(route==='engine/coverage')return send(res,200,scan.market_coverage);
  if(route==='engine/transitions')return send(res,200,{generatedAt:scan.generatedAt,transitions:(scan.transitions||[]).slice(-500).reverse()});
  if(route==='engine/errors')return send(res,200,{generatedAt:scan.generatedAt,count:(scan.errors||[]).length,errors:(scan.errors||[]).slice(0,500)});

  const m=route.match(/^stock\/([^/]+)\/analysis$/);
  if(m){const x=(scan.all||[]).find(r=>r.symbol===m[1].toUpperCase());return x?send(res,200,x):send(res,404,{error:'SYMBOL_NOT_FOUND'});}
  const h=route.match(/^stock\/([^/]+)\/history$/);
  if(h){
    const symbol=h[1].toUpperCase(),history=await loadHistory(),hist=history.value||{runs:[],recommendations:[]};
    return send(res,200,{symbol,history:(hist.recommendations||[]).filter(r=>r.symbol===symbol).slice(-200).reverse(),source:history.source,sourceError:history.error});
  }
  return send(res,404,{error:'ROUTE_NOT_FOUND',route});
}
