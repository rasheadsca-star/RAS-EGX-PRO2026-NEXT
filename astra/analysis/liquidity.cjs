'use strict';

const {validateCanonicalSnapshot}=require('../core/canonical-data.cjs');
const {pointInTimeHistory,pointInTimeIndicators,mean}=require('./indicators.cjs');

const EVIDENCE_TURNOVER_MIN_EGP=1000000;

function finite(value){
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}
function validateRow(row,sessionDate){
  const ticker=String(row?.ticker||'UNKNOWN');
  const snapshot={snapshotId:row?.snapshotId||`LIQ-${ticker}-${sessionDate}`,sessionDate,rows:[row]};
  const check=validateCanonicalSnapshot(snapshot,sessionDate);
  if(check.errors.length||check.temporal.length||check.quarantined.length){
    throw Object.assign(new Error(`Liquidity input is not valid point-in-time canonical data for ${ticker}`),{
      code:'LIQUIDITY_INPUT_INVALID',
      details:{errors:check.errors,temporal:check.temporal,quarantined:check.quarantined}
    });
  }
}
function rowTurnover(row){
  const explicit=finite(row?.turnover);
  if(explicit!==null)return explicit;
  const close=finite(row?.ohlc?.close??row?.close),volume=finite(row?.volume);
  return Number.isFinite(close)&&Number.isFinite(volume)?close*volume:null;
}
function buildLiquidityEvidence(row,history=[],sessionDate=String(row?.sessionDate||''),sourceCandidate={}){
  validateRow(row,sessionDate);
  const ticker=String(row?.ticker||'');
  const rows=pointInTimeHistory(history,sessionDate);
  const indicator=pointInTimeIndicators(row,rows,sessionDate);
  const sourceTurnover=finite(sourceCandidate?.turnover20);
  const indicatorTurnover=finite(indicator.turnover20);
  const fallbackTurnover=rowTurnover(row);
  const turnover20Egp=sourceTurnover??indicatorTurnover??fallbackTurnover??0;
  const recent20=rows.slice(-20);
  const tradedDays=recent20.filter(x=>finite(x?.volume)>0).length;
  const turnoverSeries=recent20.map(rowTurnover).filter(Number.isFinite);
  return Object.freeze({
    ticker,
    securityId:row?.securityId||ticker,
    sourceRef:row?.snapshotId||ticker,
    asOfSessionDate:sessionDate,
    turnover20Egp,
    relativeVolume20:finite(indicator.relativeVolume20),
    readiness:Object.freeze({
      passed:turnover20Egp>=EVIDENCE_TURNOVER_MIN_EGP,
      minimumTurnoverEgp:EVIDENCE_TURNOVER_MIN_EGP,
      rule:'G09_EXISTING_TURNOVER20_EVIDENCE_THRESHOLD'
    }),
    observations:Object.freeze({
      historySessions:rows.length,
      tradedDays20:recent20.length?tradedDays:null,
      tradedDaysRatio20:recent20.length?tradedDays/recent20.length:null,
      averageObservedTurnover20Egp:turnoverSeries.length?mean(turnoverSeries):null
    }),
    provenance:Object.freeze({
      source:sourceTurnover!==null?'strategy source candidate turnover20':'canonical/indicator fallback',
      marketSnapshotId:row?.snapshotId||null
    })
  });
}

module.exports=Object.freeze({EVIDENCE_TURNOVER_MIN_EGP,buildLiquidityEvidence});
