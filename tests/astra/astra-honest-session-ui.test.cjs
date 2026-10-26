'use strict'; const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const script=fs.readFileSync(path.resolve(__dirname,'../../astra-prod/app/app.js'),'utf8');
test('Astra browser shell parses and has fail-closed immutable session gating',()=>{
 new vm.Script(script);
 assert.match(script,/state\.sessionAligned\?A\(state\.data\?\.decisionSnapshot\?\.top5\):\[\]/);
 assert.match(script,/data\.sourceDecision\.session===handoff\.sessionDate/);
 assert.match(script,/handoff&&handoff\.final===true/);
 assert.match(script,/BLOCK|محجوبة/);
 assert.match(script,/\.catch\(\(\)=>null\)/);
 assert.match(script,/التوصيات محجوبة: جلسة القرار لا تطابق/);
 assert.match(script,/state\.sessionAligned\?\(state\.data\?\.decisionSnapshot\?\.basket/);
});
