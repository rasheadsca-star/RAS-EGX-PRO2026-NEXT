import { sha256 } from './hash.js';
const HEX64=/^[0-9a-f]{64}$/i;
export const PHASES=Object.freeze({DATA:'PHASE_3_DATA_READINESS',BASELINE:'PHASE_4_BASELINE'});

export function issueBaselineAuthorization(fullUniverseReport){
  const reasons=[];
  if(!fullUniverseReport||fullUniverseReport.state!=='PASS') reasons.push(`FULL_UNIVERSE_REPORT:${fullUniverseReport?.state??'MISSING'}`);
  if(fullUniverseReport?.phase3?.phase!==PHASES.DATA) reasons.push(`SOURCE_PHASE:${fullUniverseReport?.phase3?.phase??'MISSING'}`);
  if(fullUniverseReport?.phase3?.verdict!=='PASS') reasons.push(`PHASE3_VERDICT:${fullUniverseReport?.phase3?.verdict??'MISSING'}`);
  if(fullUniverseReport?.phase3?.baselineAuthorized!==true) reasons.push('PHASE3_BASELINE_NOT_AUTHORIZED');
  if(!HEX64.test(String(fullUniverseReport?.reportHash??''))) reasons.push('INVALID_SOURCE_REPORT_HASH');
  if(reasons.length) return Object.freeze({state:'DENIED',targetPhase:PHASES.BASELINE,reasons:[...new Set(reasons)].sort(),authorizationToken:null,sourceReportHash:fullUniverseReport?.reportHash??null});
  const payload={schemaVersion:'egx-one-phase-authorization-1',sourcePhase:PHASES.DATA,targetPhase:PHASES.BASELINE,sourceReportHash:fullUniverseReport.reportHash,session:fullUniverseReport.session,calendarVersion:fullUniverseReport.calendarVersion,universeVersion:fullUniverseReport.universeVersion,registryVersion:fullUniverseReport.registryVersion};
  return Object.freeze({...payload,state:'GRANTED',reasons:[],authorizationToken:sha256(payload)});
}

export function assertBaselineAuthorization(authorization,fullUniverseReport){
  if(!authorization||authorization.state!=='GRANTED') throw new Error('BASELINE_AUTHORIZATION_DENIED');
  if(authorization.targetPhase!==PHASES.BASELINE||authorization.sourcePhase!==PHASES.DATA) throw new Error('BASELINE_AUTHORIZATION_PHASE_MISMATCH');
  if(authorization.sourceReportHash!==fullUniverseReport?.reportHash) throw new Error('BASELINE_AUTHORIZATION_REPORT_MISMATCH');
  const payload={schemaVersion:authorization.schemaVersion,sourcePhase:authorization.sourcePhase,targetPhase:authorization.targetPhase,sourceReportHash:authorization.sourceReportHash,session:authorization.session,calendarVersion:authorization.calendarVersion,universeVersion:authorization.universeVersion,registryVersion:authorization.registryVersion};
  if(authorization.authorizationToken!==sha256(payload)) throw new Error('BASELINE_AUTHORIZATION_TAMPERED');
  if(fullUniverseReport?.state!=='PASS'||fullUniverseReport?.phase3?.verdict!=='PASS'||fullUniverseReport?.phase3?.baselineAuthorized!==true) throw new Error('BASELINE_SOURCE_REPORT_NOT_PASSING');
  return true;
}
