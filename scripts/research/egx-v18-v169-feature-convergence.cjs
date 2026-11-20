#!/usr/bin/env node
'use strict';
// Consolidate existing UI capabilities without conflating preview features with certified execution.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const exists=p=>fs.existsSync(path.join(root,p));
const candidates=[
 {id:'V18_OPPORTUNITY_RANKING',label:'قائمة الفرص وترتيبها',feature:'Ranked opportunities',origin:'V18.2',target:'astra-prod/app/data.json',required:['decisionSnapshot.top5'],priority:1},
 {id:'V18_STRATEGY_AGREEMENT',label:'توافق المحركات / Strategy Matrix',feature:'Consensus and strategy matrix',origin:'V18.2',target:'astra-prod/app/data.json',required:['decisionSnapshot.opportunities'],priority:1},
 {id:'V18_EVIDENCE',label:'الأدلة ومصدر الإشارة',feature:'Evidence provenance',origin:'V18.2',target:'astra-prod/app/data.json',required:['decisionSnapshot.opportunities'],priority:1},
 {id:'V18_FORWARD',label:'التقييم المستقبلي Forward Ledger',feature:'Forward ledger',origin:'V18.2',target:'docs/astra/ENGINE_CAPABILITY_COVERAGE.json',required:['engines'],priority:2},
 {id:'V169_CHART',label:'الرسم التاريخي مع مناطق الدخول والخروج',feature:'Price chart with entry stop targets',origin:'V16.9 UI',target:'astra-prod/app/app.js',required:[],priority:1},
 {id:'V169_POSITION',label:'حاسبة حجم المركز وإدارة المخاطر',feature:'Position sizing',origin:'V16.9 UI',target:'astra-prod/app/data.json',required:['decisionSnapshot.opportunities'],priority:1},
 {id:'V18_EXPORT',label:'تصدير CSV وJSON',feature:'Data export',origin:'V18.2',target:'astra-prod/app/app.js',required:[],priority:2},
 {id:'V18_DATA_HEALTH',label:'سلامة البيانات والتاريخ',feature:'Data health',origin:'V18.2',target:'astra-prod/app/data.json',required:['health'],priority:1},
 {id:'V18_PORTFOLIO',label:'المحفظة التجريبية',feature:'Read-only paper portfolio',origin:'V18.2',target:'astra-prod/app/app.js',required:[],priority:2}
];
function at(o,d){return d.split('.').reduce((x,k)=>x?.[k],o)}
function build(data,capabilities,shell){
 const current=data?.sourceDecision?.session||data?.decisionSnapshot?.sessionDate||null;
 const evidenceSession=data?.decisionSnapshot?.sessionDate||null;
 const features=candidates.map(x=>{const fileOK=exists(x.target);const checks=x.required.map(d=>({path:d,present:x.target.endsWith('data.json')?at(data,d)!=null:x.target.endsWith('COVERAGE.json')?at(capabilities,d)!=null:fileOK}));
 const available=fileOK&&checks.every(t=>t.present);
 return {...x,sourceConfirmedByScreenshot:true,currentImplementationEvidence:fileOK?'PRESENT_SOURCE':'MISSING_SOURCE',requiredChecks:checks,status:available?'EXISTING_CAPABILITY_REQUIRES_UI_AND_SESSION_REVIEW':'NOT_VERIFIED_OR_NOT_IMPLEMENTED',executionEligible:false};});
 return {schemaVersion:'egx-feature-convergence-1',generatedAt:new Date().toISOString(),uiSnapshotSession:current,opportunitySession:evidenceSession,
 canonicalMarketSession:read('data/stable/v15-price-truth.json').expectedSession,
 historicDataPromotionAllowed:false,autoTradingEnabled:false,featureCount:features.length,
 featuresAvailableInCode:features.filter(x=>x.status.startsWith('EXISTING')).length,features,
 notes:['Screenshot presence does not certify server-side strategy computation.','V18.2 full preview code should be migrated from pinned source branch only with provenance.','Old opportunities are never current when decision session differs from canonical session.']};
}
const data=read('astra-prod/app/data.json'),cap=read('docs/astra/ENGINE_CAPABILITY_COVERAGE.json');
const report=build(data,cap,'');const out=path.join(root,'artifacts/research/v18-v169-feature-convergence.json');
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({current:report.canonicalMarketSession,decision:report.opportunitySession,features:report.featureCount,present:report.featuresAvailableInCode,exec:false}));
