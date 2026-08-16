#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = process.cwd();
const MAX_BYTES = 5 * 1024 * 1024;

const exactBlockedPaths = new Set([
  '.env',
  '.project-config.json',
  '.npmrc',
]);

const blockedSuffixes = [
  '.pem',
  '.p12',
  '.pfx',
  '.key',
];

const secretPatterns = [
  { id: 'PRIVATE_KEY', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { id: 'GITHUB_TOKEN', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { id: 'AWS_ACCESS_KEY', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'GOOGLE_API_KEY', re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { id: 'SLACK_TOKEN', re: /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g },
  { id: 'STRIPE_LIVE_SECRET', re: /\bsk_live_[0-9A-Za-z]{16,}\b/g },
  { id: 'OPENAI_STYLE_SECRET', re: /\bsk-[A-Za-z0-9_-]{24,}\b/g },
];

const genericAssignment = /\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PRIVATE[_-]?KEY)[A-Z0-9_]*)\s*[:=]\s*["']?([^\s"'#`,;]{16,})/gi;

const placeholder = value => {
  const v = String(value || '').trim().toLowerCase();
  return !v ||
    v.includes('example') ||
    v.includes('placeholder') ||
    v.includes('replace_me') ||
    v.includes('replace-me') ||
    v.includes('changeme') ||
    v.includes('your_') ||
    v.includes('your-') ||
    v.startsWith('${') ||
    v.startsWith('{{') ||
    v === 'undefined' ||
    v === 'null';
};

function trackedFiles() {
  return cp.execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

function isProbablyBinary(buf) {
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  return sample.includes(0);
}

const findings = [];
const files = trackedFiles();

for (const rel of files) {
  const normalized = rel.replace(/\\/g, '/');
  const base = path.basename(normalized).toLowerCase();

  if (exactBlockedPaths.has(normalized) || blockedSuffixes.some(suffix => base.endsWith(suffix))) {
    findings.push({ file: normalized, type: 'SENSITIVE_FILE_TRACKED' });
    continue;
  }

  const full = path.join(ROOT, rel);
  let stat;
  try { stat = fs.statSync(full); } catch { continue; }
  if (!stat.isFile() || stat.size > MAX_BYTES) continue;

  let buf;
  try { buf = fs.readFileSync(full); } catch { continue; }
  if (isProbablyBinary(buf)) continue;
  const text = buf.toString('utf8');

  for (const pattern of secretPatterns) {
    pattern.re.lastIndex = 0;
    if (pattern.re.test(text)) {
      findings.push({ file: normalized, type: pattern.id });
    }
  }

  genericAssignment.lastIndex = 0;
  let match;
  while ((match = genericAssignment.exec(text))) {
    const value = match[2];
    if (!placeholder(value)) {
      findings.push({ file: normalized, type: `GENERIC_SECRET_ASSIGNMENT:${match[1]}` });
      break;
    }
  }
}

if (fs.existsSync(path.join(ROOT, '.env'))) {
  findings.push({ file: '.env', type: 'ENV_FILE_PRESENT_IN_WORKTREE' });
}

const gitignore = fs.existsSync(path.join(ROOT, '.gitignore'))
  ? fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
  : '';
if (!gitignore.split(/\r?\n/).map(line => line.trim()).includes('.env')) {
  findings.push({ file: '.gitignore', type: 'ENV_NOT_IGNORED' });
}

if (findings.length) {
  console.error(`SECRET_SCAN_FAIL findings=${findings.length}`);
  for (const item of findings) console.error(`- ${item.type} @ ${item.file}`);
  process.exit(1);
}

console.log(`SECRET_SCAN_PASS trackedFiles=${files.length} envTracked=false sensitiveFilesTracked=false`);
