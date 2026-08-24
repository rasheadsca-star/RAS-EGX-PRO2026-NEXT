import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performanceAnalytics } from '../src/performance.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const readJson=(name,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,'data',name),'utf8'));}catch{return fallback;}};
const load=()=>readJson('current-scan.json',null);
const readHistory=()=>readJson('recommendation-history.json',{runs:[],recommendations:[]});
const send=(res,status,obj)=>{res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(obj));};

export default async function handler(req,res){
  const u=new URL(req.url,'http://localhost');
  const route=(u.searchParams.get('route')||u.pathname.replace(/^\/+/, '')).replace(/^api\/index\/?/,'');
  const scan=load();

  if(route==='health'||route==='engine/health')return send(res,200,{
    ok:true,
    engineId:'SEPA_X_ENGINE_V1',
    isolatedFromRc2:true,
    scanAvailable:Boolean(scan),
    fullMarket:Boolean(scan?.market_coverage?.TotalListed&&scan?.market_coverage?.TotalEligible===scan?.market_coverage?.TotalListed),
    generatedAt:scan?.generatedAt||null,
    completeCoreHistory:scan?.market_coverage?.CompleteSMA200R252Week52??null,
    totalListed:scan?.market_coverage?.TotalListed??null
  });

  if(!scan)return send(res,503,{ok:false,error:'NO_SCAN_AVAILABLE',message:'Run the isolated SEPA-X scanner first. No mock data is served.'});

  if(route==='scan')return send(res,200,{engineId:scan.engineId,generatedAt:scan.generatedAt,market_status:scan.market_status,market_coverage:scan.market_coverage,no_high_conviction_setup:scan.no_high_conviction_setup});
  if(route==='universe')return send(res,200,{count:scan.all.length,rows:scan.all.map(x=>({symbol:x.symbol,name:x.name,rank:x.market_rank,percentile:x.market_percentile,status:x.status,action:x.action,score:x.final_score,rs:x.rs_percentile,pivot:x.pivot,distance:x.distance_to_pivot_pct,rr:x.reward_risk,classification:x.classification,historyComplete:Boolean(x.history_metrics?.complete)}))});
  if(route==='opportunities')return send(res,200,{top:scan.top5_now,near:scan.near_breakout,forming:scan.forming_leaders,extended:scan.strong_but_extended,near_miss:scan.near_miss});
  if(route==='opportunities/top')return send(res,200,scan.top5_now);
  if(route==='opportunities/near')return send(res,200,scan.near_breakout);
  if(route==='opportunities/watch'||route==='opportunities/forming')return send(res,200,scan.forming_leaders);
  if(route==='opportunities/extended')return send(res,200,scan.strong_but_extended);
  if(route==='opportunities/near-miss')return send(res,200,scan.near_miss);
  if(route==='market/regime')return send(res,200,scan.market_status);
  if(route==='engine/coverage')return send(res,200,scan.market_coverage);
  if(route==='engine/performance'){const hist=readHistory();return send(res,200,performanceAnalytics(hist));}
  if(route==='engine/history'){
    const hist=readHistory();
    return send(res,200,{runs:(hist.runs||[]).slice(-50).reverse(),recommendations:(hist.recommendations||[]).slice(-300).reverse(),count:(hist.recommendations||[]).length});
  }
  if(route==='engine/transitions')return send(res,200,{generatedAt:scan.generatedAt,transitions:(scan.transitions||[]).slice(-500).reverse()});
  if(route==='engine/errors')return send(res,200,{generatedAt:scan.generatedAt,count:(scan.errors||[]).length,errors:(scan.errors||[]).slice(0,500)});
  if(route==='backtest')return send(res,200,{status:'FRAMEWORK_READY_NO_POINT_IN_TIME_FULL_MARKET_RUN_COMMITTED',lookAheadGuard:true,walkForward:true,execution:false});

  const m=route.match(/^stock\/([^/]+)\/analysis$/);
  if(m){const x=scan.all.find(r=>r.symbol===m[1].toUpperCase());return x?send(res,200,x):send(res,404,{error:'SYMBOL_NOT_FOUND'});}
  const h=route.match(/^stock\/([^/]+)\/history$/);
  if(h){const symbol=h[1].toUpperCase(),hist=readHistory();return send(res,200,{symbol,history:(hist.recommendations||[]).filter(r=>r.symbol===symbol).slice(-200).reverse()});}
  return send(res,404,{error:'ROUTE_NOT_FOUND',route});
}
