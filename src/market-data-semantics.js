function finiteNumber(v){
  if(v===null||v===undefined||v==='') return null;
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}

export function validateOhlcvGeometry(bar){
  const open=finiteNumber(bar?.open),high=finiteNumber(bar?.high),low=finiteNumber(bar?.low),close=finiteNumber(bar?.close),volume=finiteNumber(bar?.volume);
  const reasons=[];
  if([open,high,low,close,volume].some(v=>v===null)) reasons.push('MISSING_OR_NONFINITE_OHLCV');
  if(reasons.length===0){
    if(high<low) reasons.push('HIGH_BELOW_LOW');
    if(open>high||open<low) reasons.push('OPEN_OUTSIDE_HIGH_LOW');
    if(close>high||close<low) reasons.push('CLOSE_OUTSIDE_HIGH_LOW');
    if(volume<0) reasons.push('NEGATIVE_VOLUME');
  }
  return Object.freeze({
    state:reasons.length?'INVALID_OHLCV_GEOMETRY':'VALID_OHLCV_GEOMETRY',
    valid:reasons.length===0,
    reasons:Object.freeze(reasons),
    normalized:Object.freeze({open,high,low,close,volume})
  });
}

export function assessProviderOhlcvSemantics({
  provider,
  samples=[],
  declaredFields=false,
  fieldSemanticsVerified=false,
  syntheticFieldEvidence=false,
  sourceRole='RESEARCH'
}={}){
  const evaluated=(Array.isArray(samples)?samples:[]).map(sample=>Object.freeze({
    id:String(sample?.id??sample?.session??''),
    ...validateOhlcvGeometry(sample?.bar??sample)
  }));
  const contradictions=evaluated.filter(x=>!x.valid);
  let state='INSUFFICIENT_SEMANTIC_EVIDENCE';
  if(syntheticFieldEvidence) state='SYNTHETIC_OHLC_FIELDS_REJECTED';
  else if(contradictions.length) state='OHLCV_SEMANTICS_CONTRADICTED';
  else if(declaredFields&&fieldSemanticsVerified&&evaluated.length) state='TRUE_OHLCV_RESEARCH_ELIGIBLE';
  const trueOhlcvEligible=state==='TRUE_OHLCV_RESEARCH_ELIGIBLE';
  return Object.freeze({
    provider:String(provider??'UNKNOWN'),
    sourceRole,
    declaredFields:Boolean(declaredFields),
    fieldSemanticsVerified:Boolean(fieldSemanticsVerified),
    syntheticFieldEvidence:Boolean(syntheticFieldEvidence),
    sampleCount:evaluated.length,
    contradictionCount:contradictions.length,
    state,
    trueOhlcvEligible,
    productionAuthority:false,
    evaluated:Object.freeze(evaluated)
  });
}

export function classifyMarketDataFieldRole({provider,semanticAssessment}={}){
  const p=String(provider??'UNKNOWN').toUpperCase();
  if(semanticAssessment?.trueOhlcvEligible) return Object.freeze({provider:p,role:'RESEARCH_TRUE_OHLCV_CANDIDATE',productionAuthority:false});
  return Object.freeze({provider:p,role:'CLOSE_VOLUME_OR_IDENTITY_CROSSCHECK_ONLY',productionAuthority:false});
}
