import { sha256 } from './hash.js';
const HEX64=/^[0-9a-f]{64}$/i;
export const PHASES=Object.freeze({DATA:'PHASE_3_DATA_READINESS',BASELINE:'PHASE_4_BASELINE'});

export function fullUniverseReportHash(report){
  if(!report||typeof report!=='object') return null;
  const observationCertificateHashes=[...(report.observationCertificateHashes??[])].sort();
  return sha256({
    session:report.session,
    calendarVersion:report.calendarVersion,
    universeVersion:report.universeVersion,
    registryVersion:report.registryVersion,
    phase3:report.phase3,
    coverage:report.coverage,
    observationCertificateHashes
  });
}

export function verifyFullUniverseReport(fullUniverseReport){
  const reasons=[];
  if(!fullUniverseReport||typeof fullUniverseReport!=='object') return Object.freeze({valid:false,reasons:['FULL_UNIVERSE_REPORT_MISSING'],computedReportHash:null});
  if(fullUniverseReport.state!=='PASS') reasons.push(`FULL_UNIVERSE_REPORT:${fullUniverseReport.state??'MISSING'}`);
  if(fullUniverseReport.phase3?.phase!==PHASES.DATA) reasons.push(`SOURCE_PHASE:${fullUniverseReport.phase3?.phase??'MISSING'}`);
  if(fullUniverseReport.phase3?.verdict!=='PASS') reasons.push(`PHASE3_VERDICT:${fullUniverseReport.phase3?.verdict??'MISSING'}`);
  if(fullUniverseReport.phase3?.baselineAuthorized!==true) reasons.push('PHASE3_BASELINE_NOT_AUTHORIZED');
  for(const key of ['session','calendarVersion','universeVersion','registryVersion']) if(!fullUniverseReport[key]) reasons.push(`FULL_UNIVERSE_REPORT_MISSING:${key}`);
  if(!fullUniverseReport.coverage||typeof fullUniverseReport.coverage!=='object') reasons.push('FULL_UNIVERSE_REPORT_COVERAGE_MISSING');
  const observationCertificateHashes=fullUniverseReport.observationCertificateHashes??[];
  if(!Array.isArray(observationCertificateHashes)) reasons.push('INVALID_OBSERVATION_CERTIFICATE_HASHES');
  else for(const hash of observationCertificateHashes) if(!HEX64.test(String(hash??''))) reasons.push('INVALID_OBSERVATION_CERTIFICATE_HASH');
  const computedReportHash=fullUniverseReportHash(fullUniverseReport);
  if(!HEX64.test(String(fullUniverseReport.reportHash??''))) reasons.push('INVALID_SOURCE_REPORT_HASH');
  else if(computedReportHash!==fullUniverseReport.reportHash) reasons.push('SOURCE_REPORT_HASH_MISMATCH');
  return Object.freeze({valid:reasons.length===0,reasons:[...new Set(reasons)].sort(),computedReportHash});
}

export function issueBaselineAuthorization(fullUniverseReport){
  const verification=verifyFullUniverseReport(fullUniverseReport);
  if(!verification.valid) return Object.freeze({state:'DENIED',targetPhase:PHASES.BASELINE,reasons:verification.reasons,authorizationToken:null,sourceReportHash:fullUniverseReport?.reportHash??null});
  const payload={schemaVersion:'egx-one-phase-authorization-2',sourcePhase:PHASES.DATA,targetPhase:PHASES.BASELINE,sourceReportHash:fullUniverseReport.reportHash,session:fullUniverseReport.session,calendarVersion:fullUniverseReport.calendarVersion,universeVersion:fullUniverseReport.universeVersion,registryVersion:fullUniverseReport.registryVersion};
  return Object.freeze({...payload,state:'GRANTED',reasons:[],authorizationToken:sha256(payload)});
}

export function assertBaselineAuthorization(authorization,fullUniverseReport){
  if(!authorization||authorization.state!=='GRANTED') throw new Error('BASELINE_AUTHORIZATION_DENIED');
  const verification=verifyFullUniverseReport(fullUniverseReport);
  if(!verification.valid) throw new Error(`BASELINE_SOURCE_REPORT_INVALID:${verification.reasons.join('|')}`);
  if(authorization.targetPhase!==PHASES.BASELINE||authorization.sourcePhase!==PHASES.DATA) throw new Error('BASELINE_AUTHORIZATION_PHASE_MISMATCH');
  if(authorization.sourceReportHash!==fullUniverseReport.reportHash) throw new Error('BASELINE_AUTHORIZATION_REPORT_MISMATCH');
  for(const [key,reportKey] of [['session','session'],['calendarVersion','calendarVersion'],['universeVersion','universeVersion'],['registryVersion','registryVersion']])
    if(authorization[key]!==fullUniverseReport[reportKey]) throw new Error(`BASELINE_AUTHORIZATION_${key.toUpperCase()}_MISMATCH`);
  const payload={schemaVersion:authorization.schemaVersion,sourcePhase:authorization.sourcePhase,targetPhase:authorization.targetPhase,sourceReportHash:authorization.sourceReportHash,session:authorization.session,calendarVersion:authorization.calendarVersion,universeVersion:authorization.universeVersion,registryVersion:authorization.registryVersion};
  if(authorization.authorizationToken!==sha256(payload)) throw new Error('BASELINE_AUTHORIZATION_TAMPERED');
  return true;
}
