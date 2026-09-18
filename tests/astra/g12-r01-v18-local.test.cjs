'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('R01 local V18 replacement is same-origin and DecisionSnapshot-bound',()=>{
  const html=read('astra/runtime/v18/index.html'),app=read('astra/runtime/v18/app.js');
  assert.match(html,/Astra Local Decision Surface/);
  assert.match(app,/G11_CURRENT_PIPELINE_RUN\.json/);
  assert.doesNotMatch(html+app,/https?:\/\//i);
  assert.doesNotMatch(html+app,/raw\.githubusercontent\.com|cdn\.jsdelivr\.net|vercel\.app/i);
});
