'use strict';

const {validateCanonicalSnapshot}=require('../core/canonical-data.cjs');

function finite(value){
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}
function rowDate(row){return String(row?.sessionDate||row?.date||'').slice(0,10)}
function rowClose(row){return finite(row?.ohlc?.close??row?.close)}
function rowHigh(row){return finite(row?.ohlc?.high??row?.high)}
function rowLow(row){return finite(row?.ohlc?.low??row?.low)}
function rowVolume(row){return finite(row?.volume)}

function pointInTimeHistory(history,sessionDate){
  const rows=Array.isArray(history)?history:Array.isArray(history?.rows)?history.rows:[];
  return rows
    .filter(row=>{const d=rowDate(row);return d&&d<=sessionDate})
    .slice()
    .sort((a,b)=>rowDate(a).localeCompare(rowDate(b)));
}
function mean(values){
  const xs=values.filter(Number.isFinite);
  return xs.length?xs.reduce((sum,v)=>sum+v,0)/xs.length:null;
}
function sampleStd(values){
  const xs=values.filter(Number.isFinite);
  if(xs.length<2)return null;
  const m=mean(xs);
  return Math.sqrt(xs.reduce((sum,v)=>sum+(v-m)**2,0)/(xs.length-1));
}
function sma(history,period,sessionDate){
  const closes=pointInTimeHistory(history,sessionDate).map(rowClose).filter(Number.isFinite);
  if(closes.length<period)return null;
  return mean(closes.slice(-period));
}
function returnPct(history,period,sessionDate){
  const closes=pointInTimeHistory(history,sessionDate).map(rowClose).filter(Number.isFinite);
  if(closes.length<=period)return null;
  const current=closes.at(-1),prior=closes[closes.length-1-period];
  return prior>0?(current/prior-1)*100:null;
}
function volatility20AnnualizedPct(history,sessionDate){
  const closes=pointInTimeHistory(history,sessionDate).map(rowClose).filter(Number.isFinite);
  if(closes.length<3)return null;
  const recent=closes.slice(-21),returns=[];
  for(let i=1;i<recent.length;i++)if(recent[i-1]>0)returns.push((recent[i]/recent[i-1]-1)*100);
  const sd=sampleStd(returns);
  return sd===null?null:sd*Math.sqrt(252);
}
function atr(history,period,sessionDate){
  const rows=pointInTimeHistory(history,sessionDate);
  if(rows.length<period+1)return null;
  const recent=rows.slice(-(period+1)),trs=[];
  for(let i=1;i<recent.length;i++){
    const high=rowHigh(recent[i]),low=rowLow(recent[i]),prevClose=rowClose(recent[i-1]);
    if(![high,low,prevClose].every(Number.isFinite))continue;
    trs.push(Math.max(high-low,Math.abs(high-prevClose),Math.abs(low-prevClose)));
  }
  return trs.length===period?mean(trs):null;
}
function rsi(history,period,sessionDate){
  const closes=pointInTimeHistory(history,sessionDate).map(rowClose).filter(Number.isFinite);
  if(closes.length<period+1)return null;
  const recent=closes.slice(-(period+1));let gains=0,losses=0;
  for(let i=1;i<recent.length;i++){const d=recent[i]-recent[i-1];if(d>0)gains+=d;else losses-=d}
  const avgGain=gains/period,avgLoss=losses/period;
  if(avgLoss===0)return avgGain>0?100:50;
  const rs=avgGain/avgLoss;
  return 100-(100/(1+rs));
}
function relativeVolume(history,period,sessionDate,currentVolume=null){
  const rows=pointInTimeHistory(history,sessionDate);
  const current=finite(currentVolume??rowVolume(rows.at(-1)));
  if(current===null)return null;
  const prior=rows.slice(-(period+1),-1).map(rowVolume).filter(Number.isFinite);
  if(prior.length<period)return null;
  const avg=mean(prior);
  return avg>0?current/avg:null;
}
function preferred(source,key,fallback){
  const value=source?.[key];
  return value!==undefined&&value!==null?value:fallback;
}
function validateRow(row,sessionDate){
  const ticker=String(row?.ticker||'UNKNOWN');
  const snapshot={snapshotId:row?.snapshotId||`IND-${ticker}-${sessionDate}`,sessionDate,rows:[row]};
  const check=validateCanonicalSnapshot(snapshot,sessionDate);
  if(check.errors.length||check.temporal.length||check.quarantined.length){
    throw Object.assign(new Error(`Indicator input is not valid point-in-time canonical data for ${ticker}`),{
      code:'INDICATOR_INPUT_INVALID',
      details:{errors:check.errors,temporal:check.temporal,quarantined:check.quarantined}
    });
  }
}
function pointInTimeIndicators(row,history=[],sessionDate=String(row?.sessionDate||'')){
  validateRow(row,sessionDate);
  const source=row?.technicalInputs||{};
  const close=rowClose(row);
  const s10=preferred(source,'sma10',sma(history,10,sessionDate));
  const s20=preferred(source,'sma20',sma(history,20,sessionDate));
  const s50=preferred(source,'sma50',sma(history,50,sessionDate));
  const aboveSma20=typeof source.aboveSma20==='boolean'?source.aboveSma20:(Number.isFinite(close)&&Number.isFinite(finite(s20))?close>=finite(s20):null);
  const aboveSma50=typeof source.aboveSma50==='boolean'?source.aboveSma50:(Number.isFinite(close)&&Number.isFinite(finite(s50))?close>=finite(s50):null);
  return Object.freeze({
    return1Pct:preferred(source,'return1Pct',returnPct(history,1,sessionDate)),
    return5Pct:preferred(source,'return5Pct',returnPct(history,5,sessionDate)),
    return20Pct:preferred(source,'return20Pct',returnPct(history,20,sessionDate)),
    aboveSma20,
    aboveSma50,
    volatility20AnnualizedPct:preferred(source,'volatility20AnnualizedPct',volatility20AnnualizedPct(history,sessionDate)),
    relativeVolume20:preferred(source,'relativeVolume20',relativeVolume(history,20,sessionDate,rowVolume(row))),
    sma10:s10,
    sma20:s20,
    sma50:s50,
    atr14:preferred(source,'atr14',atr(history,14,sessionDate)),
    rsi14:preferred(source,'rsi14',rsi(history,14,sessionDate)),
    turnover20:preferred(source,'turnover20',null),
    breakout20:preferred(source,'breakout20',null),
    relativeStrength20:preferred(source,'relativeStrength20',null),
    trend:preferred(source,'trend',null)
  });
}

module.exports=Object.freeze({
  finite,pointInTimeHistory,mean,sampleStd,sma,returnPct,volatility20AnnualizedPct,atr,rsi,relativeVolume,pointInTimeIndicators
});
