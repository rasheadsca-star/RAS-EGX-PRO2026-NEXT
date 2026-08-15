#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r);
const rel='data/v20/final-decision-contract.json';
const x=JSON.parse(fs.readFileSync(P(rel),'utf8'));
if(x.schemaVersion!=='20.0.0-canonical-stock-decision-contract-1')throw new Error('Unexpected final decision contract schema');
x.productStatus='DEGRADED_PRODUCT';
x.productReadiness={
  certificationState:'PRE_CERTIFICATION',
  productionReadyDecisionSupportMayBeClaimed:false,
  requiredBeforeUpgrade:['CLEAN_EXPLICIT_WORKFLOW','NO_RUNTIME_ALGORITHM_SELF_PATCHING','SEMANTIC_ACCEPTANCE_GREEN','BROWSER_E2E_GREEN','FUNDED_NAV_GREEN','FINAL_CERTIFICATION_CRITICAL_0_MAJOR_0'],
  upgradeAuthority:'FINAL_CERTIFICATION_ONLY'
};
fs.writeFileSync(P(rel),`${JSON.stringify(x,null,2)}\n`,'utf8');
console.log(JSON.stringify({ok:true,productStatus:x.productStatus,sessionStatus:x.sessionStatus,upgradeAuthority:x.productReadiness.upgradeAuthority},null,2));
