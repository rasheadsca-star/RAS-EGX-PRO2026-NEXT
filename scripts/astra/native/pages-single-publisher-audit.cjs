'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const WF_DIR = path.join(ROOT, '.github', 'workflows');
const CANONICAL = '.github/workflows/static.yml';

const expectedRetired = [
  '.github/workflows/egx-adaptive-paper-v13-5.yml',
  '.github/workflows/egx-eligibility-gated-paper-v13-2.yml',
  '.github/workflows/egx-gap-diagnostics-approved-import.yml',
  '.github/workflows/egx-historical-100-sample.yml',
  '.github/workflows/egx-historical-seed-xlsx.yml',
  '.github/workflows/egx-history-safety-eligibility-v13-1.yml',
  '.github/workflows/egx-native-stock-portfolio-v13-7.yml',
  '.github/workflows/egx-portfolio-risk-v13-8.yml',
  '.github/workflows/egx-quant-research-v13-4.yml',
  '.github/workflows/egx-seed-gap-completion.yml',
  '.github/workflows/egx-starta-gap-auto-completion.yml',
  '.github/workflows/egx-targeted-seven-repair-v13.yml',
  '.github/workflows/fix-v13-3-preview-page.yml',
  '.github/workflows/install-v13-4-quant-engine.yml',
  '.github/workflows/install-v13-5-adaptive-paper (1).yml',
  '.github/workflows/install-v13-5-adaptive-paper.yml',
  '.github/workflows/install-v13-6-unified-interface.yml',
  '.github/workflows/install-v13-7-native-stock-portfolio.yml',
  '.github/workflows/install-v13-8-portfolio-risk.yml',
  '.github/workflows/install-v13-9-recommendation-audit.yml',
  '.github/workflows/main-app-intraday-ls1.yml',
  '.github/workflows/main-app-post-basket-canonical-sync.yml',
  '.github/workflows/mobile-hotfix-deploy.yml',
  '.github/workflows/repair-v13-4-installation.yml',
  '.github/workflows/repair-v133-final.yml',
  '.github/workflows/v13-16-one-time-stabilize.yml',
  '.github/workflows/v13-17-1-exact-fresh-production-universe.yml',
  '.github/workflows/v13-17-1-session-truth-sync-final.yml',
  '.github/workflows/v13-18-portfolio-lifecycle-permission-safe.yml',
  '.github/workflows/v13-18-portfolio-lifecycle.yml',
  '.github/workflows/v13-20-multi-session-purchase-priority-permission-safe.yml',
  '.github/workflows/v13-20-stable-work-deploy.yml',
  '.github/workflows/v14-recommendation-quality-recovery.yml',
  '.github/workflows/v14-session-truth-recovery.yml',
  '.github/workflows/v14-stable-decision-system.yml',
  '.github/workflows/v16-daily-recommendation-scan.yml',
  '.github/workflows/v16-v169-basket-engine.yml',
  '.github/workflows/v17-historical-recovery-post-market.yml'
];

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

function listWorkflows() {
  return fs.readdirSync(WF_DIR)
    .filter(n => /\.ya?ml$/i.test(n))
    .map(n => path.join(WF_DIR, n))
    .sort();
}

function hasActivePagesAuxAction(text, action) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(action)) continue;
    const usesIndent = (lines[i].match(/^(\s*)/) || ['', ''])[1].length;
    const stepIndent = Math.max(0, usesIndent - 2);
    let start = i;
    while (start >= 0) {
      const indent = (lines[start].match(/^(\s*)/) || ['', ''])[1].length;
      if (/^\s*-\s+/.test(lines[start]) && indent === stepIndent) break;
      start--;
    }
    if (start < 0) return true;
    let end = i + 1;
    while (end < lines.length) {
      const indent = (lines[end].match(/^(\s*)/) || ['', ''])[1].length;
      if (/^\s*-\s+/.test(lines[end]) && indent === stepIndent) break;
      end++;
    }
    const block = lines.slice(start, end).join('\n');
    if (!/if:\s*\$\{\{\s*false\s*\}\}/.test(block)) return true;
  }
  return false;
}

const workflows = listWorkflows();
const findings = [];
const activeDeployers = [];
const pagesWriters = [];
const auxActive = [];

