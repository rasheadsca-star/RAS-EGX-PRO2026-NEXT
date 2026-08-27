import { atr, clamp, mean, median, round, sma, weightedAvailable } from './math.js';

const finite=v=>Number.isFinite(Number(v));
const DEFAULTS={
  lookbackSessions:90,
  swingRadius:2,
  minConfluenceMethods:2,
  clusterToleranceAtr:.65,
  clusterTolerancePct:1.2,
  entryAtr:.35,
  entryPct:.60,
  stopAtr:.45,
  stopPct:.80,
  precisionTargetR:.80,
  minStructuralNetRR:1.25,
  preferredRiskFromPct:4,
  preferredRiskToPct:6,
  maxNearEntryAtr:.35,
  roundTripCostPct:.60,
};

function cfgOf(cfg={}){return {...DEFAULTS,...(cfg?.strategies?.precisionGeometry||cfg?.precisionGeometry||{})};}
function out(pass,score,reasonCodes,raw){return {pass:Boolean(pass),score:round(score,1),reasonCodes,raw};}

function extrema(bars,r=2){
  const highs=[],lows=[];
  for(let i=r;i<bars.length-r;i++){
    const w=bars.slice(i-r,i+r+1),b=bars[i];
    if(b.high>=Math.max(...w.map(x=>x.high)))highs.push({i,value:b.high,date:b.date});
    if(b.low<=Math.min(...w.map(x=>x.low)))lows.push({i,value:b.low,date:b.date});
  }
  return {highs,lows};
}

function cluster(points,tolerance){
  const groups=[];
  for(const point of [...points].sort((a,b)=>a.value-b.value)){
    let g=groups.find(x=>Math.abs(x.level-point.value)<=tolerance);
    if(!g){g={items:[],level:point.value};groups.push(g);}
    g.items.push(point);g.level=median(g.items.map(x=>x.value));
  }
  return groups.map(g=>({level:g.level,touches:g.items.length,lastIndex:Math.max(...g.items.map(x=>x.i))}));
}

function structuralLevels(bars,c){
  const w=bars.slice(-Math.max(40,c.lookbackSessions)),last=w.at(-1),px=last.close,a=atr(w,14);
  if(!(a>0))return null;
  const tolerance=Math.max(a*c.clusterToleranceAtr,px*c.clusterTolerancePct/100),methods=[];

  const pivot=(last.high+last.low+last.close)/3;
  const classicSupport=2*pivot-last.high,classicResistance=2*pivot-last.low;
  if(classicSupport>0&&classicSupport<px)methods.push({name:'CLASSIC_PIVOT',support:classicSupport,resistance:classicResistance,weight:.9});

  const ex=extrema(w,c.swingRadius),lowClusters=cluster(ex.lows,tolerance).filter(x=>x.touches>=2&&x.level<px),highClusters=cluster(ex.highs,tolerance).filter(x=>x.touches>=2&&x.level>px);
  const swingSupport=lowClusters.sort((a,b)=>b.level-a.level||b.touches-a.touches)[0];
  const swingResistance=highClusters.sort((a,b)=>a.level-b.level||b.touches-a.touches)[0];
  if(swingSupport&&swingResistance)methods.push({name:'SWING_CLUSTER',support:swingSupport.level,resistance:swingResistance.level,weight:1.25,touches:{support:swingSupport.touches,resistance:swingResistance.touches}});

  const d20=w.slice(-20),donchianSupport=Math.min(...d20.map(x=>x.low)),donchianResistance=Math.max(...d20.map(x=>x.high));
  if(donchianSupport>0&&donchianSupport<px&&donchianResistance>px)methods.push({name:'DONCHIAN_20',support:donchianSupport,resistance:donchianResistance,weight:1});

  const s20=sma(w.map(x=>x.close),20);
  if(finite(s20)&&s20>0&&s20<px)methods.push({name:'SMA20_SUPPORT',support:s20,resistance:px+Math.max(a,px-s20),weight:.55});

  const supportCandidates=methods.filter(m=>finite(m.support)&&m.support<px).sort((x,y)=>y.support-x.support);
  const resistanceCandidates=methods.filter(m=>finite(m.resistance)&&m.resistance>px).sort((x,y)=>x.resistance-y.resistance);
  if(!supportCandidates.length||!resistanceCandidates.length)return {a,px,tolerance,methods,nearestSupport:null,nearestResistance:null};
  return {a,px,tolerance,methods,nearestSupport:supportCandidates[0].support,nearestResistance:resistanceCandidates[0].resistance};
}

function confluenceScore(methods,key,anchor,tolerance){
  const near=methods.filter(m=>finite(m[key])&&Math.abs(Number(m[key])-anchor)<=tolerance*1.25);
  const weight=near.reduce((s,m)=>s+Number(m.weight||1),0);
  return {methods:near.map(m=>m.name),count:near.length,score:clamp(weight/2.75*100)};
}

