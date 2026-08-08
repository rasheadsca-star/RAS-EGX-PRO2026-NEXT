#!/usr/bin/env node
'use strict';

const protectedPrefixes = [
  'preview-v169/',
  'scripts/stable/',
  'data/stable/',
];

const protectedFiles = new Set([
  'preview-v16/app/v16-9-basket-overlay.js',
  'preview-v16/app/v169.html',
  'data/history/.v169-target-audit-trigger',
  'data/research/v16-v169-basket-engine.json',
  'data/research/v16-v169-target-hit-audit.json',
  'scripts/research/v16-v169-basket-engine.py',
  'scripts/research/v16-v169-target-hit-audit.py',
  '.github/workflows/v16-v169-basket-engine.yml',
  '.github/workflows/v16-v169-target-audit.yml',
  '.github/workflows/v169-primary-pages-deploy.yml',
]);

function normalize(file) {
  return String(file || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function isProtected(file) {
  const normalized = normalize(file);
  return protectedPrefixes.some(prefix => normalized.startsWith(prefix)) || protectedFiles.has(normalized);
}

function checkPaths(paths) {
  const changed = [...new Set(paths.map(normalize).filter(Boolean))];
  return { changed, violations: changed.filter(isProtected).sort() };
}

if (require.main === module) {
  const supplied = process.argv.slice(2);
  if (!supplied.length) {
    console.error('No changed paths supplied. Refusing to assume a clean tree.');
    process.exit(2);
  }
  const paths = supplied[0] === '--allow-empty' ? supplied.slice(1) : supplied;
  const result = checkPaths(paths);
  if (result.violations.length) {
    console.error('FROZEN_V16_9_PATH_VIOLATION');
    for (const file of result.violations) console.error(`- ${file}`);
    process.exit(1);
  }
  console.log(JSON.stringify({
    status: 'PASS',
    checkedAgainst: 'caller-supplied git diff and untracked paths',
    changedFilesChecked: result.changed.length,
    protectedPrefixes,
    protectedFiles: [...protectedFiles],
  }, null, 2));
}

module.exports = { checkPaths, isProtected, protectedFiles, protectedPrefixes };
