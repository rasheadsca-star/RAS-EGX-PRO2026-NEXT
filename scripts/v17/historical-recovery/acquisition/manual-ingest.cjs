#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { archiveDocument } = require('./documents/archive.cjs');
const { extractPdfText, detectTableAmbiguity } = require('./documents/pdf-extractor.cjs');
const { resolveIdentity } = require('./entity-resolution/identity.cjs');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith('--')) args[argv[index].slice(2)] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
  }
  return args;
}

function prepareManualIngestion({ root, file, metadata, pdftotext }) {
  const base = path.join(root, 'data/v17/historical-recovery/acquisition');
  const registry = JSON.parse(fs.readFileSync(path.join(base, 'identity-registry.json'), 'utf8'));
  const index = JSON.parse(fs.readFileSync(path.join(base, 'document-index.json'), 'utf8'));
  const identityEntry = registry.companies.find(row => row.ticker === String(metadata.ticker || '').toUpperCase());
  const identity = resolveIdentity({
    ticker: metadata.ticker,
    legalName: metadata.legalName,
    sourceUrl: metadata.sourceUrl,
    exchange: metadata.exchange,
    currency: metadata.currency,
    securityClass: metadata.securityClass,
    securityId: metadata.securityId,
  }, identityEntry);
  if (!identity.accepted) return { accepted: false, status: 'IDENTITY_REVIEW_REQUIRED', identity, issues: identity.conflicts.length ? identity.conflicts : ['INSUFFICIENT_IDENTITY_SIGNALS'] };
  const buffer = fs.readFileSync(file);
  const archived = archiveDocument({
    buffer,
    metadata: {
      ...metadata,
      ticker: String(metadata.ticker).toUpperCase(),
      retrievedAt: metadata.retrievedAt || new Date().toISOString(),
      parserVersion: metadata.parserVersion || 'v17.5-text-first-1',
      extension: path.extname(file) || '.pdf',
    },
    cacheRoot: path.join(base, 'cache'),
    existingIndex: index.documents,
  });
  const extraction = extractPdfText(file, { pdftotext });
  const ambiguity = detectTableAmbiguity(extraction.text);
  const parserStatus = extraction.status === 'TEXT_EXTRACTED' && !ambiguity.reviewRequired ? 'MANUAL_FIELD_MAPPING_REQUIRED' : 'PARSER_REVIEW_REQUIRED';
  return {
    accepted: true,
    status: parserStatus,
    identity,
    document: archived.metadata,
    duplicate: archived.duplicate,
    extractionIssues: [...extraction.issues, ...ambiguity.issues],
    safeToPopulateFinancialModel: false,
    nextStepAr: 'راجع الجداول والوحدات ونطاق القوائم يدويًا، ثم أضف القيم الموثقة إلى ملف أدلة التجربة مع مرجع الصفحة. لا تُنشر القيم تلقائيًا من OCR أو استخراج نص غامض.',
  };
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file || !args.metadata) {
    console.error('Usage: node manual-ingest.cjs --file official.pdf --metadata metadata.json [--pdftotext path]');
    process.exit(2);
  }
  const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
  const result = prepareManualIngestion({ root, file: path.resolve(args.file), metadata: JSON.parse(fs.readFileSync(path.resolve(args.metadata), 'utf8')), pdftotext: args.pdftotext });
  console.log(JSON.stringify(result, null, 2));
  if (!result.accepted) process.exit(1);
}

module.exports = { parseArgs, prepareManualIngestion };
