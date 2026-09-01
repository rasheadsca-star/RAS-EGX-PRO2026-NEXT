import { sha256 } from './hash.js';
import { verifyResearchPublication } from './research-publication.js';
import { scoreDynamicResearchConfidence } from './research-market-regime.js';

function verifyRegime(regime){if(!regime||regime.authorityMode!=='RESEARCH'||regime.productionAuthority!==false||!/^[a-f0-9]{64}$/.test(String(regime.regimeHash??'')))return false;const {regimeHash,...body}=regime;return sha256(body)===regimeHash}

export function buildResearchDecisionContext({publication,regime}={}){
  if(!verifyResearchPublication(publication))throw new Error('DECISION_CONTEXT_PUBLICATION_INVALID');if(!verifyRegime(regime))throw new Error('DECISION_CONTEXT_REGIME_INVALID');if(publication.signalSession!==regime.session)throw new Error('DECISION_CONTEXT_SESSION_MISMATCH');
  const recommendations=(publication.recommendations??[]).map(plan=>{const confidence=scoreDynamicResearchConfidence(plan,regime);return {ticker:plan.ticker,planHash:plan.planHash,decision:plan.decision,qualityScore:plan.qualityScore,confidenceIndex:confidence.confidenceIndex,confidenceMeaning:confidence.confidenceMeaning,regimeFilterWouldAccept:confidence.acceptedByRegimeGuard,advisoryOnly:true,changesPublishedDecision:false}});
  const body={schemaVersion:'egx-one-research-decision-context-1',authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,automaticOrders:false,signalSession:publication.signalSession,publicationHash:publication.publicationHash,regimeHash:regime.regimeHash,regime:regime.regime,policy:regime.policy,confidenceMeaning:'RESEARCH_RELATIVE_CONFIDENCE_INDEX_NOT_SUCCESS_PROBABILITY',baselineRecommendationSetUnchanged:true,recommendations};return Object.freeze({...body,contextHash:sha256(body)});
}

export function verifyResearchDecisionContext(context,{publication,regime}={}){if(!context||context.productionAuthority!==false||context.baselineRecommendationSetUnchanged!==true||!/^[a-f0-9]{64}$/.test(String(context.contextHash??'')))return false;const {contextHash,...body}=context;if(sha256(body)!==contextHash)return false;if(publication&&context.publicationHash!==publication.publicationHash)return false;if(regime&&context.regimeHash!==regime.regimeHash)return false;return true}
