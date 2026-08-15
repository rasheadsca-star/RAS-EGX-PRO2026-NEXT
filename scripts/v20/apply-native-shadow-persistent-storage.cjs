#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r);
function replace(rel,from,to,label){const f=P(rel);let text=fs.readFileSync(f,'utf8');if(text.includes(to))return{label,state:'ALREADY_APPLIED'};if(!text.includes(from))throw Error(`${rel}: persistent storage anchor missing: ${label}`);text=text.replace(from,to);fs.writeFileSync(f,text,'utf8');return{label,state:'APPLIED'}}
const results=[];
results.push(replace('scripts/v20/archive-native-shadow.cjs',"dir='data/v20/native-shadow-archive'","dir='data/v20/signal-archive/native-shadow/archive'",'archive-dir'));
results.push(replace('scripts/v20/archive-native-shadow.cjs',"read('data/v20/native-shadow-forward.json',{evaluations:[]})","read('data/v20/signal-archive/native-shadow/forward.json',{evaluations:[]})",'forward-read'));
results.push(replace('scripts/v20/archive-native-shadow.cjs',"write('data/v20/native-shadow-forward.json',out)","write('data/v20/signal-archive/native-shadow/forward.json',out)",'forward-write'));
results.push(replace('scripts/v20/native-shadow-forward-regression.cjs',"read('data/v20/native-shadow-forward.json')","read('data/v20/signal-archive/native-shadow/forward.json')",'regression-forward-read'));
results.push(replace('scripts/v20/native-shadow-forward-regression.cjs',"read('data/v20/native-shadow-archive/index.json')","read('data/v20/signal-archive/native-shadow/archive/index.json')",'regression-index-read'));
results.push(replace('scripts/v20/native-shadow-forward-regression.cjs',"P('data/v20/native-shadow-forward-regression.json')","P('data/v20/signal-archive/native-shadow/regression.json')",'regression-write'));
results.push(replace('scripts/v20/augment-native-shadow-performance-registry.cjs',"read('data/v20/native-shadow-forward.json'),reg=read('data/v20/native-shadow-forward-regression.json')","read('data/v20/signal-archive/native-shadow/forward.json'),reg=read('data/v20/signal-archive/native-shadow/regression.json')",'registry-persistent-read'));
results.push(replace('scripts/v20/native-shadow-performance-regression.cjs',"read('data/v20/native-shadow-forward.json')","read('data/v20/signal-archive/native-shadow/forward.json')",'performance-persistent-read'));
console.log(JSON.stringify({schemaVersion:'20.0.0-native-shadow-persistent-storage-patch-1',persistentRoot:'data/v20/signal-archive/native-shadow',legacySignalArchiveIndexEntriesUntouched:true,results},null,2));
