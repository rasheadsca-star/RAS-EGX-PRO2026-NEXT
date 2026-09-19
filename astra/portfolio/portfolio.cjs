'use strict';

const {normalizeTicker}=require('../core/symbol-master.cjs');
const {utcDate,fmt}=require('../core/market-calendar.cjs');

const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;

function sessionDate(value){
  const date=String(value||'').slice(0,10);
  if(!DATE_RE.test(date))return null;
  try{return fmt(utcDate(date))===date?date:null}catch{return null}
}
function finitePositive(value,name){
  const n=Number(value);
  if(!(Number.isFinite(n)&&n>0))throw new Error(`${name}_INVALID`);
  return n;
}
function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.freeze(value);
  for(const child of Object.values(value))freeze(child);
  return value;
}
function createPosition(input){
  const ticker=normalizeTicker(input?.ticker);
  const openedSessionDate=sessionDate(input?.openedSessionDate);
  if(!ticker)throw new Error('PORTFOLIO_TICKER_REQUIRED');
  if(!openedSessionDate)throw new Error('PORTFOLIO_OPEN_SESSION_INVALID');
  const quantity=finitePositive(input?.quantity,'PORTFOLIO_QUANTITY');
  const averagePriceEgp=finitePositive(input?.averagePriceEgp,'PORTFOLIO_AVERAGE_PRICE');
  const positionId=String(input?.positionId||`POS:${ticker}:${openedSessionDate}`);
  return freeze({
    schemaVersion:'astra-portfolio-position-1',
    positionId,ticker,securityId:input?.securityId||`EGX:${ticker}`,
    status:'OPEN',openedSessionDate,closedSessionDate:null,
    quantity,averagePriceEgp,
    source:String(input?.source||'MANUAL_OR_CONFIRMED_TRADE'),
    lifecycle:Object.freeze([])
  });
}
function applyPositionEvent(position,event){
  if(!position||position.status!=='OPEN')throw new Error('PORTFOLIO_POSITION_NOT_OPEN');
  const type=String(event?.type||'').toUpperCase();
  const date=sessionDate(event?.sessionDate);
  if(!date||date<position.openedSessionDate)throw new Error('PORTFOLIO_EVENT_SESSION_INVALID');
  if(type==='CLOSE'){
    const closePriceEgp=finitePositive(event?.priceEgp,'PORTFOLIO_CLOSE_PRICE');
    return freeze({...position,status:'CLOSED',closedSessionDate:date,lifecycle:[...position.lifecycle,{type,date,priceEgp:closePriceEgp}]});
  }
  if(type==='ADD'){
    const addQty=finitePositive(event?.quantity,'PORTFOLIO_ADD_QUANTITY');
    const addPrice=finitePositive(event?.priceEgp,'PORTFOLIO_ADD_PRICE');
    const totalQty=position.quantity+addQty;
    const averagePriceEgp=(position.quantity*position.averagePriceEgp+addQty*addPrice)/totalQty;
    return freeze({...position,quantity:totalQty,averagePriceEgp,lifecycle:[...position.lifecycle,{type,date,quantity:addQty,priceEgp:addPrice}]});
  }
  if(type==='REDUCE'){
    const reduceQty=finitePositive(event?.quantity,'PORTFOLIO_REDUCE_QUANTITY');
    if(reduceQty>=position.quantity)throw new Error('PORTFOLIO_REDUCE_EXCEEDS_POSITION');
    return freeze({...position,quantity:position.quantity-reduceQty,lifecycle:[...position.lifecycle,{type,date,quantity:reduceQty}]});
  }
  throw new Error('PORTFOLIO_EVENT_UNSUPPORTED');
}
function positionExposureEgp(position){
  if(!position||position.status!=='OPEN')return 0;
  return Number(position.quantity)*Number(position.averagePriceEgp);
}
function portfolioCapacity({capitalEgp,positions=[]}={}){
  const capital=finitePositive(capitalEgp,'PORTFOLIO_CAPITAL');
  const open=(Array.isArray(positions)?positions:[]).filter(x=>x?.status==='OPEN');
  const existingExposureEgp=open.reduce((sum,p)=>sum+positionExposureEgp(p),0);
  return freeze({
    capitalEgp:capital,
    existingExposureEgp,
    existingExposurePct:capital>0?existingExposureEgp/capital*100:0,
    availableCapitalEgp:Math.max(0,capital-existingExposureEgp),
    openPositionCount:open.length
  });
}

module.exports=Object.freeze({sessionDate,createPosition,applyPositionEvent,positionExposureEgp,portfolioCapacity});
