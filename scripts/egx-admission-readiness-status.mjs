import fs from 'node:fs';
import {assessEgxAdmissionReadiness} from '../src/egx-admission-readiness.js';

const path='data/research/egx-admission-readiness-2026-09-01.json';
const report=JSON.parse(fs.readFileSync(path,'utf8'));
const assessment=assessEgxAdmissionReadiness(report);
const output={
  schemaVersion:'egx-admission-readiness-status-1',
  source:path,
  asOfSession:report.asOfSession,
  state:assessment.state,
  verifiedCi:report.verifiedCi,
  researchProgress:assessment.researchProgress,
  prerequisiteGates:assessment.prerequisiteGates,
  readinessBlockers:assessment.readinessBlockers,
  authoritativePhase3Verdict:assessment.authoritativePhase3Verdict,
  authoritativePhase3Blockers:assessment.authoritativePhase3Blockers,
  phase3EvaluationEligible:assessment.phase3EvaluationEligible,
  productionAuthority:false,
  baselineAuthorized:false,
  phase4Open:false
};
console.log(JSON.stringify(output,null,2));
if(!assessment.invariantReady) process.exitCode=1;
