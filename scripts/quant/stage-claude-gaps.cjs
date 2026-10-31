'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
/* Ingest Claude's 101-record CSV for review ONLY. No canonical price modifications.
   This script uses comma-separated quoted-field parsing; malformed CSV is rejected. */
function parseCsv(text){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];
  if(quoted){if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}else if(ch==='"')quoted=false;else field+=ch;}
  else if(ch==='"'){if(field.length)throw Error('malformed quote');quoted=true;}
  else if(ch===','){row.push(field);field='';}
  else if(ch==='\n'){row.push(field.replace(/\r$/,''));field='';if(row.some(x=>x!==''))rows.push(row);row=[];}
  else field+=ch;
 }
 if(quoted)throw Error('unclosed CSV quote');if(field||row.length){row.push(field);rows.push(row);}
 const header=rows.shift();if(!header||new Set(header).size!==header.length)throw Error('invalid CSV header');
 return rows.map((r,i)=>{if(r.length!==header.length)throw Error('CSV columns mismatch row '+(i+2));return Object.fromEntries(header.map((h,k)=>[h,r[k]]));});
}
function stage(input){
 const pairs=new Set(),records=[];const counts={REVIEW_PARTIAL_HLCV_B:0,REVIEW_COMPLETE_OHLCV_B:0,UNRESOLVED:0,QUARANTINE_INVALID:0};
 for(const r of input){
  const key=r.ticker+'|'+r.date,missingOpen=r.open==null||String(r.open).trim()==='';
  const number=k=>{const v=r[k];return v==null||String(v).trim()===''?NaN:Number(v);};
  const [op,hi,lo,cl,vol]=['open','high','low','close','volume'].map(number);
  const coreValid=[hi,lo,cl,vol].every(Number.isFinite)&&lo>0&&lo<=cl&&cl<=hi&&vol>0;
  const claimed=r.status==='VERIFIED_TRADED',source=String(r.source_url||'');
  let category='UNRESOLVED';
  if(claimed){
   if(!coreValid||(!missingOpen&&(!Number.isFinite(op)||op<lo||op>hi))||!source.startsWith('https://stockanalysis.com/quote/egx/'))category='QUARANTINE_INVALID';
   else category=missingOpen?'REVIEW_PARTIAL_HLCV_B':'REVIEW_COMPLETE_OHLCV_B';
  } else if(r.status!=='UNRESOLVED') category='QUARANTINE_INVALID';
  if(pairs.has(key))category='QUARANTINE_INVALID';pairs.add(key);
  counts[category]++;
  records.push({ticker:r.ticker,date:r.date,category,source,sourceIndependentlyVerified:false,eligibleForCanonicalMerge:false,missingOpen,close:Number.isFinite(cl)?cl:null,volume:Number.isFinite(vol)?vol:null});
 }
 return {status:'STAGING_ONLY',counts,total:records.length,uniquePairs:pairs.size,automaticCanonicalMergeAllowed:false,records};
}
if(require.main===module){
 const src=process.argv[2],dst=process.argv[3]||'research-artifacts/claude-gap-staging.json';
 if(!src)throw Error('Usage: node stage-claude-gaps.cjs <Claude CSV> [output JSON]');
 const raw=fs.readFileSync(src,'utf8').replace(/^\uFEFF/,'');const staged=stage(parseCsv(raw));
 staged.sourceSha256=crypto.createHash('sha256').update(raw).digest('hex');
 fs.writeFileSync(dst,JSON.stringify(staged,null,2)+'\n');console.log(JSON.stringify({counts:staged.counts,total:staged.total,sourceSha256:staged.sourceSha256}));
 if(staged.counts.QUARANTINE_INVALID)process.exitCode=1;
}
module.exports={parseCsv,stage};
