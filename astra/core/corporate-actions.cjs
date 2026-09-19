'use strict';

const {normalizeTicker}=require('./symbol-master.cjs');
const {utcDate,fmt,isTrading}=require('./market-calendar.cjs');

const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const ACTION_TYPES=Object.freeze(['SPLIT','CASH_DIVIDEND','SYMBOL_CHANGE']);

function normalizeSessionDate(value){
  const date=String(value||'').slice(0,10);
  if(!DATE_RE.test(date))return null;
  try{return fmt(utcDate(date))===date?date:null}catch{return null}
}
function evidenceBacked(event){
  const url=String(event?.evidenceUrl||event?.sourceUrl||'').trim();
  const source=String(event?.source||event?.sourceName||'').trim();
  return Boolean(source&&/^https?:\/\//i.test(url));
}
function normalizeCorporateAction(event,{marketPolicy=null}={}){
  const type=String(event?.type||'').trim().toUpperCase();
  if(!ACTION_TYPES.includes(type))throw new Error('CORPORATE_ACTION_TYPE_UNSUPPORTED');
  if(!evidenceBacked(event))throw new Error('CORPORATE_ACTION_EVIDENCE_REQUIRED');
  const ticker=normalizeTicker(event?.ticker);
  const effectiveSessionDate=normalizeSessionDate(event?.effectiveSessionDate);
  if(!ticker)throw new Error('CORPORATE_ACTION_TICKER_REQUIRED');
  if(!effectiveSessionDate)throw new Error('CORPORATE_ACTION_SESSION_INVALID');
  if(marketPolicy&&isTrading(effectiveSessionDate,marketPolicy)!==true)throw new Error('CORPORATE_ACTION_SESSION_NOT_TRADING_DAY');
  const base={
    actionId:String(event?.actionId||`${type}:${ticker}:${effectiveSessionDate}`),
    type,ticker,effectiveSessionDate,
    source:String(event.source||event.sourceName).trim(),
    evidenceUrl:String(event.evidenceUrl||event.sourceUrl).trim()
  };
  if(type==='SPLIT'){
    const numerator=Number(event?.ratioNumerator),denominator=Number(event?.ratioDenominator);
    if(!(Number.isFinite(numerator)&&numerator>0&&Number.isFinite(denominator)&&denominator>0))throw new Error('CORPORATE_ACTION_SPLIT_RATIO_INVALID');
    return Object.freeze({...base,ratioNumerator:numerator,ratioDenominator:denominator});
  }
  if(type==='CASH_DIVIDEND'){
    const cashPerShareEgp=Number(event?.cashPerShareEgp);
    if(!(Number.isFinite(cashPerShareEgp)&&cashPerShareEgp>=0))throw new Error('CORPORATE_ACTION_DIVIDEND_INVALID');
    return Object.freeze({...base,cashPerShareEgp});
  }
  const newTicker=normalizeTicker(event?.newTicker);
  if(!newTicker||newTicker===ticker)throw new Error('CORPORATE_ACTION_SYMBOL_CHANGE_INVALID');
  return Object.freeze({...base,newTicker});
}
function validateCorporateActionEvents(events,sessionDate){
  const errors=[],temporal=[],normalized=[];
  const session=normalizeSessionDate(sessionDate);
  for(const raw of Array.isArray(events)?events:[]){
    try{
      const event=normalizeCorporateAction(raw);
      normalized.push(event);
      if(session&&event.effectiveSessionDate>session)temporal.push(`${event.ticker}:CORPORATE_ACTION:${event.effectiveSessionDate}`);
    }catch(error){
      errors.push(String(error.message||error));
    }
  }
  return Object.freeze({errors,temporal,events:Object.freeze(normalized)});
}
function splitAdjustmentFactor(event){
  const normalized=normalizeCorporateAction(event);
  if(normalized.type!=='SPLIT')return 1;
  return normalized.ratioDenominator/normalized.ratioNumerator;
}

module.exports=Object.freeze({
  ACTION_TYPES,normalizeSessionDate,evidenceBacked,normalizeCorporateAction,validateCorporateActionEvents,splitAdjustmentFactor
});
