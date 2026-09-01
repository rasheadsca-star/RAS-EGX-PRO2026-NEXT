import { sha256,canonicalize } from './hash.js';
import { buildAuthoritativeUniverse,canonicalTicker } from './universe-authority.js';
const HEX64=/^[0-9a-f]{64}$/i;

function snapshotChecks(snapshot){
  const reasons=[],manifest=snapshot?.manifest,certificate=snapshot?.universeExtractionCertificate,evidence=snapshot?.evidence,rawUniverseRows=snapshot?.certifiedUniverseRows;
  if(snapshot?.state!=='READY'||!manifest) reasons.push('CERTIFIED_SNAPSHOT_NOT_READY');
  if(!Array.isArray(evidence)) reasons.push('CERTIFIED_SNAPSHOT_EVIDENCE_MISSING');
  if(!Array.isArray(rawUniverseRows)) reasons.push('CERTIFIED_SNAPSHOT_UNIVERSE_ROWS_MISSING');
  if(manifest){const{manifestHash,...body}=manifest;if(!HEX64.test(String(manifestHash??''))||sha256(body)!==manifestHash)reasons.push('CERTIFIED_SNAPSHOT_MANIFEST_HASH_MISMATCH');if(manifest.exhaustive!==true)reasons.push('CERTIFIED_SNAPSHOT_NOT_EXHAUSTIVE');if(manifest.declaredTotal!==manifest.equityRows)reasons.push('CERTIFIED_SNAPSHOT_DECLARED_TOTAL_MISMATCH');if(Array.isArray(evidence)&&manifest.equityRows!==evidence.length)reasons.push('CERTIFIED_SNAPSHOT_EVIDENCE_COUNT_MISMATCH')}
  if(!certificate) reasons.push('UNIVERSE_EXTRACTION_CERTIFICATE_MISSING');
  else{const{certificateHash,...body}=certificate;if(certificate.certificateKind!=='EGX_UNIVERSE_EXTRACTION_CERTIFICATE')reasons.push('UNIVERSE_EXTRACTION_CERTIFICATE_KIND_MISMATCH');if(!HEX64.test(String(certificateHash??''))||sha256(body)!==certificateHash)reasons.push('UNIVERSE_EXTRACTION_CERTIFICATE_HASH_MISMATCH');if(manifest&&certificateHash!==manifest.universeCertificateHash)reasons.push('SNAPSHOT_CERTIFICATE_HASH_MISMATCH');if(Array.isArray(rawUniverseRows)){if(certificate.universeRowCount!==rawUniverseRows.length)reasons.push('CERTIFIED_UNIVERSE_RAW_ROW_COUNT_MISMATCH');if(certificate.universeOutputHash!==sha256(rawUniverseRows))reasons.push('CERTIFIED_UNIVERSE_RAW_ROWS_HASH_MISMATCH')}}
  if(manifest&&Array.isArray(evidence))for(const row of evidence){if(row.universeCertificateHash!==manifest.universeCertificateHash)reasons.push(`UNIVERSE_EVIDENCE_CERTIFICATE_MISMATCH:${row.ticker??'UNKNOWN'}`);if(row.sourceReceiptHash!==manifest.sourceReceiptHash)reasons.push(`UNIVERSE_EVIDENCE_RECEIPT_MISMATCH:${row.ticker??'UNKNOWN'}`);if(row.scopeProofHash!==manifest.scopeProofHash)reasons.push(`UNIVERSE_EVIDENCE_SCOPE_MISMATCH:${row.ticker??'UNKNOWN'}`);if(row.sourceHash!==manifest.sourceHash||row.sourceId!==manifest.sourceId||row.sourceUrl!==manifest.sourceUrl)reasons.push(`UNIVERSE_EVIDENCE_SOURCE_MISMATCH:${row.ticker??'UNKNOWN'}`)}
  if(Array.isArray(evidence)&&Array.isArray(rawUniverseRows)){const rawKeys=new Set(rawUniverseRows.map(x=>`${canonicalTicker(x.ticker??x.reutersCode)}|${String(x.isin??'').trim().toUpperCase()}`));for(const row of evidence)if(!rawKeys.has(`${canonicalTicker(row.ticker)}|${String(row.isin??'').trim().toUpperCase()}`))reasons.push(`UNIVERSE_EVIDENCE_RAW_ROW_MISMATCH:${row.ticker??'UNKNOWN'}`)}
  return{reasons:[...new Set(reasons)].sort(),manifest,certificate,evidence,rawUniverseRows};
}

