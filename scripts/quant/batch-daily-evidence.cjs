'use strict';
// Offline manual/permissioned observation CSV reconciliation, never a scraper.
// Fail closed on instrument, source independence, price basis, licences and actions.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const approved=new Set(['LICENSED_INTERNAL_RESEARCH','LICENSED_REDISTRIBUTION']);
function csv(s){
 let out=[],row=[],field='',quoted=false;
 for(let i=0;i<s.length;i++){const ch=s[i];
  if(ch==='"'){if(quoted&&s[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
  else if(ch===','&&!quoted){row.push(field);field='';}
  else if((ch==='\r'||ch==='\n')&&!quoted){if(ch==='\r'&&s[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))out.push(row);row=[];field='';}
  else field+=ch;
 }
 if(quoted)throw Error('Bad CSV quoting');row.push(field);if(row.some(x=>x.trim()))out.push(row);
 if(!out.length)throw Error('Empty CSV');
 const headers=out.shift().map(v=>v.trim().replace(/^\uFEFF/,''));
 return out.map((r,i)=>{if(r.length!==headers.length)throw Error('Bad CSV line '+(i+2));return Object.fromEntries(headers.map((h,j)=>[h,r[j].trim()]));});
}
function reconcile(gaps,rows){
 const source=new Map(),seen=new Set(),results=[];
 for(const r of rows){
  if(!/^20\d\d-\d\d-\d\d$/.test(r.date)||!/^[A-Z0-9]{2,8}$/.test(r.ticker)||!r.source_family||!r.source_url?.startsWith('https://'))throw Error('Invalid source identification');
  if(!['UNKNOWN','RAW_UNADJUSTED','ADJUSTED_CONFIRMED'].includes(r.price_basis))throw Error('Invalid price basis');
  const close=Number(r.close);if(!(close>0&&Number.isFinite(close)))throw Error('Invalid price');
  if(r.volume&&!/^\d+$/.test(r.volume))throw Error('Invalid share volume');
  const k=r.ticker+'|'+r.date;if(!source.has(k))source.set(k,[]);source.get(k).push({...r,nclose:close});
 }
 for(const gap of gaps){
  const k=gap.ticker+'|'+gap.date;if(seen.has(k))throw Error('Duplicate gap');seen.add(k);
  const count=Number(gap.missingMarkFrequency);if(!Number.isSafeInteger(count)||count<=0)throw Error('Bad missing frequency');
  const ev=source.get(k)||[],fam=new Set(ev.map(r=>r.source_family)),values=ev.map(r=>r.nclose);
  const closeMatched=ev.length>=2&&fam.size>=2&&Math.max(...values)-Math.min(...values)<=0.000001;
  const isinMatched=ev.length>=2&&ev.every(r=>/^EG[A-Z0-9]{10}$/.test(r.isin||''))&&new Set(ev.map(r=>r.isin)).size===1;
  const basisConfirmed=ev.length>=2&&ev.every(r=>r.price_basis==='RAW_UNADJUSTED')&&!['true','1',true,1].includes(gap.corporateActionRisk);
  const licensed=ev.length>=2&&ev.every(r=>approved.has(r.license_scope));
  const blockers=[];if(ev.length&&!closeMatched)blockers.push('CLOSE_UNCONFIRMED');if(closeMatched&&!isinMatched)blockers.push('ISIN');
  if(closeMatched&&!basisConfirmed)blockers.push('PRICE_BASIS');if(closeMatched&&!licensed)blockers.push('LICENCE');
  const eligible=closeMatched&&isinMatched&&basisConfirmed&&licensed;
  results.push({ticker:gap.ticker,date:gap.date,missingMarkFrequency:count,sourceFamilyCount:fam.size,closeMatched,isinMatched,basisConfirmed,licensed,blockers,eligibleForResearchOnly:eligible,eligibleForCanonicalMerge:false});
 }
 const days=new Map();for(const r of results){if(!days.has(r.date))days.set(r.date,{date:r.date,missingMarks:0,pairs:0,evidencedPairs:0,licenceBlockedPairs:0,eligibleResearchMarks:0});
  const d=days.get(r.date);d.missingMarks+=r.missingMarkFrequency;d.pairs++;if(r.sourceFamilyCount)d.evidencedPairs++;if(r.closeMatched&&!r.licensed)d.licenceBlockedPairs++;if(r.eligibleForResearchOnly)d.eligibleResearchMarks+=r.missingMarkFrequency;}
 const ordered=[...days.values()].sort((a,b)=>b.missingMarks-a.missingMarks||a.date.localeCompare(b.date));
 return {schemaVersion:1,researchOnly:true,canonicalImports:0,summary:{gapPairs:results.length,missingMarks:ordered.reduce((s,d)=>s+d.missingMarks,0),matchedCloses:results.filter(x=>x.closeMatched).length,licenceBlocked:results.filter(x=>x.closeMatched&&!x.licensed).length,eligibleResearchMarks:ordered.reduce((s,d)=>s+d.eligibleResearchMarks,0)},dates:ordered,decisions:results};
}
function run(gapsFile,observationsFile,outDir){
 if(!gapsFile||!observationsFile||!outDir)throw Error('Usage: node batch-daily-evidence.cjs gaps.csv approved-observations.csv outdir');
 const a=fs.readFileSync(gapsFile,'utf8'),b=fs.readFileSync(observationsFile,'utf8');const r=reconcile(csv(a),csv(b));
 r.inputHashes={gapsSha256:crypto.createHash('sha256').update(a).digest('hex'),evidenceSha256:crypto.createHash('sha256').update(b).digest('hex')};
 fs.mkdirSync(outDir,{recursive:true});fs.writeFileSync(path.join(outDir,'date-batch-evidence-audit.json'),JSON.stringify(r,null,2)+'\n');
 console.log(JSON.stringify(r.summary));return r;
}
if(require.main===module)run(...process.argv.slice(2));module.exports={csv,reconcile,run};
