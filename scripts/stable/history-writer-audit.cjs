'use strict';
// Read-only enforcement scanner: refuse to certify history publication while
// ANY workflow retains unsafe optimistic overwrite semantics or writer coverage
// remains unreviewed. No production workflow is changed by this scanner.
const fs=require('node:fs'),path=require('node:path');
const patterns=[
 {id:'OURS_REBASE',pattern:/git\s+pull\s+[^\n]*--rebase\s+-X\s+ours|git\s+pull\s+[^\n]*-X\s+ours\s+--rebase/},
 {id:'HISTORY_SCRIPT',pattern:/v16-session-aware-price-truth\.cjs|v15-live-price-truth\.cjs|v16-market-coverage-reconciler\.cjs|history-storage\.cjs/},
 {id:'HISTORY_GIT_PATH',pattern:/data\/history\//},
];
function scan({root,allowlist=[]}){
 const dir=path.join(root,'.github/workflows');
 const entries=fs.readdirSync(dir).filter(f=>/\.ya?ml$/.test(f)).sort();
 const findings=[];
 for(const file of entries){
  const source=fs.readFileSync(path.join(dir,file),'utf8');
  for(const item of patterns){
   if(item.pattern.test(source))findings.push({workflow:file,id:item.id});
  }
 }
 const active=findings.filter(x=>!allowlist.includes(x.workflow+':'+x.id));
 return {workflowsScanned:entries.length,findings,active,clear:active.length===0};
}
function assertSafe(root){
 const result=scan({root});
 if(!result.clear)throw new Error('HISTORY_WRITER_COVERAGE_UNPROVEN:'+result.active.map(x=>x.workflow+':'+x.id).join(','));
 return result;
}
if(require.main===module){
 try{const r=assertSafe(process.cwd());console.log(JSON.stringify(r));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={scan,assertSafe};
