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
const v19Disposition = pick(v19, ['disposition','conclusion','promotion.disposition','verdict']);
const v19Pass = String(v19Disposition || '').toUpperCase().includes('PASS');

const critical = [];
if (inherited) critical.push('INHERITED_V20_BASELINE_BLOCKER');
if (!rawPass) critical.push('RAW_MOMENTUM_RETROSPECTIVE_GATE_NOT_PASSED');

const verdict = {
  schemaVersion: 'meta-research-verdict-v1',
  generatedAt: new Date().toISOString(),
  branch: process.env.GITHUB_REF_NAME || 'agent/egx-meta-engine-v1-20260829',
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
    passesRetrospectiveGate: rawPass,
    disposition: raw.disposition || null,
    standaloneDevelopment: raw.standalone?.development || null,
    standaloneValidation: raw.standalone?.validation || null,
    confirmationValidation: raw.confirmation?.validation || null,
    preregisteredChecks: raw.preregisteredChecks || null
  } : null,
  v19OlderDevelopmentReplay: v19 ? {
    disposition: v19Disposition,
    passes: v19Pass,
    summary: pick(v19, ['summary','comparison','metrics','validation'])
  } : null,
  entryQualityAudit: entry ? {
    disposition: pick(entry, ['disposition','conclusion','verdict']),
    summary: pick(entry, ['summary','comparison','metrics','validation'])
  } : null,
  legacyVetoAudit: legacy ? {
    disposition: pick(legacy, ['disposition','conclusion','verdict']),
    baseline: pick(legacy, ['all','baseline','summary.all'])
  } : null,
  inheritedBlocker: inherited,
  openCriticalHigh: critical,
  finalResearchDisposition: rawPass
    ? 'KEEP_V16_CHAMPION_AND_START_RAW_MOMENTUM_FRESH_FORWARD_SHADOW'
    : 'KEEP_V16_CHAMPION_REJECT_RAW_MOMENTUM_V1_ALPHA_WEIGHT',
  reason: 'No challenger is promoted from reused/retrospective evidence. V16 remains champion until superiority is demonstrated on fresh point-in-time evidence under identical execution and cost assumptions.'
};

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(out, JSON.stringify(verdict, null, 2) + '\n');
console.log(JSON.stringify(verdict, null, 2));
