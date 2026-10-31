'use strict';
// Scenario assumptions, NOT observed execution slippage.
const {roundTrip}=require('./thndr-cost.cjs');
function estimate(orderEgp,advEgp,scenario='medium'){
 if(!(orderEgp>0&&advEgp>0))return {valid:false,reason:'missing_trade_value_or_ADV'};
 const participation=orderEgp/advEgp;
 const levels={low:[0.10,0.15],medium:[0.30,0.35],high:[0.75,0.60]};
 if(!levels[scenario])throw Error('scenario');
 const [base,slope]=levels[scenario];
 const perSidePct=Math.min(5,base+slope*Math.sqrt(participation/.01));
 const fees=roundTrip(orderEgp);
 return {valid:true,scenario,participationPct:+(participation*100).toFixed(3),slippagePerSidePct:+perSidePct.toFixed(4),roundTripFeesEgp:fees.total,roundTripFeesPct:+fees.costPct.toFixed(4),estimatedAllInPct:+(fees.costPct+perSidePct*2).toFixed(4),calibration:'HYPOTHETICAL_NOT_OBSERVED'};
}
module.exports={estimate};
