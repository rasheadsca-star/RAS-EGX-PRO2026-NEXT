#!/usr/bin/env node
'use strict';
// Reconcile only observed, same-session, provenance-backed intervening bars
// into the isolated certified G22 checkout. Never modify the MAIN APP source.
const fs = require('node:fs');
const path = require('node:path');

const isoDate = x => /^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? String(x) : null;
const number = x => x === null || x === undefined || x === '' ? NaN : Number(x);
const observed = r => {
  const o=number(r?.open), h=number(r?.high), l=number(r?.low), c=number(r?.close), v=number(r?.volume);
  return [o,h,l,c,v].every(Number.isFinite) && o>0 && c>0 && l>0 && h>=Math.max(o,c) && l<=Math.min(o,c) && v>=0;
};
function independentlyDated(r) {
  const d=isoDate(r?.date || r?.sessionDate);
  const warnings=Array.isArray(r?.warnings)?r.warnings:[];
  return Boolean(d && isoDate(r.sourceSessionDate)===d &&
    r.validationStatus==='precise_public_source_session_confirmed' &&
    typeof r.sourceSessionEvidence==='string' && r.sourceSessionEvidence.length>0 &&
    /^https:\/\//.test(String(r.sourceUrls?.primary||'')) &&
    !warnings.some(x=>/reconstruct|synthetic|estimated|unverified|invalid|conflict|quarantin|fallback/i.test(String(x))) &&
    observed(r));
}
function reconcile({prodRoot,certRoot}) {
  const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
  const write=(p,x)=>fs.writeFileSync(p,JSON.stringify(x,null,2)+'\n');
  const truth=read(path.join(prodRoot,'data/stable/v15-price-truth.json'));
  const fetchStatus=read(path.join(prodRoot,'data/fetch-status.json'));
  const expected=isoDate(truth.expectedSession);
  if(!expected || truth.ready!==true || truth.executionGrade!==true ||
    fetchStatus.expectedSession!==expected || fetchStatus.executionGrade!==true || fetchStatus.ok!==true ||
    Number(fetchStatus.marketRows)!==Number(truth.acceptedRows) ||
    Number(fetchStatus.inputRows)!==Number(truth.source?.inputRows) ||
    Number(truth.acceptedRows)+Number(truth.rejectedRows)+Number(truth.droppedRows||0)!==Number(fetchStatus.inputRows) ||
    Math.abs(Number(fetchStatus.coveragePct)-100*Number(truth.acceptedRows)/Number(fetchStatus.inputRows))>0.02) {
    throw Error('G22_HISTORY_BRIDGE_SOURCE_TRUTH_MISMATCH');
  }
  const srcDir=path.join(prodRoot,'data/history'),dstDir=path.join(certRoot,'data/history');
  const stats={expectedSession:expected,filesReviewed:0,filesChanged:0,addedBars:0,
    rejectedBars:0,missingCertifiedHistory:0,identityRejected:0,conflictingDates:0,
    tickerChanges:[],policy:'Observed same-session OHLCV after pinned certified history, before expected session; no overwrite, no synthetic prices'};
  for(const name of fs.readdirSync(srcDir).filter(n=>/^[A-Za-z0-9_-]+\.json$/.test(n)).sort()){
    const ticker=name.slice(0,-5).toUpperCase(),dst=path.join(dstDir,name);
    if(!fs.existsSync(dst)){stats.missingCertifiedHistory++;continue;}
    const source=read(path.join(srcDir,name)),target=read(dst);
    stats.filesReviewed++;
    const sameTicker=String(source.ticker||'').toUpperCase()===ticker && String(target.ticker||'').toUpperCase()===ticker;
    const validIsin=/^EG[A-Z0-9]{9,}$/i.test(String(target.isin||''));
    const matchingIsin=!source.isin || String(source.isin).toUpperCase()===String(target.isin).toUpperCase();
    const matchingCurrency=!source.currency||!target.currency||source.currency===target.currency;
    if(!sameTicker||source.symbolVerified!==true||target.symbolVerified!==true||!validIsin||!matchingIsin||!matchingCurrency){stats.identityRejected++;continue;}
    const existing=new Map((target.sessions||[]).map(r=>[isoDate(r?.date||r?.sessionDate),r]).filter(([d])=>d));
    const baselineLast=[...existing.keys()].filter(d=>d<expected).sort().at(-1);
    if(!baselineLast)continue;
    let changed=0;
    for(const row of source.sessions||[]){
      const d=isoDate(row?.date||row?.sessionDate);
      if(!d||d<=baselineLast||d>=expected)continue;
      if(existing.has(d)){
        const prior=existing.get(d);
        if(number(prior.close)!==number(row.close))stats.conflictingDates++;
        continue; // Never silently replace certified baseline evidence.
      }
      if(!independentlyDated(row) || (row.ticker && String(row.ticker).toUpperCase()!==ticker)){
        stats.rejectedBars++;continue;
      }
      existing.set(d,row);changed++;
    }
    if(!changed)continue;
    target.sessions=[...existing.values()].sort((a,b)=>String(a.date||a.sessionDate).localeCompare(String(b.date||b.sessionDate)));
    target.firstSession=isoDate(target.sessions[0]?.date||target.sessions[0]?.sessionDate);
    target.lastSession=isoDate(target.sessions.at(-1)?.date||target.sessions.at(-1)?.sessionDate);
    target.availableSessions=target.sessions.length;
    // Do not mark the security current; the separate exact-session overlay and G11 decide that.
    write(dst,target);
    stats.filesChanged++;stats.addedBars+=changed;stats.tickerChanges.push({ticker,added:changed});
  }
  return stats;
}
if(require.main===module){
  const prodRoot=process.env.PROD_DATA_ROOT,certRoot=process.env.CERT_ROOT;
  if(!prodRoot||!certRoot||path.resolve(prodRoot)===path.resolve(certRoot))throw Error('G22_HISTORY_BRIDGE_REQUIRES_DISTINCT_CHECKOUTS');
  console.log('G22_VERIFIED_HISTORY_BRIDGE '+JSON.stringify(reconcile({prodRoot,certRoot})));
}
module.exports={observed,independentlyDated,reconcile};
