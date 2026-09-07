#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const OUT=path.join(ROOT,'data/stable/v18-global-strategy-ensemble.json');
const STOCK_DIR=path.join(ROOT,'data/quant/stocks');

const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const write=(f,x)=>{const tmp=`${f}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(tmp,`${JSON.stringify(x,null,2)}\n`,'utf8');JSON.parse(fs.readFileSync(tmp,'utf8'));fs.renameSync(tmp,f)};
const n=(v,d=null)=>{const x=Number(v);return Number.isFinite(x)?x:d};
const r=(v,d=4)=>{const x=Number(v);return Number.isFinite(x)?Number(x.toFixed(d)):null};
const pos=v=>Number.isFinite(Number(v))&&Number(v)>0;

function stockMap(){
  const m=new Map();
  if(!fs.existsSync(STOCK_DIR))return m;
  for(const file of fs.readdirSync(STOCK_DIR).filter(x=>x.endsWith('.json'))){
    const s=read(path.join(STOCK_DIR,file));
    if(s?.ticker)m.set(String(s.ticker).toUpperCase(),s);
  }
  return m;
}

function buildPlan(row,stock){
  const preferred=row?.execution?.preferredPlan&&typeof row.execution.preferredPlan==='object'?row.execution.preferredPlan:null;
  const canonical=stock?.recommendation?.plan&&typeof stock.recommendation.plan==='object'?stock.recommendation.plan:null;
  const base=preferred||canonical||{};
  const close=n(row?.technical?.price,n(stock?.indicators?.close,n(stock?.latest?.close)));
  if(!(close>0))return null;
  const atr=n(stock?.indicators?.atr14,close*Math.max(n(stock?.indicators?.atrPct,2.5),0.5)/100);
  const safeAtr=Math.max(atr||close*.025,close*.005);
  const band=Math.min(Math.max(safeAtr*.15,close*.0025),close*.0125);
  let entryLow=pos(base.entryLow)?n(base.entryLow):pos(base.entryHigh)?n(base.entryHigh):close-band;
  let entryHigh=pos(base.entryHigh)?n(base.entryHigh):pos(base.entryLow)?n(base.entryLow):close+band;
  if(entryLow>entryHigh)[entryLow,entryHigh]=[entryHigh,entryLow];
  const referenceEntry=(entryLow+entryHigh)/2;
  let stop=pos(base.stopLoss)&&n(base.stopLoss)<referenceEntry?n(base.stopLoss):referenceEntry-Math.max(safeAtr*1.2,referenceEntry*.025);
  const support=n(stock?.indicators?.support20);
  if(!(pos(base.stopLoss))&&support>0&&support<referenceEntry)stop=Math.max(stop,support*.995);
  stop=Math.max(.0001,Math.min(stop,referenceEntry-referenceEntry*.005));
  const risk=Math.max(referenceEntry-stop,referenceEntry*.005);
  let target1=pos(base.target1)&&n(base.target1)>referenceEntry?n(base.target1):referenceEntry+risk*1.3;
  let target2=pos(base.target2)&&n(base.target2)>target1?n(base.target2):Math.max(target1+risk*.5,referenceEntry+risk*2.2);
  let target3=pos(base.target3)&&n(base.target3)>target2?n(base.target3):Math.max(target2+risk*.6,referenceEntry+risk*3.1);
  if(target2<=target1)target2=target1+risk*.5;
  if(target3<=target2)target3=target2+risk*.6;
  const origin=preferred?'PREFERRED_SOURCE_PLAN':canonical?'CANONICAL_RECOMMENDATION_PLAN':'CANONICAL_ATR_REFERENCE';
  return{
    entryLow:r(entryLow),entryHigh:r(entryHigh),referenceEntry:r(referenceEntry),stopLoss:r(stop),
    target1:r(target1),target2:r(target2),target3:r(target3),
    riskPerShare:r(risk),riskPct:r(risk/referenceEntry*100,2),
    rr1:r((target1-referenceEntry)/risk,2),rr2:r((target2-referenceEntry)/risk,2),rr3:r((target3-referenceEntry)/risk,2),
    origin,
    sourceTarget1Preserved:Boolean(pos(base.target1)&&n(base.target1)>referenceEntry),
    sourceTarget2Preserved:Boolean(pos(base.target2)&&n(base.target2)>target1),
    sourceTarget3Preserved:Boolean(pos(base.target3)&&n(base.target3)>target2),
    maximumHoldingSessions:n(base.maximumHoldingSessions,n(base.holdingSessions,null)),
    methodology:'PRESERVE_SOURCE_LEVELS_THEN_SPECULATIVE_R_MULTIPLE_EXTENSIONS',
    noteAr:preferred
      ?'منطقة الدخول والوقف وTarget 1 الأصليين محفوظة من الخطة المفضلة. Target 2/3 امتدادات فنية لإدارة الصفقة ولا تغيّر نتيجة Forward Target 1 التاريخية.'
      :canonical
        ?'الخطة مبنية على Canonical recommendation plan؛ المستويات الأصلية محفوظة حيث توفرت، وتُستكمل الأهداف الأعلى بمنهج R-multiples.'
        :'خطة مرجعية محسوبة من السعر وATR للاستخدام الفني فقط؛ يلزم تأكيد الافتتاح والسيولة ولا تمثل أمر شراء تلقائي.'
  };
}

function apply(rows,stocks){
  if(!Array.isArray(rows))return;
  for(const row of rows){
    const stock=stocks.get(String(row?.ticker||'').toUpperCase());
    const plan=buildPlan(row,stock);
    row.execution=row.execution&&typeof row.execution==='object'?row.execution:{};
    row.execution.multiTargetPlan=plan;
    row.execution.multiTargetPlanNoteAr=plan?.noteAr||'لا تتوفر بيانات كافية لبناء خطة متعددة الأهداف.';
  }
}

if(!fs.existsSync(OUT))throw new Error('Missing V18 unified output');
const out=read(OUT);
if(out.schemaVersion!=='18.2.0-shadow')throw new Error(`Multi-target extension expects 18.2.0-shadow, got ${out.schemaVersion}`);
const stocks=stockMap();
apply(out.allCandidates,stocks);apply(out.actionable,stocks);apply(out.watch,stocks);
const byTicker=new Map((out.allCandidates||[]).map(x=>[x.ticker,x.execution?.multiTargetPlan||null]));
for(const bucket of ['actionable','watch'])for(const row of out[bucket]||[])if(byTicker.has(row.ticker))row.execution.multiTargetPlan=byTicker.get(row.ticker);
const top20=(out.allCandidates||[]).slice().sort((a,b)=>(a.evidenceRank??a.rank??9999)-(b.evidenceRank??b.rank??9999)).slice(0,20);
const bad=top20.filter(row=>{const p=row.execution?.multiTargetPlan;if(!p)return true;return ![p.entryLow,p.entryHigh,p.stopLoss,p.target1,p.target2,p.target3].every(pos)||p.entryLow>p.entryHigh||p.stopLoss>=p.referenceEntry||p.target1<=p.referenceEntry||p.target2<=p.target1||p.target3<=p.target2});
if(bad.length)throw new Error(`Invalid multi-target plans: ${bad.map(x=>x.ticker).join(', ')}`);
out.executionPlanPolicy={
  code:'MULTI_TARGET_EXECUTION_REFERENCE_V1',
  appliesTo:'ALL_PUBLISHED_RECOMMENDATIONS',
  officialForwardOutcomeStillUses:'TARGET1_FROM_IMMUTABLE_ISSUE_SNAPSHOT',
  target2Target3Role:'TRADE_MANAGEMENT_REFERENCE_LEVELS',
  methodology:'Preserve existing source plan when available; otherwise use canonical recommendation plan; if absent use ATR reference. Higher targets use speculative R-multiple extensions while preserving explicit source targets.',
  guarantees:false
};
out.featureManifest=Array.isArray(out.featureManifest)?out.featureManifest:[];
if(!out.featureManifest.some(x=>x.id==='MULTI_TARGET_EXECUTION'))out.featureManifest.push({id:'MULTI_TARGET_EXECUTION',labelAr:'منطقة دخول + 3 أهداف + وقف لكل توصية',provenance:'V18 Multi-Target Execution',enabled:true});
write(OUT,out);
console.log(JSON.stringify({sessionId:out.sessionId,top20Plans:top20.map(x=>({rank:x.evidenceRank??x.rank,ticker:x.ticker,...x.execution.multiTargetPlan})),policy:out.executionPlanPolicy},null,2));
