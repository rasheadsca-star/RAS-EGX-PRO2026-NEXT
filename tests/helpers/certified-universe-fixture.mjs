import assert from'node:assert/strict';
import{sha256}from'../../src/hash.js';
import{adaptEgxListedSnapshot,classifyEgxSecurity}from'../../src/egx-official-adapter.js';
import{admitOfficialArtifact,bindExtractionManifest}from'../../src/official-artifact-admission.js';
import{validateSchemaAttestation}from'../../src/schema-attestation.js';
import{certifyUniverseAuthority}from'../../src/certified-universe-authority.js';

export function certifiedUniverseFixture(db,{session='2026-08-31',ticker='ABUK',isin='EGS38191C010',companyName='Abu Qir Fertilizers'}={}){
  const rows=[{ticker,reutersCode:`${ticker}.CA`,isin,companyName,segment:'MAIN',status:'ACTIVE',effectiveDate:session}];
  const bytes=Buffer.from(`%PDF-1.4\nEGX CERTIFIED UNIVERSE FIXTURE ${ticker}\n`),sourceHash=sha256(bytes),sourceUrl=`https://egx.com.eg/downloads/Bulletins/certified-${ticker.toLowerCase()}.pdf`;
  const sourceReceipt={sourceId:'EGX_BULLETIN',sourceClass:'OFFICIAL_EXCHANGE',providerGroup:'EGX',sourceUrl,session,capturedAt:`${session}T15:10:00+03:00`,provenanceKind:'OFFICIAL_DIRECT_FILE',contentHash:sourceHash};
  const artifact={artifactKind:'DAILY_BULLETIN_PDF',mimeType:'application/pdf',sourceUrl,session,byteLength:bytes.length,contentHash:sourceHash};
  const admission=admitOfficialArtifact({artifact,rawBytes:bytes,sourceReceipt});assert.equal(admission.state,'READY_FOR_SCHEMA_VALIDATION');
  const extraction=bindExtractionManifest(admission,{extractorId:'egx-bulletin-parser',extractorVersion:'0.1.0',schemaId:'EGX_VERIFIED_SCHEMA_TEST_V1',rowCount:rows.length,extractedOutput:rows,sourceAdmissionHash:admission.admissionHash});
  const schemaResult=validateSchemaAttestation({admission,extraction,extractedOutput:rows,attestation:{state:'VERIFIED',sourceAdmissionHash:admission.admissionHash,extractionManifestHash:extraction.manifest.manifestHash,schemaId:extraction.manifest.schemaId,schemaDefinitionHash:'d'.repeat(64),verificationEvidenceHash:'e'.repeat(64),semanticFields:['ISIN','SECURITY_CODE','ASSET_CLASS','LISTING_STATUS']},requiredSemanticFields:['ISIN','SECURITY_CODE','ASSET_CLASS','LISTING_STATUS']});assert.equal(schemaResult.state,'READY_FOR_SCOPE_VALIDATION');
  const universeRows=rows.filter(x=>classifyEgxSecurity(x)==='EQUITY'),scopeAttestation={state:'VERIFIED',scope:'ALL_LISTED_EQUITIES',declaredTotal:universeRows.length,evidenceLocator:'document-header:all-listed-equities',sourceAdmissionHash:admission.admissionHash,extractionManifestHash:extraction.manifest.manifestHash,schemaAttestationHash:schemaResult.attestation.attestationHash,scopeDefinitionHash:'1'.repeat(64),verificationEvidenceHash:'2'.repeat(64)};
  const snapshot=adaptEgxListedSnapshot(rows,{evidenceType:'OFFICIAL_DAILY_BULLETIN',exhaustive:true,asOfDate:session,declaredTotal:universeRows.length,artifact,rawBytes:bytes,sourceReceipt,extraction,schemaAttestation:schemaResult.attestation,scopeAttestation});assert.equal(snapshot.state,'READY');
  const certified=certifyUniverseAuthority(snapshot);assert.equal(certified.state,'CERTIFIED');assert.equal(certified.universe.state,'READY');
  if(db)db.putCertifiedUniverse(certified.universe,{createdAt:`${session}T15:11:00+03:00`});
  return{snapshot,universe:certified.universe};
}
