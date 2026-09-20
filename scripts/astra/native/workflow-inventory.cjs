'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../../..');
const WF=path.join(ROOT,'.github','workflows');
const files=fs.readdirSync(WF).filter(x=>/\.ya?ml$/i.test(x)).sort();
const rows=[];
for(const file of files){
  const rel='.github/workflows/'+file;
  const src=fs.readFileSync(path.join(WF,file),'utf8');
  const deployPages=/actions\/deploy-pages@/i.test(src);
  const uploadPages=/actions\/upload-pages-artifact@/i.test(src);
  const gitPush=/\bgit\s+push\b/i.test(src);
  const writesMarket=/data\/market\.json|data\/history\/|data\/stable\//i.test(src);
  const writesAstra=/astra-prod\//i.test(src);
  const workflowRun=/workflow_run:/i.test(src);
  const schedule=/\bschedule:/i.test(src);
  const canonical=rel==='.github/workflows/static.yml';
  const categories=[];
  if(canonical) categories.push('Required','Astra producer');
  if(writesMarket) categories.push('Market-data producer','Writes shared state');
  if(writesAstra) categories.push('Astra producer');
  if(gitPush) categories.push('Writes shared state');
  if(deployPages&&!canonical) categories.push('Competing publisher');
  if(!deployPages&&!gitPush&&!writesMarket&&!writesAstra) categories.push('Read-only');
  if(/v1[3456789]|legacy|repair|install/i.test(file)&&!canonical) categories.push('Legacy but harmless');
  if(deployPages&&!canonical) categories.push('Retire candidate');
  if(deployPages&&!canonical&&(schedule||workflowRun||gitPush)) categories.push('Dangerous');
  rows.push({path:rel,categories:[...new Set(categories)],deployPages,uploadPages,gitPush,writesMarket,writesAstra,workflowRun,schedule});
}
const competing=rows.filter(x=>x.deployPages&&!x.path.endsWith('/static.yml'));
const dangerous=rows.filter(x=>x.categories.includes('Dangerous'));
const out={
  schemaVersion:'astra-development-workflow-inventory-1',
  generatedAt:new Date().toISOString(),
  canonicalAstraProductionPublisher:'.github/workflows/static.yml',
  totalWorkflows:rows.length,
  competingPublisherCandidates:competing.length,
  dangerousCandidates:dangerous.length,
  policy:{
    developmentBranchMayPublishPages:false,
    legacyDecisionInfluenceAllowed:false,
    finalizedSessionMustUseCanonicalDataHead:true,
    recommendationTruthSource:'EGX PRO — Astra DecisionSnapshot only'
  },
  workflows:rows
};
const target=path.join(ROOT,'docs/astra/development/WORKFLOW_INVENTORY.json');
fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({status:'PASS',total:rows.length,competing:competing.length,dangerous:dangerous.length,canonical:out.canonicalAstraProductionPublisher},null,2));
