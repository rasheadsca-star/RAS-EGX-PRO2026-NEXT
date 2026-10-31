'use strict';
// Research-only corporate-action controls: do not mix adjusted bars with raw execution prices.
const fs=require('node:fs'),path=require('node:path');
function loadActions(root=path.resolve(__dirname,'../..')){
 const file=path.join(root,'data/quant/corporate-action-research-2026.json');
 return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')).corporateActions||[]:[];
}
function crossingActions(trades,actions){
 const exposures=[];
 for(const trade of trades||[])for(const a of actions||[]){
  if(trade.ticker===a.ticker&&trade.entryDate<a.effectiveDate&&trade.exitDate>=a.effectiveDate)
   exposures.push({ticker:trade.ticker,entryDate:trade.entryDate,exitDate:trade.exitDate,effectiveDate:a.effectiveDate,type:a.type,shareRatio:a.shareRatio,
    status:'UNRECONCILED_POSITION_AND_PRICE_BASIS',reason:'Realized trade return and price-basis alignment not independently verified'});
 }
 return exposures;
}
function applyShareRatio(position,ratio){
 const units=Number(position.units),price=Number(position.lastPrice);
 if(!(Number.isFinite(units)&&units>=0&&Number.isFinite(price)&&price>0&&Number.isFinite(ratio)&&ratio>0))throw Error('invalid share adjustment');
 return {...position,units:units*ratio,lastPrice:price/ratio};
}
module.exports={loadActions,crossingActions,applyShareRatio};