export function certifyUniverseAuthority(snapshot){
  const checked=snapshotChecks(snapshot);if(checked.reasons.length)return Object.freeze({state:'BLOCKED',reasons:checked.reasons,universe:null});
  const universe=buildAuthoritativeUniverse(checked.evidence,{asOfDate:checked.manifest.asOfDate,declaredTotal:checked.manifest.declaredTotal,requireSnapshot:true});
  if(universe.state!=='READY')return Object.freeze({state:'BLOCKED',reasons:[`AUTHORITATIVE_UNIVERSE:${universe.state}`,...(universe.reasons??[])],universe:null});
  const authorityInputs={snapshotManifest:checked.manifest,universeExtractionCertificate:checked.certificate,certifiedUniverseRows:checked.rawUniverseRows,officialEvidence:checked.evidence};
  const proofBody={schemaVersion:'egx-one-certified-universe-authority-1',authorityMode:'CERTIFIED_PRODUCTION',universeVersion:universe.version,asOfDate:universe.asOfDate,total:universe.total,snapshotManifestHash:checked.manifest.manifestHash,universeExtractionCertificateHash:checked.certificate.certificateHash,sourceReceiptHash:checked.manifest.sourceReceiptHash,scopeProofHash:checked.manifest.scopeProofHash,certifiedUniverseRowsHash:sha256(checked.rawUniverseRows),officialEvidenceHash:sha256(checked.evidence),universeRowsHash:sha256(universe.rows),sourceManifestHash:universe.sourceManifest.manifestHash};
  const authorityProof={...proofBody,authorityProofHash:sha256(proofBody)};
  return Object.freeze({state:'CERTIFIED',reasons:[],universe:Object.freeze({...universe,authorityMode:'CERTIFIED_PRODUCTION',authorityInputs:Object.freeze(authorityInputs),authorityProof:Object.freeze(authorityProof)})});
}

export function verifyCertifiedUniverseAuthority(universe){
  const reasons=[];
  if(!universe||universe.state!=='READY'||universe.authorityMode!=='CERTIFIED_PRODUCTION')return{state:'BLOCKED',reasons:['CERTIFIED_UNIVERSE_NOT_READY']};
  const inputs=universe.authorityInputs;
  if(!inputs)return{state:'BLOCKED',reasons:['CERTIFIED_UNIVERSE_AUTHORITY_INPUTS_MISSING']};
  const rebuilt=certifyUniverseAuthority({state:'READY',manifest:inputs.snapshotManifest,universeExtractionCertificate:inputs.universeExtractionCertificate,certifiedUniverseRows:inputs.certifiedUniverseRows,evidence:inputs.officialEvidence});
  if(rebuilt.state!=='CERTIFIED'||!rebuilt.universe)return{state:'BLOCKED',reasons:['CERTIFIED_UNIVERSE_REBUILD_FAILED',...(rebuilt.reasons??[])]};
  for(const key of ['version','asOfDate','total'])if(rebuilt.universe[key]!==universe[key])reasons.push(`CERTIFIED_UNIVERSE_${key.toUpperCase()}_MISMATCH`);
  if(canonicalize(rebuilt.universe.rows)!==canonicalize(universe.rows))reasons.push('CERTIFIED_UNIVERSE_ROWS_MISMATCH');
  if(canonicalize(rebuilt.universe.sourceManifest)!==canonicalize(universe.sourceManifest))reasons.push('CERTIFIED_UNIVERSE_SOURCE_MANIFEST_MISMATCH');
  if(canonicalize(rebuilt.universe.authorityProof)!==canonicalize(universe.authorityProof))reasons.push('CERTIFIED_UNIVERSE_AUTHORITY_PROOF_MISMATCH');
  return{state:reasons.length?'BLOCKED':'READY',reasons:[...new Set(reasons)].sort()};
}
