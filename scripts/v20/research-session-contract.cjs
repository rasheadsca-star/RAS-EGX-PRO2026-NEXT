'use strict';
// Research diagnostics require verified current research evidence. This contract
// never grants execution permission or substitutes research dates for price truth.
function researchSessionAligned(current, gate, truth, sr) {
  const session = current?.sessionDate;
  return /^\d{4}-\d{2}-\d{2}$/.test(session || '')
    && truth?.researchSessionVerified === true && truth.researchSessionDate === session
    && gate?.readiness?.researchReady === true
    && gate.executionInputs?.internal?.referenceSessionDate === session
    && sr?.referenceSessionDate === session
    && sr.researchReady === true && sr.researchSessionVerified === true;
}
module.exports = {researchSessionAligned};
