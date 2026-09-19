'use strict';

const {validateCanonicalSnapshot}=require('../core/canonical-data.cjs');
const {finite,pointInTimeHistory,mean,pointInTimeIndicators}=require('./indicators.cjs');
const {buildRelativeStrengthEvidence}=require('./relative-strength.cjs');

function rowClose(row){return finite(row?.ohlc?.close??row?.close)}
function rowHigh(row){return finite(row?.ohlc?.high??row?.high)}
function rowLow(row){return finite(row?.ohlc?.low??row?.low)}
function rowVolume(row){return finite(row?.volume)}
function validateRow(row,sessionDate){
  const ticker=String(row?.ticker||'UNKNOWN');
  const snapshot={snapshotId:row?.snapshotId||`VCP-${ticker}-${sessionDate}`,sessionDate,rows:[row]};
  const check=validateCanonicalSnapshot(snapshot,sessionDate);
  if(check.errors.length||check.temporal.length||check.quarantined.length){
    throw Object.assign(new Error(`VCP input is not valid point-in-time canonical data for ${ticker}`),{
      code:'VCP_INPUT_INVALID',
      details:{errors:check.errors,temporal:check.temporal,quarantined:check.quarantined}
    });
  }
}
function averageRangePct(rows){
  const values=[];
  for(const row of rows){
    const high=rowHigh(row),low=rowLow(row),close=rowClose(row);
    if([high,low,close].every(Number.isFinite)&&close>0)values.push((high-low)/close*100);
  }
  return values.length?mean(values):null;
}
function averageVolume(rows){
  const values=rows.map(rowVolume).filter(Number.isFinite);
  return values.length?mean(values):null;
}
function buildVcpEvidence(row,history=[],sessionDate=String(row?.sessionDate||''),universeRows=[row]){
  validateRow(row,sessionDate);
  const ticker=String(row?.ticker||'');
  const rows=pointInTimeHistory(history,sessionDate);
  const indicators=pointInTimeIndicators(row,rows,sessionDate);
  const relativeStrength=buildRelativeStrengthEvidence(row,rows,sessionDate,universeRows);
  const last5=rows.slice(-5),last20=rows.slice(-20);
  const range5=averageRangePct(last5),range20=averageRangePct(last20);
  const volume5=averageVolume(last5),volume20=averageVolume(last20);
  const contractionRatio=Number.isFinite(range5)&&Number.isFinite(range20)&&range20>0?range5/range20:null;
  const volumeDryUpRatio=Number.isFinite(volume5)&&Number.isFinite(volume20)&&volume20>0?volume5/volume20:null;
  const highs=last20.map(rowHigh).filter(Number.isFinite);
  const availableHigh=highs.length?Math.max(...highs):null;
  const close=rowClose(row);
  const distanceFromAvailableHighPct=Number.isFinite(close)&&Number.isFinite(availableHigh)&&availableHigh>0
    ? (close/availableHigh-1)*100
    : null;
  return Object.freeze({
    ticker,
    securityId:row?.securityId||ticker,
    sourceRef:row?.snapshotId||ticker,
    asOfSessionDate:sessionDate,
    observations:Object.freeze({
      historySessions:rows.length,
      averageRange5Pct:range5,
      averageRange20Pct:range20,
      contractionRatio,
      averageVolume5:volume5,
      averageVolume20:volume20,
      volumeDryUpRatio,
      availableHigh20:availableHigh,
      distanceFromAvailableHighPct,
      breakout20:finite(indicators.breakout20),
      aboveSma20:indicators.aboveSma20,
      aboveSma50:indicators.aboveSma50,
      relativeStrength20:relativeStrength.relativeStrength20
    }),
    provenance:Object.freeze({
      source:'point-in-time canonical OHLCV + IndicatorSnapshot + RelativeStrengthEvidence',
      marketSnapshotId:row?.snapshotId||null,
      noStrategyThresholdsApplied:true
    })
  });
}

module.exports=Object.freeze({averageRangePct,averageVolume,buildVcpEvidence});
