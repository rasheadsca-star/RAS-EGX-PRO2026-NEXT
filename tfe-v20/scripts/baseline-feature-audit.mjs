import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backtestHistory } from '../src/backtest.js';
import { analyzeTickerBase } from '../src/engine.js';
import { scoreBars } from '../src/originalScore.js';
import { POLICY } from '../src/policy.js';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'../..');
const HISTORY=path.join(ROOT,'data/history');
const OUT=path.join(ROOT,'tfe-v20/evidence/meta/baseline-feature-audit.json');
const round=(x,d=3)=>Number.isFinite(Number(x))?Number(Number(x).toFixed(d)):null;
const med=(a)=>{const x=a.filter(Number.isFinite).sort((p,q)=>p-q);if(!x.length)return null;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2;};
const mean=(a)=>{const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null;};
const q=(a,p)=>{const x=a.filter(Number.isFinite).sort((u,v)=>u-v);if(!x.length)return null;const i=(x.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return lo===hi?x[lo]:x[lo]+(x[hi]-x[lo])*(i-lo);};
function cliffsDelta(a,b){const x=a.filter(Number.isFinite),y=b.filter(Number.isFinite);if(!x.length||!y.length)return null;let gt=0,lt=0;for(const i of x)for(const j of y){if(i>j)gt++;else if(i<j)lt++;}return (gt-lt)/(x.length*y.length);}
function featureSummary(records,key){const w=records.filter(r=>r.group==='TARGET').map(r=>Number(r.features[key])).filter(Number.isFinite);const l=records.filter(r=>r.group==='LOSS').map(r=>Number(r.features[key])).filter(Number.isFinite);return {feature:key,targetN:w.length,lossN:l.length,targetMean:round(mean(w)),lossMean:round(mean(l)),targetMedian:round(med(w)),lossMedian:round(med(l)),targetQ25:round(q(w,.25)),targetQ75:round(q(w,.75)),lossQ25:round(q(l,.25)),lossQ75:round(q(l,.75)),medianDelta:round((med(w)??0)-(med(l)??0)),cliffsDelta:round(cliffsDelta(w,l))};}
function categorical(records,key){const out={};for(const r of records){const v=String(r.features[key]??'UNKNOWN');out[v]??={value:v,target:0,loss:0,other:0};if(r.group==='TARGET')out[v].target++;else if(r.group==='LOSS')out[v].loss++;else out[v].other++;}return Object.values(out).map(x=>({...x,total:x.target+x.loss+x.other,targetRateComparable:(x.target+x.loss)?round(x.target/(x.target+x.loss)*100,1):null})).sort((a,b)=>b.total-a.total);}

const docs=[];
for(const file of fs.readdirSync(HISTORY).filter(x=>x.endsWith('.json')).sort()){
  try{const doc=JSON.parse(fs.readFileSync(path.join(HISTORY,file),'utf8'));if(Array.isArray(doc.sessions)&&doc.sessions.length>=POLICY.minBars)docs.push(doc);}catch{}
}
const records=[];
for(const doc of docs){
  const ticker=String(doc.ticker??'').toUpperCase();
  if(!ticker)continue;
  const bt=backtestHistory({ticker,rows:doc.sessions});
  for(const trade of bt.trades){
    const idx=doc.sessions.findIndex(x=>x.date===trade.signalDate);
    if(idx<0)continue;
    const prefix=doc.sessions.slice(0,idx+1);
    const a=analyzeTickerBase({ticker,rows:prefix,historyMeta:{warnings:[]},expectedSessionDate:null,includeOverlay:false});
    const tech=scoreBars(prefix);
    const bd=tech.breakdown??[];
    const price=Number(a.price??tech.lastClose);
    const atr=Number(a.supportResistance?.atr14);
    const plan=a.tradePlan;
    const group=trade.outcome==='TARGET1'?'TARGET':(String(trade.outcome).startsWith('STOP')||Number(trade.netPct)<=0?'LOSS':'OTHER');
    records.push({ticker,signalDate:trade.signalDate,entryDate:trade.entryDate,exitDate:trade.exitDate,outcome:trade.outcome,netPct:trade.netPct,group,features:{
      researchScore:Number(a.scores?.research),technicalScore:Number(a.scores?.technical),liquidityScore:Number(a.liquidity?.score),srScore:Number(a.supportResistance?.score),qualityScore:Number(a.quality?.score),structuralNetRR:Number(plan?.structuralNetRR),precisionNetRR:Number(plan?.precisionNetRR),srMethodCount:Number(a.supportResistance?.methodCount),atrPct:Number.isFinite(atr)&&price>0?atr/price*100:null,
      trendPoints:Number(bd[0]?.points),rsiPoints:Number(bd[1]?.points),macdPoints:Number(bd[2]?.points),volatilityPenalty:Number(bd[3]?.points),volumePoints:Number(bd[4]?.points),alignment:plan?.alignmentState??'UNKNOWN'
    }});
  }
}
const numeric=['researchScore','technicalScore','liquidityScore','srScore','qualityScore','structuralNetRR','precisionNetRR','srMethodCount','atrPct','trendPoints','rsiPoints','macdPoints','volatilityPenalty','volumePoints'];
const target=records.filter(r=>r.group==='TARGET'),loss=records.filter(r=>r.group==='LOSS'),other=records.filter(r=>r.group==='OTHER');
const features=numeric.map(k=>featureSummary(records,k)).sort((a,b)=>Math.abs(b.cliffsDelta??0)-Math.abs(a.cliffsDelta??0));
const report={schemaVersion:'tfe-baseline-feature-audit-v1',generatedAt:new Date().toISOString(),mode:'DESCRIPTIVE_ONLY_NO_TUNING',governance:{researchOnly:true,featureThresholdSelectionAllowed:false,productionPromotionAllowed:false,sameSampleMustNotBeUsedForSelectingAndClaimingImprovement:true,nextStepRequiresPreregisteredTemporalValidation:true},sample:{usableHistoryDocs:docs.length,trades:records.length,target:target.length,loss:loss.length,other:other.length,targetPct:records.length?round(target.length/records.length*100,1):null,lossPct:records.length?round(loss.length/records.length*100,1):null},numericFeatureSeparation:features,alignment:categorical(records,'alignment'),records};
fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sample:report.sample,topFeatureSeparation:features.slice(0,12),alignment:report.alignment},null,2));
