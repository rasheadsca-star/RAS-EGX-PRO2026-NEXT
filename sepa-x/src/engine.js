import { DEFAULT_CONFIG } from './config.js';
import { MarketDataProvider } from './providers.js';
import { catalystEngine, dataIntegrity, finalize, fundamentalEngine, liquidityEngine, marketRegime, pivotEngine, rsRaw, sectorEngine, tightnessEngine, trendTemplate, vcpEngine, volumeEngine } from './features.js';

const workerMap=async(items,limit,fn)=>{
  const out=new Array(items.length);let cursor=0;
  async function worker(){while(true){const i=cursor++;if(i>=items.length)return;try{out[i]=await fn(items[i],i);}catch(e){out[i]={__error:e};}}}
  await Promise.all(Array.from({length:Math.min(limit,Math.max(1,items.length))},worker));return out;
};
const serializable=(x)=>JSON.parse(JSON.stringify(x));

export async function scanMarket({provider=new MarketDataProvider(DEFAULT_CONFIG),config=DEFAULT_CONFIG,limit=null,previousScan=null}={}){
  const generatedAt=new Date().toISOString(),ctx=await provider.loadContext(),universe=provider.buildUniverse(ctx);
  const hasLimit=limit!==null&&limit!==undefined&&limit!==''&&Number.isFinite(Number(limit))&&Number(limit)>=0;
  const selected=hasLimit?universe.slice(0,Number(limit)):universe;
  const errors=[];
  const loaded=await workerMap(selected,config.cache.concurrency,async(entry)=>{
    const stock=await provider.loadStock(entry);if(stock.errors.length)errors.push(...stock.errors.map(message=>({symbol:entry.ticker,engine_stage:'DATA_PROVIDER',error_code:'SOURCE_DEGRADED',error_message:message,timestamp:new Date().toISOString()})));
    const bars=stock.rows,data=dataIntegrity(stock,config),liquidity=liquidityEngine(bars,config),trend=trendTemplate(bars),rs=rsRaw(bars,config),fundamentals=fundamentalEngine(entry),catalyst=catalystEngine(entry),vcp=vcpEngine(bars),volume=volumeEngine(bars,liquidity),tightness=tightnessEngine(bars),pivot=pivotEngine(bars,vcp);
    const sector=entry.sector||entry.industry||entry.fundamentals?.sectorModel||'UNKNOWN';
    return {symbol:entry.ticker,name:entry.companyNameEn||entry.companyNameAr||entry.ticker,nameAr:entry.companyNameAr||null,nameEn:entry.companyNameEn||null,bars,entryMeta:entry,data,liquidity,trend,rs,fundamentals,catalyst,vcp,volume,tightness,pivot,sector,price_data_as_of:stock.meta.priceDataAsOf,fundamentals_as_of:stock.meta.fundamentalsAsOf,analysis_generated_at:generatedAt};
  });
  const rows=loaded.map((x,i)=>x?.__error?(errors.push({symbol:selected[i]?.ticker,engine_stage:'ANALYSIS',error_code:'UNHANDLED',error_message:x.__error.message,timestamp:new Date().toISOString()}),null):x).filter(Boolean);
  const benchmark=await provider.loadBenchmark();
  const sectors=sectorEngine(rows),market=marketRegime(rows,benchmark);
  const finalRows=rows.map(r=>finalize(r,rows,sectors,market,config));
  finalRows.sort((a,b)=>(b.final_score??-1)-(a.final_score??-1)||a.symbol.localeCompare(b.symbol));
  finalRows.forEach((x,i)=>{x.market_rank=i+1;x.market_percentile=finalRows.length?Math.round((1-i/finalRows.length)*1000)/10:null;});
  const topCandidates=finalRows.filter(x=>x.eligibleForTop).sort((a,b)=>{
    const statusOrder={'READY NOW':0,'BREAKOUT CONFIRMED':1,'NEAR PIVOT':2};return (statusOrder[a.status]??9)-(statusOrder[b.status]??9)||(b.final_score??0)-(a.final_score??0)||(b.confidence_score??0)-(a.confidence_score??0)||Math.abs(a.entry.raw.distance_to_pivot_pct??99)-Math.abs(b.entry.raw.distance_to_pivot_pct??99);
  });
  const near=finalRows.filter(x=>x.status==='NEAR PIVOT'&&x.hardReasons.filter(r=>r!=='RR_BELOW_2').length===0).slice(0,15);
  const forming=finalRows.filter(x=>x.status==='FORMING'&&x.vcp.score>=45).slice(0,20);
  const extended=finalRows.filter(x=>x.status==='EXTENDED').slice(0,20);
  const nearMiss=finalRows.filter(x=>!x.eligibleForTop&&x.hardReasons.length<=2&&x.final_score>=65).slice(0,20);
  const coverage={
    TotalListed:universe.length,TotalEligible:selected.length,SuccessfullyAnalyzed:finalRows.length,RejectedByLiquidity:finalRows.filter(x=>!x.liquidity.pass).length,RejectedByDataQuality:finalRows.filter(x=>!x.data.pass).length,
    PassedTrendTemplate:finalRows.filter(x=>x.trend.pass).length,HighRSStocks:finalRows.filter(x=>(x.rs.raw.RS_PERCENTILE??0)>=70).length,ValidVCP:finalRows.filter(x=>x.vcp.pass).length,
    ReadyNow:finalRows.filter(x=>x.status==='READY NOW').length,BreakoutConfirmed:finalRows.filter(x=>x.status==='BREAKOUT CONFIRMED').length,NearPivot:finalRows.filter(x=>x.status==='NEAR PIVOT').length,Errors:errors.length
  };
  const compact=(x)=>({
    symbol:x.symbol,name:x.name,last_price:x.entry.raw.price,final_score:x.final_score,strength_score:x.strength_score,setup_clarity_score:x.setup_clarity_score,entry_readiness_score:x.entry_readiness_score,confidence_score:x.confidence_score,status:x.status,action:x.action,
    pivot:x.pivot.raw.pivot_price,distance_to_pivot_pct:x.entry.raw.distance_to_pivot_pct,entry_zone:x.risk.raw.entry_zone,stop_loss:x.risk.raw.stop_loss,risk_pct:x.risk.raw.risk_pct,reward_risk:x.risk.raw.reward_risk,rs_percentile:x.rs.raw.RS_PERCENTILE,sector_rs:x.sector?.sector_RS_percentile??null,
    trend_template:{passed:x.trend.pass,score:x.trend.score,raw:x.trend.raw},vcp:{detected:x.vcp.pass,quality:x.vcp.score,contractions:x.vcp.raw.contractions},volume:{dry_up_score:x.volume.raw.volume_dryup_ratio==null?null:x.volume.score,breakout_ratio:x.entry.raw.breakout_volume_ratio,accumulation_score:x.volume.raw.accumulation_score},
    fundamentals:x.fundamentals.raw,catalyst:x.catalyst.raw.catalyst??null,market_regime:market.regime,classification:x.classification,raw_opportunity_score:x.raw_opportunity_score,why_selected:x.why_selected,risks:x.risks,invalidation:x.invalidation,failed_rules:x.hardReasons,passed_rules:['DATA','LIQUIDITY','TREND','RS','VCP','PIVOT','ENTRY','RISK'].filter(k=>({DATA:x.data.pass,LIQUIDITY:x.liquidity.pass,TREND:x.trend.pass,RS:x.rs.pass,VCP:x.vcp.pass,PIVOT:x.pivot.pass,ENTRY:x.entry.pass,RISK:x.risk.pass})[k]),nearest_upgrade_condition:x.hardReasons[0]||null,market_rank:x.market_rank,market_percentile:x.market_percentile,
    audit_stages:{data_integrity:x.data,liquidity:x.liquidity,trend:x.trend,relative_strength:x.rs,fundamentals:x.fundamentals,catalyst:x.catalyst,vcp:x.vcp,volume:x.volume,tightness:x.tightness,pivot:x.pivot,entry:x.entry,risk:x.risk},
    last_session:{date:x.bars.at(-1)?.date??null,open:x.bars.at(-1)?.open??null,high:x.bars.at(-1)?.high??null,low:x.bars.at(-1)?.low??null,close:x.bars.at(-1)?.close??null,volume:x.bars.at(-1)?.volume??null},
    price_data_as_of:x.price_data_as_of,fundamentals_as_of:x.fundamentals_as_of,analysis_generated_at:x.analysis_generated_at
  });
  const currentStates=new Map(finalRows.map(x=>[x.symbol,x.status]));
  const previousStates=new Map((previousScan?.all||[]).map(x=>[x.symbol,x.status]));
  const transitions=[];for(const [symbol,to] of currentStates){const from=previousStates.get(symbol);if(from&&from!==to)transitions.push({symbol,from,to,timestamp:generatedAt});}
  const top5=topCandidates.slice(0,5).map(compact);
  return serializable({
    schemaVersion:config.schemaVersion,engineId:config.engineId,researchOnly:true,permissions:config.permissions,generatedAt,
    sourceIsolation:{rc2RuntimeImports:0,rc2RuntimeMutations:0,sharedInputsReadOnly:true,namespace:'sepa-x'},
    market_status:{Regime:market.regime,Breadth:market.breadth,RiskLevel:market.regime==='BEAR'?'HIGH':market.regime==='CAUTION'?'ELEVATED':'NORMAL',EligibleUniverse:selected.length,LastUpdate:generatedAt,indexEvidenceAvailable:market.indexAvailable},
    top5_now:top5,near_breakout:near.map(compact),forming_leaders:forming.map(compact),strong_but_extended:extended.map(compact),near_miss:nearMiss.map(compact),
    best_one:top5[0]||null,no_high_conviction_setup:top5.length===0,market_coverage:coverage,transitions,errors,all:finalRows.map(compact)
  });
}
