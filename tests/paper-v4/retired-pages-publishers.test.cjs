'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const retired=['egx-github-pages','github-pages-paper','egx-elite-pages','mobile-hotfix-deploy','v13-20-stable-work-deploy'];
for(const name of retired){
 const body=fs.readFileSync('.github/workflows/'+name+'.yml','utf8');
 assert.doesNotMatch(body,/actions\/deploy-pages@/,'Competing Pages deployment: '+name);
 assert.doesNotMatch(body,/^\s+schedule:/m,'Retired workflow still scheduled: '+name);
 assert.doesNotMatch(body,/^\s+push:/m,'Retired workflow still pushes: '+name);
 assert.match(body,/workflow_dispatch:/);
}
const canonical=fs.readFileSync('.github/workflows/static.yml','utf8');
assert.match(canonical,/actions\/deploy-pages@/);
assert.match(canonical,/upload-pages-artifact@/);
console.log('V4 canonical Pages publisher protected against five legacy competing deployers');
