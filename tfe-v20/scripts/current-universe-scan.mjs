import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeTickerBase } from '../src/engine.js';
import { POLICY } from '../src/policy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const HISTORY = path.join(ROOT, 'data/history');
const OUT = path.join(ROOT, 'tfe-v20/evidence/meta/current-universe-scan.json');
const triplePath = path.join(ROOT, 'tfe-v20/evidence/external/triple-engine-current-2026-08-27.json');
const expectedSessionDate = fs.existsSync(triplePath)
  ? JSON.parse(fs.readFileSync(triplePath, 'utf8')).marketSession ?? '2026-08-27'
  : '2026-08-27';

const median = (xs) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x,y)=>x-y), m = Math.floor(a.length/2);
  return a.length % 2 ? a[m] : (a[m-1]+a[m])/2;
};
const round = (x,d=2) => Number.isFinite(Number(x)) ? Number(Number(x).toFixed(d)) : null;

function inc(map,key){map.set(key,(map.get(key)??0)+1);}
function histogram(map,total){return [...map.entries()].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0]))).map(([name,count])=>({name,count,pct:total?round(count/total*100,1):null}));}

const docs=[];
for (const file of fs.readdirSync(HISTORY).filter((x)=>x.endsWith('.json')).sort()) {
  try {
    const doc=JSON.parse(fs.readFileSync(path.join(HISTORY,file),'utf8'));
    const sessions=Array.isArray(doc.sessions)?doc.sessions:[];
    if(sessions.length<POLICY.minBars) continue;
    docs.push({file,doc,sessions,ticker:String(doc.ticker??path.basename(file,'.json')).toUpperCase()});
  } catch {}
}

const rows=[];
const reasonCounts=new Map(), qualityCounts=new Map(), decisionCounts=new Map(), lastSessionCounts=new Map();
for (const {doc,sessions,ticker} of docs) {
  const analysis=analyzeTickerBase({
    ticker,
    nameAr:doc.companyNameAr??null,
    nameEn:doc.companyNameEn??null,
    rows:sessions,
    expectedSessionDate,
    historyMeta:{
      warnings:doc.warnings??[],
      updateFailed:doc.updateFailed??false,
      staleData:doc.staleData??false,
      symbolVerified:doc.symbolVerified,
      symbolVerification:doc.symbolVerification,
      officiallyVerifiedLatestSession:doc.officiallyVerifiedLatestSession,
    },
    includeOverlay:false,
  });
  const lastSession=analysis.sessionDate??doc.lastSession??sessions.at(-1)?.date??null;
  const reasons=analysis.reasonCodes??[];
  reasons.forEach((r)=>inc(reasonCounts,r));
  inc(qualityCounts,analysis.quality?.state??'UNKNOWN');
  inc(decisionCounts,analysis.decision??'UNKNOWN');
  inc(lastSessionCounts,lastSession??'UNKNOWN');
  rows.push({
    ticker,
    nameAr:analysis.nameAr??null,
    nameEn:analysis.nameEn??null,
    sessionDate:lastSession,
    fresh:lastSession===expectedSessionDate,
    price:analysis.price??null,
    eligible:Boolean(analysis.eligible),
    decision:analysis.decision??null,
    reasonCodes:reasons,
    scores:analysis.scores??null,
    quality:analysis.quality??null,
    liquidity:analysis.liquidity??null,
    supportResistance:{
      score:analysis.supportResistance?.score??null,
      methodCount:analysis.supportResistance?.methodCount??null,
      atr14:analysis.supportResistance?.atr14??null,
      nearestSupport:analysis.supportResistance?.nearestSupport??null,
      nearestResistance:analysis.supportResistance?.nearestResistance??null,
    },
    tradePlan:analysis.tradePlan??null,
    history:{availableSessions:doc.availableSessions??sessions.length,generatedAt:doc.generatedAt??null,warnings:doc.warnings??[],updateFailed:doc.updateFailed??false,staleData:doc.staleData??false},
  });
}

