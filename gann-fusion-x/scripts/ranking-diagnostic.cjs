#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');
const ROOT=path.resolve(__dirname,'../..');
const build=spawnSync(process.execPath,[path.join(__dirname,'build-snapshot.cjs')],{cwd:ROOT,encoding:'utf8'});
if(build.status!==0){process.stderr.write(build.stdout||'');process.stderr.write(build.stderr||'');process.exit(build.status||1)}
const snap=JSON.parse(fs.readFileSync(path.join(ROOT,'gann-fusion-x/data/current.json'),'utf8'));
const rows=(snap.all||[]).filter(x=>x.decisionFunnel?.speculative?.decision?.code==='ACTIONABLE').map(x=>{
  const p=x.parts||{},sp=x.decisionFunnel.speculative,lv=sp.levels||{},m=x.marketMeta||{};
  return {
    ticker:x.ticker,
    nameAr:x.nameAr,
    fusionScore:x.score,
    speculativeScore:sp.score,
    close:x.close,
    entryLow:lv.entryLow,
    entryHigh:lv.entryHigh,
    trigger:lv.trigger,
    stopLoss:lv.stopLoss,
    riskPct:lv.riskPct,
    rr1:lv.rr1,
    rr2:lv.rr2,
    breakout:{score:p.breakout?.score,confirmed:p.breakout?.confirmed,near:p.breakout?.near,distancePct:p.breakout?.distancePct},
    volume:{score:p.volume?.score,ratio20:p.volume?.ratio20,confirmed:p.volume?.confirmed},
    momentum:{score:p.momentum?.score,rsi14:p.momentum?.rsi14,ret5Pct:p.momentum?.ret5Pct,ret20Pct:p.momentum?.ret20Pct,overheated:p.momentum?.overheated},
    trend:{score:p.trend?.score},
    relativeStrength:{score:p.relativeStrength?.score,rs20Pct:p.relativeStrength?.rs20Pct},
    gannTime:{score:p.gannTime?.score,active:p.gannTime?.active,cycle:p.gannTime?.cycle,distance:p.gannTime?.distance},
    gannPrice:{score:p.gannPrice?.score,distancePct:p.gannPrice?.distancePct},
    fundamentals:{score:p.fundamentals?.score,verified:Boolean(x.sepaEvidence?.fundamentals?.verified)},
    marketRegime:{score:p.marketRegime?.score,regime:p.marketRegime?.regime},
    liquidityPercentile:m.liquidityPercentile,
    technicalRank:m.technicalRank,
    riskScore:m.riskScore,
    moneyFlowQualityScore:m.moneyFlowQualityScore
  };
}).sort((a,b)=>b.speculativeScore-a.speculativeScore);
console.log(JSON.stringify({sessionDate:snap.sessionDate,count:rows.length,rows},null,2));
