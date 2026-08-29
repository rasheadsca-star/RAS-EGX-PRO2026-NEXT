import { evaluateMetaCandidate, rankMetaCandidates } from './meta-engine.js';
import { prepareMetaExperts } from './evidence-registry.js';

export function evaluateRegisteredMetaCandidate(candidate = {}) {
  const prepared = prepareMetaExperts(candidate.experts ?? []);
  const result = evaluateMetaCandidate({ ...candidate, experts: prepared.votingExperts });
  return {
    ...result,
    evidenceRegistry: {
      suppliedExperts: prepared.allExperts.length,
      votingExperts: prepared.votingExperts.map((x) => x.id),
      excludedCompositeExperts: prepared.excludedCompositeExperts.map((x) => x.id),
      unmatchedExperts: prepared.allExperts.filter((x) => x.registryMatched === false).map((x) => x.id),
    },
  };
}

export function rankRegisteredMetaCandidates(candidates = []) {
  // Use the canonical registry-backed evaluator before sorting. Never rank raw expert payloads directly.
  const evaluated = candidates.map(evaluateRegisteredMetaCandidate);
  const priority = Object.freeze({ BUY: 4, READY: 3, WATCH: 2, NO_TRADE: 1 });
  return evaluated.sort((a, b) =>
    (priority[b.decision] ?? 0) - (priority[a.decision] ?? 0)
    || b.edgeScore - a.edgeScore
    || b.confidence - a.confidence
    || (b.context.structuralNetRR ?? 0) - (a.context.structuralNetRR ?? 0)
    || a.ticker.localeCompare(b.ticker)
  ).map((x, i) => ({ ...x, rank: i + 1 }));
}

export const rawMetaRankerForTestsOnly = rankMetaCandidates;
