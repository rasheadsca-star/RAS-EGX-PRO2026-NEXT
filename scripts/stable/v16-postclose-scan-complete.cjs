'use strict';

// This only suppresses redundant source scans. Publication quality gates remain
// in their respective engines; MAIN APP readiness cannot certify Astra readiness.
function postCloseComplete({ today, hour, primary = {}, scan = {}, marker = {}, audit = {} }) {
  const sourceComplete = Number(hour) >= 15
    && primary.currentSessionReady === true
    && primary.sessionDate === today
    && primary.basketPlan?.sourceSessionReady === true
    && scan.pagesPublishedSession === today;
  const fingerprint = String(marker.materialFingerprint || '');
  const head = String(marker.canonicalDataHead || '');
  const astraComplete = marker.sessionDate === today
    && audit.session?.decision === today
    && audit.session?.freshnessStatus === 'CURRENT'
    && /^[0-9a-f]{64}$/.test(fingerprint)
    && /^[0-9a-f]{40}$/.test(head)
    && audit.upstream?.mainAppMaterialFingerprint === fingerprint
    && audit.upstream?.canonicalDataHead === head;
  return { sourceComplete, astraComplete, skip: sourceComplete && astraComplete };
}

module.exports = { postCloseComplete };
