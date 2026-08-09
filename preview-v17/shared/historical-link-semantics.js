(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.V17HistoricalSemantics=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
  const round=(value,digits=2)=>finite(value)?Number(Number(value).toFixed(digits)):null;
  const peakToTroughDecline=historical=>finite(historical?.high)&&finite(historical?.postPeakLow)&&Number(historical.high)>0?round((1-Number(historical.postPeakLow)/Number(historical.high))*100,2):null;
  function quality(integrated,scanner){
    const q=integrated?.historicalDataQuality||{},scannerReview=scanner?.stage==='DATA_REVIEW_REQUIRED'||scanner?.recoveryStage===null;
    const corporateReview=q.corporateActionConfidence==='REVIEW_REQUIRED'||(q.reasons||[]).some(x=>String(x).includes('CORPORATE_ACTION'))||(scanner?.reasons||[]).some(x=>String(x).includes('corporate_action'));
    if(corporateReview)return{state:'CORPORATE_ACTION_REVIEW',labelAr:'إجراءات شركات: مراجعة مطلوبة',tone:'danger',acceptable:false};
    if((q.status&&q.status!=='VALID')||scannerReview)return{state:'DATA_REVIEW',labelAr:'جودة البيانات التاريخية: تحت المراجعة',tone:'danger',acceptable:false};
    if(finite(q.confidence)&&Number(q.confidence)<70)return{state:'LIMITED_CONFIDENCE',labelAr:'ثقة المصدر: محدودة',tone:'warning',acceptable:false};
    return{state:'ACCEPTABLE',labelAr:'جودة البيانات التاريخية: مقبولة',tone:'neutral',acceptable:true};
  }
  function classify({integrated=null,scanner=null,bridgeBadge=null}={}){
    const available=Boolean(integrated||scanner),q=quality(integrated,scanner),h=integrated?.historical,stage=integrated?.technical?.recoveryStage||scanner?.recoveryStage||null,decline=peakToTroughDecline(h),currentDrawdown=round(h?.currentDrawdownPct,2),position=round(h?.recoveryPositionPct,2);
    const distinctEvents=Boolean(h?.highDate&&h?.postPeakLowDate&&String(h.postPeakLowDate)>String(h.highDate)&&round(h.high,4)!==round(h.postPeakLow,4));
    const recoveryStage=['BOTTOMING','EARLY_RECOVERY','RECOVERY_CONFIRMED'].includes(stage);
    const meaningful=q.acceptable&&Boolean(h?.available)&&distinctEvents&&finite(decline)&&decline>0&&finite(currentDrawdown)&&currentDrawdown>0&&finite(position)&&position<100&&recoveryStage;
    let state='NO_HISTORICAL_DATA',labelAr='لا توجد بيانات تاريخية صالحة حاليًا',cycleLabelAr='مطابقة دورة القاع والتعافي: لا';
    if(available&&!q.acceptable){state='RECOVERY_CYCLE_REVIEW';labelAr='بيانات تاريخية متاحة — تحت المراجعة';cycleLabelAr='دورة التعافي: تحت المراجعة';}
    else if(meaningful){state='MEANINGFUL_RECOVERY_CYCLE';labelAr='مطابقة دورة تعافٍ بعد قمة';cycleLabelAr='مطابقة دورة القاع والتعافي: نعم';}
    else if(available){state='HISTORICAL_DATA_AVAILABLE';labelAr='بيانات تاريخية متاحة فقط';cycleLabelAr='مطابقة دورة القاع والتعافي: لا';}
    return{state,labelAr,cycleLabelAr,dataAvailable:available,meaningfulRecoveryCycle:meaningful,reviewRequired:available&&!q.acceptable,investmentBridgeEligible:bridgeBadge?.conversionAllowed===true,quality:q,peakToTroughDeclinePct:decline,currentDrawdownPct:currentDrawdown,recoveryPositionPct:position,stage,semanticReasons:{distinctPeakAndLaterTrough:distinctEvents,existingRecoveryStage:recoveryStage,nonZeroPeakToTrough:finite(decline)&&decline>0,stillBelowPeak:finite(currentDrawdown)&&currentDrawdown>0,notFullyRecovered:finite(position)&&position<100}};
  }
  return{classify,quality,peakToTroughDecline};
});
