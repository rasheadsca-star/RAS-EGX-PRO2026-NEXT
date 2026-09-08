#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const sourceFile=path.join(ROOT,'data/stable/v18-global-strategy-ensemble.json');
if(!fs.existsSync(sourceFile))throw new Error('Missing V18 unified output');
const data=JSON.parse(fs.readFileSync(sourceFile,'utf8'));
if(data.schemaVersion!=='18.2.0-shadow')throw new Error(`Agreement badges expect V18.2 unified input, got ${data.schemaVersion}`);
if(!Array.isArray(data.allCandidates))throw new Error('Missing allCandidates');

function engineName(source){
  const s=String(source||'').trim();
  if(!s)return null;
  if(/^V16_9_/i.test(s))return 'V16.9';
  if(/^V13_5_/i.test(s))return 'V13.5';
  if(/^V13_4_/i.test(s))return 'V13.4';
  if(/^V15_/i.test(s))return 'V15';
  if(/^EMA_MACD/i.test(s))return 'EMA–MACD';
  if(/^V18_/i.test(s))return 'V18';
  if(/^EMA_MACD_DAILY_EXTERNAL/i.test(s))return 'EMA–MACD External';
  return s;
}
function agreementMeta(row){
  const engines=[...new Set((row.sources||[]).map(engineName).filter(Boolean))];
  const engineCount=engines.length;
  const isShared=engineCount>=2;
  let labelAr='';
  if(engineCount===2)labelAr='🔗 مشتركة بين محركين';
  else if(engineCount===3)labelAr='⭐ مشتركة بين 3 محركات';
  else if(engineCount>=4)labelAr=`🔥 مشتركة بين ${engineCount} محركات`;
  const attentionLevel=engineCount>=4?'HIGH':engineCount===3?'ELEVATED':engineCount===2?'WATCH':'NORMAL';
  return {isShared,engineCount,engines,labelAr,attentionLevel};
}
function cleanBaseLabel(row){
  const raw=String(row.baseDecisionLabelAr??row.decisionLabelAr??'').trim();
  return raw.replace(/^(?:🔥|⭐|🔗)\s*مشتركة بين\s*(?:محركين|\d+\s*محركات)\s*·\s*/u,'').trim();
}
function decorate(row){
  const meta=agreementMeta(row);
  const baseDecisionLabelAr=cleanBaseLabel(row);
  return {...row,baseDecisionLabelAr,engineAgreementBadge:meta,decisionLabelAr:meta.isShared?`${meta.labelAr}${baseDecisionLabelAr?` · ${baseDecisionLabelAr}`:''}`:baseDecisionLabelAr};
}

const decorated=data.allCandidates.map(decorate);
const byTicker=new Map(decorated.map(x=>[x.ticker,x]));
data.allCandidates=decorated;
if(Array.isArray(data.topFiveNow))data.topFiveNow=data.topFiveNow.map(x=>{const d=byTicker.get(x.ticker);return d?{...x,baseDecisionLabelAr:d.baseDecisionLabelAr,decisionLabelAr:d.decisionLabelAr,engineAgreementBadge:d.engineAgreementBadge}:x});
if(Array.isArray(data.universeScreener))data.universeScreener=data.universeScreener.map(x=>{const d=byTicker.get(x.ticker);if(!d||!x.decision)return x;return {...x,decision:{...x.decision,labelAr:d.decisionLabelAr,engineAgreementBadge:d.engineAgreementBadge,engineCount:d.engineAgreementBadge.engineCount,engines:d.engineAgreementBadge.engines}}});
if(Array.isArray(data.engineAgreement))data.engineAgreement=data.engineAgreement.map(x=>{const d=byTicker.get(x.ticker);if(!d)return x;const m=d.engineAgreementBadge;return {...x,engineCount:m.engineCount,engines:m.engines,agreementBadgeAr:m.labelAr,attentionLevel:m.attentionLevel,isShared:m.isShared}});

const shared=decorated.filter(x=>x.engineAgreementBadge.isShared);
const high=decorated.filter(x=>x.engineAgreementBadge.engineCount>=4);
const elevated=decorated.filter(x=>x.engineAgreementBadge.engineCount===3);
const watch=decorated.filter(x=>x.engineAgreementBadge.engineCount===2);
data.engineAgreementBadgeSummary={policy:'UNIQUE_ENGINE_FAMILIES_NOT_RAW_SOURCE_LAYERS',sharedCandidates:shared.length,highAttention4Plus:high.length,elevatedAttention3:elevated.length,multiEngine2:watch.length,topShared:shared.slice().sort((a,b)=>b.engineAgreementBadge.engineCount-a.engineAgreementBadge.engineCount||(a.evidenceRank??a.rank??9999)-(b.evidenceRank??b.rank??9999)).slice(0,20).map(x=>({ticker:x.ticker,evidenceRank:x.evidenceRank??x.rank??null,engineCount:x.engineAgreementBadge.engineCount,engines:x.engineAgreementBadge.engines,labelAr:x.engineAgreementBadge.labelAr}))};
if(Array.isArray(data.featureManifest)&&!data.featureManifest.some(x=>x.id==='ENGINE_AGREEMENT_BADGE'))data.featureManifest.push({id:'ENGINE_AGREEMENT_BADGE',labelAr:'شارة واضحة لعدد المحركات المتفقة على التوصية',provenance:'V18.3 Agreement Badge',enabled:true});

for(const row of decorated){const expected=agreementMeta(row);if(row.engineAgreementBadge.engineCount!==expected.engineCount)throw new Error(`Agreement count mismatch for ${row.ticker}`);if(expected.isShared&&!row.decisionLabelAr.includes('مشتركة بين'))throw new Error(`Missing shared badge for ${row.ticker}`);}
fs.writeFileSync(sourceFile,`${JSON.stringify(data,null,2)}\n`,'utf8');
console.log(JSON.stringify({module:'V18_ENGINE_AGREEMENT_BADGES',sessionId:data.sessionId,sharedCandidates:shared.length,highAttention4Plus:high.length,elevatedAttention3:elevated.length,multiEngine2:watch.length,topShared:data.engineAgreementBadgeSummary.topShared.slice(0,10)},null,2));
