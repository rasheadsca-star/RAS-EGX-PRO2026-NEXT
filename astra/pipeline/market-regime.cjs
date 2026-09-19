'use strict';
const {VERSION,CONFIG,finite,round,median,deepFreeze,stableHash}=require('./g09-shared.cjs');
const {pointInTimeIndicators}=require('../analysis/indicators.cjs');

function computeRegime(context){
  const rows=context.canonicalSnapshot.rows;const metricsRows=rows.map(row=>pointInTimeIndicators(row,[],context.sessionDate));
  const advances=metricsRows.filter(x=>finite(x.return1Pct,0)>.05).length;
  const declines=metricsRows.filter(x=>finite(x.return1Pct,0)<-.05).length;
  const unchanged=rows.length-advances-declines;
  const sma50Known=metricsRows.filter(x=>typeof x.aboveSma50==='boolean');
  const volKnown=metricsRows.map(x=>finite(x.volatility20AnnualizedPct)).filter(Number.isFinite);
  const metrics={
    sessionDate:context.sessionDate,universeCount:rows.length,analyzedCount:rows.length,participationPct:100,
    advances,declines,unchanged,advancePct:round(advances/Math.max(1,advances+declines)*100,1),
    advanceDeclineRatio:round(advances/Math.max(1,declines),2),
    aboveSma20Pct:round(metricsRows.filter(x=>x.aboveSma20===true).length/Math.max(1,rows.length)*100,1),
    aboveSma50Pct:round(sma50Known.filter(x=>x.aboveSma50===true).length/Math.max(1,sma50Known.length)*100,1),
    medianReturn1Pct:round(median(metricsRows.map(x=>finite(x.return1Pct))),2),
    medianReturn5Pct:round(median(metricsRows.map(x=>finite(x.return5Pct))),2),
    medianReturn20Pct:round(median(metricsRows.map(x=>finite(x.return20Pct))),2),
    volatility20AnnualizedPct:round(median(volKnown),2),
    highVolumeParticipationPct:round(metricsRows.filter(x=>finite(x.relativeVolume20)>=1.2).length/Math.max(1,metricsRows.filter(x=>Number.isFinite(finite(x.relativeVolume20))).length)*100,1)
  };
  for(const k of ['advancePct','aboveSma20Pct','aboveSma50Pct','medianReturn20Pct','medianReturn5Pct','volatility20AnnualizedPct'])if(!Number.isFinite(metrics[k]))throw Object.assign(new Error(`Regime metric missing: ${k}`),{code:'REGIME_EXECUTION_FAILED'});
  let score=50;
  if(metrics.advancePct>=60)score+=14;else if(metrics.advancePct<40)score-=16;
  if(metrics.aboveSma20Pct>=60)score+=16;else if(metrics.aboveSma20Pct<40)score-=18;
  if(metrics.aboveSma50Pct>=55)score+=14;else if(metrics.aboveSma50Pct<35)score-=16;
  if(metrics.medianReturn20Pct>=4)score+=12;else if(metrics.medianReturn20Pct<-4)score-=14;
  if(metrics.medianReturn5Pct>=1.5)score+=6;else if(metrics.medianReturn5Pct<-2)score-=8;
  if(metrics.volatility20AnnualizedPct>=55)score-=18;else if(metrics.volatility20AnnualizedPct<=30)score+=6;
  score=Math.max(0,Math.min(100,Math.round(score)));
  let regime='NEUTRAL';if(metrics.volatility20AnnualizedPct>=65)regime='HIGH_VOLATILITY';else if(score>=68)regime='RISK_ON';else if(score<=35)regime='RISK_OFF';
  const policy={RISK_ON:{riskMultiplier:1,maxOpenRiskPct:2,maxTradeRiskPct:.25},NEUTRAL:{riskMultiplier:.65,maxOpenRiskPct:1.3,maxTradeRiskPct:.16},RISK_OFF:{riskMultiplier:.35,maxOpenRiskPct:.7,maxTradeRiskPct:.09},HIGH_VOLATILITY:{riskMultiplier:.2,maxOpenRiskPct:.4,maxTradeRiskPct:.05}}[regime];
  const semantic={regime,score,metrics,version:VERSION.regime,source:CONFIG.regimeSource};
  return deepFreeze({regimeId:`REGIME-${stableHash(semantic).slice(0,20)}`,regime,score,version:VERSION.regime,metrics,evidenceReasons:regimeReasons(metrics,score,regime),eligibleStrategyFamilies:['V16_CHAMPION_LINEAGE'],...policy,semanticHash:stableHash(semantic)});
}

function regimeReasons(m,score,regime){return[{code:'BREADTH_ADVANCE_PCT',value:m.advancePct},{code:'ABOVE_SMA20_PCT',value:m.aboveSma20Pct},{code:'ABOVE_SMA50_PCT',value:m.aboveSma50Pct},{code:'MEDIAN_RETURN20_PCT',value:m.medianReturn20Pct},{code:'MEDIAN_RETURN5_PCT',value:m.medianReturn5Pct},{code:'VOLATILITY20_ANNUALIZED_PCT',value:m.volatility20AnnualizedPct},{code:'REGIME_SCORE',value:score},{code:'REGIME_CLASS',value:regime}]}

module.exports={computeRegime,regimeReasons};
