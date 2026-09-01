import fs from 'node:fs';
import crypto from 'node:crypto';

const EVIDENCE='data/research/egx-independent-identity-evidence-2026-09-01.json';
const OUT='artifacts/egx-independent-identity-audit.json';
const URL='https://beta.egx.com.eg/api/bff/egx/stock-info';
const rawEvidence=fs.readFileSync(EVIDENCE);
const evidence=JSON.parse(rawEvidence);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const norm=v=>String(v??'').trim().toUpperCase();

fs.mkdirSync('artifacts',{recursive:true});
const res=await fetch(URL,{headers:{accept:'application/json','x-egx-bff-request':'1',referer:'https://beta.egx.com.eg/en/listed/stocks','user-agent':'Mozilla/5.0 Chrome/151'}});
const raw=Buffer.from(await res.arrayBuffer());
let parsed=null; try{parsed=JSON.parse(raw.toString('utf8'))}catch{}
if(res.status!==200||!Array.isArray(parsed?.data)) throw new Error('live stock-info unavailable');

const official=new Map();
for(const row of parsed.data){
  const m=Object.fromEntries(Object.entries(row??{}).map(([k,v])=>[String(k).toLowerCase(),v]));
  const reuters=norm(m.reuters); const ticker=reuters.split('.')[0];
  if(ticker) official.set(ticker,{ticker,isin:norm(m.isin),reuters,name:String(m.name??''),schedule:String(m.schedule??'')});
}
const mappings=Array.isArray(evidence.mappings)?evidence.mappings:[];
const duplicateTickers=mappings.map(x=>norm(x.ticker)).filter((x,i,a)=>a.indexOf(x)!==i);
const duplicateIsins=mappings.map(x=>norm(x.isin)).filter((x,i,a)=>a.indexOf(x)!==i);
const results=mappings.map(x=>{
  const ticker=norm(x.ticker),isin=norm(x.isin),live=official.get(ticker)??null;
  const exact=Boolean(live&&live.isin===isin&&live.schedule==='Egyptian securities-Stocks');
  return {ticker,expectedIsin:isin,independentName:x.independentName,sourceUrl:x.sourceUrl,live,exactMatch:exact,productionAuthority:false};
});
const report={
  schemaVersion:'egx-independent-identity-audit-1',generatedAt:new Date().toISOString(),
  evidence:{path:EVIDENCE,sha256:sha(rawEvidence),provider:evidence.provider,authorityMode:evidence.authorityMode},
  officialReceipt:{url:URL,httpStatus:res.status,bytes:raw.length,sha256:sha(raw)},
  mappingCount:mappings.length,duplicateTickers,duplicateIsins,results,
  exactMatches:results.filter(x=>x.exactMatch).length,
  mismatches:results.filter(x=>!x.exactMatch).map(x=>x.ticker),
  verdict:mappings.length===7&&duplicateTickers.length===0&&duplicateIsins.length===0&&results.every(x=>x.exactMatch)?'PASS_INDEPENDENT_IDENTITY_COMPLEMENT':'FAIL_CLOSED',
  productionAuthority:false
};
fs.writeFileSync(OUT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(report.verdict!=='PASS_INDEPENDENT_IDENTITY_COMPLEMENT') process.exit(1);