for (const file of workflows) {
  const fileRel = rel(file);
  const text = fs.readFileSync(file, 'utf8');

  if (/pages:\s*write\b/.test(text)) pagesWriters.push(fileRel);
  if (/^\\s*(?:-\\s*)?uses:\\s*actions\\/deploy-pages@/mi.test(text)) activeDeployers.push(fileRel);

  for (const action of ['actions/configure-pages@', 'actions/upload-pages-artifact@']) {
    if (fileRel !== CANONICAL && hasActivePagesAuxAction(text, action)) {
      auxActive.push({ file: fileRel, action });
    }
  }
}

if (JSON.stringify(activeDeployers) !== JSON.stringify([CANONICAL])) {
  findings.push({ id: 'DEPLOYER_SET', expected: [CANONICAL], actual: activeDeployers });
}
if (JSON.stringify(pagesWriters) !== JSON.stringify([CANONICAL])) {
  findings.push({ id: 'PAGES_WRITE_SET', expected: [CANONICAL], actual: pagesWriters });
}
if (auxActive.length) {
  findings.push({ id: 'ACTIVE_AUX_PAGES_ACTIONS', actual: auxActive });
}

const canonicalText = fs.readFileSync(path.join(ROOT, CANONICAL), 'utf8');
if (!/push:\s*[\s\S]*branches:\s*\["main"\]/m.test(canonicalText)) {
  findings.push({ id: 'CANONICAL_MAIN_TRIGGER_MISSING' });
}
if (!/actions\/configure-pages@/i.test(canonicalText) ||
    !/actions\/upload-pages-artifact@/i.test(canonicalText) ||
    !/actions\/deploy-pages@/i.test(canonicalText)) {
  findings.push({ id: 'CANONICAL_PAGES_CHAIN_INCOMPLETE' });
}

const retiredMissing = [];
const retiredNotMarked = [];
const retiredStillDeploying = [];
for (const fileRel of expectedRetired) {
  const abs = path.join(ROOT, fileRel);
  if (!fs.existsSync(abs)) {
    retiredMissing.push(fileRel);
    continue;
  }
  const text = fs.readFileSync(abs, 'utf8');
  if (!text.includes('ASTRA_SINGLE_PUBLISHER')) retiredNotMarked.push(fileRel);
  if (/pages:\s*write\b/.test(text) || /^\\s*(?:-\\s*)?uses:\\s*actions\\/deploy-pages@/mi.test(text)) retiredStillDeploying.push(fileRel);
}
if (retiredMissing.length) findings.push({ id: 'EXPECTED_RETIRED_MISSING', actual: retiredMissing });
if (retiredNotMarked.length) findings.push({ id: 'EXPECTED_RETIRED_UNMARKED', actual: retiredNotMarked });
if (retiredStillDeploying.length) findings.push({ id: 'RETIRED_STILL_DEPLOYING', actual: retiredStillDeploying });


function pushIsMainOnly(text) {
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex(line => /^  push:\s*/.test(line));
  if (idx < 0) return true;
  const first = lines[idx].trim();
  if (first !== 'push:') {
    return /branches\s*:\s*\[\s*['"]?main['"]?\s*\]/.test(first);
  }
  let end = idx + 1;
  while (end < lines.length && !/^  [A-Za-z0-9_"'-]+:\s*/.test(lines[end])) end++;
  const block = lines.slice(idx + 1, end).join('\n');
  const m = block.match(/^    branches:\s*(.+)$/m);
  if (!m) return false;
  const value = m[1].trim();
  return /^\[\s*['"]?main['"]?\s*\]$/.test(value);
}

const unsafePushTriggers = [];
for (const fileRel of expectedRetired) {
  const abs = path.join(ROOT, fileRel);
  if (!fs.existsSync(abs)) continue;
  const text = fs.readFileSync(abs, 'utf8');
  if (!pushIsMainOnly(text)) unsafePushTriggers.push(fileRel);
}
if (unsafePushTriggers.length) {
  findings.push({ id: 'UNSCOPED_PUSH_TRIGGERS', actual: unsafePushTriggers });
}

const result = {
  schemaVersion: 'astra-pages-single-publisher-audit-1',
  status: findings.length ? 'FAIL' : 'PASS',
  workflowCount: workflows.length,
  canonicalPublisher: CANONICAL,
  activeDeployers,
  pagesWriters,
  retiredPublisherCount: expectedRetired.length,
  activeAuxPagesActionsOutsideCanonical: auxActive.length,
  unsafePushTriggerCount: unsafePushTriggers.length,
  findings
};

console.log(JSON.stringify(result, null, 2));
if (findings.length) process.exit(1);