const fresh=rows.filter((x)=>x.fresh);
const freshReadyData=fresh.filter((x)=>x.quality?.state!=='BLOCKED');
const eligible=rows.filter((x)=>x.eligible);
const freshEligible=eligible.filter((x)=>x.fresh);
const plans=fresh.map((x)=>x.tradePlan).filter(Boolean);
const rrs=plans.map((p)=>Number(p.structuralNetRR)).filter(Number.isFinite);
const nearMiss=fresh
  .filter((x)=>!x.eligible)
  .map((x)=>({ ...x, blockerCount:x.reasonCodes.length }))
  .sort((a,b)=>a.blockerCount-b.blockerCount||(b.scores?.research??-1)-(a.scores?.research??-1)||(b.tradePlan?.structuralNetRR??-99)-(a.tradePlan?.structuralNetRR??-99)||a.ticker.localeCompare(b.ticker));
const ranked=[...freshEligible].sort((a,b)=>(b.scores?.research??-1)-(a.scores?.research??-1)||(b.scores?.technical??-1)-(a.scores?.technical??-1)||(b.tradePlan?.structuralNetRR??-99)-(a.tradePlan?.structuralNetRR??-99)||a.ticker.localeCompare(b.ticker)).map((x,i)=>({...x,rank:i+1}));

const report={
  schemaVersion:'tfe-current-universe-scan-v1',
  generatedAt:new Date().toISOString(),
  engineId:POLICY.engineId,
  mode:'RESEARCH_CURRENT_SCAN_ONLY',
  expectedSessionDate,
  governance:{researchOnly:true,executionAllowed:false,productionPromotionAllowed:false,missingOrStaleDataCanBecomeRecommendation:false},
  summary:{
    historyFilesUsable:rows.length,
    freshSession: fresh.length,
    staleOrBehind: rows.length-fresh.length,
    freshNonBlockedQuality:freshReadyData.length,
    eligibleAllDates:eligible.length,
    freshEligible:freshEligible.length,
    freshWithTradePlan:plans.length,
    freshRrAtLeast070:rrs.filter((x)=>x>=POLICY.minStructuralNetRR).length,
    freshRrMedian:round(median(rrs),3),
    freshRrMin:rrs.length?round(Math.min(...rrs),3):null,
    freshRrMax:rrs.length?round(Math.max(...rrs),3):null,
  },
  reasonHistogram:histogram(reasonCounts,rows.length),
  qualityHistogram:histogram(qualityCounts,rows.length),
  decisionHistogram:histogram(decisionCounts,rows.length),
  lastSessionHistogram:histogram(lastSessionCounts,rows.length).slice(0,20),
  topEligible:ranked.slice(0,50),
  nearMisses:nearMiss.slice(0,75).map((x)=>({ticker:x.ticker,sessionDate:x.sessionDate,price:x.price,blockerCount:x.blockerCount,reasonCodes:x.reasonCodes,researchScore:x.scores?.research??null,technicalScore:x.scores?.technical??null,liquidityScore:x.liquidity?.score??null,srScore:x.supportResistance?.score??null,rr:x.tradePlan?.structuralNetRR??null,alignment:x.tradePlan?.alignmentState??null,qualityState:x.quality?.state??null,qualityScore:x.quality?.score??null})),
  allRows:rows,
};
fs.mkdirSync(path.dirname(OUT),{recursive:true});
fs.writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({
  expectedSessionDate,
  summary:report.summary,
  topEligible:report.topEligible.slice(0,20).map((x)=>({rank:x.rank,ticker:x.ticker,decision:x.decision,research:x.scores?.research,technical:x.scores?.technical,liquidity:x.liquidity?.score,sr:x.supportResistance?.score,rr:x.tradePlan?.structuralNetRR,alignment:x.tradePlan?.alignmentState})),
  nearMisses:report.nearMisses.slice(0,20),
  topReasons:report.reasonHistogram.slice(0,12),
},null,2));
