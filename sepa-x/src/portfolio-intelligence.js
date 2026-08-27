const finite=v=>Number.isFinite(Number(v));
const round=(v,d=2)=>finite(v)?Number(Number(v).toFixed(d)):null;

export function normalizeRc2Analysis(payload){
  const x=payload?.result??payload??null;
  if(!x||typeof x!=='object')return null;
  const p=x.tradePlan??null,h=x.historicalConfidence??null;
  return {
    engine:x.engine??'TFE_V20_FUSION_RC2',
    ticker:x.ticker??null,
    sessionDate:x.sessionDate??null,
    price:finite(x.price)?Number(x.price):null,
    decision:x.decision??'NO_RECOMMENDATION',
    eligible:Boolean(x.eligible),
    technicalEligible:x.technicalEligible==null?Boolean(x.eligible):Boolean(x.technicalEligible),
    publicationEligible:x.publicationEligible==null?Boolean(x.eligible):Boolean(x.publicationEligible),
    publicationState:x.publicationState??null,
    researchOnly:x.researchOnly!==false,
    qualityState:x.quality?.state??null,
    scores:{
      core:finite(x.scores?.core)?Number(x.scores.core):null,
      research:finite(x.scores?.research)?Number(x.scores.research):null,
      fusionRank:finite(x.scores?.fusionRank)?Number(x.scores.fusionRank):null,
      liquidity:finite(x.scores?.liquidity)?Number(x.scores.liquidity):null,
      supportResistance:finite(x.scores?.supportResistance)?Number(x.scores.supportResistance):null,
    },
    historicalConfidence:h?{
      entered:finite(h.entered)?Number(h.entered):finite(h.trades)?Number(h.trades):null,
      target1Pct:finite(h.target1Pct)?Number(h.target1Pct):null,
      wilson95LowerPct:finite(h.confidenceWilsonLower95Pct)?Number(h.confidenceWilsonLower95Pct):finite(h.wilson95LowerPct)?Number(h.wilson95LowerPct):null,
      sampleReliability:finite(h.sampleReliability)?Number(h.sampleReliability):null,
    }:null,
    tradePlan:p?{
      entryLow:finite(p.entryLow)?Number(p.entryLow):null,
      entryHigh:finite(p.entryHigh)?Number(p.entryHigh):null,
      stop:finite(p.stop)?Number(p.stop):null,
      target1:finite(p.target1)?Number(p.target1):null,
      target2:finite(p.target2)?Number(p.target2):null,
      structuralNetRR:finite(p.structuralNetRR)?Number(p.structuralNetRR):null,
      precisionNetRR:finite(p.precisionNetRR)?Number(p.precisionNetRR):null,
      alignmentState:p.alignmentState??null,
      distanceAtr:finite(p.distanceAtr)?Number(p.distanceAtr):null,
      entryExpirySessions:finite(p.entryExpirySessions)?Number(p.entryExpirySessions):null,
      maxHoldSessions:finite(p.maxHoldSessions)?Number(p.maxHoldSessions):null,
    }:null,
    reasonCodes:Array.isArray(x.reasonCodes)?x.reasonCodes:[],
    permissions:x.permissions??{executionAllowed:false,automaticOrders:false},
  };
}

export function portfolioReadout({core=null,rc2=null,forwardSignal=null}={}){
  const v3=core?.strategy_lab?.full_structure_v3??null;
  const price=finite(core?.last_price)?Number(core.last_price):finite(rc2?.price)?Number(rc2.price):null;
  const coreStop=finite(core?.stop_loss)?Number(core.stop_loss):null;
  const belowCoreStop=finite(price)&&finite(coreStop)&&price<=coreStop;
  const coreBad=['FAILED BREAKOUT','AVOID'].includes(String(core?.status??'').toUpperCase());
  const trendPass=core?.trend_template?.passed===true;
  const rc2Ready=Boolean(rc2?.publicationEligible&&rc2?.tradePlan&&!['DO_NOT_CHASE','BELOW_ENTRY_WAIT'].includes(rc2.tradePlan.alignmentState));
  const v3Pass=Boolean(v3?.pass);
  let state='REVIEW',labelAr='مراجعة';
  if(coreBad||belowCoreStop){state='RISK_REVIEW';labelAr='مراجعة مخاطر';}
  else if(trendPass&&rc2Ready&&v3Pass){state='THREE_WAY_CONFLUENCE';labelAr='توافق قوي: Core + RC2 + V3';}
  else if(trendPass&&rc2Ready){state='CORE_RC2_CONFLUENCE';labelAr='توافق Core + RC2';}
  else if(trendPass&&v3Pass){state='CORE_V3_SHADOW';labelAr='Core إيجابي + V3 Shadow';}
  else if(trendPass){state='CORE_MONITOR';labelAr='متابعة Core';}
  else if(rc2Ready){state='RC2_MONITOR';labelAr='متابعة RC2';}
  return {
    state,labelAr,
    researchOnly:true,
    automaticOrders:false,
    rc2ReadOnlyReference:true,
    v3ShadowOnly:true,
    currentPrice:round(price,4),
    coreStop:round(coreStop,4),
    checks:{trendPass,rc2Ready,v3Pass,belowCoreStop,coreBad},
    forwardState:forwardSignal?.state??null,
  };
}
