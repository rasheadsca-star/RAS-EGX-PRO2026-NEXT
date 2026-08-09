'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function extractPdfText(file, options = {}) {
  if (!fs.existsSync(file)) return { status: 'PARSER_REVIEW_REQUIRED', text: '', issues: ['DOCUMENT_NOT_FOUND'] };
  const output = path.join(options.tempDir || os.tmpdir(), `v17-pdf-${process.pid}-${Date.now()}.txt`);
  const executable = options.pdftotext || 'pdftotext';
  const result = spawnSync(executable, ['-layout', file, output], { encoding: 'utf8', timeout: options.timeoutMs || 45_000 });
  if (result.error || result.status !== 0 || !fs.existsSync(output)) {
    return { status: 'PARSER_REVIEW_REQUIRED', text: '', issues: ['PDF_TEXT_EXTRACTION_FAILED'], detail: result.error?.message || result.stderr || null };
  }
  const text = fs.readFileSync(output, 'utf8');
  fs.rmSync(output, { force: true });
  const issues = [];
  if (text.trim().length < 200) issues.push('EXTRACTED_TEXT_TOO_SHORT');
  if (!/financial|القوائم|statement|الإيرادات|revenue/i.test(text)) issues.push('FINANCIAL_CONTENT_NOT_CONFIRMED');
  return { status: issues.length ? 'PARSER_REVIEW_REQUIRED' : 'TEXT_EXTRACTED', text, issues };
}

function detectTableAmbiguity(text) {
  const issues = [];
  if (!text || text.length < 200) issues.push('TEXT_UNAVAILABLE');
  if (/unaudited|غير مدقق/i.test(text)) issues.push('UNAUDITED_DOCUMENT');
  if (!/currency|EGP|USD|جنيه|دولار/i.test(text)) issues.push('CURRENCY_NOT_LOCATED');
  if (!/consolidated|standalone|مجمعة|مجمعه|مستقلة|مستقله/i.test(text)) issues.push('STATEMENT_SCOPE_NOT_LOCATED');
  return { reviewRequired: issues.length > 0, issues };
}

module.exports = { extractPdfText, detectTableAmbiguity };
