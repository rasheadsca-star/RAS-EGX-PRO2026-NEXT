#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),read=r=>JSON.parse(fs.readFileSync(path.join(root,r),'utf8'));
const report=read('data/v19/native-challenger.json'),replay=read('data/v19/recorded-session-replay.json'),gate=read('data/v19/challenger-status.json');
const failures=[],assert=(ok,msg)=>{if(!ok)failures.push(msg)};
assert(report.schemaVersion==='19.0.0-native-challenger-1','wrong report schema');
assert(report.engineId==='V19_CHAT_GPT_NATIVE_CHALLENGER','wrong engine');
assert(report.status==='SHADOW_RESEARCH_ONLY','V19 must remain shadow');
assert(report.current?.executionAllowed===false,'current V19 execution must be disabled');
assert(report.promotion?.automaticPromotion===false,'automatic promotion forbidden');
assert(report.promotion?.promotionAllowed===false,'promotion must remain false');
assert(report.isolation?.v16Untouched===true&&report.isolation?.v17Untouched===true,'isolation contract failed');
assert(report.independentHoldout?.frozen===true,'holdout is not frozen');
assert(report.independentHoldout?.labelsNeverUsedForRefit===true,'holdout leakage contract failed');
assert(Number(report.independentHoldout?.sessions||0)>=20,'holdout below 20 sessions');
assert(String(report.methodology?.execution||'').includes('SAME_SESSION_TARGET_AND_STOP_IS_STOP'),'ambiguity policy missing');
assert(replay.schemaVersion==='19.0.0-recorded-session-replay-1','wrong replay schema');
assert(replay.policy?.v16AndV17LedgersReadOnly===true,'source ledgers must be read only');
assert(replay.policy?.asOfDateOnly===true&&replay.policy?.futureLeakageForbidden===true,'replay leakage policy failed');
assert(replay.policy?.countsAsLiveEvidence===false,'retroactive replay cannot be live evidence');
for(const s of replay.sessions||[])assert(s.evidenceClass==='RETROACTIVE_AS_OF_DATE_REPLAY_NOT_LIVE_V19_EVIDENCE',`bad replay evidence ${s.signalDate}`);
for(const c of report.current?.candidates||[]){assert(Number.isFinite(Number(c.opportunityScore)),`missing score ${c.ticker}`);assert(c.executionEligible===Object.values(c.ruleChecks||{}).every(Boolean),`execution rule mismatch ${c.ticker}`);assert(Number(c.target)>0&&Number(c.stop)>0,`invalid plan ${c.ticker}`)}
assert(gate.automaticPromotion===false&&gate.promotionAllowed===false,'gate promotion safety failed');
const output={schemaVersion:'19.0.0-regression-1',generatedAt:new Date().toISOString(),ok:failures.length===0,failedCount:failures.length,failures};
fs.writeFileSync(path.join(root,'data/v19/regression.json'),JSON.stringify(output,null,2)+'\n','utf8');console.log(JSON.stringify(output,null,2));if(failures.length)process.exit(1);
