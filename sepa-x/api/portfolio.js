import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRc2Analysis, portfolioReadout } from '../src/portfolio-intelligence.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const BRANCH_DATA='https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/develop/sepax-isolated-v1/sepa-x/data';
const RC2_ANALYZE='https://egx-tfe-v20-fusion-rc2.vercel.app/api/index?route=analyze&ticker=';

const send=(res,status,body)=>{res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(body));};
const readJson=(rel)=>{try{return JSON.parse(fs.readFileSync(path.join(root,rel),'utf8'));}catch{return null;}};
async function fetchJson(url,timeoutMs=15000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(url,{cache:'no-store',signal:c.signal});if(!r.ok)throw new Error(`HTTP_${r.status}`);return await r.json();}finally{clearTimeout(t);}}
async function loadEvidence(rel,remote){const local=readJson(rel);if(local)return {value:local,source:'LOCAL_BUNDLE'};try{return {value:await fetchJson(remote,12000),source:'GITHUB_BRANCH_SNAPSHOT'};}catch(error){return {value:null,source:'UNAVAILABLE',error:String(error?.message||error)};}}
const parseSymbols=(u)=>[...new Set(String(u.searchParams.get('symbols')||'').split(',').map(x=>x.trim().toUpperCase()).filter(x=>/^[A-Z0-9._-]{2,12}$/.test(x)))].slice(0,20);

export default async function handler(req,res){
  if(req.method&&req.method!=='GET')return send(res,405,{ok:false,error:'METHOD_NOT_ALLOWED'});
  const u=new URL(req.url,`https://${req.headers.host||'localhost'}`),symbols=parseSymbols(u);
  if(!symbols.length)return send(res,400,{ok:false,error:'symbols is required'});
  const [scanEv,forwardEv]=await Promise.all([
    loadEvidence('data/current-scan.json',`${BRANCH_DATA}/current-scan.json`),
    loadEvidence('data/research/full-structure-v3-forward.json',`${BRANCH_DATA}/research/full-structure-v3-forward.json`),
  ]);
  const scan=scanEv.value;
  if(!scan||!Array.isArray(scan.all))return send(res,503,{ok:false,error:'SEPA_X_SCAN_UNAVAILABLE',source:scanEv.source,sourceError:scanEv.error||null});
  const forwardSignals=Array.isArray(forwardEv.value?.signals)?forwardEv.value.signals:[];
  const rc2Settled=await Promise.allSettled(symbols.map(symbol=>fetchJson(`${RC2_ANALYZE}${encodeURIComponent(symbol)}`,18000)));
  const rows=symbols.map((symbol,i)=>{
    const core=(scan.all||[]).find(x=>String(x.symbol).toUpperCase()===symbol)||null;
    const result=rc2Settled[i];
    const rc2=result.status==='fulfilled'?normalizeRc2Analysis(result.value):null;
    const rc2Error=result.status==='rejected'?String(result.reason?.message||result.reason):null;
    const signals=forwardSignals.filter(x=>String(x.symbol).toUpperCase()===symbol).sort((a,b)=>String(b.observedAt||'').localeCompare(String(a.observedAt||'')));
    const forwardSignal=signals[0]||null;
    return {
      symbol,
      core,
      rc2,
      rc2Error,
      v3:core?.strategy_lab?.full_structure_v3??null,
      forwardSignal,
      readout:portfolioReadout({core,rc2,forwardSignal}),
    };
  });
  return send(res,200,{
    ok:true,
    generatedAt:new Date().toISOString(),
    researchOnly:true,
    automaticOrders:false,
    rc2Isolation:{mode:'READ_ONLY_HTTP_REFERENCE',runtimeImports:0,runtimeMutations:0,executionAllowed:false},
    sepaX:{generatedAt:scan.generatedAt??null,source:scanEv.source},
    v3Forward:{updatedAt:forwardEv.value?.updatedAt??null,source:forwardEv.source},
    count:rows.length,
    rows,
  });
}
