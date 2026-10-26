(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.GFXBacktest=api;
})(typeof self!=='undefined'?self:this,function(){
'use strict';
function evaluate(signals,barsByTicker,opts={}){
  const costPct=Number(opts.costPct??0.6),holding=Math.max(1,Number(opts.holdingSessions??5)),rows=[],skipped=[];
  for(const s of signals||[]){
    const bars=barsByTicker?.[s.ticker]||[];
    const idx=bars.findIndex(b=>b.date===s.sessionDate);
    if(idx<0||!bars[idx+1]){skipped.push({ticker:s.ticker,reason:'MISSING_POST_SIGNAL_BARS'});continue;}
    const low=Number(s.plan?.entryLow??s.plan?.entryHigh);
    const high=Number(s.plan?.entryHigh??s.plan?.entryLow);
    const stop=Number(s.plan?.stopLoss||0),target=Number(s.plan?.target1||0);
    if(!Number.isFinite(low)||!Number.isFinite(high)||low<=0||high<low){
      skipped.push({ticker:s.ticker,reason:'INVALID_ENTRY_PLAN'});continue;
    }
    let activation=-1,entry=null;
    const end=Math.min(idx+holding,bars.length-1);
    for(let j=idx+1;j<=end;j++){
      const b=bars[j],open=Number(b.open),barLow=Number(b.low),barHigh=Number(b.high);
      if(![open,barLow,barHigh].every(Number.isFinite)||barLow<=0||barHigh<barLow){
        skipped.push({ticker:s.ticker,reason:'INVALID_POST_SIGNAL_CANDLE'});activation=-2;break;
      }
      if(barHigh<low||barLow>high)continue;
      activation=j;
      if(open>=low&&open<=high)entry=open;
      break;
    }
    if(activation===-2)continue;
    if(activation<0){skipped.push({ticker:s.ticker,reason:'ENTRY_NOT_TRIGGERED'});continue;}
    if(entry===null){skipped.push({ticker:s.ticker,reason:'ENTRY_TOUCHED_PRICE_UNKNOWN'});continue;}
    let outcome='TIME_EXIT',exit=Number(bars[end].close),exitDate=bars[end].date,ambiguous=false;
    for(let j=activation;j<=end;j++){
      const b=bars[j],hitStop=stop>0&&Number(b.low)<=stop,hitTarget=target>0&&Number(b.high)>=target;
      if(hitStop&&hitTarget){outcome='AMBIGUOUS_STOP_FIRST';exit=stop;exitDate=b.date;ambiguous=true;break;}
      if(hitStop){outcome='STOP';exit=stop;exitDate=b.date;break;}
      if(hitTarget){outcome='TARGET';exit=target;exitDate=b.date;break;}
    }
    if(!Number.isFinite(exit)||exit<=0){skipped.push({ticker:s.ticker,reason:'INVALID_EXIT_PRICE'});continue;}
    const gross=(exit/entry-1)*100,net=gross-costPct;
    rows.push({ticker:s.ticker,signalDate:s.sessionDate,activationDate:bars[activation].date,exitDate,
      outcome,ambiguous,entry,exit,grossPct:Number(gross.toFixed(2)),netPct:Number(net.toFixed(2))});
  }
  const resolved=rows.filter(r=>!r.ambiguous),wins=resolved.filter(r=>r.netPct>0),losses=resolved.filter(r=>r.netPct<=0);
  const gp=wins.reduce((a,b)=>a+b.netPct,0),gl=Math.abs(losses.reduce((a,b)=>a+b.netPct,0));
  return {signals:rows.length,evaluable:resolved.length,ambiguous:rows.length-resolved.length,
    skipped:skipped.length,skippedReasons:skipped,wins:wins.length,losses:losses.length,
    winRatePct:resolved.length?Number((wins.length/resolved.length*100).toFixed(1)):null,
    averageNetPct:resolved.length?Number((resolved.reduce((a,b)=>a+b.netPct,0)/resolved.length).toFixed(2)):null,
    profitFactor:gl?Number((gp/gl).toFixed(2)):gp>0?null:null,
    costPct,holdingSessions:holding,rows};
}
return{evaluate};
});