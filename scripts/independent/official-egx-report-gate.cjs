'use strict';
// Fail closed: provider timestamps do not establish an official EGX closing report.
// An audited PDF plus per-symbol close, volume and ISIN reconciliation is required.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const ROOT=process.env.GITHUB_WORKSPACE||process.cwd();
const iso=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 !Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function validIsin(s){
 if(typeof s!=='string'||!/^EG[A-Z0-9]{10}$/.test(s))return false;
 const digits=s.replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));
 let sum=0;
 for(let i=digits.length-1,j=0;i>=0;i--,j++){
  const n=Number(digits[i])*(j%2?2:1);
  sum+=Math.floor(n/10)+n%10;
 }
 return sum%10===0;
}
function defaultExtract(pdf){
 return execFileSync('pdftotext',['-layout','-','-'],{input:pdf,encoding:'utf8',
  timeout:15000,maxBuffer:16*1024*1024});
}
function reportCheck(root,session,price,{extractText=defaultExtract,minRows=80}={}){
 const fail=reason=>({ok:false,session,reason});
 if(!iso(session)||price?.expectedSession!==session)return fail('SESSION_NOT_ALIGNED');
 const dir=path.join(root,'data/official-egx-reports');
 const manifestFile=path.join(dir,session+'.json'),pdfFile=path.join(dir,session+'.pdf');
 if(!fs.existsSync(manifestFile)||!fs.existsSync(pdfFile))
  return fail('OFFICIAL_EGX_PDF_OR_RECONCILIATION_MISSING');
 let m,pdf,symbols,txt;
 try{
  m=read(manifestFile);pdf=fs.readFileSync(pdfFile);
  symbols=read(path.join(root,'data/symbol-map.json'));
 }catch{return fail('OFFICIAL_EGX_EVIDENCE_UNREADABLE')}
 if(m?.schemaVersion!=='egx-official-pdf-reconciliation-v1'||m.session!==session||
    m.reviewMethod!=='MANUAL_PDF_ROW_RECONCILIATION'||!Number.isFinite(Date.parse(m.reviewedAt||''))||
    !/^[a-f0-9]{64}$/i.test(m.pdfSha256||'')||m.pdfSha256.toLowerCase()!==hash(pdf)||
    pdf.length<100||!pdf.subarray(0,5).equals(Buffer.from('%PDF-'))||
    !pdf.toString('latin1').includes('%%EOF'))
  return fail('OFFICIAL_PDF_HASH_OR_MANIFEST_INVALID');
 let url;
 try{url=new URL(m.pdfSourceUrl)}catch{return fail('INVALID_OFFICIAL_REPORT_URL')}
 if(url.protocol!=='https:'||!(url.hostname==='egx.com.eg'||url.hostname.endsWith('.egx.com.eg')))
  return fail('INVALID_OFFICIAL_REPORT_URL');
 try{txt=extractText(pdf)}catch{return fail('OFFICIAL_PDF_TEXT_UNAVAILABLE')}
 const [y,mo,d]=session.split('-');
 if(typeof txt!=='string'||![session,d+'/'+mo+'/'+y,d+'-'+mo+'-'+y,y+'/'+mo+'/'+d].some(x=>txt.includes(x)))
  return fail('PDF_SESSION_DATE_NOT_VERIFIED');
 if(!Array.isArray(m.rows)||m.rows.length<minRows)return fail('INSUFFICIENT_RECONCILED_SYMBOLS');
 const seen=new Set();
 for(const r of m.rows){
  if(!r||!(/^[A-Z0-9]{2,12}$/.test(r.ticker||''))||seen.has(r.ticker)||
     !validIsin(r.isin)||!Number.isFinite(r.close)||r.close<=0||
     !Number.isSafeInteger(r.volume)||r.volume<0||
     !Number.isInteger(r.sourcePage)||r.sourcePage<1||
     r.verifiedAgainstPdf!==true)
   return fail('INVALID_RECONCILED_ROW');
  seen.add(r.ticker);
  const sym=symbols[r.ticker];
  if(!sym||sym.isin!==r.isin||sym.active===false)return fail('ISIN_IDENTITY_MISMATCH');
  let h;
  try{h=read(path.join(root,'data/history',r.ticker+'.json'))}
  catch{return fail('HISTORICAL_BAR_MISSING')}
  const matches=(h.sessions||[]).filter(b=>(b.date||b.sessionDate)===session);
  if(h.isin!==r.isin||matches.length!==1||matches[0].close!==r.close||
     matches[0].volume!==r.volume||matches[0].sourceSessionDate!==session)
   return fail('OFFICIAL_VS_PERSISTED_CLOSE_VOLUME_MISMATCH');
  // The PDF must identify each symbol; page and numeric cells are manually reconciled.
  const tickerMatches=[...txt.matchAll(new RegExp('(^|[^A-Z0-9])'+r.ticker+'([^A-Z0-9]|$)','gi'))];
  if(!tickerMatches.length)return fail('PDF_TICKER_NOT_FOUND');
  // Confirm the actual PDF text contains BOTH numeric cells near this symbol,
  // not merely a manually asserted row in the reconciliation manifest.
  const numericNearTicker=tickerMatches.some(match=>{
   const nearby=txt.slice(Math.max(0,match.index-100),Math.min(txt.length,match.index+250));
   const nums=[...nearby.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map(x=>Number(x[0].replaceAll(',','')));
   return nums.some(x=>Math.abs(x-r.close)<1e-6)&&nums.some(x=>x===r.volume);
  });
  if(!numericNearTicker)return fail('PDF_CLOSE_VOLUME_NOT_FOUND_NEAR_TICKER');
 }
 return {ok:true,session,verifiedSymbols:seen.size,pdfSha256:m.pdfSha256};
}
function main(){
 const price=read(path.join(ROOT,'data/stable/v15-price-truth.json'));
 const result=reportCheck(ROOT,price.expectedSession,price);
 if(process.env.GITHUB_OUTPUT)
  fs.appendFileSync(process.env.GITHUB_OUTPUT,'verified='+(result.ok?'true':'false')+'\n');
 console.log('EGX_OFFICIAL_REPORT_GATE '+JSON.stringify(result));
}
if(require.main===module)main();
module.exports={reportCheck,validIsin};
