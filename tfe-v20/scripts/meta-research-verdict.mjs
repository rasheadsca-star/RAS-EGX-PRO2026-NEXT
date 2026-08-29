import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const reportDir = path.join(cwd, 'reports');
const out = path.join(reportDir, 'meta-research-verdict.json');

function read(name) {
  const p = path.join(reportDir, name);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function pick(obj, paths) {
  for (const p of paths) {
    let cur = obj;
    for (const part of p.split('.')) cur = cur?.[part];
    if (cur !== undefined && cur !== null) return cur;
  }
  return null;
}

const raw = read('raw-momentum-expert-audit.json');
const v19 = read('meta-v19-development-consensus-audit.json');
const entry = read('meta-entry-quality-audit.json');
const legacy = read('legacy-expert-veto-audit.json');
const inherited = read('inherited-v20-blocker.json');

const rawPass = Boolean(raw?.passesRetrospectiveGate);
const v19Pass = Boolean(v19?.supportsConfirmatoryHypothesis);
const entryPass = Boolean(entry?.promotion?.eligible || entry?.supportsRiskGate);

const promotionBlockers = [];
if (inherited) promotionBlockers.push('INHERITED_V20_BASELINE_BLOCKER');
if (!rawPass) promotionBlockers.push('RAW_MOMENTUM_RETROSPECTIVE_GATE_NOT_PASSED');
if (v19 && !v19Pass) promotionBlockers.push('V19_CONFIRMATORY_HYPOTHESIS_NOT_REPRODUCED');
if (entry && !entryPass) promotionBlockers.push('ENTRY_QUALITY_RULE_NOT_ROBUST');

// A failed candidate-performance gate is not itself a Critical/High implementation defect.
// Keep that distinction explicit so destructive-review severity is not inflated.
const openCriticalHigh = inherited ? ['INHERITED_V20_BASELINE_BLOCKER'] : [];

const verdict = {
  schemaVersion: 'meta-research-verdict-v2',
  generatedAt: new Date().toISOString(),
  branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || 'agent/egx-meta-engine-v1-20260829',
  headSha: process.env.GITHUB_SHA || null,
  promotionEligible: false,
  champion: 'V16_9_EQUAL_WEIGHT_BASKET',
  metaV2: {
    status: 'RESEARCH_ONLY',
    v19Treatment: 'ZERO_ALPHA_WEIGHT_UNTIL_FRESH_INDEPENDENT_EVIDENCE',
    gannTreatment: 'DIAGNOSTIC_ONLY_ZERO_ALPHA_WEIGHT',
    sepaTreatment: 'DIAGNOSTIC_ONLY_ZERO_ALPHA_WEIGHT',
    fundamentalsNewsTreatment: 'RISK_ONLY_NEVER_POSITIVE_ALPHA'
  },
  rawMomentumExpert: raw ? {
    evidenceClass: raw.evidenceClass || null,
    independentGeneration: raw.lineage?.independentGeneration ?? null,
    passesRetrospectiveGate: rawPass,
    disposition: raw.disposition || null,
    standaloneDevelopment: raw.standalone?.development || null,
    standaloneValidation: raw.standalone?.validation || null,
    confirmationValidation: raw.confirmation?.validation || null,
    preregisteredChecks: raw.preregisteredChecks || null
  } : null,
  v19OlderDevelopmentReplay: v19 ? {
    evidenceClass: v19.evidenceClass || null,
    lineage: v19.sourcePolicy?.v19Lineage || null,
    supportsConfirmatoryHypothesis: v19Pass,
    disposition: v19Pass ? 'RESEARCH_HYPOTHESIS_SURVIVED' : 'REJECT_POSITIVE_ALPHA_WEIGHT',
    overall: v19.overall || null,
    preregisteredChecks: v19.preregisteredChecks || null,
    reason: v19.promotion?.reason || null
  } : null,
  entryQualityAudit: entry ? {
    evidenceClass: entry.evidenceClass || null,
    supportsRiskGate: Boolean(entry.supportsRiskGate),
    promotionEligible: Boolean(entry.promotion?.eligible),
    disposition: entryPass ? 'RESEARCH_GATE_SURVIVED' : 'REJECT_RULE_NO_RETUNING',
    baseline: entry.baseline || null,
    filtered: entry.filtered || null,
    preregisteredChecks: entry.preregisteredChecks || null,
    reason: entry.promotion?.reason || null
  } : null,
  legacyVetoAudit: legacy ? {
    baseline: legacy.groups?.ALL || legacy.all || legacy.baseline || null,
    treatment: 'GANN_AND_SEPA_DIAGNOSTIC_ONLY_ZERO_ALPHA_WEIGHT'
  } : null,
  inheritedBlocker: inherited,
  promotionBlockers,
  openCriticalHigh,
  finalResearchDisposition: rawPass
    ? 'KEEP_V16_CHAMPION_RAW_MOMENTUM_REQUIRES_FRESH_FORWARD_PROOF'
    : 'KEEP_V16_CHAMPION_REJECT_RAW_MOMENTUM_V1_ALPHA_WEIGHT',
  reason: 'No challenger is promoted from reused or retrospective evidence. V16 remains champion until superiority is demonstrated on fresh point-in-time evidence under identical execution and cost assumptions.'
};

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(out, JSON.stringify(verdict, null, 2) + '\n');
console.log(JSON.stringify(verdict, null, 2));