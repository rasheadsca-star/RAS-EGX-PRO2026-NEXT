import fs from 'node:fs';
import crypto from 'node:crypto';

const SESSION='2026-08-31';
const BASE='https://beta.egx.com.eg/api/bff/egx/';
const REF='https://beta.egx.com.eg/en/listed/stocks';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36';
const OUT='artifacts/egx-session-close-volume-audit.json';
const IDENTITY='data/research/egx-independent-identity-evidence-2026-09-01.json';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const norm=v=>String(v??'').trim().toUpperCase();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

fs.mkdirSync('artifacts',{recursive:true});

async function fetchBytes(url,{referer=REF,accept='*/*',retries=2}={}){
  let last;
  for(let attempt=0;attempt<=retries;attempt++){
    try{
      const res=await fetch(url,{headers:{accept,referer,'user-agent':UA,'x-egx-bff-request':url.startsWith(BASE)?'1':'0'}});
      const raw=Buffer.from(await res.arrayBuffer());
      last={url,httpStatus:res.status,contentType:res.headers.get('content-type'),bytes:raw.length,sha256:sha(raw),raw};
      if(res.ok||attempt===retries) return last;
    }catch(error){last={url,httpStatus:0,contentType:null,bytes:0,sha256:null,raw:Buffer.alloc(0),error:String(error)}}
    await sleep(250*(attempt+1));
  }
  return last;
}

