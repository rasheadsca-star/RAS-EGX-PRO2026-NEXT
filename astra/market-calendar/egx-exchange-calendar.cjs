'use strict';
const {sessionWindow,validateWindow}=require('./trading-session-window.cjs');
const doc=require('../../data/egx-exchange-closures.json');
const iso=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
function classify(date,closures=doc){
 if(!iso(date))throw Error('INVALID_DATE');
 const day=new Date(date+'T00:00:00Z').getUTCDay();
 if([5,6].includes(day))return{status:'CLOSED',reason:'WEEKEND',verified:true};
 const event=(closures.closures||[]).find(x=>x.date===date&&x.status==='confirmed_exchange_closure');
 if(event)return{status:'CLOSED',reason:'EXCHANGE_CONFIRMED_HOLIDAY',verified:true,source:event.source};
 return{status:'UNCONFIRMED_OPEN',reason:'NO_VERIFIED_CLOSURE_NOT_PROOF_OF_TRADING',verified:false};
}
function validateMarketWindow(calendar,end,count,observations,closures=doc){
 if(!Array.isArray(calendar))throw Error('INVALID_CALENDAR');
 const unexpected=calendar.filter(d=>classify(d,closures).status==='CLOSED');
 if(unexpected.length)return{ready:false,reason:'CALENDAR_INCLUDES_CLOSED_DATE',dates:unexpected,sessions:[]};
 return validateWindow(calendar,end,count,observations);
}
module.exports={classify,validateMarketWindow,sessionWindow};
