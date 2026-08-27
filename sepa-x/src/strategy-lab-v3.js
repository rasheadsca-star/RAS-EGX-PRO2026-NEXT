const finite=v=>Number.isFinite(Number(v));
const round=(v,d=3)=>finite(v)?Number(Number(v).toFixed(d)):null;

export const FULL_STRUCTURE_V3_DEFINITION=Object.freeze({
  id:'FULL_STRUCTURE_V3',
  researchOnly:true,
  promotionAllowed:false,
  automaticEligibilityImpact:'NONE',
  discoveredAfterHistoricalHoldoutReview:true,
  independentForwardValidationRequired:true,
  thresholds:Object.freeze({
    minBreakoutVolumeRatio:1.40,
    maxRetestVolumeVsBreakout:0.75,
    maxRetestDepthAtr:0.45,
    minReclaimVolumeRatio:0.95,
    minResistanceTouches:3,
    minRiskPct:3,
    maxRiskPct:7,
  }),
});

export function fullStructureV3Shadow(retestV2){
  const raw=retestV2?.raw??{},t=FULL_STRUCTURE_V3_DEFINITION.thresholds;
  const breakoutVolume=Number(raw.breakout?.volumeRatio),retestVolume=Number(raw.retest?.volumeVsBreakout),retestDepth=Number(raw.retest?.depthAtr),reclaimVolume=Number(raw.reclaim?.volumeRatio),touches=Number(raw.touches),riskPct=Number(raw.plan?.riskPct);
  const checks={
    retestReclaimV2Confirmed:Boolean(retestV2?.pass),
    breakoutVolume:finite(breakoutVolume)&&breakoutVolume>=t.minBreakoutVolumeRatio,
    dryRetest:finite(retestVolume)&&retestVolume<=t.maxRetestVolumeVsBreakout,
    shallowRetest:finite(retestDepth)&&retestDepth<=t.maxRetestDepthAtr,
    reclaimVolume:finite(reclaimVolume)&&reclaimVolume>=t.minReclaimVolumeRatio,
    resistanceTouches:finite(touches)&&touches>=t.minResistanceTouches,
    riskBand:finite(riskPct)&&riskPct>=t.minRiskPct&&riskPct<=t.maxRiskPct,
  };
  const pass=Object.values(checks).every(Boolean),passed=Object.values(checks).filter(Boolean).length,total=Object.keys(checks).length;
  return {
    pass,
    score:round(passed/total*100,1),
    reasonCodes:Object.entries(checks).filter(([,ok])=>!ok).map(([k])=>`V3_${k.toUpperCase()}_FAIL`),
    raw:{
      version:'FULL_STRUCTURE_V3_SHADOW',
      researchOnly:true,
      promotionAllowed:false,
      automaticEligibilityImpact:'NONE',
      evidenceStatus:'EXPLORATORY_HOLDOUT_DISCOVERED_REQUIRES_FORWARD_OOS',
      independentForwardValidationRequired:true,
      definition:FULL_STRUCTURE_V3_DEFINITION,
      checks,
      mechanics:{breakoutVolumeRatio:round(breakoutVolume,2),retestVolumeVsBreakout:round(retestVolume,2),retestDepthAtr:round(retestDepth,2),reclaimVolumeRatio:round(reclaimVolume,2),touches:finite(touches)?touches:null,riskPct:round(riskPct,2)},
      sourceSignal:{breakoutDate:raw.breakout?.date??null,retestDate:raw.retest?.date??null,reclaimDate:raw.reclaim?.date??null},
      plan:raw.plan??null,
    },
  };
}