async function egx(endpoint){
  const r=await fetchBytes(BASE+endpoint,{accept:'application/json'});
  let parsed=null; try{parsed=JSON.parse(r.raw.toString('utf8'))}catch{}
  return {...r,parsed};
}
function categorySet(data,key){
  return new Set((data?.[key]??[]).map(x=>norm(Object.entries(x??{}).find(([k])=>String(k).toLowerCase()==='symbol_code')?.[1])).filter(Boolean));
}
function decode(s){return String(s??'').replace(/&amp;/g,'&').replace(/&#x2F;/g,'/').replace(/&quot;/g,'"').replace(/&#39;/g,"'");}
function stripTags(s){return decode(String(s??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim());}
function decimals(text){
  const s=String(text??'').trim(); const m=s.match(/\.([0-9]+)/); return m?m[1].length:0;
}
function precisionCompatible(official,providerText){
  const p=decimals(providerText), scale=10**p, a=Number(official), b=Number(providerText);
  if(!Number.isFinite(a)||!Number.isFinite(b)) return {compatible:false,providerDecimals:p,delta:null,tolerance:null};
  const delta=Math.abs(a-b), tolerance=0.5/scale;
  return {compatible:delta<=tolerance+1e-12,providerDecimals:p,delta,tolerance};
}
function parseCsvSession(raw){
  for(const line of raw.toString('utf8').split(/\r?\n/)){
    const cols=line.trim().split(',').map(x=>x.trim());
    if(cols.length<6) continue;
    const date=cols[0].split('/')[0]; if(date!==SESSION) continue;
    const closeText=cols[4], volumeText=cols[5];
    const close=Number(closeText),volume=Number(volumeText);
    if(!Number.isFinite(close)||!Number.isFinite(volume)) continue;
    return {session:date,close,closeText,volume,rawLine:line.trim(),trueOhlcvEligible:false};
  }
  return null;
}

const identityRaw=fs.readFileSync(IDENTITY); const identity=JSON.parse(identityRaw);
const complement=new Map((identity.mappings??[]).map(x=>[norm(x.ticker),norm(x.isin)]));
const [info,cats]=await Promise.all([egx('stock-info'),egx('stock-categories')]);
if(info.httpStatus!==200||!Array.isArray(info.parsed?.data)) throw new Error('official stock-info unavailable');
if(cats.httpStatus!==200||!cats.parsed?.data) throw new Error('official stock-categories unavailable');
const A=categorySet(cats.parsed.data,'categoryA'),B=categorySet(cats.parsed.data,'categoryB'),C=categorySet(cats.parsed.data,'categoryC');
const eligible=new Set([...A,...B,...C]);
const candidates=[];
for(const row of info.parsed.data){
  const m=Object.fromEntries(Object.entries(row??{}).map(([k,v])=>[String(k).toLowerCase(),v]));
  const isin=norm(m.isin); if(m.schedule!=='Egyptian securities-Stocks'||!eligible.has(isin)) continue;
  const reuters=norm(m.reuters),ticker=reuters.split('.')[0];
  candidates.push({ticker,isin,reuters,name:String(m.name??''),egxClose:Number(m.last_cp),egxVolume:Number(m.last_vol),lastTradeDate:String(m.last_trade_date??'')});
}
candidates.sort((a,b)=>a.ticker.localeCompare(b.ticker));

async function one(c){
  const pageUrl=`https://english.mubasher.info/markets/EGX/stocks/${encodeURIComponent(c.ticker)}`;
  const page=await fetchBytes(pageUrl,{referer:'https://english.mubasher.info/',accept:'text/html,*/*;q=0.8'});
  const html=page.raw.toString('utf8');
  const h1=stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]??'');
  const pageTickerMatch=new RegExp(`\\(${c.ticker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\)\\s*$`,'i').test(h1);
  const complementExact=complement.get(c.ticker)===c.isin;
  const identityReady=pageTickerMatch||complementExact;
  const identityMethod=pageTickerMatch?'MUBASHER_EXACT_TICKER_PAGE':complementExact?'DECYPHA_EXACT_TICKER_ISIN_COMPLEMENT':'UNRESOLVED';
  const rawHist=html.match(/historical-data-url=["']([^"']+)["']/i)?.[1]??'';
  const historyUrl=decode(rawHist);
  let hist={httpStatus:null,bytes:0,sha256:null},sessionRow=null;
  if(historyUrl){
    hist=await fetchBytes(historyUrl,{referer:pageUrl,accept:'text/csv,text/plain,*/*;q=0.8'});
    if(hist.httpStatus===200) sessionRow=parseCsvSession(hist.raw);
  }
  const close=sessionRow?precisionCompatible(c.egxClose,sessionRow.closeText):{compatible:false,providerDecimals:null,delta:null,tolerance:null};
  const volumeExact=Boolean(sessionRow&&Number.isFinite(c.egxVolume)&&sessionRow.volume===c.egxVolume);
  return {...c,mubasherPage:{httpStatus:page.httpStatus,bytes:page.bytes,sha256:page.sha256},mubasherH1:h1,pageTickerMatch,complementExact,identityReady,identityMethod,historyUrl:historyUrl||null,historicalReceipt:{httpStatus:hist.httpStatus,bytes:hist.bytes,sha256:hist.sha256},sessionRow,closePrecisionCompatible:close.compatible,closeDelta:close.delta,closeTolerance:close.tolerance,providerCloseDecimals:close.providerDecimals,volumeExact,sessionCloseVolumeReconciled:Boolean(identityReady&&sessionRow&&close.compatible&&volumeExact),trueOhlcvEligible:false};
}

const results=new Array(candidates.length); let index=0;
async function worker(){while(true){const i=index++; if(i>=candidates.length)return; results[i]=await one(candidates[i]);}}
await Promise.all(Array.from({length:12},()=>worker()));

const missingSession=results.filter(x=>!x.sessionRow).map(x=>x.ticker);
const unresolvedIdentity=results.filter(x=>!x.identityReady).map(x=>x.ticker);
const closeExact=results.filter(x=>x.sessionRow&&x.closeDelta===0).length;
const closePrecisionOnly=results.filter(x=>x.sessionRow&&x.closeDelta>0&&x.closePrecisionCompatible).map(x=>({ticker:x.ticker,egxClose:x.egxClose,providerClose:x.sessionRow.close,delta:x.closeDelta,tolerance:x.closeTolerance}));
const report={
  schemaVersion:'egx-session-close-volume-audit-1',
  generatedAt:new Date().toISOString(),session:SESSION,
  officialReceipts:{
    stockInfo:{httpStatus:info.httpStatus,bytes:info.bytes,sha256:info.sha256},
    stockCategories:{httpStatus:cats.httpStatus,bytes:cats.bytes,sha256:cats.sha256}
  },
  independentIdentityEvidence:{path:IDENTITY,sha256:sha(identityRaw),complementCount:complement.size},
  semanticPolicy:{
    mubasherRole:'INDEPENDENT_CLOSE_VOLUME_HISTORY_AND_IDENTITY_CROSSCHECK',
    closeRule:'EXACT_OR_WITHIN_HALF_OF_PROVIDER_LAST_DECIMAL_UNIT',
    volumeRule:'EXACT_INTEGER_EQUALITY',
    trueOhlcvEligible:false,
    productionAuthority:false
  },
  counts:{
    candidates:candidates.length,
    identityReady:results.filter(x=>x.identityReady).length,
    identityViaMubasherPage:results.filter(x=>x.identityMethod==='MUBASHER_EXACT_TICKER_PAGE').length,
    identityViaExactComplement:results.filter(x=>x.identityMethod==='DECYPHA_EXACT_TICKER_ISIN_COMPLEMENT').length,
    sessionRows:results.filter(x=>x.sessionRow).length,
    closeExact,
    closePrecisionCompatible:results.filter(x=>x.sessionRow&&x.closePrecisionCompatible).length,
    volumeExact:results.filter(x=>x.volumeExact).length,
    sessionCloseVolumeReconciled:results.filter(x=>x.sessionCloseVolumeReconciled).length
  },
  unresolvedIdentity,missingSession,closePrecisionOnly,
  sessionFailures:results.filter(x=>!x.sessionCloseVolumeReconciled).map(x=>({ticker:x.ticker,isin:x.isin,identityReady:x.identityReady,identityMethod:x.identityMethod,pageStatus:x.mubasherPage.httpStatus,historyStatus:x.historicalReceipt.httpStatus,sessionRow:x.sessionRow,egxClose:x.egxClose,egxVolume:x.egxVolume,closePrecisionCompatible:x.closePrecisionCompatible,closeDelta:x.closeDelta,closeTolerance:x.closeTolerance,volumeExact:x.volumeExact})),
  results,
  productionAuthority:false,
  phase4Open:false
};
const checks={candidateCount213:report.counts.candidates===213,identity213:report.counts.identityReady===213,sessionRows204:report.counts.sessionRows===204,closeCompatible204:report.counts.closePrecisionCompatible===204,volumeExact204:report.counts.volumeExact===204,reconciled204:report.counts.sessionCloseVolumeReconciled===204,missingSession9:report.missingSession.length===9};
report.checks=checks;
report.verdict=Object.values(checks).every(Boolean)?'PASS_SESSION_CLOSE_VOLUME_RESEARCH_RECONCILIATION':'FAIL_CLOSED';
fs.writeFileSync(OUT,JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,results:undefined,sessionFailures:report.sessionFailures},null,2));
if(report.verdict!=='PASS_SESSION_CLOSE_VOLUME_RESEARCH_RECONCILIATION') process.exit(1);
