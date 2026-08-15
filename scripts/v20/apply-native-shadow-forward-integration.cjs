#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r);
function patch(rel,marker,from,to){const f=P(rel);let text=fs.readFileSync(f,'utf8');if(text.includes(marker))return{rel,state:'ALREADY_APPLIED'};if(!text.includes(from))throw Error(`${rel}: Native shadow integration anchor missing: ${marker}`);text=text.replace(from,to);fs.writeFileSync(f,text,'utf8');return{rel,state:'APPLIED'}}
const results=[];
results.push(patch('scripts/v20/build-performance-evidence-registry.cjs','NATIVE_SHADOW_FORWARD_PREPARE_AND_RESOLVE_V2',
`const P = rel => path.join(root, rel);\nconst read = (rel, fallback = {}) => {`,
`const P = rel => path.join(root, rel);\n// NATIVE_SHADOW_FORWARD_PREPARE_AND_RESOLVE_V2\nconst { execFileSync } = require('child_process');\nconst nativeStore=P('data/v20/signal-archive/native-shadow'), nativeIndex=path.join(nativeStore,'archive','index.json');\nif(fs.existsSync(nativeIndex)){const idx=JSON.parse(fs.readFileSync(nativeIndex,'utf8'));let changed=false;for(const e of idx.entries||[]){const wanted='data/v20/signal-archive/native-shadow/archive/'+path.basename(String(e.file||''));if(e.file!==wanted){e.file=wanted;changed=true}}if(changed)fs.writeFileSync(nativeIndex,JSON.stringify(idx,null,2)+'\\n','utf8');}\nexecFileSync(process.execPath,[P('scripts/v20/archive-native-shadow.cjs')],{cwd:root,env:{...process.env,V20_NATIVE_FORWARD_NETWORK_REFRESH:'true',V20_NATIVE_FORWARD_CONCURRENCY:'6'},stdio:'inherit'});\nexecFileSync(process.execPath,[P('scripts/v20/native-shadow-forward-regression.cjs')],{cwd:root,stdio:'inherit'});\nconst read = (rel, fallback = {}) => {`
));
results.push(patch('scripts/v20/build-performance-evidence-registry.cjs','NATIVE_SHADOW_FORWARD_REGISTRY_AUGMENTED',
`write('data/v20/performance-evidence-registry.json', out);\nconsole.log(JSON.stringify(out.summary, null, 2));`,
`write('data/v20/performance-evidence-registry.json', out);\n// NATIVE_SHADOW_FORWARD_REGISTRY_AUGMENTED\nexecFileSync(process.execPath,[P('scripts/v20/augment-native-shadow-performance-registry.cjs')],{cwd:root,stdio:'inherit'});\nconsole.log(JSON.stringify(read('data/v20/performance-evidence-registry.json').summary, null, 2));`
));
results.push(patch('scripts/v20/performance-evidence-regression.cjs','NATIVE_SHADOW_FORWARD_PERFORMANCE_REGRESSION_INTEGRATED',
`fs.writeFileSync(P('data/v20/performance-evidence-regression.json'), \`${'${JSON.stringify(report, null, 2)}'}\\n\`, 'utf8');\nconsole.log(JSON.stringify(report, null, 2));\nif (!report.ok) process.exitCode = 1;`,
`fs.writeFileSync(P('data/v20/performance-evidence-regression.json'), \`${'${JSON.stringify(report, null, 2)}'}\\n\`, 'utf8');\n// NATIVE_SHADOW_FORWARD_PERFORMANCE_REGRESSION_INTEGRATED\nif(report.ok){require('child_process').execFileSync(process.execPath,[P('scripts/v20/native-shadow-performance-regression.cjs')],{cwd:root,stdio:'inherit'});}\nconsole.log(JSON.stringify(JSON.parse(fs.readFileSync(P('data/v20/performance-evidence-regression.json'),'utf8')), null, 2));\nif (!report.ok) process.exitCode = 1;`
));
console.log(JSON.stringify({schemaVersion:'20.0.0-native-shadow-forward-integration-2',persistentStore:'data/v20/signal-archive/native-shadow',directPersistentStorage:true,existingImmutableArchiveIndexUntouched:true,results},null,2));
