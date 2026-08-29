import { analyzeMetaOpportunity, rankMetaOpportunities } from './metaEngine.js';

const DEFAULT_V2_POLICY = Object.freeze({
  sharedResearchLineagePriorWeightCap: 0.25,
  sameUnderlyingMethodPriorWeightCap: 0,
  diagnosticPriorWeightCap: 0,
  riskOnlyPriorWeightCap: 0,
  requirePrimaryAlpha: true,
  requireExactSessionAlignment: true,
  minimumFreshIndependentFamiliesForPromotion: 2
});

const ROLE = Object.freeze({
  PRIMARY_ALPHA: 'PRIMARY_ALPHA',
  CONFIRMATORY_ALPHA: 'CONFIRMATORY_ALPHA',
  DIAGNOSTIC_ONLY: 'DIAGNOSTIC_ONLY',
  RISK_ONLY: 'RISK_ONLY'
});

const LINEAGE = Object.freeze({
  INDEPENDENT: 'INDEPENDENT',
  SHARED_RESEARCH_LINEAGE: 'SHARED_RESEARCH_LINEAGE',
  SAME_UNDERLYING_METHOD: 'SAME_UNDERLYING_METHOD',
  UNVERIFIED: 'UNVERIFIED'
});

function finite(v, fallback = null) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function upper(v, fallback = '') {
  const s = String(v ?? fallback).trim();
  return s ? s.toUpperCase() : fallback;
}

function exactSessionAligned(engine, signalDate) {
  if (!signalDate) return engine.sessionAligned !== false;
  const engineDate = String(engine.signalDate || engine.sessionDate || '').slice(0, 10);
  return engine.sessionAligned !== false && Boolean(engineDate) && engineDate === String(signalDate).slice(0, 10);
}

function canonicalLineageFamily(engine, role, lineage) {
  if (lineage === LINEAGE.SHARED_RESEARCH_LINEAGE || lineage === LINEAGE.SAME_UNDERLYING_METHOD) {
    return `LINEAGE:${String(engine.lineageGroup || 'V16_RESEARCH_LINEAGE')}`;
  }
  if (role === ROLE.PRIMARY_ALPHA && upper(engine.id).includes('V16')) {
    return `LINEAGE:${String(engine.lineageGroup || 'V16_RESEARCH_LINEAGE')}`;
  }
  return String(engine.family || engine.id || 'UNVERIFIED_FAMILY');
}

function preparedPriorWeight(engine, role, lineage, policy) {
  const requested = Math.max(0, finite(engine.priorWeight, 1));
  if (role === ROLE.DIAGNOSTIC_ONLY) return Math.min(requested, policy.diagnosticPriorWeightCap);
  if (role === ROLE.RISK_ONLY) return Math.min(requested, policy.riskOnlyPriorWeightCap);
  if (lineage === LINEAGE.SAME_UNDERLYING_METHOD) return Math.min(requested, policy.sameUnderlyingMethodPriorWeightCap);
  if (lineage === LINEAGE.SHARED_RESEARCH_LINEAGE) return Math.min(requested, policy.sharedResearchLineagePriorWeightCap);
  return requested;
}

function riskOnlyPenalty(engine) {
  if (upper(engine.role) !== ROLE.RISK_ONLY) return 0;
  return Math.max(0, finite(engine.riskPenalty, finite(engine.penalty, 0)));
}

function isFreshIndependent(engine, signalDate) {
  const role = upper(engine.role, ROLE.CONFIRMATORY_ALPHA);
  const lineage = upper(engine.lineageStatus, LINEAGE.UNVERIFIED);
  const evidence = upper(engine.evidenceClass, 'UNVERIFIED');
  if (![ROLE.PRIMARY_ALPHA, ROLE.CONFIRMATORY_ALPHA].includes(role)) return false;
  if (lineage !== LINEAGE.INDEPENDENT) return false;
  if (!exactSessionAligned(engine, signalDate)) return false;
  return ['FRESH_FORWARD_INDEPENDENT', 'WALK_FORWARD_POINT_IN_TIME'].includes(evidence);
}

