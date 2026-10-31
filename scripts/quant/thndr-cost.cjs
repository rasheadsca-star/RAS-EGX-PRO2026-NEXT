'use strict';
// Research simulation only. Verified: two Thndr invoices, 2026-10-21.
// Unverified caps and fill treatment are explicitly excluded for now.
function roundPiasters(x){return Math.round((x+Number.EPSILON)*100)/100;}
function perOrder(value){
  if(!Number.isFinite(value)||value<=0)throw new Error('invalid order value');
  const lines={
    brokerageFlat:2,
    exchange:roundPiasters(value*.0001),
    mcdr:roundPiasters(value*.0001),
    fra:Math.max(1,roundPiasters(value*.00005)),
    riskFund:roundPiasters(value*.00005),
    stamp:roundPiasters(value*.0005),
    brokerageCustody:roundPiasters(value*.001)
  };
  return {lines,total:roundPiasters(Object.values(lines).reduce((a,b)=>a+b,0))};
}
function roundTrip(entryValue,exitValue=entryValue){const buy=perOrder(entryValue),sell=perOrder(exitValue);return {buy,sell,total:roundPiasters(buy.total+sell.total),costPct:(buy.total+sell.total)/entryValue*100};}
module.exports={perOrder,roundTrip};
