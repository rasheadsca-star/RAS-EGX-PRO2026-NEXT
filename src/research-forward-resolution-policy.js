import { sha256 } from './hash.js';

function validHash(v){return /^[a-f0-9]{64}$/.test(String(v??''))}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null}
function bodyOf(x){const {policyHash,...body}=x;return body}

export function buildForwardResolutionPolicy(strategy){
  if(strategy?.authorityMode!=='RESEARCH'||strategy?.researchOnly!==true||strategy?.productionAuthority!==false||strategy?.automaticOrders!==false)throw new Error('FORWARD_POLICY_STRATEGY_AUTHORITY_INVALID');
  if(!validHash(strategy?.strategySnapshotHash)||!/^\d{4}-\d{2}-\d{2}$/.test(String(strategy?.signalSession??'')))throw new Error('FORWARD_POLICY_STRATEGY_LINEAGE_INVALID');
  const costBps=finite(strategy?.policy?.costBps);
  if(costBps==null||costBps<0||strategy?.policy?.sameBarAmbiguity!=='STOP_FIRST')throw new Error('FORWARD_POLICY_EXECUTION_RULE_INVALID');
  const recs=Array.isArray(strategy?.recommendations)?strategy.recommendations:[];
  if(!recs.length)throw new Error('FORWARD_POLICY_RECOMMENDATIONS_MISSING');
  for(const r of recs){
    if(r?.executableResearchPlan!==true||r?.costConvention!=='ROUND_TRIP_TOTAL'||Number(r?.costAssumptionBps)!==costBps||!validHash(r?.planHash))throw new Error(`FORWARD_POLICY_PLAN_EXECUTION_MISMATCH:${r?.ticker??'UNKNOWN'}`);
  }
  const body={
    schemaVersion:'egx-one-forward-resolution-policy-1',
    authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,automaticOrders:false,
    signalSession:String(strategy.signalSession),strategySnapshotHash:String(strategy.strategySnapshotHash),strategyId:String(strategy.validation?.selectedPreset??recs[0]?.strategyId??''),
    costAssumptionBps:costBps,costConvention:'ROUND_TRIP_TOTAL',fillConvention:'ENTRY_HIGH_ON_FIRST_ZONE_TOUCH',triggerConvention:'LOW_LE_ENTRY_HIGH_AND_HIGH_GE_ENTRY_LOW',sameBarAmbiguity:'STOP_FIRST',targetPriorityAfterStop:'TARGET2_THEN_TARGET1',timeoutExit:'FINAL_HORIZON_SESSION_CLOSE',untriggeredTreatment:'EXCLUDED_FROM_TARGET_FAILURE_KPI',sourcePlanHashes:recs.map(r=>String(r.planHash)).sort()
  };
  return Object.freeze({...body,policyHash:sha256(body)});
}

export function verifyForwardResolutionPolicy(policy){
  if(!policy||policy.schemaVersion!=='egx-one-forward-resolution-policy-1'||policy.authorityMode!=='RESEARCH'||policy.researchOnly!==true||policy.productionAuthority!==false||policy.automaticOrders!==false||!validHash(policy.strategySnapshotHash)||!validHash(policy.policyHash)||!/^\d{4}-\d{2}-\d{2}$/.test(String(policy.signalSession??''))||!Array.isArray(policy.sourcePlanHashes)||policy.sourcePlanHashes.some(x=>!validHash(x)))return false;
  if(policy.costConvention!=='ROUND_TRIP_TOTAL'||policy.fillConvention!=='ENTRY_HIGH_ON_FIRST_ZONE_TOUCH'||policy.triggerConvention!=='LOW_LE_ENTRY_HIGH_AND_HIGH_GE_ENTRY_LOW'||policy.sameBarAmbiguity!=='STOP_FIRST'||policy.targetPriorityAfterStop!=='TARGET2_THEN_TARGET1'||policy.timeoutExit!=='FINAL_HORIZON_SESSION_CLOSE'||policy.untriggeredTreatment!=='EXCLUDED_FROM_TARGET_FAILURE_KPI'||!(Number(policy.costAssumptionBps)>=0))return false;
  return sha256(bodyOf(policy))===policy.policyHash;
}
