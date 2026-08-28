#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd()),DATA=path.join(ROOT,'gann-fusion-x','data');
function read(f){return JSON.parse(fs.readFileSync(f,'utf8'))}
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v}
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const ledger=read(path.join(DATA,'champion-challenger-ledger.json'));
if(ledger.policyHash!==hash(ledger.policy))throw new Error('TOURNAMENT_POLICY_HASH_MISMATCH');
const keys=new Set();for(const s of ledger.completedSessions||[]){if(keys.has(s.key))throw new Error(`DUPLICATE_TOURNAMENT_SESSION ${s.key}`);keys.add(s.key);const immutable={engine:s.engine,role:s.role,signalSession:s.signalSession,legs:s.legs,basketNetPct:s.basketNetPct};if(s.fingerprint!==hash(immutable))throw new Error(`TOURNAMENT_FINGERPRINT_MISMATCH ${s.key}`)}
const manifestPath=path.join(DATA,'fundamentals-pit','manifest.json');if(fs.existsSync(manifestPath)){const m=read(manifestPath),dates=new Set();for(const e of m.snapshots||[]){if(dates.has(e.marketSession))throw new Error(`DUPLICATE_PIT_SESSION ${e.marketSession}`);dates.add(e.marketSession);const p=path.join(ROOT,e.path),doc=read(p);if(doc.marketSession!==e.marketSession)throw new Error(`PIT_SESSION_MISMATCH ${e.marketSession}`);const h=hash(doc.payload);if(h!==doc.integrity?.payloadSha256||h!==e.payloadSha256)throw new Error(`PIT_HASH_MISMATCH ${e.marketSession}`)}}
console.log(JSON.stringify({status:'SUCCESS',tournamentSessions:keys.size,pitSnapshots:fs.existsSync(manifestPath)?read(manifestPath).snapshots.length:0},null,2));
