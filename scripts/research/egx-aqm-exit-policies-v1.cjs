'use strict';
// Reusable causal exit rules for EGX AQM. Stop first where intrabar ordering is ambiguous.
// The trailing stop moves after the close and can affect only subsequent sessions.
const STYLES=Object.freeze(['partial','full_target','trailing']);
function act(position,bar,style,maxBars){
 if(!STYLES.includes(style))throw Error('Unknown exit style: '+style);
 if(!bar||!(bar.volume>0)||bar.executable===false)return {sells:[],reason:null};
 if(bar.low<=position.stop)return {sells:[{qty:position.qty,price:Math.min(bar.open,position.stop)}],reason:bar.open<position.stop?'STOP_GAP':'STOP'};
 if(style==='partial'){
  if(position.hitFirst&&bar.high>=position.target2)return {sells:[{qty:position.qty,price:position.target2}],reason:'TARGET2'};
  if(!position.hitFirst&&bar.high>=position.target1){
   const qty=Math.max(1,Math.ceil(position.qty*0.5));
   return {sells:[{qty,price:position.target1}],reason:null,firstTarget:true};
  }
 }else if(style==='full_target'&&bar.high>=position.target2){
  return {sells:[{qty:position.qty,price:position.target2}],reason:'TARGET2'};
 }
 if(position.holdingBars>=maxBars)return {sells:[{qty:position.qty,price:bar.close}],reason:'TIME_EXIT'};
 if(style==='trailing')return {sells:[],reason:null,nextStop:Math.max(position.stop,bar.close-1.5*position.atr)};
 return {sells:[],reason:null};
}
module.exports={STYLES,act};
