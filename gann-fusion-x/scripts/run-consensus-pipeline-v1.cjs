#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const source=path.join(__dirname,'backtest-consensus-pipeline-v1.cjs');
const runtime=path.join(__dirname,'.backtest-consensus-pipeline-v1.runtime.cjs');
let text=fs.readFileSync(source,'utf8');
const bad=",'','## Acceptance'];for(const [k,v]";
const good=",'','## Acceptance');for(const [k,v]";
if(!text.includes(bad))throw new Error('Expected report-syntax marker not found; refusing implicit rewrite.');
text=text.replace(bad,good);
fs.writeFileSync(runtime,text,'utf8');
try{require(runtime)}finally{try{fs.unlinkSync(runtime)}catch{}}
