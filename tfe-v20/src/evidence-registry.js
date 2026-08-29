export const ENGINE_EVIDENCE_REGISTRY = Object.freeze({
  V16_9: Object.freeze({
    id: 'V16_9',
    family: 'V16_9',
    label: 'MAIN APP V16.9.2',
    evidenceClass: 'EXACT_WALK_FORWARD',
    asOf: '2026-08-26',
    source: 'data/stable/v16-main-app-engine-performance.json',
    oos: Object.freeze({ entered: 55, targetHits: 22, stopHits: 21 }),
    limitations: Object.freeze(['20-session comparison window', 'daily OHLC same-bar ambiguity counted conservatively']),
    votingEligible: true,
  }),
  V19_V6: Object.freeze({
    id: 'V19_V6',
    family: 'V19',
    label: 'V19 V6',
    evidenceClass: 'REUSED_HOLDOUT',
    asOf: '2026-08-26',
    source: 'data/v19/target-stop-audit-v6.json',
    oos: Object.freeze({ entered: 52, targetHits: 18, stopHits: 22 }),
    limitations: Object.freeze(['holdout was reused during V19 development', 'diagnostic not fresh independent forward']),
    votingEligible: true,
  }),
  V20_NATIVE: Object.freeze({
    id: 'V20_NATIVE',
    family: 'TFE_V20',
    label: 'V20 Native',
    evidenceClass: 'RETROSPECTIVE_POINT_IN_TIME',
    asOf: '2026-08-18',
    source: 'data/v20/retrospective-walk-forward-target-stop.json',
    oos: Object.freeze({ entered: 15, targetHits: 7, stopHits: 2, avgNetPct: 0.7031 }),
    limitations: Object.freeze(['8 reconstructed sessions only', 'survivorship bias possible', 'not fresh forward']),
    votingEligible: true,
  }),
  TFE_CORE: Object.freeze({
    id: 'TFE_CORE',
    family: 'TFE_V20',
    label: 'TFE Core',
    evidenceClass: 'RETROSPECTIVE_POINT_IN_TIME',
    asOf: '2026-08-19',
    source: 'tfe-v20/src/ablation.js',
    oos: null,
    limitations: Object.freeze(['ablation framework exists but no immutable comparative output is registered yet']),
    votingEligible: true,
  }),
  GANN_FUSION_X: Object.freeze({
    id: 'GANN_FUSION_X',
    family: 'GANN',
    label: 'GANN Fusion X',
    evidenceClass: 'SNAPSHOT_CURRENT_ONLY',
    asOf: '2026-08-27',
    source: 'gann-fusion-x/data/forward-shadow-report.json',
    oos: null,
    limitations: Object.freeze(['forward shadow had one session and zero evaluated outcomes at snapshot time', 'historical comparison generator exists but immutable output is not registered']),
    votingEligible: true,
  }),
  SEPA_X: Object.freeze({
    id: 'SEPA_X',
    family: 'SEPA',
    label: 'SEPA-X',
    evidenceClass: 'PROXY_RECONSTRUCTION',
    asOf: '2026-08-27',
    source: 'gann-fusion-x/data/forward-shadow-report.json',
    oos: null,
    limitations: Object.freeze(['historical SEPA path is reconstructed proxy', 'forward shadow had zero evaluated outcomes at snapshot time']),
    votingEligible: true,
  }),
  TRIPLE_ENGINE: Object.freeze({
    id: 'TRIPLE_ENGINE',
    family: 'TRIPLE_COMPOSITE',
    label: 'Triple Engine Consensus',
    evidenceClass: 'SNAPSHOT_CURRENT_ONLY',
    asOf: '2026-08-27',
    source: 'triple-engine/data/current.json',
    oos: null,
    componentFamilies: Object.freeze(['V16_9', 'SEPA', 'GANN']),
    limitations: Object.freeze(['composite of constituent engines', 'must not receive an additional independent vote']),
    votingEligible: false,
  }),
});

const aliases = Object.freeze({
  MAIN_APP_V16_9: 'V16_9',
  V16_9_LIVE: 'V16_9',
  V19: 'V19_V6',
  V20: 'V20_NATIVE',
  TFE: 'TFE_CORE',
  GANN: 'GANN_FUSION_X',
  SEPA: 'SEPA_X',
  TRIPLE: 'TRIPLE_ENGINE',
});

export function canonicalExpertId(id = '') {
  const key = String(id).trim().toUpperCase();
  return aliases[key] ?? key;
}

export function enrichExpertWithEvidence(expert = {}) {
  const canonicalId = canonicalExpertId(expert.id ?? expert.name ?? '');
  const registry = ENGINE_EVIDENCE_REGISTRY[canonicalId] ?? null;
  if (!registry) return { ...expert, id: canonicalId || expert.id, registryMatched: false };
  return {
    ...expert,
    id: canonicalId,
    family: expert.family ?? registry.family,
    evidenceClass: expert.evidenceClass ?? registry.evidenceClass,
    oos: expert.oos ?? registry.oos ?? {},
    votingEligible: expert.votingEligible ?? registry.votingEligible,
    evidenceAsOf: registry.asOf,
    evidenceSource: registry.source,
    evidenceLimitations: registry.limitations,
    registryMatched: true,
  };
}

export function prepareMetaExperts(experts = []) {
  const enriched = (Array.isArray(experts) ? experts : []).filter(Boolean).map(enrichExpertWithEvidence);
  return {
    allExperts: enriched,
    votingExperts: enriched.filter((x) => x.votingEligible !== false),
    excludedCompositeExperts: enriched.filter((x) => x.votingEligible === false),
  };
}
