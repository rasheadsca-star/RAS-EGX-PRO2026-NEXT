#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..','.github/workflows');
const parkedMarkers=[
 'Paused by user request','Legacy automation paused','Legacy automatic execution suspended',
 'Legacy automatic execution suspended','Deprecated automated pipeline',
 'Prior experimental engine frozen','User-requested archive of redundant engines',
 'Legacy experimental engine paused','Disabled legacy automatic trigger',
 'Parked legacy engine'
];
const files=fs.readdirSync(root).filter(n=>/\.ya?ml$/.test(n));
let parked=0;const failures=[],names=[];
for(const file of files){
 const s=fs.readFileSync(path.join(root,file),'utf8');
 if(!parkedMarkers.some(x=>s.includes(x)))continue;
 parked++;names.push(file);
 if(s.includes('\\non:')||s.includes('\\n  workflow_dispatch:'))failures.push(file+': literal escaped YAML newline');
 const on=s.match(/^on:\s*\n([\s\S]*?)(?=^[a-zA-Z][\w-]*:|$)/m);
 if(!on){failures.push(file+': missing top-level on');continue}
 const e=on[1];
 if(!/^  workflow_dispatch:\s*$/m.test(e))failures.push(file+': missing manual dispatch');
 if(/^  (?:schedule|push|pull_request|workflow_run|repository_dispatch):/m.test(e))failures.push(file+': unintended automatic event');
}
if(parked<89)failures.push('Expected at least 89 parked workflows, found '+parked);
const report={parked,workflowTotal:files.length,failures,examples:names.slice(0,8)};
console.log(JSON.stringify(report,null,2));
if(failures.length)process.exitCode=2;
