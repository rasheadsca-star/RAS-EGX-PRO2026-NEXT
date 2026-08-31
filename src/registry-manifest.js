import { sha256,canonicalize } from './hash.js';
const HEX64=/^[0-9a-f]{64}$/i;

export function registryCounts(rows){return rows.reduce((acc,row)=>(acc[row.readiness]=(acc[row.readiness]??0)+1,acc),{})}

export function validateRegistrySnapshot(registry){
  const reasons=[];
  if(!registry||typeof registry!=='object') return Object.freeze({valid:false,reasons:['REGISTRY_NOT_OBJECT']});
  if(!Array.isArray(registry.rows)) reasons.push('REGISTRY_ROWS_MISSING');
  const rows=Array.isArray(registry.rows)?registry.rows:[];
  if(!HEX64.test(String(registry.version??''))) reasons.push('INVALID_REGISTRY_VERSION');
  else if(sha256(rows)!==registry.version) reasons.push('REGISTRY_VERSION_HASH_MISMATCH');
  if(registry.total!==rows.length) reasons.push('REGISTRY_TOTAL_MISMATCH');
  const counts=registryCounts(rows);
  if(canonicalize(registry.counts??{})!==canonicalize(counts)) reasons.push('REGISTRY_COUNTS_MISMATCH');
  const tickers=new Set(),declaredOrder=[];
  for(const row of rows){if(!row||typeof row!=='object'||!row.ticker) reasons.push('REGISTRY_ROW_IDENTITY_MISSING');else{declaredOrder.push(row.ticker);if(tickers.has(row.ticker)) reasons.push(`REGISTRY_DUPLICATE_TICKER:${row.ticker}`);else tickers.add(row.ticker)}}
  if(canonicalize(declaredOrder)!==canonicalize([...declaredOrder].sort((a,b)=>a.localeCompare(b)))) reasons.push('REGISTRY_ROWS_NOT_SORTED');
  return Object.freeze({valid:reasons.length===0,reasons:[...new Set(reasons)].sort()});
}

export function createRegistryManifest(registry,{marketSession,universeVersion}={}){
  const validation=validateRegistrySnapshot(registry);if(!validation.valid) throw new Error(`INVALID_REGISTRY_SNAPSHOT:${validation.reasons.join('|')}`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(marketSession??''))) throw new Error('REGISTRY_MANIFEST_INVALID_SESSION');
  if(!universeVersion) throw new Error('REGISTRY_MANIFEST_UNIVERSE_VERSION_MISSING');
  const payload={schemaVersion:'egx-one-registry-manifest-1',registryVersion:registry.version,marketSession,universeVersion,total:registry.total,counts:registry.counts,rows:registry.rows};
  return Object.freeze({...payload,manifestHash:sha256(payload)});
}

export function verifyRegistryManifest(manifest){
  const reasons=[];if(!manifest||typeof manifest!=='object') return Object.freeze({valid:false,reasons:['REGISTRY_MANIFEST_NOT_OBJECT']});
  const {manifestHash,...payload}=manifest;if(!HEX64.test(String(manifestHash??''))||sha256(payload)!==manifestHash) reasons.push('REGISTRY_MANIFEST_HASH_MISMATCH');
  if(manifest.schemaVersion!=='egx-one-registry-manifest-1') reasons.push('REGISTRY_MANIFEST_SCHEMA_MISMATCH');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(manifest.marketSession??''))) reasons.push('REGISTRY_MANIFEST_INVALID_SESSION');
  if(!manifest.universeVersion) reasons.push('REGISTRY_MANIFEST_UNIVERSE_VERSION_MISSING');
  const snapshot={version:manifest.registryVersion,total:manifest.total,counts:manifest.counts,rows:manifest.rows},validation=validateRegistrySnapshot(snapshot);reasons.push(...validation.reasons);
  return Object.freeze({valid:reasons.length===0,reasons:[...new Set(reasons)].sort()});
}

export function registryRowMatchesManifest(manifest,row){const verified=verifyRegistryManifest(manifest);if(!verified.valid||!row?.ticker)return false;const expected=manifest.rows.find(x=>x.ticker===row.ticker);return Boolean(expected)&&canonicalize(expected)===canonicalize(row)}
