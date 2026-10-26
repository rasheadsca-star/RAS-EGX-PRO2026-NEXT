'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

const root = path.resolve(__dirname, '../../..');
const product = path.join(root, 'scripts/stable/v16-session-aware-price-truth.cjs');
const workflowRoot = path.join(root, '.github/workflows');
const flag = 'EGX_HISTORY_GUARDED_INTEGRATION';

function walkFiles(dir) {
  if (!fs.existsSync(dir)) throw new Error('Missing workflows directory: ' + dir);
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlink in workflows: ' + p);
    if (entry.isDirectory()) return walkFiles(p);
    if (!entry.isFile()) throw new Error('Unexpected workflow entry: ' + p);
    return [p];
  });
}
function traverse(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end' || key === 'loc') continue;
    if (Array.isArray(value)) value.forEach(child => traverse(child, visit, node));
    else if (value && typeof value === 'object') traverse(value, visit, node);
  }
}
function staticString(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0)
    return node.quasis[0].value.cooked;
  return null;
}
function isRequire(node) {
  return node?.type === 'CallExpression' &&
    node.callee?.type === 'Identifier' && node.callee.name === 'require';
}
function isHistorySpecifier(value) {
  return typeof value === 'string' && /(^|[\\/])history-[^\\/]+$/.test(value);
}
function staticGuard(repoRoot = root) {
  const producer = path.join(repoRoot, 'scripts/stable/v16-session-aware-price-truth.cjs');
  const src = fs.readFileSync(producer, 'utf8');
  // Parse failure is fatal, including unsupported syntax.
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  const violations = [];
  // Fail closed on ANY producer history require/import, not merely top-level:
  // no hidden default execution path or dynamic guarded branch may be added in S2.
  traverse(ast, node => {
    if (isRequire(node)) {
      const spec = staticString(node.arguments[0]);
      if (spec === null) violations.push('Non-literal require at offset ' + node.start);
      else if (isHistorySpecifier(spec)) violations.push('history require at offset ' + node.start + ': ' + spec);
    }
    if (node.type === 'ImportExpression') {
      const spec = staticString(node.source);
      if (spec === null || isHistorySpecifier(spec)) violations.push('Unsafe import() at offset ' + node.start);
    }
    if (node.type === 'ImportDeclaration' && isHistorySpecifier(node.source?.value))
      violations.push('history import at offset ' + node.start);
  });
  const workflows = walkFiles(path.join(repoRoot, '.github/workflows'));
  if (workflows.length === 0) violations.push('No workflows found');
  for (const wf of workflows) {
    if (fs.readFileSync(wf, 'utf8').includes(flag))
      violations.push('Forbidden flag in workflow ' + path.relative(repoRoot, wf));
  }
  return violations;
}

test('S2 reusable static production isolation guard', () => {
  assert.deepEqual(staticGuard(), [], 'Producer/workflow static isolation violations');
});
test('S2 static guard rejects historical require, malformed syntax, and workflow opt-in', () => {
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egx-s2-'));
  try {
    const p = path.join(tmp, 'scripts/stable/v16-session-aware-price-truth.cjs');
    const w = path.join(tmp, '.github/workflows/test.yml');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.mkdirSync(path.dirname(w), { recursive: true });
    fs.writeFileSync(w, 'name: safe');
    fs.writeFileSync(p, "function f(){return require('./history-guarded-merge.cjs')}");
    assert.match(staticGuard(tmp).join(' '), /history require/);
    fs.writeFileSync(p, 'function () {');
    assert.throws(() => staticGuard(tmp), /Unexpected token/);
    fs.writeFileSync(p, "const fs = require('fs');");
    fs.writeFileSync(w, 'env: ' + flag + ': 1');
    assert.match(staticGuard(tmp).join(' '), /Forbidden flag/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