function geometryScore({riskPct,structuralNetRR,precisionNetRR,alignmentState,supportConfluence,resistanceConfluence},c){
  const riskScore=riskPct>=c.preferredRiskFromPct&&riskPct<=c.preferredRiskToPct?100:riskPct>=3&&riskPct<=7?70:35;
  const rrScore=structuralNetRR>=2?100:structuralNetRR>=1.5?85:structuralNetRR>=c.minStructuralNetRR?70:clamp(structuralNetRR/Math.max(.01,c.minStructuralNetRR)*60);
  const precisionScore=precisionNetRR>=.7?100:precisionNetRR>=.55?80:precisionNetRR>=.4?55:25;
  const alignment=({IN_ENTRY_RANGE:100,NEAR_ENTRY:85,BELOW_ENTRY_WAIT:45,EXTENDED_WAIT:25})[alignmentState]??25;
  return weightedAvailable([[supportConfluence.score,18],[resistanceConfluence.score,18],[riskScore,18],[rrScore,22],[precisionScore,12],[alignment,12]])??0;
}

export function structuralPrecisionGeometryEngine(bars,cfg={}){
  const c=cfgOf(cfg);
  if(!Array.isArray(bars)||bars.length<60)return out(false,0,['INSUFFICIENT_HISTORY'],{researchOnly:true,eligibilityImpact:'NONE_CHALLENGER_MODE'});
  const lv=structuralLevels(bars,c);
  if(!lv||!(lv.a>0)||!finite(lv.nearestSupport)||!finite(lv.nearestResistance))return out(false,0,['STRUCTURAL_LEVELS_INCOMPLETE'],{researchOnly:true,eligibilityImpact:'NONE_CHALLENGER_MODE',methods:lv?.methods??[]});

  const {a,px,tolerance,methods,nearestSupport,nearestResistance}=lv;
  const supportConfluence=confluenceScore(methods,'support',nearestSupport,tolerance),resistanceConfluence=confluenceScore(methods,'resistance',nearestResistance,tolerance);
  const entryLow=nearestSupport,entryHigh=entryLow+Math.max(a*c.entryAtr,px*c.entryPct/100),stop=entryLow-Math.max(a*c.stopAtr,px*c.stopPct/100);
  if(!(entryLow>0&&entryHigh>entryLow&&stop>0&&nearestResistance>entryHigh))return out(false,0,['INVALID_PRECISION_GEOMETRY'],{researchOnly:true,eligibilityImpact:'NONE_CHALLENGER_MODE',entryLow:round(entryLow,4),entryHigh:round(entryHigh,4),stop:round(stop,4),nearestResistance:round(nearestResistance,4)});

  const cost=entryHigh*c.roundTripCostPct/100,effectiveRisk=entryHigh-stop+cost;
  const rawP1=entryHigh+c.precisionTargetR*effectiveRisk,p1=Math.min(rawP1,nearestResistance),precisionNetRR=(p1-entryHigh-cost)/effectiveRisk,structuralNetRR=(nearestResistance-entryHigh-cost)/effectiveRisk,riskPct=(entryHigh-stop)/entryHigh*100;
  let alignmentState='EXTENDED_WAIT';
  if(px<entryLow)alignmentState='BELOW_ENTRY_WAIT';
  else if(px<=entryHigh)alignmentState='IN_ENTRY_RANGE';
  else if((px-entryHigh)/a<=c.maxNearEntryAtr)alignmentState='NEAR_ENTRY';
  const score=geometryScore({riskPct,structuralNetRR,precisionNetRR,alignmentState,supportConfluence,resistanceConfluence},c);
  const reasons=[];
  if(supportConfluence.count<c.minConfluenceMethods)reasons.push('SUPPORT_CONFLUENCE_WEAK');
  if(resistanceConfluence.count<c.minConfluenceMethods)reasons.push('RESISTANCE_CONFLUENCE_WEAK');
  if(structuralNetRR<c.minStructuralNetRR)reasons.push('STRUCTURAL_RR_LOW');
  if(['BELOW_ENTRY_WAIT','EXTENDED_WAIT'].includes(alignmentState))reasons.push(alignmentState);
  const pass=reasons.length===0;
  return out(pass,score,reasons,{
    researchOnly:true,eligibilityImpact:'NONE_CHALLENGER_MODE',calibrated:false,
    status:pass?'STRUCTURAL_PRECISION_READY':alignmentState,
    price:round(px,4),atr14:round(a,4),tolerance:round(tolerance,4),
    methods:methods.map(m=>({name:m.name,support:round(m.support,4),resistance:round(m.resistance,4),weight:m.weight,touches:m.touches??null})),
    supportConfluence,resistanceConfluence,
    entryZone:{from:round(entryLow,4),to:round(entryHigh,4)},referenceEntry:round(entryHigh,4),stopLoss:round(stop,4),riskPct:round(riskPct,2),
    precisionTarget:{id:'PG1',requestedR:c.precisionTargetR,price:round(p1,4),netR:round(precisionNetRR,3),cappedByResistance:p1<rawP1},
    structuralResistance:round(nearestResistance,4),structuralNetRR:round(structuralNetRR,3),roundTripCostPct:c.roundTripCostPct,alignmentState,
    preferredRiskBand:{fromPct:c.preferredRiskFromPct,toPct:c.preferredRiskToPct,inside:riskPct>=c.preferredRiskFromPct&&riskPct<=c.preferredRiskToPct},
    promotionAllowed:false,
  });
}
