import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const reportPath = path.join(cwd, 'reports', 'v16-loss-anatomy-audit.json');
if (!fs.existsSync(reportPath)) throw new Error('LOSS_ANATOMY_REPORT_MISSING');

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const diagnostics = new Map((report.featureDiagnostics || []).map(x => [x.feature, x]));

function finite(v) { return Number.isFinite(v); }
function relError(value, expected) {
  return finite(value) && expected !== 0 ? Math.abs(value - expected) / Math.abs(expected) : Infinity;
}
function round(v, d = 6) { return finite(v) ? Number(v.toFixed(d)) : null; }
function boundaryRatio(numeratorFeature, denominatorFeature, boundary) {
  const n = diagnostics.get(numeratorFeature)?.boundaries?.[boundary];
  const d = diagnostics.get(denominatorFeature)?.boundaries?.[boundary];
  return finite(n) && finite(d) && d !== 0 ? n / d : null;
}

// V16 target-hit audit constructs recommendation geometry from a shared ATR:
// entry width = 0.16*ATR, stop distance = 0.90*ATR, target distance = 1.20*ATR.
// If anatomy recomputes ATR independently, all three normalized features can move together
// because of a latent ATR-ratio/rounding mismatch. That is not an independent decision variable.
const expectedStopToWidth = 0.90 / 0.16; // 5.625
const expectedTargetToWidth = 1.20 / 0.16; // 7.5
const ratioTolerance = 0.05;
const maxStructuralRRTertileSpread = 0.01;

const ratios = {
  stopToWidthQ33: boundaryRatio('stopDistanceAtr', 'entryZoneWidthAtr', 'q33'),
  stopToWidthQ67: boundaryRatio('stopDistanceAtr', 'entryZoneWidthAtr', 'q67'),
  targetToWidthQ33: boundaryRatio('targetDistanceAtr', 'entryZoneWidthAtr', 'q33'),
  targetToWidthQ67: boundaryRatio('targetDistanceAtr', 'entryZoneWidthAtr', 'q67')
};
const rrQ33 = diagnostics.get('structuralRR')?.boundaries?.q33;
const rrQ67 = diagnostics.get('structuralRR')?.boundaries?.q67;
const rrTertileSpread = finite(rrQ33) && finite(rrQ67) ? Math.abs(rrQ67 - rrQ33) : null;

const ratioChecks = {
  stopToWidthQ33NearFormula: relError(ratios.stopToWidthQ33, expectedStopToWidth) <= ratioTolerance,
  stopToWidthQ67NearFormula: relError(ratios.stopToWidthQ67, expectedStopToWidth) <= ratioTolerance,
  targetToWidthQ33NearFormula: relError(ratios.targetToWidthQ33, expectedTargetToWidth) <= ratioTolerance,
  targetToWidthQ67NearFormula: relError(ratios.targetToWidthQ67, expectedTargetToWidth) <= ratioTolerance,
  structuralRREffectivelyConstant: finite(rrTertileSpread) && rrTertileSpread <= maxStructuralRRTertileSpread
};
const geometryFormulaDerivedDegeneracy = Object.values(ratioChecks).every(Boolean);

const guard = {
  name: 'GEOMETRY_FORMULA_DERIVED_DEGENERACY',
  addedAfterDestructiveReview: true,
  purpose: 'Validity/identity correction only; does not change outcomes, bins, feature values, or optimize a performance threshold.',
  sourceIdentity: {
    entryZoneWidthAtrFormula: '0.16 * original V16 ATR, then divided by independently recomputed anatomy ATR',
    stopDistanceAtrFormula: '0.90 * original V16 ATR, then divided by independently recomputed anatomy ATR',
    targetDistanceAtrFormula: '1.20 * original V16 ATR, then divided by independently recomputed anatomy ATR',
    structuralRRFormula: 'approximately 1.20 / 0.90 = 1.3333 before rounding'
  },
  expectedRatios: {
    stopDistanceToEntryWidth: expectedStopToWidth,
    targetDistanceToEntryWidth: expectedTargetToWidth
  },
  observed: {
    ...Object.fromEntries(Object.entries(ratios).map(([k, v]) => [k, round(v)])),
    structuralRRQ33: round(rrQ33),
    structuralRRQ67: round(rrQ67),
    structuralRRTertileSpread: round(rrTertileSpread)
  },
  tolerances: {
    relativeRatioTolerance: ratioTolerance,
    maxStructuralRRTertileSpread
  },
  checks: ratioChecks,
  triggered: geometryFormulaDerivedDegeneracy,
  treatment: geometryFormulaDerivedDegeneracy
    ? 'EXCLUDE_GEOMETRY_FROM_NEW_CANDIDATE_ELIGIBILITY_KEEP_DIAGNOSTIC_ONLY'
    : 'NO_GEOMETRY_DEGENERACY_EXCLUSION'
};

