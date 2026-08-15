#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.');
const P=rel=>path.join(root,rel);
const read=rel=>JSON.parse(fs.readFileSync(P(rel),'utf8'));
const write=(rel,value)=>{const file=P(rel);fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.tmp`;fs.writeFileSync(tmp,`${JSON.stringify(value,null,2)}\n`,'utf8');JSON.parse(fs.readFileSync(tmp,'utf8'));fs.renameSync(tmp,file);};
const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};

const contract=read('data/v20/final-decision-contract.json');
const core=read('data/v20/v17-production-decision-core.json');
const native=read('data/v20/native-current.json');
const semantic=read('data/v20/v17-centric-semantic-acceptance.json');
const navReg=read('data/v20/funded-nav-regression.json');
const forwardReg=read('data/v20/signal-archive/native-shadow/regression.json');
const perfReg=read('data/v20/performance-evidence-regression.json');
const govReg=read('data/v20/champion-challenger-regression.json');
const registry=read('data/v20/champion-challenger-registry.json');
const browser=read('data/v20/decision-board-browser-certification.json');
const sync=read('data/v20/v17-runtime-sync.json');

assert(contract.schemaVersion==='20.0.0-canonical-stock-decision-contract-1','Unexpected canonical contract schema');
assert(contract.architecture==='V17_CENTRIC_V20_NATIVE_DISCOVERY','Canonical architecture drift');
assert(contract.policy?.v20Discovers===true&&contract.policy?.v17ValidatesAndAuthorizes===true&&contract.policy?.v20NativeCannotOverrideV17===true,'V17-centric policy drift');
assert(contract.policy?.legacyNativeScoringContributionPct===0,'Legacy scoring contribution drift');
assert(core.policy?.v17IsAuthoritativeForProductionEligibility===true,'V17 authority missing');
assert(native.executionPermission===false,'Native gained execution permission');
assert(native.legacyScoringContributionPct===0,'Native legacy scoring contribution is nonzero');
assert(semantic.ok===true,'Semantic acceptance failed');
assert(navReg.ok===true,'Funded NAV regression failed');
assert(forwardReg.ok===true,'Native forward regression failed');
assert(perfReg.ok===true,'Performance evidence regression failed');
assert(govReg.ok===true,'Champion/challenger regression failed');
assert(browser.ok===true&&browser.failedCount===0,'Decision Board browser certification failed');
assert(browser.schemaVersion==='20.0.0-v17-centric-browser-certification-1','Unexpected browser certification schema');
assert(browser.sessionDate===contract.sessionDate,'Browser/contract session mismatch');
assert(browser.architecture===contract.architecture,'Browser/contract architecture mismatch');
assert((browser.consoleErrors||[]).length===0,'Browser console errors present');
const requiredChecks=['canonicalArchitecture','v17ProductionAuthority','nativeDiscoveryOnly','closedGateCanonicalNoActionable','decisionBoardLoaded','decisionBoardNoLoadError','decisionBoardIsPrimary','decisionPipelineFourStages','nativeDiscoveryStageVisible','v17EligibilityStageVisible','v17GlobalGateStageVisible','finalCanonicalDecisionStageVisible','legacyWorkspaceSecondary','nativeScoreSeparationVisible','evidenceStripLoaded','allCanonicalRowsRendered','stockDossierOpened','nativeScoreNotConfidenceVisible','technicalSourceVsProductionVisible','srSourceVsProductionVisible','corporateActionSafetyVisible','globalGateVisibleInDossier','provenanceVisible','legacyContributionZeroVisible','nativeExecutionPermissionDeniedVisible','noRuntimeOrConsoleErrors'];
for(const key of requiredChecks)assert(browser.checks?.[key]?.ok===true,`Browser check failed: ${key}`);
const expectedWidths=[1440,1024,768,430,390];
assert(JSON.stringify((browser.viewportResults||[]).map(v=>v.width))===JSON.stringify(expectedWidths),'Responsive viewport set mismatch');
assert((browser.viewportResults||[]).every(v=>v.ready===true&&v.horizontalOverflow===false&&(v.width>430||v.dialogHorizontalOverflow===false)),'Responsive overflow/readiness failure');
assert(registry.activeChampion==='V16_9_EQUAL_WEIGHT_BASKET','Champion drift');
assert(registry.automaticPromotion===false,'Automatic promotion enabled');
assert(sync.ok===true&&sync.source?.branch==='develop/v17-rebuild'&&/^[0-9a-f]{40}$/.test(sync.source?.commitSha||''),'V17 runtime provenance invalid');
assert(contract.sourceV17Commit===sync.source.commitSha,'Canonical contract V17 SHA mismatch');
assert(contract.summary?.productionNewExposurePct===0,'Unexpected new production exposure');
if(contract.sessionStatus!=='EXECUTION_GRADE'){
  assert(contract.summary?.productionActionableCount===0,'Closed gate produced ACTIONABLE');
  assert(!(contract.rows||[]).some(r=>r.governance?.finalDecisionState==='ACTIONABLE'),'Closed gate contains ACTIONABLE row');
  assert(browser.checks?.closedGateUiNoActionable?.ok===true,'Closed gate UI exposes ACTIONABLE');
}
assert((contract.rows||[]).every(r=>r.governance?.automaticPromotion===false&&r.governance?.automaticBrokerExecution===false&&r.governance?.v20MayOverrideV17===false),'Per-stock governance drift');

const certifiedAt=new Date().toISOString();
contract.productStatus='PRODUCTION_READY_DECISION_SUPPORT';
contract.productReadiness={
  certificationState:'CERTIFIED',
  certifiedAt,
  productionReadyDecisionSupportMayBeClaimed:true,
  executionPermissionStillControlledByV17:true,
  sessionExecutionStatus:contract.sessionStatus,
  automaticBrokerExecution:false,
  automaticPromotion:false,
  activeChampion:'V16_9_EQUAL_WEIGHT_BASKET',
  certificationArtifact:'data/v20/v17-centric-final-certification.json'
};
write('data/v20/final-decision-contract.json',contract);

const certification={
  schemaVersion:'20.0.0-v17-centric-final-certification-1',
  generatedAt:certifiedAt,
  ok:true,
  critical:0,
  major:0,
  source:{branch:process.env.GITHUB_REF_NAME||'develop/v20-integrated-decision-platform',workflowCommit:process.env.GITHUB_SHA||null,v17Commit:sync.source.commitSha,sessionDate:contract.sessionDate},
  architecture:{canonicalDecisionBoard:true,v17Centric:true,nativeDiscoveryOnly:true,v17ExecutionAuthorityPreserved:true,legacyNativeScoringContributionPct:0},
  product:{productStatus:contract.productStatus,sessionStatus:contract.sessionStatus,decisionSupportCertified:true,executionGrade:contract.sessionStatus==='EXECUTION_GRADE',productionActionableCount:contract.summary.productionActionableCount,productionNewExposurePct:contract.summary.productionNewExposurePct},
  governance:{activeChampion:registry.activeChampion,automaticPromotion:false,automaticBrokerExecution:false,v20MayOverrideV17:false},
  evidence:{semanticAcceptance:true,fundedNavRegression:true,nativeForwardRegression:true,performanceEvidenceRegression:true,championChallengerRegression:true,browserE2E:true,responsiveWidths:expectedWidths,noRuntimeOrConsoleErrors:true,noActionableWhenGateClosed:contract.sessionStatus==='EXECUTION_GRADE'?null:true},
  browser:{schemaVersion:browser.schemaVersion,failedCount:browser.failedCount,viewports:browser.viewportResults.map(v=>({width:v.width,ready:v.ready,horizontalOverflow:v.horizontalOverflow,dialogHorizontalOverflow:v.dialogHorizontalOverflow}))},
  persistence:{policy:'CONTROLLED_V20_ONLY_WHITELIST',v17FilesMayBeCommitted:false,certifiedContractPath:'data/v20/final-decision-contract.json'},
  limitations:['CERTIFICATION_IS_FOR_DECISION_SUPPORT_PRODUCT_INTEGRITY_NOT_A_CLAIM_OF_MODEL_PROFITABILITY','EXECUTION_REMAINS_FAIL_CLOSED_UNLESS_V17_SESSION_STATUS_IS_EXECUTION_GRADE']
};
write('data/v20/v17-centric-final-certification.json',certification);
console.log(JSON.stringify({ok:true,critical:0,major:0,productStatus:contract.productStatus,sessionStatus:contract.sessionStatus,actionable:contract.summary.productionActionableCount,newExposurePct:contract.summary.productionNewExposurePct,activeChampion:registry.activeChampion,v17Commit:sync.source.commitSha},null,2));
