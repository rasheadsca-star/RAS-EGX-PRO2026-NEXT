'use strict';

// This only suppresses redundant source scans. Publication quality gates remain
// in their respective engines; MAIN APP readiness cannot certify Astra readiness.
function postCloseComplete({ today, hour, primary = {}, scan = {}, marker = {}, audit = {} }) {
  const sourceCoveragePct = Number(marker.sourceSessionEvidenceCoveragePct || 0);
  const canonicalCoveragePct = Number(audit?.health?.currentCanonicalCoveragePct || 0);
  const sourceComplete = Number(hour) >= 15
    && primary.currentSessionReady === true
    && primary.sessionDate === today
    && primary.basketPlan?.sourceSessionReady === true
    && scan.pagesPublishedSession === today
    && marker.final === true
    && marker.sourceReady === true
    && marker.executionGrade === true
    && marker.pagesPublished === true
    && marker.sessionDate === today
    && Number(marker.acceptedRows || 0) >= 200
    && sourceCoveragePct >= 90
    && canonicalCoveragePct >= 90;
  const fingerprint = String(marker.materialFingerprint || '');
  const head = String(marker.canonicalDataHead || '');
  const astraComplete = marker.sessionDate === today
    && audit.session?.decision === today
    && audit.session?.freshnessStatus === 'CURRENT'
    && /^[0-9a-f]{64}$/.test(fingerprint)
    && /^[0-9a-f]{40}$/.test(head)
    && audit.upstream?.mainAppMaterialFingerprint === fingerprint
    && audit.upstream?.canonicalDataHead === head;
  return { sourceComplete, astraComplete, sourceCoveragePct, canonicalCoveragePct, skip: sourceComplete && astraComplete };
}

module.exports = { postCloseComplete };
