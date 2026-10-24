'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..');
const scripts=['scripts/astra/native/astra-intelligence.cjs','scripts/astra/native/workflow-inventory.cjs'];
function invoke(script,overrides={}){
  const env={...process.env,GITHUB_ACTIONS:'true',ASTRA_ALLOW_ROOT_OVERRIDE:'1',...overrides};
  return cp.spawnSync(process.execPath,[path.join(ROOT,script)],{cwd:ROOT,env,encoding:'utf8'});
}
for(const script of scripts){
  test(script+' blocks a temp-directory symlink pointing to repository',t=>{
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'astra-root-guard-'));
    t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
    const link=path.join(temp,'repo-link');
    fs.symlinkSync(ROOT,link,'dir');
    const out=invoke(script,{ASTRA_INTELLIGENCE_ROOT:link});
    assert.notEqual(out.status,0);
    assert.match(out.stderr,/blocked in GitHub Actions/);
    assert.doesNotMatch(out.stderr,/NON-PRODUCTION ROOT OVERRIDE/);
  });
  test(script+' refuses override in Actions without explicit authorization',t=>{
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'astra-root-guard-'));
    t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
    const out=invoke(script,{ASTRA_INTELLIGENCE_ROOT:temp,ASTRA_ALLOW_ROOT_OVERRIDE:''});
    assert.notEqual(out.status,0);
    assert.match(out.stderr,/blocked in GitHub Actions/);
  });
  test(script+' accepts real temp root through guard with newline warning',t=>{
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'astra-root-guard-'));
    t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
    // Content beyond the guard may reject the deliberately incomplete fixture.
    const out=invoke(script,{ASTRA_INTELLIGENCE_ROOT:temp});
    assert.match(out.stderr,/\[ASTRA\] NON-PRODUCTION ROOT OVERRIDE: [^\r\n]+\n/);
    assert.doesNotMatch(out.stderr,/blocked in GitHub Actions/);
  });
}
