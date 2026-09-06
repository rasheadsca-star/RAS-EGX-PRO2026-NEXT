#!/usr/bin/env node
'use strict';

const fs=require('fs');const path=require('path');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const OUT=path.join(ROOT,'data/stable/v18-global-strategy-ensemble.json');
function read(){return JSON.parse(fs.readFileSync(OUT,'utf8'))}
function write(v){fs.writeFileSync(OUT,`${JSON.stringify(v,null,2)}\n`,'utf8')}
function n(v,d=0){const x=Number(v);return Number.isFinite(x)?x:d}
function evidencePriority(row){const t=String(row?.tier||'');if(t.includes('TIER_A'))return 400;if(t.includes('TIER_B_CONFLUENCE'))return 350;if(t.includes('TIER_B_EMA_MACD'))return 330;if(t.includes('TIER_B_RESEARCH'))return 250;if(t.includes('TIER_B'))return 320;return 100}
function compare(a,b){return evidencePriority(b)-evidencePriority(a)||n(b.decisionScore)-n(a.decisionScore)||(b.sources?.length||0)-(a.sources?.length||0)||String(a.ticker).localeCompare(String(b.ticker))}
const out=read();
const all=[...(out.allCandidates||[])].sort(compare);
all.forEach((row,i)=>{row.evidenceRank=i+1;row.evidencePriority=evidencePriority(row)});
const byTicker=new Map(all.map(x=>[x.ticker,x]));
const ordered=(arr)=>[...(arr||[])].map(x=>byTicker.get(x.ticker)||x).sort(compare);
out.allCandidates=all;out.actionable=ordered(out.actionable);out.watch=ordered(out.watch);
out.rankingPolicy={code:'EVIDENCE_FIRST_THEN_SCORE',descriptionAr:'الترتيب يعرض Tier A أولاً، ثم Tier B ذو التوافق المستقل، ثم Tier B البحثي، وبعد ذلك المراقبة. الدرجة داخل كل طبقة تحسم الترتيب.',immutableForwardRawRank:true};
write(out);
console.log(JSON.stringify({policy:out.rankingPolicy.code,top:all.slice(0,12).map(x=>({evidenceRank:x.evidenceRank,rawRank:x.rank,ticker:x.ticker,tier:x.tier,score:x.decisionScore,evidencePriority:x.evidencePriority}))},null,2));
