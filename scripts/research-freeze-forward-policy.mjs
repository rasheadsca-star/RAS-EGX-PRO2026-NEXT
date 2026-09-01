#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildForwardResolutionPolicy,verifyForwardResolutionPolicy } from '../src/research-forward-resolution-policy.js';

const root=path.resolve(process.env.RESEARCH_DATA_ROOT||'data/research');
const strategy=JSON.parse(fs.readFileSync(path.join(root,'strategy','latest.json'),'utf8'));
const policy=buildForwardResolutionPolicy(strategy);
if(!verifyForwardResolutionPolicy(policy))throw new Error('FORWARD_POLICY_VERIFY_FAILED');
const dir=path.join(root,'shadow-ledger','policies');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,`${policy.strategySnapshotHash}.json`);
if(fs.existsSync(file)){
  const existing=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!verifyForwardResolutionPolicy(existing)||existing.policyHash!==policy.policyHash)throw new Error('FORWARD_POLICY_IMMUTABLE_CONFLICT');
}else fs.writeFileSync(file,JSON.stringify(policy,null,2)+'\n');
console.log(JSON.stringify({strategySnapshotHash:policy.strategySnapshotHash,signalSession:policy.signalSession,costAssumptionBps:policy.costAssumptionBps,sameBarAmbiguity:policy.sameBarAmbiguity,policyHash:policy.policyHash,file},null,2));
