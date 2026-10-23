'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd()), out=path.join(root,'data/ops/egx-holiday-before-after.json');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const ledgerPath='data/stable/v15-recommendation-ledger.json', reportPath='data/stable/v15-recommendation-evaluation.json';
const prior=read(ledgerPath),priorReport=read(reportPath),closures=read('data/egx-exchange-closures.json');
const closed=new Set(closures.closures.filter(c=>c.status==='confirmed_exchange_closure').map(c=>c.date));
const mapOld=new Map(prior.records.map(r=>[r.id,r]));
const affected=prior.records.filter(r=>closed.has(r.entryDate)||closed.has(r.exitDate)||(r.evaluationWindowDates||[]).some(d=>closed.has(d)));
const execution=cp.spawnSync(process.execPath,['scripts/stable/v15-recommendation-evaluator.cjs'],{cwd:root,encoding:'utf8',maxBuffer:20*1024*1024});
if(execution.status!==0)throw new Error('Re-evaluation failed: '+execution.stderr);
const next=read(ledgerPath),newReport=read(reportPath),mapNew=new Map(next.records.map(r=>[r.id,r]));
const fields=['evaluationStatus','entryDate','exitDate','entryPrice','exitPrice','netReturnPct','sessionsObserved'];
const changes=[];
for(const [id,a] of mapOld){const b=mapNew.get(id);if(!b){changes.push({id,change:'REMOVED_ON_REBUILD'});continue;}
const changed=fields.filter(k=>JSON.stringify(a[k]??null)!==JSON.stringify(b[k]??null));
if(changed.length)changes.push({id,changedFields:changed,before:Object.fromEntries(fields.map(k=>[k,a[k]??null])),after:Object.fromEntries(fields.map(k=>[k,b[k]??null]))});}
const residual=(next.records||[]).filter(r=>closed.has(r.entryDate)||closed.has(r.exitDate)||(r.evaluationWindowDates||[]).some(d=>closed.has(d))).map(r=>r.id);
const artifact={schemaVersion:'egx-holiday-before-after-1',generatedAt:new Date().toISOString(),method:'Recompute V15 ledger from archived recommendations using holiday-aware history',baselineGeneratedAt:prior.generatedAt,originalRecords:prior.records.length,updatedRecords:next.records.length,flaggedBefore:affected.length,flaggedBeforeIds:affected.map(r=>r.id),remainingHolidayConflicts:residual,changedCount:changes.length,changes,summaryBefore:priorReport.summary,summaryAfter:newReport.summary,pass:residual.length===0};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(artifact,null,2)+'\n');
console.log(JSON.stringify({flaggedBefore:artifact.flaggedBefore,changedCount:changes.length,remainingHolidayConflicts:residual.length,successRateBefore:priorReport.summary.successRatePct,successRateAfter:newReport.summary.successRatePct},null,2));
if(residual.length)process.exitCode=2;
