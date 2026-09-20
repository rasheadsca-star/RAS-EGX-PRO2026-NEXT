'use strict';

const fs=require('fs');
const path=require('path');

const ROOT=path.resolve(process.env.ASTRA_DECISION_ROOT||process.env.GITHUB_WORKSPACE||process.cwd());
const P=p=>path.join(ROOT,p);
const read=(p,d=null)=>{try{return JSON.parse(fs.readFileSync(P(p),'utf8'))}catch{return d}};
const write=(p,v)=>{fs.mkdirSync(path.dirname(P(p)),{recursive:true});fs.writeFileSync(P(p),JSON.stringify(v,null,2)+'\n','utf8')};
const dateOnly=v=>(String(v||'').match(/^(\d{4}-\d{2}-\d{2})/)||[])[1]||null;
const finite=v=>Number.isFinite(Number(v))?Number(v):null;
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;

function validRows(doc,session){
  return (doc.sessions||[]).map(r=>({
    date:dateOnly(r.date||r.sessionDate),
    open:finite(r.open),high:finite(r.high),low:finite(r.low),close:finite(r.close),volume:finite(r.volume),
    validationStatus:String(r.validationStatus||'')
  })).filter(r=>r.date&&r.date<=session&&r.open>0&&r.high>0&&r.low>0&&r.close>0&&r.volume!==null&&r.volume>=0&&
    r.high>=Math.max(r.open,r.close)&&r.low<=Math.min(r.open,r.close)&&
    !/invalid|conflict|failed|unresolved|quarantined/i.test(r.validationStatus)
  ).sort((a,b)=>a.date.localeCompare(b.date));
}
function sma(rows,i,n,key='close'){
  if(i-n+1<0)return null;
  const vals=[];
  for(let j=i-n+1;j<=i;j++){const v=finite(rows[j]?.[key]);if(v===null)return null;vals.push(v)}
  return mean(vals);
}
function atr(rows,i,n=14){
  if(i-n+1<1)return null;
  const vals=[];
  for(let j=i-n+1;j<=i;j++){
    const prev=finite(rows[j-1]?.close),hi=finite(rows[j]?.high),lo=finite(rows[j]?.low);
    if(!(prev>0&&hi>0&&lo>0))return null;
    vals.push(Math.max(hi-lo,Math.abs(hi-prev),Math.abs(lo-prev)));
  }
  return mean(vals);
}
function rsi(rows,i,n=14){
  if(i-n<0)return null;
  let g=0,l=0;
  for(let j=i-n+1;j<=i;j++){
    const c=rows[j].close-rows[j-1].close;g+=Math.max(c,0);l+=Math.max(-c,0);
  }
  return l===0?100:100-100/(1+(g/n)/(l/n));
}
const pct=(a,b)=>b?((a/b)-1)*100:null;

function evaluate(ticker,expected){
  const doc=read('data/history/'+ticker+'.json',{});
  const rows=validRows(doc,expected);
  const i=rows.findIndex(r=>r.date===expected);
  if(i<55)return{ticker,eligible:false,reason:'INSUFFICIENT_CURRENT_HISTORY',validHistorySessions:rows.length};
  const q=rows[i],s10=sma(rows,i,10),s20=sma(rows,i,20),s50=sma(rows,i,50),a14=atr(rows,i,14),rr=rsi(rows,i,14),av=sma(rows,i-1,20,'volume');
  const ret1=pct(q.close,rows[i-1].close),ret3=pct(q.close,rows[i-3].close),ret5=pct(q.close,rows[i-5].close),ret10=pct(q.close,rows[i-10].close),ret20=pct(q.close,rows[i-20].close);
  const prior=rows.slice(i-20,i);const hi=Math.max(...prior.map(x=>x.high)),lo=Math.min(...prior.map(x=>x.low));
  const range=hi>lo?(q.close-lo)/(hi-lo):0.5,breakout=pct(q.close,hi),atrPct=a14/q.close*100;
  const baseReady=[s10,s20,s50,a14,rr,av,ret1,ret3,ret5,ret10,ret20,range,breakout,atrPct].every(Number.isFinite)&&av>0&&Math.abs(ret1)<=30;
  const outOfRange=Number.isFinite(atrPct)&&!(0.4<=atrPct&&atrPct<=14);
  const pureDomain=baseReady&&outOfRange;
  return{
    ticker,eligible:pureDomain,reason:pureDomain?'ATR_PCT_OUTSIDE_V16_0_4_TO_14_RANGE':!baseReady?'OTHER_V16_INPUT_REJECTION':'ATR_INSIDE_CERTIFIED_RANGE',
    session:expected,atrPct,atr14:a14,close:q.close,ret1Pct:ret1,validHistorySessions:rows.length,
    currentSessionValidated:q.date===expected,symbolVerified:doc.symbolVerified===true,isin:String(doc.isin||'').trim().toUpperCase()||null,
    sourcePrerequisites:{sma10:s10,sma20:s20,sma50:s50,rsi14:rr,averageVolume20:av,ret3Pct:ret3,ret5Pct:ret5,ret10Pct:ret10,ret20Pct:ret20,rangePosition20:range,breakout20Pct:breakout}
  };
}

