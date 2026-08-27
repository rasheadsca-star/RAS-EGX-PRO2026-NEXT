#!/usr/bin/env node
'use strict';
const cp=require('child_process');
function run(cmd){return cp.execSync(cmd,{encoding:'utf8'}).trim()}
let base=process.env.GFX_BASE_REF||'main';let names='';try{names=run(`git diff --name-only ${base}...HEAD`)}catch{console.error('تعذر حساب diff. شغّل الاختبار داخل Git checkout يحتوي على base branch.');process.exit(2)}
const files=names.split(/\r?\n/).filter(Boolean),violations=files.filter(f=>!f.startsWith('gann-fusion-x/'));
const protectedTouched=files.filter(f=>f.startsWith('preview-v16/')||f.startsWith('data/stable/')||f.startsWith('scripts/stable/'));
const out={ok:violations.length===0&&protectedTouched.length===0,changedFiles:files.length,violations,protectedTouched};console.log(JSON.stringify(out,null,2));if(!out.ok)process.exit(1);