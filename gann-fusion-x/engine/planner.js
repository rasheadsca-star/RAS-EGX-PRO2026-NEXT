(function(root,factory){
const api=factory();
if(typeof module==='object'&&module.exports)module.exports=api;
else root.GFXPlanner=api;
})(typeof self!=='undefined'?self:this,function(){
'use strict';

const PROFILES={
  speculative:{code:'SPEC',labelAr:'مضاربي 1–3 جلسات',holdingAr:'من جلسة إلى 3 جلسات',defaultRiskPct:.5,maxAllocationPct:10,stopMode:'INTRADAY',entryParts:[60,40],exitParts:[35,35,30]},
  medium:{code:'MED',labelAr:'استثمار متوسط الأجل',holdingAr:'من 2 إلى 8 أسابيع',defaultRiskPct:.65,maxAllocationPct:15,stopMode:'DAILY_CLOSE',entryParts:[40,30,30],exitParts:[25,25,50]},
  long:{code:'LONG',labelAr:'استثمار طويل الأجل',holdingAr:'من 3 إلى 12 شهرًا',defaultRiskPct:.75,maxAllocationPct:20,stopMode:'WEEKLY_CLOSE',entryParts:[30,30,40],exitParts:[20,25,55]}
};
const DECISIONS={
  ACTIONABLE:{code:'ACTIONABLE',ar:'قابل للدخول بشروط الخطة',tone:'positive',order:2},
  WATCH:{code:'WATCH',ar:'مراقبة — لم تكتمل شروط الدخول',tone:'warn',order:1},
  REJECTED:{code:'REJECTED',ar:'مرفوض حاليًا',tone:'danger',order:0}
};
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const clamp=(n,a=0,b=100)=>finite(n)?Math.max(a,Math.min(b,Number(n))):null;
const round=(n,d=2)=>{if(!finite(n))return null;const p=10**d;return Math.round(Number(n)*p)/p};
const result=(eligible,code,reasonAr,missing=[])=>({eligible,code,reasonAr,missing});

function nextEgxSession(date){
  if(!date)return null;
  const d=new Date(String(date)+'T12:00:00Z');
  do{d.setUTCDate(d.getUTCDate()+1)}while([5,6].includes(d.getUTCDay()));
  return d.toISOString().slice(0,10);
}
function normalizedRiskScore(rr){if(!finite(rr))return null;const x=Number(rr);return x>=2.5?100:x>=2?90:x>=1.6?78:x>=1.3?65:x>=1.15?52:30}
function liquidityInfo(a){
  const raw=a.marketMeta?.liquidityPercentile,known=finite(raw),percentile=known?Number(raw):null;
  return{known,percentile,acceptable:known&&percentile>=20};
}
function criticalMeta(a,verifiedFundamentals=false){
  const p=a.parts||{},liq=liquidityInfo(a),missing=[];
  if(a.rankable===false||!finite(a.score)||['WAIT_DATA','DATA_BLOCKED'].includes(a.classification?.code))missing.push('engineRankable');
  if(p.volume?.known!==true||!finite(p.volume?.score))missing.push('volume');
  if(p.relativeStrength?.known!==true||!finite(p.relativeStrength?.score))missing.push('relativeStrength');
  if(p.marketRegime?.known!==true||!finite(p.marketRegime?.score))missing.push('marketRegime');
  if(p.fundamentals?.known!==true||p.fundamentals?.verified!==true||verifiedFundamentals!==true||!finite(p.fundamentals?.score))missing.push('fundamentalsVerified');
  if(!liq.known)missing.push('liquidity');
  if(!finite(a.marketMeta?.riskScore))missing.push('risk');
  if(!finite(a.marketMeta?.moneyFlowQualityScore))missing.push('moneyFlow');
  if(a.plan?.known!==true||!finite(a.plan?.rr))missing.push('riskReward');
  return{complete:missing.length===0,missing,liquidity:liq};
}
function horizonScore(a,horizon,verifiedFundamentals=false){
  const meta=criticalMeta(a,verifiedFundamentals),p=a.parts||{},rr=normalizedRiskScore(a.plan?.rr);
  if(!meta.complete||!finite(rr))return null;
  if(horizon==='speculative')return round(clamp(Number(a.score)*.28+Number(p.gannTime.score)*.16+Number(p.breakout.score)*.18+Number(p.volume.score)*.14+Number(p.momentum.score)*.10+Number(p.relativeStrength.score)*.07+rr*.07),1);
  if(horizon==='medium')return round(clamp(Number(a.score)*.25+Number(p.trend.score)*.20+Number(p.relativeStrength.score)*.13+Number(p.fundamentals.score)*.20+Number(p.marketRegime.score)*.10+rr*.07+Number(p.gannPrice.score)*.05),1);
  return round(clamp(Number(a.score)*.18+Number(p.fundamentals.score)*.31+8+Number(p.trend.score)*.18+Number(p.relativeStrength.score)*.10+Number(p.marketRegime.score)*.10+Number(p.gannPrice.score)*.05),1);
}
function levels(a,horizon){
  const base=a.plan||{};
  if(base.known!==true||!finite(a.close)||!finite(base.entryLow)||!finite(base.entryHigh)||!finite(base.trigger)||!finite(base.stopLoss)||!finite(base.atr14))return{known:false,entryLow:null,entryHigh:null,referenceEntry:null,trigger:null,stopLoss:null,target1:null,target2:null,target3:null,riskPct:null,rr1:null,rr2:null,rr3:null,atr14:null,reason:'RISK_PLAN_UNKNOWN'};
  const entryLow=Number(base.entryLow),entryHigh=Number(base.entryHigh),entry=(entryLow+entryHigh)/2,atr=Math.max(Number(base.atr14),.01);
  let stop=Number(base.stopLoss);
  if(horizon==='medium')stop=Math.min(stop,entry-Math.max(atr*2,entry*.05));
  if(horizon==='long')stop=Math.min(stop,entry-Math.max(atr*3,entry*.08));
  stop=Math.max(.01,stop);
  const r=Math.max(entry-stop,entry*.005);
  let mult=[1.3,2.2,3.1];
  if(horizon==='medium')mult=[1.8,2.8,4];
  if(horizon==='long')mult=[2.2,3.6,5.2];
  const t1=Math.max(finite(base.target1)?Number(base.target1):0,entry+r*mult[0]);
  const t2=Math.max(finite(base.target2)?Number(base.target2):0,t1+r*.5,entry+r*mult[1]);
  const t3=Math.max(t2+r*.6,entry+r*mult[2]);
  return{known:true,entryLow:round(entryLow,4),entryHigh:round(entryHigh,4),referenceEntry:round(entry,4),trigger:round(Number(base.trigger),4),stopLoss:round(stop,4),target1:round(t1,4),target2:round(t2,4),target3:round(t3,4),riskPct:round((entry-stop)/entry*100,2),rr1:round((t1-entry)/r,2),rr2:round((t2-entry)/r,2),rr3:round((t3-entry)/r,2),atr14:round(atr,4)};
}
function triggerDistancePct(a,lv){
  const raw=a.parts?.breakout?.distancePct;
  if(finite(raw))return Math.abs(Number(raw));
  if(!lv?.known||!finite(lv.trigger)||!finite(a.close))return null;
  return Math.abs((Number(a.close)/Number(lv.trigger)-1)*100);
}
function triggerReadinessScore(a,lv){
  const b=a.parts?.breakout||{};
  if(b.known!==true||!finite(b.score))return null;
  if(b.confirmed)return 100;
  const d=triggerDistancePct(a,lv);if(d===null)return null;
  const proximity=clamp(100-d*12),base=clamp(b.score);
  let score=proximity*.6+base*.4;
  if(b.near)score=Math.max(score,85);
  return round(clamp(score),1);
}
function stopEfficiencyScore(riskPct){return finite(riskPct)?round(clamp(140-Number(riskPct)*10),1):null}
function rrExecutionScore(rr){if(!finite(rr))return null;const x=Number(rr);return x>=3?100:x>=2.5?90:x>=2?80:x>=1.6?70:x>=1.3?60:40}
function momentumTemperatureScore(p){
  if(p?.known!==true||!finite(p?.rsi14)||!finite(p?.score))return null;
  const rsi=Number(p.rsi14),raw=clamp(p.score);let temperature=40;
  if(rsi>=50&&rsi<=72)temperature=100;
  else if(rsi>=45&&rsi<50)temperature=85;
  else if(rsi>72&&rsi<=78)temperature=80;
  else if(rsi>78&&rsi<=82)temperature=55;
  else if(rsi>=40&&rsi<45)temperature=70;
  return round((temperature+raw)/2,1);
}
function dataConfidenceScore(a,verifiedFundamentals=false){
  const m=criticalMeta(a,verifiedFundamentals);return m.complete?100:null;
}
function executionQuality(a,horizon,verifiedFundamentals=false,lvInput=null){
  const base=horizonScore(a,horizon,verifiedFundamentals),lv=lvInput||levels(a,horizon);
  if(!finite(base)||lv.known!==true)return{score:null,rankScore:null,tier:'DATA_INCOMPLETE',tierAr:'بيانات غير مكتملة — بلا ترتيب تنفيذ',triggerDistancePct:null,components:{horizonScore:base}};
  if(horizon!=='speculative')return{score:base,rankScore:base,tier:'STRUCTURAL',tierAr:'ترتيب هيكلي',triggerDistancePct:null,components:{horizonScore:base}};
  const p=a.parts||{},distance=triggerDistancePct(a,lv),components={triggerReadiness:triggerReadinessScore(a,lv),volumeConfirmation:p.volume?.known===true?clamp(p.volume.score):null,stopEfficiency:stopEfficiencyScore(lv.riskPct),rewardRisk:rrExecutionScore(lv.rr1),momentumTemperature:momentumTemperatureScore(p.momentum||{}),relativeStrength:p.relativeStrength?.known===true?clamp(p.relativeStrength.score):null,moneyFlowQuality:finite(a.marketMeta?.moneyFlowQualityScore)?clamp(a.marketMeta.moneyFlowQualityScore):null,gannTiming:finite(p.gannTime?.score)?clamp(p.gannTime.score):null,dataConfidence:dataConfidenceScore(a,verifiedFundamentals)};
  if(distance===null||Object.values(components).some(v=>!finite(v)))return{score:null,rankScore:null,tier:'DATA_INCOMPLETE',tierAr:'بيانات غير مكتملة — بلا ترتيب تنفيذ',triggerDistancePct:null,components:{...components,horizonScore:base}};
  const score=round(clamp(components.triggerReadiness*.24+components.volumeConfirmation*.18+components.stopEfficiency*.14+components.rewardRisk*.12+components.momentumTemperature*.08+components.relativeStrength*.08+components.moneyFlowQuality*.06+components.gannTiming*.05+components.dataConfidence*.05),1),rankScore=round(score*.70+base*.30,1);
  let tier='EARLY_SETUP',tierAr='إعداد مبكر — انتظر اقتراب التفعيل';
  if(score>=70&&distance<=2.5&&p.volume?.confirmed){tier='READY_NEAR_TRIGGER';tierAr='جاهزية تنفيذ مرتفعة قرب التفعيل';}
  else if(score>=58&&distance<=4){tier='CONDITIONAL_READY';tierAr='جاهزية مشروطة — لا دخول قبل Trigger';}
  return{score,rankScore,tier,tierAr,triggerDistancePct:round(distance,2),components:{...components,horizonScore:base}};
}
function eligibility(a,horizon,verifiedFundamentals=false){
  const p=a.parts||{},meta=criticalMeta(a,verifiedFundamentals),lv=levels(a,horizon),liq=meta.liquidity;
  if(!meta.complete)return result(false,'DATA_INVALID',`بيانات حرجة غير مكتملة: ${meta.missing.join(', ')}`,meta.missing);
  if(lv.known!==true)return result(false,'DATA_INVALID','خطة المخاطر غير مكتملة.',['riskPlan']);
  if(!liq.acceptable)return result(false,'LOW_LIQUIDITY','السيولة منخفضة بالنسبة للسوق.');
  if(horizon==='speculative'){
    if(p.marketRegime?.regime==='RISK_OFF')return result(false,'MARKET_RISK_OFF','السوق العام دفاعي؛ لا تُفتح مضاربة جديدة ضمن الخطة.');
    if(Number(a.score)<68)return result(false,'FUSION_LT_68','Fusion أقل من الحد المطلوب للمضاربة.');
    if(!(p.breakout?.confirmed||p.breakout?.near||p.gannTime?.active))return result(false,'NO_CATALYST','لا يوجد محفز اختراق أو نافذة Gann واضحة للجلسات القريبة.');
    if(p.momentum?.overheated)return result(false,'OVERHEATED','السهم ساخن سعريًا؛ تجنب المطاردة.');
    if(lv.riskPct>8)return result(false,'RISK_TOO_WIDE','مسافة الوقف واسعة للمضاربة القصيرة.');
    const distance=triggerDistancePct(a,lv);
    if(!p.breakout?.confirmed&&!p.breakout?.near&&distance!==null&&distance>4)return result(false,'TOO_EARLY_FROM_TRIGGER','السعر ما زال بعيدًا أكثر من 4% عن نقطة التفعيل؛ يُراقب ولا يُعامل كفرصة دخول الآن.');
    if(p.breakout?.confirmed)return result(true,'ELIGIBLE','اختراق متحقق ويحتاج استمرار السيولة.');
    if(p.breakout?.near)return result(true,'ELIGIBLE','السعر قريب من نقطة التفعيل؛ الدخول فقط بعد تأكيد الاختراق والسيولة.');
    return result(true,'ELIGIBLE','نافذة Gann نشطة والسعر داخل 4% من نقطة التفعيل؛ لا دخول قبل Trigger وسيولة داعمة.');
  }
  if(horizon==='medium'){
    if(Number(a.score)<64||Number(p.trend.score)<60||Number(p.fundamentals.score)<52)return result(false,'MEDIUM_QUALITY','الاتجاه/الجودة غير كافيين لبناء مركز متوسط.');
    if(lv.riskPct>15)return result(false,'MEDIUM_RISK_TOO_WIDE','الوقف الهيكلي بعيد بصورة غير مناسبة.');
    return result(true,'ELIGIBLE','اتجاه وجودة مقبولان مع بناء مركز تدريجي.');
  }
  if(Number(p.fundamentals.score)<68||Number(p.trend.score)<58)return result(false,'LONG_QUALITY','الجودة الأساسية أو الاتجاه لا يبرران مركزًا طويل الأجل.');
  return result(true,'ELIGIBLE','جودة أساسية موثقة واتجاه مناسب للبناء التدريجي.');
}
function decisionFor(a,horizon,elig,score){
  if(elig.eligible)return{...DECISIONS.ACTIONABLE,reasonCode:elig.code,reasonAr:elig.reasonAr};
  const hard=new Set(['DATA_INVALID','LOW_LIQUIDITY','RISK_TOO_WIDE','MEDIUM_RISK_TOO_WIDE']);
  let d=hard.has(elig.code)?DECISIONS.REJECTED:DECISIONS.WATCH;
  if(elig.code==='FUSION_LT_68'&&finite(a.score)&&Number(a.score)<60)d=DECISIONS.REJECTED;
  if(elig.code==='MEDIUM_QUALITY'&&finite(score)&&Number(score)<58)d=DECISIONS.REJECTED;
  if(elig.code==='LONG_QUALITY'&&finite(score)&&Number(score)<55)d=DECISIONS.REJECTED;
  return{...d,reasonCode:elig.code,reasonAr:elig.reasonAr};
}
function positionSize({portfolioValue=0,riskPct,entry,stop,maxAllocationPct}){
  if(!finite(entry)||!finite(stop)||Number(entry)<=0||Number(stop)<=0||Number(stop)>=Number(entry)||!finite(maxAllocationPct)||Number(maxAllocationPct)<=0)return{riskBudgetPct:finite(riskPct)?round(riskPct,2):null,stopPct:null,allocationPct:0,capital:0,shares:finite(portfolioValue)&&Number(portfolioValue)>0?0:null};
  const pv=Math.max(0,Number(portfolioValue)||0),rp=Math.max(.05,finite(riskPct)?Number(riskPct):.5),e=Number(entry),s=Number(stop),dist=e-s,stopPct=dist/e*100,riskBasedPct=rp/stopPct*100,allocationPct=Math.max(0,Math.min(Number(maxAllocationPct),riskBasedPct)),capital=pv?pv*allocationPct/100:0,shares=pv?Math.floor(capital/e):null,actualCapital=shares==null?null:round(shares*e,2),actualPct=pv&&shares!=null?round(actualCapital/pv*100,2):round(allocationPct,2);
  return{riskBudgetPct:round(rp,2),stopPct:round(stopPct,2),allocationPct:actualPct,capital:actualCapital,shares};
}
function effectiveAllocationCap(a,profile){
  const adjustments=[],liq=liquidityInfo(a),regime=a.parts?.marketRegime?.regime;let factor=1;
  if(!liq.known){return{capPct:0,adjustments:['الحجم التنفيذي صفر لأن تصنيف السيولة النسبي غير متاح.']};}
  if(liq.percentile<40){factor*=.75;adjustments.push('خفض 25% لأن السيولة دون المتوسط.');}
  if(regime==='RISK_OFF'){factor*=.5;adjustments.push('خفض 50% لأن السوق دفاعي.');}
  else if(regime==='SIDEWAYS'){factor*=.75;adjustments.push('خفض 25% لأن السوق عرضي.');}
  else if(regime==='POSITIVE'){factor*=.9;adjustments.push('خفض 10% لأن السوق إيجابي بحذر.');}
  return{capPct:round(profile.maxAllocationPct*factor,2),adjustments};
}
function entryPlan(a,horizon,lv){
  if(lv?.known!==true)return['لا توجد خطة دخول قابلة للتنفيذ قبل اكتمال البيانات الحرجة.'];
  const trigger=lv.trigger;
  if(horizon==='speculative')return[
    `لا دخول تلقائي مع جرس الافتتاح؛ راقب ثبات السعر حول ${trigger}.`,
    `ألغِ المطاردة إذا افتتح السهم أعلى من ${round(lv.entryHigh*1.03,4)} تقريبًا (أكثر من 3% فوق الحد الأعلى للدخول).`,
    `الدخول الأول ${PROFILES.speculative.entryParts[0]}% من الحجم المخطط فقط بعد تفعيل الشرط السعري مع سيولة داعمة.`,
    `أضف ${PROFILES.speculative.entryParts[1]}% فقط إذا حافظ السهم على الاختراق/إعادة الاختبار ولم يكسر نطاق الدخول ${lv.entryLow}–${lv.entryHigh}.`
  ];
  if(horizon==='medium')return[
    `ابدأ ${PROFILES.medium.entryParts[0]}% من الحجم داخل نطاق ${lv.entryLow}–${lv.entryHigh} أو بعد إعادة اختبار ناجحة.`,
    `لا تطارد افتتاحًا أعلى من ${round(lv.entryHigh*1.05,4)} تقريبًا؛ انتظر Pullback يعيد R/R للمستوى المقبول.`,
    `أضف ${PROFILES.medium.entryParts[1]}% بعد جلسة تأكيد اتجاه، ثم ${PROFILES.medium.entryParts[2]}% فقط إذا استمر السهم أعلى الدعم ولم تتدهور السوق.`
  ];
  return[
    `ابنِ المركز على 3 دفعات ${PROFILES.long.entryParts.join('% / ')}% بدل الشراء مرة واحدة.`,
    `لا تبدأ دفعة جديدة بعد فجوة صاعدة كبيرة؛ الأفضل انتظار منطقة قيمة/دعم أو ثبات أسبوعي.`,
    `الدفعة الأولى قرب نطاق القيمة/الدعم، والثانية بعد ثبات أسبوعي، والثالثة بعد تأكيد نمو الاتجاه دون تدهور مالي.`,
    `أي تغير جوهري سلبي في الأساسيات يلغي خطة الإضافة حتى لو ظل السعر صاعدًا.`
  ];
}
function exitPlan(horizon,lv){
  if(lv?.known!==true)return['لا توجد خطة خروج تنفيذية قبل اكتمال بيانات الدخول والمخاطر.'];
  if(horizon==='speculative')return[
    `وقف خسارة كامل عند ${lv.stopLoss}؛ لا توسّع الوقف بعد الدخول.`,
    `عند الهدف 1 (${lv.target1}) خفّض 35% وانقل حماية الباقي قرب سعر الدخول.`,
    `عند الهدف 2 (${lv.target2}) خفّض 35%، واترك 30% للهدف 3 (${lv.target3}) أو Trailing Stop.`,
    `Time Stop: إذا لم يظهر Follow-through خلال 3 جلسات، أعد تقييم الصفقة حتى لو لم يُضرب الوقف.`
  ];
  if(horizon==='medium')return[
    `الوقف الهيكلي ${lv.stopLoss} ويُراقب أساسًا على الإغلاق اليومي.`,
    `الهدف 1 ${lv.target1}: خفّض 25%، الهدف 2 ${lv.target2}: خفّض 25%.`,
    `اترك 50% للهدف 3 ${lv.target3} مع رفع الوقف أسفل قاع/متوسط مناسب مع تقدم الاتجاه.`
  ];
  return[
    `الوقف الاستثماري ${lv.stopLoss} أوسع عمدًا ويُراجع على الإغلاق الأسبوعي مع الأساسيات.`,
    `الهدف 1 ${lv.target1}: خفّض 20% فقط إذا أصبح التقييم/الزخم ممتدًا.`,
    `الهدف 2 ${lv.target2}: خفّض 25%؛ واترك 55% للهدف 3 ${lv.target3} أو استمرار الاتجاه طويل الأجل.`,
    `خروج مبكر إذا حدث كسر جوهري في الربحية/التدفقات/المديونية حتى قبل الوقف السعري.`
  ];
}
function buildPlan(a,horizon,opts={}){
  const profile=PROFILES[horizon],verifiedFundamentals=Boolean(opts.verifiedFundamentals),lv=levels(a,horizon),elig=eligibility(a,horizon,verifiedFundamentals),baseScore=horizonScore(a,horizon,verifiedFundamentals),execution=executionQuality(a,horizon,verifiedFundamentals,lv),score=horizon==='speculative'?execution.rankScore:baseScore,decision=decisionFor(a,horizon,elig,score),riskPct=Number(opts.riskPct??profile.defaultRiskPct),cap=effectiveAllocationCap(a,profile),candidate=positionSize({portfolioValue:opts.portfolioValue,riskPct,entry:lv.referenceEntry,stop:lv.stopLoss,maxAllocationPct:cap.capPct}),size={...candidate};
  size.baseMaxAllocationPct=profile.maxAllocationPct;
  size.plannedAllocationPct=candidate.allocationPct;
  size.effectiveMaxAllocationPct=elig.eligible?cap.capPct:0;
  size.adjustmentsAr=[...cap.adjustments];
  if(!elig.eligible){size.allocationPct=0;size.capital=0;if(size.shares!==null)size.shares=0;size.adjustmentsAr.push('الحجم التنفيذي صفر لأن القرار ليس ACTIONABLE.');}
  let actionAr=decision.ar;
  if(elig.eligible&&horizon==='speculative'){
    if(a.parts?.breakout?.confirmed)actionAr='دخول مشروط بعد ثبات الاختراق';
    else if(a.parts?.breakout?.near)actionAr='قريب من التفعيل — دخول بعد التأكيد';
    else actionAr='انتظار Trigger ثم دخول مشروط';
  }
  if(elig.eligible&&horizon==='medium')actionAr='تجميع تدريجي على تأكيدات';
  if(elig.eligible&&horizon==='long')actionAr='بناء مركز استثماري تدريجي';
  return{ticker:a.ticker,nameAr:a.nameAr,horizon,profile,score,horizonScore:baseScore,executionQuality:execution.score,rankScore:execution.rankScore,executionTier:execution.tier,executionTierAr:execution.tierAr,executionComponents:execution.components,triggerDistancePct:execution.triggerDistancePct,eligible:elig.eligible,reasonAr:elig.reasonAr,reasonCode:elig.code,missingCritical:elig.missing||[],decision,actionAr,sessionDate:a.sessionDate,nextSession:nextEgxSession(a.sessionDate),levels:lv,size,entryPlan:entryPlan(a,horizon,lv),exitPlan:exitPlan(horizon,lv),analysis:a};
}
function buildAll(a,opts={}){return['speculative','medium','long'].map(h=>buildPlan(a,h,opts))}
return{PROFILES,DECISIONS,nextEgxSession,criticalMeta,horizonScore,levels,liquidityInfo,triggerDistancePct,triggerReadinessScore,stopEfficiencyScore,rrExecutionScore,momentumTemperatureScore,dataConfidenceScore,executionQuality,eligibility,decisionFor,positionSize,effectiveAllocationCap,buildPlan,buildAll};
});