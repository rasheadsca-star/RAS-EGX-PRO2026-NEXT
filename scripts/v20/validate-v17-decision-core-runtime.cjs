#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r);
const read=r=>JSON.parse(fs.readFileSync(P(r),'utf8'));
const hash=r=>crypto.createHash('sha256').update(fs.readFileSync(P(r))).digest('hex');
const required=['data/recommendations.json','data/v17/current-recommendation-base-status.json'];
const failures=[];for(const r of required)if(!fs.existsSync(P(r)))failures.push(`MISSING_${r.replace(/[^A-Za-z0-9]+/g,'_')}`);
const sync=read('data/v20/v17-runtime-sync.json');
const rec=read('data/recommendations.json');
const status=read('data/v17/current-recommendation-base-status.json');
if(rec.engine!=='V17_CURRENT_SESSION_TECHNICAL_BASE_1')failures.push('V17_RECOMMENDATION_ENGINE_DRIFT');
if(rec.sessionDate!==sync.sessionDate||status.sessionDate!==sync.sessionDate)failures.push('V17_RECOMMENDATION_SESSION_MISMATCH');
if(rec.policy?.newTradingFormulaIntroduced!==false||rec.policy?.technical50MethodologyReused!==true)failures.push('V17_RECOMMENDATION_METHODOLOGY_DRIFT');
if(status.engine!==rec.engine)failures.push('V17_RECOMMENDATION_STATUS_ENGINE_MISMATCH');
if(Number(rec.total||0)<=0||(rec.all||[]).length!==Number(rec.total||0))failures.push('V17_RECOMMENDATION_UNIVERSE_INVALID');
const out={schemaVersion:'20.0.0-v17-decision-core-runtime-1',generatedAt:new Date().toISOString(),ok:failures.length===0,failedCount:failures.length,failures,source:{...sync.source},sessionDate:sync.sessionDate,recommendationEngine:rec.engine,recommendationCount:Number(rec.total||0),methodology:{newTradingFormulaIntroduced:false,technical50MethodologyReused:true,staleLegacyConfidenceForbidden:rec.policy?.staleLegacyConfidenceForbidden===true,staleLegacyPricePlanForbidden:rec.policy?.staleLegacyPricePlanForbidden===true},files:required.map(r=>({path:r,sha256:hash(r),bytes:fs.statSync(P(r)).size})),governance:{readOnlyV17Source:true,v20MayMutateV17:false,productionEligibilityAuthority:'V17'}};
fs.writeFileSync(P('data/v20/v17-decision-core-runtime.json'),`${JSON.stringify(out,null,2)}\n`,'utf8');console.log(JSON.stringify(out,null,2));if(!out.ok)process.exitCode=1;
