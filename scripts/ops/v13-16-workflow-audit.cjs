#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const OUTPUT = path.join(ROOT, 'data', 'ops', 'workflow-inventory-v13-16.json');
const PRIMARY = 'v13-17-full-market-search-money-flow.yml';

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, file);
}
function read(file) {
  try { return fs.readFileSync(file, 'utf8'); }
  catch { return ''; }
}
function workflowName(text, filename) {
  const match = text.match(/^\s*name\s*:\s*(.+?)\s*$/m);
  return match ? match[1].replace(/^['"]|['"]$/g, '') : filename;
}
function hasTrigger(text, key) {
  const onBlock = text.match(/^\s*on\s*:\s*(?:\n([\s\S]*?))(?=^\S|\z)/m);
  const haystack = onBlock ? onBlock[0] : text;
  return new RegExp(`(^|\\n)\\s*${key}\\s*:`, 'm').test(haystack);
}
function schedules(text) {
  const values = [];
  const re = /cron\s*:\s*['"]?([^'"\n]+)['"]?/g;
  let match;
  while ((match = re.exec(text))) values.push(match[1].trim());
  return values;
}

const files = fs.existsSync(WORKFLOWS)
  ? fs.readdirSync(WORKFLOWS).filter(name => /\.ya?ml$/i.test(name)).sort()
  : [];

const workflows = files.map(filename => {
  const relativePath = `.github/workflows/${filename}`;
  const text = read(path.join(WORKFLOWS, filename));
  const scheduleValues = schedules(text);
  const isPrimary = filename === PRIMARY;
  const isEmergency = /emergency|restore|rollback/i.test(filename + ' ' + workflowName(text, filename));
  return {
    filename,
    relativePath,
    name: workflowName(text, filename),
    isPrimary,
    isEmergency,
    hasSchedule: scheduleValues.length > 0 || hasTrigger(text, 'schedule'),
    schedules: scheduleValues,
    hasWorkflowDispatch: hasTrigger(text, 'workflow_dispatch'),
    hasPush: hasTrigger(text, 'push'),
    deploysPages: /actions\/deploy-pages@/i.test(text),
    writesRepository: /git\s+push|contents:\s*write/i.test(text),
    classification: isPrimary ? 'PRIMARY' : isEmergency ? 'EMERGENCY' : 'LEGACY_OR_AUXILIARY'
  };
});

const scheduledLegacy = workflows.filter(item =>
  !item.isPrimary && !item.isEmergency && item.hasSchedule
);
const pageDeployers = workflows.filter(item => item.deploysPages);
const repositoryWriters = workflows.filter(item => item.writesRepository);
const warnings = [];
if (scheduledLegacy.length) {
  warnings.push(`${scheduledLegacy.length} legacy/auxiliary workflow(s) still have schedules and may update data independently.`);
}
if (pageDeployers.length > 1) {
  warnings.push(`${pageDeployers.length} workflows can deploy GitHub Pages.`);
}
if (repositoryWriters.length > 1) {
  warnings.push(`${repositoryWriters.length} workflows can write to the repository.`);
}

const output = {
  schemaVersion: '13.16.0',
  generatedAt: new Date().toISOString(),
  auditMode: 'REPORT_ONLY',
  automaticArchiveEnabled: false,
  primaryWorkflow: `.github/workflows/${PRIMARY}`,
  counts: {
    total: workflows.length,
    scheduled: workflows.filter(item => item.hasSchedule).length,
    scheduledLegacy: scheduledLegacy.length,
    pageDeployers: pageDeployers.length,
    repositoryWriters: repositoryWriters.length,
    emergency: workflows.filter(item => item.isEmergency).length
  },
  status: warnings.length ? 'WARNING' : 'HEALTHY',
  warnings,
  scheduledLegacy: scheduledLegacy.map(item => ({
    filename: item.filename,
    name: item.name,
    schedules: item.schedules
  })),
  workflows
};
writeJson(OUTPUT, output);
console.log(`V13.16 workflow audit: total=${workflows.length}, scheduledLegacy=${scheduledLegacy.length}, pageDeployers=${pageDeployers.length}.`);