function main(){
  const truth=read('data/stable/v15-price-truth.json',{});
  const old=read('data/g11-v16-domain-exceptions.json',{records:[]});
  const expected=dateOnly(truth.expectedSession);
  if(!expected)throw new Error('expected_session_missing');
  const candidates=[...new Set((old.records||[]).filter(r=>r.approved===true&&r.reason==='ATR_PCT_OUTSIDE_V16_0_4_TO_14_RANGE').map(r=>String(r.ticker||'').trim().toUpperCase()).filter(Boolean))];
  const evaluations=candidates.map(t=>evaluate(t,expected));
  const records=[];
  const readiness=[];
  for(const e of evaluations){
    if(!e.eligible||e.currentSessionValidated!==true||e.symbolVerified!==true||!e.isin||e.validHistorySessions<56)continue;
    records.push({
      ticker:e.ticker,isin:e.isin,session:expected,disposition:'LEGITIMATE_V16_MODEL_DOMAIN_EXCLUSION',approved:true,
      identityVerified:true,currentSessionValidated:true,validHistorySessions:e.validHistorySessions,
      reason:'ATR_PCT_OUTSIDE_V16_0_4_TO_14_RANGE',observedAtrPct:e.atrPct,certifiedRange:{min:0.4,max:14},
      sameSessionRequirementMet:true,
      evidencePaths:['data/history/'+e.ticker+'.json','docs/astra/G11_V16_FEATURE_READINESS.json','scripts/research/v16-probabilistic-model-impact.py'],
      reviewedAt:new Date().toISOString()
    });
    readiness.push({
      ticker:e.ticker,ready:false,readyBeforeCrossSection:false,sameSessionRequirementMet:true,latestSession:expected,
      validHistorySessions:e.validHistorySessions,reasons:['ATR_PCT_OUTSIDE_V16_0_4_TO_14_RANGE'],atrPct:e.atrPct
    });
  }
  write('data/g11-v16-domain-exceptions.json',{
    schemaVersion:'astra-g11-v16-domain-exceptions-1',expectedSession:expected,
    policy:'Daily G22 operational revalidation of the certified V16 ATR domain. No threshold changes are permitted; an exclusion exists only when the exact current session is valid and ATR% remains outside the frozen 0.4..14 range while all other reproduced V16 base-feature prerequisites pass.',
    records
  });
  write('docs/astra/G11_V16_FEATURE_READINESS.json',{
    schemaVersion:'astra-g11-v16-feature-readiness-operational-1',generatedAt:new Date().toISOString(),expectedSession:expected,
    methodology:{source:'scripts/research/v16-probabilistic-model-impact.py',atrPctRange:{min:0.4,max:14},thresholdChanged:false},
    records:readiness
  });
  write('data/g22-v16-domain-refresh-audit.json',{
    schemaVersion:'astra-g22-v16-domain-refresh-audit-1',generatedAt:new Date().toISOString(),expectedSession:expected,
    candidateTickers:candidates,acceptedTickers:records.map(r=>r.ticker),evaluations
  });
  console.log('G22_V16_DOMAIN_EXCEPTIONS '+JSON.stringify({expectedSession:expected,acceptedTickers:records.map(r=>r.ticker),evaluations:evaluations.map(e=>({ticker:e.ticker,atrPct:e.atrPct,reason:e.reason,validHistorySessions:e.validHistorySessions}))}));
}
main();
