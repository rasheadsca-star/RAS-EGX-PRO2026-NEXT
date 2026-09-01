#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildForwardResolutionPolicy,verifyForwardResolutionPolicy } from '../src/research-forward-resolution-policy.js';

const root=path.resolve(process.env.RESEARCH_DATA_ROOT||'data/research');
const strategy=JSON.parse(fs.readFileSync(path.join(root,'strategy','latest.json'),'utf8'));
const policy=buildForwardResolutionPolicy(strategy);
if(!verifyForwardResolutionPolicy(policy))throw new Error('FORWARD_POLICY_VERIFY_FAILED');
const dir=path.join(root,'shadow-ledger','policies');fs.mkdirSync(dir,{recursive:true});

function writeImmutablePolicy(p){
  if(!verifyForwardResolutionPolicy(p))throw new Error(`FORWARD_POLICY_VERIFY_FAILED:${p?.strategySnapshotHash??'UNKNOWN'}`);
  const file=path.join(dir,`${p.strategySnapshotHash}.json`);
  if(fs.existsSync(file)){
    const existing=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!verifyForwardResolutionPolicy(existing)||existing.policyHash!==p.policyHash)throw new Error(`FORWARD_POLICY_IMMUTABLE_CONFLICT:${p.strategySnapshotHash}`);
    return {file,created:false};
  }
  fs.writeFileSync(file,JSON.stringify(p,null,2)+'\n');
  return {file,created:true};
}

const primary=writeImmutablePolicy(policy);
const currentPlanHashes=(strategy.recommendations??[]).map(r=>String(r.planHash)).sort();
const currentStrategyId=String(strategy.validation?.selectedPreset??strategy.recommendations?.[0]?.strategyId??'');
const ledgerPath=path.join(root,'shadow-ledger','latest.json');
const aliases=[];

if(fs.existsSync(ledgerPath)){
  const ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
  for(const entry of ledger.entries??[]){
    const sourceHash=String(entry?.sourceStrategySnapshotHash??'');
    if(!/^[a-f0-9]{64}$/.test(sourceHash)||sourceHash===policy.strategySnapshotHash)continue;
    const entryPlanHashes=(entry.plans??[]).map(p=>String(p.planHash)).sort();
    const exactPlanSet=entryPlanHashes.length===currentPlanHashes.length&&entryPlanHashes.every((h,i)=>h===currentPlanHashes[i]);
    const sameSession=String(entry.signalSession??'')===String(strategy.signalSession??'');
    const sameStrategy=String(entry.strategyId??'')===currentStrategyId;
    if(!(exactPlanSet&&sameSession&&sameStrategy))continue;
    const alias=buildForwardResolutionPolicy({...strategy,strategySnapshotHash:sourceHash});
    const written=writeImmutablePolicy(alias);
    aliases.push({strategySnapshotHash:sourceHash,policyHash:alias.policyHash,created:written.created,file:written.file,reason:'EXACT_SIGNAL_SESSION_STRATEGY_AND_PLAN_HASH_SET_MATCH'});
  }
}

console.log(JSON.stringify({strategySnapshotHash:policy.strategySnapshotHash,signalSession:policy.signalSession,costAssumptionBps:policy.costAssumptionBps,sameBarAmbiguity:policy.sameBarAmbiguity,policyHash:policy.policyHash,file:primary.file,created:primary.created,aliases},null,2));
