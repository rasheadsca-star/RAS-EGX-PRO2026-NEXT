#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { verifyForwardResolutionPolicy } from '../src/research-forward-resolution-policy.js';
import { resolveForwardShadowLedger,verifyForwardResolution } from '../src/research-forward-shadow-resolver.js';
import { verifyForwardShadowLedger } from '../src/research-forward-shadow-ledger.js';

const root=path.resolve(process.env.RESEARCH_DATA_ROOT||'data/research');
const ledgerPath=path.join(root,'shadow-ledger','latest.json');
const ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
if(!verifyForwardShadowLedger(ledger))throw new Error('FORWARD_LEDGER_INVALID');
const policyDir=path.join(root,'shadow-ledger','policies');
const policies=fs.existsSync(policyDir)?fs.readdirSync(policyDir).filter(x=>x.endsWith('.json')).sort().map(x=>JSON.parse(fs.readFileSync(path.join(policyDir,x),'utf8'))):[];
for(const p of policies)if(!verifyForwardResolutionPolicy(p))throw new Error(`FORWARD_POLICY_INVALID:${p?.strategySnapshotHash??'UNKNOWN'}`);
const sessionsDir=path.join(root,'live','sessions');
const sessionSnapshots=fs.existsSync(sessionsDir)?fs.readdirSync(sessionsDir).filter(x=>/^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort().map(x=>JSON.parse(fs.readFileSync(path.join(sessionsDir,x),'utf8'))):[];
const result=resolveForwardShadowLedger({ledger,policies,sessionSnapshots});
for(const r of result.ledger.resolutions??[])if(!verifyForwardResolution(r))throw new Error(`FORWARD_RESOLUTION_VERIFY_FAILED:${r?.ticker??'UNKNOWN'}`);
if(result.added.length)fs.writeFileSync(ledgerPath,JSON.stringify(result.ledger,null,2)+'\n');
console.log(JSON.stringify({entries:result.ledger.entries.length,resolutions:result.ledger.resolutions.length,added:result.added.map(x=>({ticker:x.ticker,signalSession:x.signalSession,state:x.state,terminalSession:x.terminalSession,netReturnPct:x.netReturnPct})),pending:result.pending,ledgerHash:result.ledger.ledgerHash},null,2));
