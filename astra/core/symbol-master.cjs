'use strict';

function normalizeTicker(value){
  return String(value||'').trim().toUpperCase().replace(/[^A-Z0-9._-]/g,'');
}
function symbolRows(raw){
  return Array.isArray(raw)?raw:Object.entries(raw||{}).map(([key,value])=>({...value,ticker:value?.ticker||key}));
}
function reviewedSecurityIdentity(entry){
  const verification=entry?.g11IdentityVerification;
  const ticker=normalizeTicker(entry?.ticker);
  const isin=String(entry?.isin||'').trim().toUpperCase();
  const evidence=Array.isArray(verification?.evidenceUrls)
    ? verification.evidenceUrls.filter(x=>/^https?:\/\//i.test(String(x||'')))
    : [];
  return Boolean(
    entry?.active!==false &&
    verification?.verified===true &&
    verification?.method==='EXACT_TICKER_ISIN_EGX_EVIDENCE' &&
    normalizeTicker(verification?.canonicalTicker)===ticker &&
    String(verification?.exchange||'').trim().toUpperCase()==='EGX' &&
    /^EG[A-Z0-9]{10}$/.test(isin) &&
    String(verification?.isin||'').trim().toUpperCase()===isin &&
    evidence.length>=2 &&
    String(verification?.evidenceSummary||'').trim()
  );
}
module.exports=Object.freeze({normalizeTicker,symbolRows,reviewedSecurityIdentity});