export function analyzeMetaOpportunityV2(input, customPolicy = {}) {
  const policy = { ...DEFAULT_V2_POLICY, ...customPolicy };
  const engines = Array.isArray(input?.engines) ? input.engines : [];
  const signalDate = input?.signalDate || null;
  const primary = engines.filter(engine => upper(engine.role, ROLE.CONFIRMATORY_ALPHA) === ROLE.PRIMARY_ALPHA);
  const riskPenaltyFromModifiers = engines.reduce((sum, engine) => sum + riskOnlyPenalty(engine), 0);

  const lineageAudit = [];
  const prepared = [];
  for (const engine of engines) {
    const role = upper(engine.role, ROLE.CONFIRMATORY_ALPHA);
    const lineage = upper(engine.lineageStatus, LINEAGE.UNVERIFIED);
    const sessionAligned = exactSessionAligned(engine, signalDate);
    let priorWeight = preparedPriorWeight(engine, role, lineage, policy);
    const exclusionReasons = [];

    if (policy.requireExactSessionAlignment && !sessionAligned) {
      priorWeight = 0;
      exclusionReasons.push('SESSION_NOT_ALIGNED');
    }
    if (role === ROLE.DIAGNOSTIC_ONLY) exclusionReasons.push('DIAGNOSTIC_ZERO_ALPHA_WEIGHT');
    if (role === ROLE.RISK_ONLY) exclusionReasons.push('RISK_ONLY_ZERO_ALPHA_WEIGHT');
    if (lineage === LINEAGE.SAME_UNDERLYING_METHOD) exclusionReasons.push('SAME_UNDERLYING_METHOD_ZERO_INDEPENDENCE');
    if (lineage === LINEAGE.SHARED_RESEARCH_LINEAGE) exclusionReasons.push('SHARED_RESEARCH_LINEAGE_CAPPED');

    lineageAudit.push({
      id: String(engine.id || 'UNKNOWN'),
      role,
      lineageStatus: lineage,
      sessionAligned,
      alphaPriorWeight: priorWeight,
      exclusionReasons
    });

    if (priorWeight <= 0) continue;
    prepared.push({
      ...engine,
      priorWeight,
      freshness: sessionAligned ? finite(engine.freshness, 1) : 0,
      family: canonicalLineageFamily(engine, role, lineage)
    });
  }

  const v1 = analyzeMetaOpportunity({
    ...input,
    engines: prepared,
    riskPenalty: Math.max(0, finite(input?.riskPenalty, 0)) + riskPenaltyFromModifiers
  }, customPolicy);

  const governanceBlocking = [];
  if (policy.requirePrimaryAlpha && !primary.length) governanceBlocking.push('PRIMARY_ALPHA_MISSING');
  if (policy.requirePrimaryAlpha && primary.length && !primary.some(engine => exactSessionAligned(engine, signalDate))) {
    governanceBlocking.push('PRIMARY_ALPHA_STALE_OR_MISALIGNED');
  }

  const freshIndependentFamilies = new Set(
    engines
      .filter(engine => isFreshIndependent(engine, signalDate))
      .map(engine => canonicalLineageFamily(engine, upper(engine.role), upper(engine.lineageStatus)))
  );

  let decision = v1.decision;
  if (governanceBlocking.length) decision = 'NO_TRADE';

  const promotionEligible = decision === 'BUY'
    && governanceBlocking.length === 0
    && freshIndependentFamilies.size >= policy.minimumFreshIndependentFamiliesForPromotion;

  return {
    ...v1,
    decision,
    gates: {
      ...v1.gates,
      blocking: [...new Set([...(v1.gates?.blocking || []), ...governanceBlocking])],
      freshIndependentFamilyCount: freshIndependentFamilies.size,
      riskOnlyPenalty: riskPenaltyFromModifiers
    },
    lineageAudit,
    governance: {
      version: 'META_ENGINE_V2_RESEARCH',
      primaryAlphaRequired: policy.requirePrimaryAlpha,
      promotionEligible,
      promotionReason: promotionEligible
        ? 'BUY_WITH_AT_LEAST_TWO_FRESH_INDEPENDENT_FAMILIES'
        : 'RESEARCH_ONLY_UNTIL_FRESH_INDEPENDENT_EVIDENCE_PASSES',
      v19Treatment: 'CONFIRMATORY_SHARED_RESEARCH_LINEAGE_NOT_SECOND_INDEPENDENT_FAMILY',
      gannTreatment: 'DIAGNOSTIC_ONLY_ZERO_ALPHA_WEIGHT',
      sepaTreatment: 'DIAGNOSTIC_ONLY_ZERO_ALPHA_WEIGHT',
      fundamentalsNewsTreatment: 'RISK_ONLY_NEVER_POSITIVE_ALPHA'
    }
  };
}

export function rankMetaOpportunitiesV2(items) {
  return rankMetaOpportunities(items);
}

export const META_ENGINE_V2_ROLE = ROLE;
export const META_ENGINE_V2_LINEAGE = LINEAGE;
