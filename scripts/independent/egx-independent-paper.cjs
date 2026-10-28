'use strict';
// Independent, fail-closed, paper-only engine. No Astra dependencies.
const fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GITHUB_WORKSPACE||process.cwd();
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const day=s=>typeof s==='string'?s.slice(0,10):'';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=(n,d=4)=>Number(n.toFixed(d));
function validBar(r,session){
 return day(r?.date||r?.sessionDate)===session && day(r?.sourceSessionDate)===session &&
  [r?.open,r?.high,r?.low,r?.close,r?.volume].every(finite) &&
  r.open>0&&r.close>0&&r.low>0&&r.high>=Math.max(r.open,r.close)&&
  r.low<=Math.min(r.open,r.close)&&r.volume>=0&&
  r.validationStatus==='precise_public_source_session_confirmed'&&
  !r.warnings?.some(x=>/reconstruct|synthetic|partial_ohlc/i.test(String(x)));
}
function sma(rows,n){return rows.slice(-n).reduce((s,r)=>s+r.close,0)/n}
function atr(rows,n=14){
 let sum=0;for(let i=rows.length-n;i<rows.length;i++){
  const r=rows[i],prev=rows[i-1];if(!prev)return null;
  sum+=Math.max(r.high-r.low,Math.abs(r.high-prev.close),Math.abs(r.low-prev.close));
 }return sum/n;
}
function evaluate({price,handoff,symbols,loadHistory,session,minimumRows=190}){
 const result={schemaVersion:'egx-independent-paper-v1',session,mode:'PAPER_ONLY',executable:false,
  status:'BLOCKED',blockers:[],verifiedCandidates:[],recommendations:[],watchlist:[],
  inputs:{priceAccepted:price?.acceptedRows??null,handoffAccepted:handoff?.acceptedRows??null}};
 if(!/^\d{4}-\d{2}-\d{2}$/.test(session))result.blockers.push('INVALID_SESSION');
 if(day(price?.expectedSession)!==session||price?.ready!==true||price?.executionGrade!==true||
    Number(price?.acceptedRows||0)<minimumRows)result.blockers.push('PRICE_TRUTH_NOT_EXECUTION_GRADE');
 if(day(handoff?.sessionDate)!==session||handoff?.acceptedRows!==price?.acceptedRows)
    result.blockers.push('HANDOFF_NOT_ALIGNED');
 if(result.blockers.length)return result;
 const accepted=new Set((price.sampleAccepted||[]).map(r=>r.ticker));
 // sampleAccepted is intentionally incomplete: never infer unlisted securities are approved.
 const rows=Array.isArray(symbols)?symbols:Object.values(symbols||{});
 for(const sym of rows){
  const ticker=String(sym?.ticker||'').trim().toUpperCase();
  if(!ticker||sym.active===false||!accepted.has(ticker))continue;
  let h;try{h=loadHistory(ticker)}catch{continue}
  if(h?.symbolVerified!==true||!/^EG[A-Z0-9]{9,}$/i.test(h?.isin||''))continue;
  const bars=(h.sessions||[]).filter(r=>day(r.date||r.sessionDate)<=session).sort((a,b)=>day(a.date).localeCompare(day(b.date)));
  if(bars.length<60||!validBar(bars.at(-1),session))continue;
  if(bars.slice(-60).some(r=>![r.open,r.high,r.low,r.close,r.volume].every(finite)||
     r.close<=0||r.high<Math.max(r.open,r.close)||r.low>Math.min(r.open,r.close)))continue;
  const c=bars.at(-1),m20=sma(bars,20),m50=sma(bars,50),a=atr(bars);
  const avgVolume=bars.slice(-21,-1).reduce((s,r)=>s+r.volume,0)/20;
  if(!a||a<=0||avgVolume<=0)continue;
  const liquid=c.close*avgVolume>=1000000;
  const trending=c.close>m20&&m20>m50;
  const score=round((c.close/m20-1)*100+(m20/m50-1)*100,3);
  result.verifiedCandidates.push({ticker,close:c.close,score,liquid,trending});
  if(liquid&&trending&&a/c.close<=0.1){
   const entry=round(c.close),stop=round(Math.max(0.01,c.close-2*a));
   const target=round(c.close+4*a);
   if(stop<entry&&target>entry)
    result.watchlist.push({ticker,session,entry,stop,target,riskReward:round((target-entry)/(entry-stop),2),
      signal:'SMA20_ABOVE_SMA50_AND_CLOSE_ABOVE_SMA20',source:'VERIFIED_SAME_SESSION_HISTORY',
      state:'CANDIDATE_NOT_EXECUTED'});
  }
 }
 result.watchlist.sort((a,b)=>a.ticker.localeCompare(b.ticker));
 result.status='RESEARCH_READY_PAPER_VALIDATION_REQUIRED';
 result.blockers.push('NO_INDEPENDENT_OUT_OF_SAMPLE_PERFORMANCE_CERTIFICATION');
 // No execution-grade recommendations until independent forward/paper validation exists.
 return result;
}
function main(){
 const price=read('data/stable/v15-price-truth.json');
 const handoff=read('data/ops/g22-main-app-handoff.json');
 const symbols=read('data/symbol-map.json');
 const output=evaluate({price,handoff,symbols,session:day(price.expectedSession),
  loadHistory:t=>read('data/history/'+t+'.json')});
 const out=path.join(ROOT,'unified-console/independent-paper.json');
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(output,null,2)+'\n');
 console.log('EGX_INDEPENDENT_PAPER '+JSON.stringify({status:output.status,blockers:output.blockers,watch:output.watchlist.length}));
}
if(require.main===module)main();
module.exports={evaluate,validBar,atr};