report.governance = report.governance || {};
report.governance.postDestructiveReviewValidityCorrection = true;
report.familyGuards = report.familyGuards || {};
report.familyGuards.geometryFormulaDerivedDegeneracy = guard;

for (const item of report.featureDiagnostics || []) {
  if (item.family === 'GEOMETRY' && geometryFormulaDerivedDegeneracy) {
    item.candidateEligibility = false;
    item.candidateExclusionReason = 'FORMULA_DERIVED_DEGENERACY_SHARED_V16_ATR_CONSTRUCTION';
    if (item.status === 'STABLE_DIAGNOSTIC_PATTERN') item.status = 'STABLE_BUT_FORMULA_DERIVED_ARTIFACT';
  } else {
    item.candidateEligibility = item.status === 'STABLE_DIAGNOSTIC_PATTERN' && !item.familyLockedByPriorRejectedExperiment;
  }
}

report.stablePatterns = (report.featureDiagnostics || [])
  .filter(x => x.status === 'STABLE_DIAGNOSTIC_PATTERN' || x.status === 'STABLE_BUT_FORMULA_DERIVED_ARTIFACT')
  .map(x => ({
    feature: x.feature,
    family: x.family,
    locked: Boolean(x.familyLockedByPriorRejectedExperiment),
    candidateEligibility: Boolean(x.candidateEligibility),
    candidateExclusionReason: x.candidateExclusionReason || null,
    status: x.status,
    betterExtreme: x.extremeComparison?.higherQuality || null,
    edgeDiffHighMinusLowPp: x.extremeComparison?.edgeDiffPp ?? null,
    averageNextCloseDiffHighMinusLowPp: x.extremeComparison?.averageNextCloseDiffPp ?? null,
    stableFolds: x.stableFolds ?? null,
    effectScore: x.effectScore ?? null
  }));

const eligibleStable = (report.featureDiagnostics || []).filter(x => Boolean(x.candidateEligibility));
const familyBest = new Map();
for (const item of eligibleStable) {
  const existing = familyBest.get(item.family);
  if (!existing || (item.effectScore || 0) > (existing.effectScore || 0)) familyBest.set(item.family, item);
}
report.unlockedFamilyCandidates = [...familyBest.entries()]
  .map(([family, item]) => ({
    family,
    strongestFeature: item.feature,
    effectScore: item.effectScore ?? null,
    betterExtreme: item.extremeComparison?.higherQuality || null,
    edgeDiffHighMinusLowPp: item.extremeComparison?.edgeDiffPp ?? null,
    averageNextCloseDiffHighMinusLowPp: item.extremeComparison?.averageNextCloseDiffPp ?? null,
    stableFolds: item.stableFolds ?? null
  }))
  .sort((a, b) => (b.effectScore || 0) - (a.effectScore || 0));

const recommended = report.unlockedFamilyCandidates[0] || null;
report.newCandidateRecommendation = recommended ? {
  recommended: true,
  ...recommended,
  authority: 'PREREGISTER_NEXT_EXPERIMENT_ONLY_ZERO_ALPHA_ZERO_PRODUCTION_AUTHORITY'
} : {
  recommended: false,
  family: null,
  reason: geometryFormulaDerivedDegeneracy
    ? 'The only previously unlocked stable family was geometry, but destructive review proved it is formula-derived from the shared V16 ATR construction; no independent family remains eligible.'
    : 'No unlocked independent family meets the frozen stable diagnostic criteria.'
};
report.disposition = recommended
  ? 'ONE_NEW_FAMILY_MAY_BE_PREREGISTERED_BEFORE_FIRST_OUTCOME_RUN'
  : 'NO_NEW_RETROSPECTIVE_RULE_MOVE_TO_FRESH_FORWARD_EVIDENCE';

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  familyGuard: guard,
  stablePatterns: report.stablePatterns,
  unlockedFamilyCandidates: report.unlockedFamilyCandidates,
  newCandidateRecommendation: report.newCandidateRecommendation,
  disposition: report.disposition
}, null, 2));
