const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function compareDate(sourceDate, referenceDate) {
  if (!ISO_DATE.test(String(sourceDate ?? ''))) return 'UNKNOWN_REFERENCE_DATE';
  if (sourceDate === referenceDate) return 'ALIGNED';
  if (sourceDate < referenceDate) return 'STALE_REFERENCE_DATE';
  return 'FUTURE_REFERENCE_DATE';
}

export function analyzeFreshForwardSourceQuality(snapshot, {
  requiredSourceIds = ['v16', 'regime', 'triple', 'v20'],
} = {}) {
  const referenceDate = snapshot?.signalSessionDate ?? null;
  if (!ISO_DATE.test(String(referenceDate ?? ''))) throw new Error('INVALID_REFERENCE_DATE');

  const sourceAlignment = {};
  for (const id of requiredSourceIds) {
    const source = snapshot?.sources?.[id] ?? null;
    const sourceDate = source?.sessionDate ?? null;
    sourceAlignment[id] = {
      sourceDate,
      referenceDate,
      status: compareDate(sourceDate, referenceDate),
    };
  }

  const entries = Object.values(sourceAlignment);
  const staleSources = Object.entries(sourceAlignment)
    .filter(([, row]) => row.status === 'STALE_REFERENCE_DATE')
    .map(([id]) => id);
  const futureSources = Object.entries(sourceAlignment)
    .filter(([, row]) => row.status === 'FUTURE_REFERENCE_DATE')
    .map(([id]) => id);
  const unknownSources = Object.entries(sourceAlignment)
    .filter(([, row]) => row.status === 'UNKNOWN_REFERENCE_DATE')
    .map(([id]) => id);
  const alignedSources = Object.entries(sourceAlignment)
    .filter(([, row]) => row.status === 'ALIGNED')
    .map(([id]) => id);

  const lookaheadDetected = futureSources.length > 0;
  const degradedInputs = staleSources.length > 0 || unknownSources.length > 0;
  const allRequiredAligned = entries.length > 0 && entries.every((row) => row.status === 'ALIGNED');

  return {
    schemaVersion: 'egx.fresh-forward-source-quality.1',
    referenceDate,
    requiredSourceIds: [...requiredSourceIds],
    sourceAlignment,
    alignedSources,
    staleSources,
    futureSources,
    unknownSources,
    lookaheadDetected,
    degradedInputs,
    allRequiredAligned,
    operationalShadowEvidenceEligible: !lookaheadDetected,
    algorithmicAttributionEligible: allRequiredAligned && !lookaheadDetected,
    promotionEvidenceEligible: false,
    interpretation: lookaheadDetected
      ? 'INVALID_FOR_FORWARD_ATTRIBUTION_FUTURE_DATED_SOURCE'
      : degradedInputs
        ? 'VALID_OPERATIONAL_SHADOW_BUT_DEGRADED_INPUT_ATTRIBUTION'
        : 'ALIGNED_INPUT_SHADOW_EVIDENCE',
    note: 'Source quality is an attribution guard only. It does not change frozen signals, outcomes, weights, or production authority.',
  };
}
