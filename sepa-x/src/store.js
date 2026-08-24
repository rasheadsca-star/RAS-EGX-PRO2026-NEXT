import fs from 'node:fs';
import path from 'node:path';
export function readJson(file,fallback=null){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
export function writeJsonAtomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.tmp`;fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n');JSON.parse(fs.readFileSync(tmp,'utf8'));fs.renameSync(tmp,file);}

const recSummary=(scan,x,rank)=>({
  recommendation_id:`${scan.generatedAt}:${x.symbol}:${x.status}`,
  symbol:x.symbol,timestamp:scan.generatedAt,entry:x.entry_zone?.from??x.pivot??null,pivot:x.pivot??null,stop:x.stop_loss??null,
  score:x.final_score,status:x.status,action:x.action,market_regime:scan.market_status?.Regime??null,rank,
  sub_scores:{strength:x.strength_score,clarity:x.setup_clarity_score,readiness:x.entry_readiness_score,confidence:x.confidence_score,rs:x.rs_percentile,vcp:x.vcp?.quality??null},
  reason_codes:x.failed_rules??[],why_selected:x.why_selected??[],
  max_gain_after_signal:null,max_drawdown_after_signal:null,hit_1R:false,hit_2R:false,hit_3R:false,stop_hit:false,
  days_to_trigger:x.status==='BREAKOUT CONFIRMED'?0:null,days_to_target:null,observed_sessions:0,resolution:null,same_day_ambiguity_policy:'STOP_FIRST'
});
const round=(x,d=4)=>Number.isFinite(Number(x))?Number(Number(x).toFixed(d)):null;

export function appendHistory(file,scan,maxRuns=120,maxRecommendations=5000){
  const prior=readJson(file,{schemaVersion:'1.0.0',runs:[],recommendations:[]});
  const state=Array.isArray(prior)?{schemaVersion:'1.0.0',runs:prior,recommendations:[]}:{schemaVersion:'1.0.0',runs:prior.runs??[],recommendations:prior.recommendations??[]};
  const current=new Map((scan.all??[]).map(x=>[x.symbol,x]));
  for(const r of state.recommendations){
    const x=current.get(r.symbol); if(!x||!r.entry)continue;
    const hi=Number(x.last_session?.high),lo=Number(x.last_session?.low),entry=Number(r.entry),stop=Number(r.stop);
    if(!Number.isFinite(hi)||!Number.isFinite(lo)||!Number.isFinite(entry))continue;
    r.observed_sessions=(r.observed_sessions??0)+1;
    const gain=(hi-entry)/entry*100,dd=(lo-entry)/entry*100;
    r.max_gain_after_signal=round(Math.max(Number(r.max_gain_after_signal??-Infinity),gain),2);
    r.max_drawdown_after_signal=round(Math.min(Number(r.max_drawdown_after_signal??Infinity),dd),2);
    const risk=Number.isFinite(stop)&&entry>stop?entry-stop:null;
    if(risk){
      const stopHit=lo<=stop,t1=hi>=entry+risk,t2=hi>=entry+2*risk,t3=hi>=entry+3*risk;
      if(stopHit){
        r.stop_hit=true;
        if(!r.resolution)r.resolution='STOP_HIT';
      }else{
        if(t1)r.hit_1R=true;
        if(t2){r.hit_2R=true;if(r.days_to_target==null)r.days_to_target=r.observed_sessions;if(!r.resolution)r.resolution='HIT_2R_BEFORE_STOP';}
        if(t3){r.hit_3R=true;if(!r.resolution||r.resolution==='HIT_2R_BEFORE_STOP')r.resolution='HIT_3R_BEFORE_STOP';}
      }
    }
    if(r.days_to_trigger==null&&x.status==='BREAKOUT CONFIRMED')r.days_to_trigger=r.observed_sessions;
  }
  const eligible=(scan.all??[]).filter(x=>['READY NOW','BREAKOUT CONFIRMED','NEAR PIVOT'].includes(x.status));
  const byRank=new Map((scan.top5_now??[]).map((x,i)=>[x.symbol,i+1]));
  for(const x of eligible)state.recommendations.push(recSummary(scan,x,byRank.get(x.symbol)??null));
  state.runs.push({generatedAt:scan.generatedAt,market_status:scan.market_status,top5_symbols:(scan.top5_now??[]).map(x=>x.symbol),coverage:scan.market_coverage});
  state.runs=state.runs.slice(-maxRuns); state.recommendations=state.recommendations.slice(-maxRecommendations);
  writeJsonAtomic(file,state); return state;
}
