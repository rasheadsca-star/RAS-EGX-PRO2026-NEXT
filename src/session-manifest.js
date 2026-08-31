import { sha256 } from './hash.js';

export const SESSION_AUTHORITY_MODES=Object.freeze({RESEARCH:'RESEARCH',CERTIFIED_PRODUCTION:'CERTIFIED_PRODUCTION'});
const AUTHORITY_MODES=new Set(Object.values(SESSION_AUTHORITY_MODES));
const REQUIRED=['marketSession','authorityMode','exchangeCalendarVersion','universeVersion','rawDataVersion','normalizedDataVersion','sourceManifest','corporateActionVersion','fundamentalsCutoff','featureVersion','modelVersion','engineVersion','configVersion','commitHash','generatedAt'];

function normalize(input){
  const manifest=structuredClone(input??{});
  manifest.authorityMode=String(manifest.authorityMode??SESSION_AUTHORITY_MODES.RESEARCH).trim().toUpperCase();
  return manifest;
}

export function createSessionManifest(input){
  const manifest=normalize(input);
  for(const key of REQUIRED){if(manifest[key]===undefined||manifest[key]===null||manifest[key]==='')throw new Error(`manifest_missing:${key}`)}
  if(!AUTHORITY_MODES.has(manifest.authorityMode))throw new Error(`manifest_invalid:authorityMode:${manifest.authorityMode}`);
  manifest.snapshotHash=sha256(manifest);
  return Object.freeze(manifest);
}

export function validateSessionManifest(m){
  if(!m||typeof m!=='object')return{valid:false,errors:['manifest_not_object']};
  const errors=REQUIRED.filter(k=>m[k]===undefined||m[k]===null||m[k]==='').map(k=>`manifest_missing:${k}`);
  if(m.authorityMode&&!AUTHORITY_MODES.has(String(m.authorityMode).trim().toUpperCase()))errors.push(`manifest_invalid:authorityMode:${m.authorityMode}`);
  if(!m.snapshotHash)errors.push('manifest_missing:snapshotHash');
  else{const{snapshotHash,...rest}=m;if(sha256(rest)!==snapshotHash)errors.push('snapshot_hash_mismatch')}
  return{valid:errors.length===0,errors};
}
