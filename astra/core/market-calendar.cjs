'use strict';

function cairoParts(iso){
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',
    weekday:'long',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(new Date(iso));
  const g=t=>parts.find(x=>x.type===t)?.value;
  return{date:`${g('year')}-${g('month')}-${g('day')}`,weekday:g('weekday'),hour:Number(g('hour')),minute:Number(g('minute'))};
}
function utcDate(s){const [y,m,d]=String(s).split('-').map(Number);return new Date(Date.UTC(y,m-1,d))}
function fmt(d){return d.toISOString().slice(0,10)}
function isTrading(s,policy){return policy.market.tradingDayNumbersJs.includes(utcDate(s).getUTCDay())}
function previousTrading(s,policy){
  const d=utcDate(s);
  do{d.setUTCDate(d.getUTCDate()-1)}while(!isTrading(fmt(d),policy));
  return fmt(d);
}
function expectedSession(evaluatedAt,policy){
  const c=cairoParts(evaluatedAt);
  return policy.market.tradingDays.includes(c.weekday)&&c.hour>=Number(policy.market.expectedPostSessionHourCairo||15)
    ? c.date
    : previousTrading(c.date,policy);
}
function tradingLag(from,to,policy){
  if(!from||!to)return null;
  if(from===to)return 0;
  let d=utcDate(from),count=0,guard=0;
  while(fmt(d)!==to&&guard++<1000){
    d.setUTCDate(d.getUTCDate()+1);
    if(isTrading(fmt(d),policy))count++;
  }
  return count;
}
module.exports=Object.freeze({cairoParts,utcDate,fmt,isTrading,previousTrading,expectedSession,tradingLag});
