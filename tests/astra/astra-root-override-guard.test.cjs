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
    if(fs.realpathSync(ROOT).startsWith(fs.realpathSync(os.tmpdir())+path.sep)){
      t.skip('repository itself is under temp; symlink escape prerequisite is false');
      return;
    }
    // Link to an isolated stand-in, NEVER the live checkout: a regressed guard may run the builder.
    const escaped=fs.mkdtempSync(path.join(path.dirname(fs.realpathSync(os.tmpdir())),'astra-outside-'));
    t.after(()=>fs.rmSync(escaped,{recursive:true,force:true}));
    const copy=(src,dst)=>{fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst);};
    copy(path.join(ROOT,'scripts/astra/native/workflow-inventory.cjs'),path.join(escaped,'scripts/astra/native/workflow-inventory.cjs'));
    copy(path.join(ROOT,'scripts/astra/native/astra-intelligence.cjs'),path.join(escaped,'scripts/astra/native/astra-intelligence.cjs'));
    copy(path.join(ROOT,'data/egx-exchange-closures.json'),path.join(escaped,'data/egx-exchange-closures.json'));
    fs.mkdirSync(path.join(escaped,'.github/workflows'),{recursive:true});
    fs.writeFileSync(path.join(escaped,'.github/workflows/sample.yml'),'name: sample\\non: workflow_dispatch\\n');
    fs.symlinkSync(escaped,link,'dir');
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

for(const script of scripts){
  test(script+' defaults to repository root without executing the builder',()=>{
    // Static contract: invoking production builders here would mutate tracked artifacts.
    const source=fs.readFileSync(path.join(ROOT,script),'utf8');
    assert.match(source,/const DEFAULT_ROOT=path\.resolve\(__dirname,'\.\.\/\.\.\/\.\.'\);/);
    assert.match(source,/const ROOT_OVERRIDE=process\.env\.ASTRA_INTELLIGENCE_ROOT;/);
    assert.match(source,/ROOT_OVERRIDE\?path\.resolve\(ROOT_OVERRIDE\):DEFAULT_ROOT/);
    assert.match(source,/if\(ROOT_OVERRIDE\) process\.stderr\.write/);
  });
  test(script+' rejects wrong authorization flags',t=>{
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'astra-root-guard-'));
    t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
    for(const flag of ['true','yes','0']){
      const result=invoke(script,{ASTRA_INTELLIGENCE_ROOT:temp,ASTRA_ALLOW_ROOT_OVERRIDE:flag});
      assert.notEqual(result.status,0);
      assert.match(result.stderr,/blocked in GitHub Actions/);
    }
  });
  test(script+' fails closed for missing override root',()=>{
    const missing=path.join(os.tmpdir(),'astra-definitely-missing-root-'+process.pid+'-'+Date.now());
    const result=invoke(script,{ASTRA_INTELLIGENCE_ROOT:missing});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/ENOENT|blocked in GitHub Actions/);
  });
}
