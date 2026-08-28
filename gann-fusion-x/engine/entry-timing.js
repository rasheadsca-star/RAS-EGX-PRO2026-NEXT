(function(root,factory){
const api=factory();
if(typeof module==='object'&&module.exports)module.exports=api;
else{
  root.GFXEntryTiming=api;
  if(root.GFXPlanner)api.install(root.GFXPlanner);
}
})(typeof self!=='undefined'?self:this,function(){
'use strict';

const round=(n,d=4)=>{const x=Number(n);if(!Number.isFinite(x))return null;const p=10**d;return Math.round(x*p)/p};
const num=(v,fallback=null)=>{const n=Number(v);return Number.isFinite(n)?n:fallback};
const pct=(a,b)=>a!=null&&b?((a/b)-1)*100:null;

function pullbackZone(levels){
  const trigger=num(levels?.trigger),entryLow=num(levels?.entryLow),entryHigh=num(levels?.entryHigh);
  if(!(trigger>0))return{low:round(entryLow),high:round(entryHigh)};
  let low=Math.max(entryLow||trigger*.985,trigger*.985),high=Math.min(entryHigh||trigger*1.01,trigger*1.01);
  if(!(low>0&&high>0)||low>high){low=entryLow||trigger*.985;high=entryHigh||trigger*1.01;}
  return{low:round(low),high:round(high)};
}

function classify(plan){
  if(!plan||plan.horizon!=='speculative')return{grade:null,mode:'NOT_SPECULATIVE',headlineAr:'غير مطبق',instructionAr:'تصنيف توقيت A/B/C مخصص للمضاربة القصيرة.',invalidationPrice:null};
  if(!plan.eligible||plan.decision?.code!=='ACTIONABLE')return{grade:null,mode:'NOT_ACTIONABLE',headlineAr:'غير قابل للدخول حاليًا',instructionAr:'يُتبع قرار الـFunnel أولًا قبل تقييم توقيت الدخول.',invalidationPrice:round(plan.levels?.stopLoss)};

  const a=plan.analysis||{},parts=a.parts||{},b=parts.breakout||{},v=parts.volume||{},m=parts.momentum||{},lv=plan.levels||{};
  const close=num(a.close,num(lv.referenceEntry)),trigger=num(lv.trigger),entryLow=num(lv.entryLow),entryHigh=num(lv.entryHigh),stop=num(lv.stopLoss),atr=Math.max(num(lv.atr14,0)||0,0);
  const rsi=num(m.rsi14),signedTriggerPct=pct(close,trigger),volumeConfirmed=Boolean(v.confirmed),breakoutConfirmed=Boolean(b.confirmed);
  const extended=Boolean(
    (entryHigh>0&&close>entryHigh*1.005)||
    (signedTriggerPct!==null&&signedTriggerPct>2.5)||
    (rsi!==null&&rsi>78)
  );
  const zone=pullbackZone(lv);
  const invalidationPrice=round(stop);
  const cancellationAr=stop>0?`إلغاء الخطة إذا كسر السعر ${round(stop)}.`:'إلغاء الخطة عند كسر مستوى الوقف المحدد.';

  if(extended){
    return{
      grade:'C',mode:'WAIT_PULLBACK',headlineAr:'C — انتظار Pullback',shortAr:`لا تطارد؛ انتظر إعادة اختبار ${zone.low}–${zone.high}`,
      instructionAr:`السعر ممتد بالنسبة لنقطة التفعيل أو الزخم مرتفع؛ لا دخول بالمطاردة. انتظر Pullback/إعادة اختبار داخل ${zone.low}–${zone.high} مع بقاء الهيكل صالحًا.`,
      activationPrice:trigger>0?round(trigger):null,pullbackZone:zone,invalidationPrice,cancellationAr,
      currentPrice:round(close),triggerDistancePct:signedTriggerPct===null?null:round(signedTriggerPct,2),volumeConfirmed,breakoutConfirmed,rsi14:rsi===null?null:round(rsi,1),extended:true
    };
  }

  const insideEntry=entryLow>0&&entryHigh>0&&close>=entryLow*.995&&close<=entryHigh*1.005;
  const atOrAboveTrigger=trigger>0&&close>=trigger*.995;
  if(breakoutConfirmed&&volumeConfirmed&&insideEntry&&atOrAboveTrigger){
    return{
      grade:'A',mode:'ENTER_ON_CONFIRMATION',headlineAr:'A — دخول مشروط الآن',shortAr:`تنفيذ فقط مع استمرار الثبات فوق ${round(trigger)}`,
      instructionAr:`التوقيت مناسب للتنفيذ المشروط إذا استمر السعر فوق Trigger ${round(trigger)} وبقيت السيولة داعمة؛ التنفيذ يكون داخل نطاق ${round(entryLow)}–${round(entryHigh)} دون مطاردة.`,
      activationPrice:trigger>0?round(trigger):null,pullbackZone:null,invalidationPrice,cancellationAr,
      currentPrice:round(close),triggerDistancePct:signedTriggerPct===null?null:round(signedTriggerPct,2),volumeConfirmed,breakoutConfirmed,rsi14:rsi===null?null:round(rsi,1),extended:false
    };
  }

  const confirmationText=breakoutConfirmed&&!volumeConfirmed?'الاختراق موجود لكن تأكيد السيولة غير مكتمل':`الاختراق لم يثبت بعد فوق ${round(trigger)}`;
  return{
    grade:'B',mode:'WAIT_TRIGGER',headlineAr:'B — انتظار Trigger',shortAr:`انتظر ثباتًا فوق ${round(trigger)} مع سيولة داعمة`,
    instructionAr:`${confirmationText}؛ لا دخول قبل ثبات السعر فوق Trigger ${round(trigger)} مع تحسن/استمرار السيولة، ثم التنفيذ داخل نطاق الدخول دون مطاردة.`,
    activationPrice:trigger>0?round(trigger):null,pullbackZone:null,invalidationPrice,cancellationAr,
    currentPrice:round(close),triggerDistancePct:signedTriggerPct===null?null:round(signedTriggerPct,2),volumeConfirmed,breakoutConfirmed,rsi14:rsi===null?null:round(rsi,1),extended:false,atr14:round(atr)
  };
}

function decorate(plan){
  const timing=classify(plan),out={...plan,entryTiming:timing};
  if(timing.grade&&plan?.horizon==='speculative'&&plan?.eligible){
    out.actionAr=`${timing.headlineAr} · ${timing.shortAr}`;
    out.entryPlan=[`توقيت ${timing.grade}: ${timing.instructionAr}`,timing.cancellationAr,...(Array.isArray(plan.entryPlan)?plan.entryPlan:[])];
  }
  return out;
}

function install(planner){
  if(!planner||planner.__entryTimingInstalled)return planner;
  if(typeof planner.buildPlan!=='function')throw new Error('GFXPlanner.buildPlan is required');
  const originalBuildPlan=planner.buildPlan.bind(planner);
  planner.buildPlan=function(a,horizon,opts){return decorate(originalBuildPlan(a,horizon,opts));};
  planner.buildAll=function(a,opts={}){return['speculative','medium','long'].map(h=>planner.buildPlan(a,h,opts));};
  planner.entryTimingGrade=classify;
  planner.__entryTimingInstalled=true;
  return planner;
}

return{classify,decorate,install,pullbackZone};
});
