'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function contentHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function validateDocumentMetadata(metadata) {
  const issues = [];
  for (const field of ['documentId', 'ticker', 'sourceId', 'sourceUrl', 'documentType', 'reportingPeriodEnd', 'retrievedAt', 'contentHash', 'parserVersion']) {
    if (!metadata?.[field]) issues.push(`${field.toUpperCase()}_REQUIRED`);
  }
  if (!['ANNUAL_REPORT', 'INTERIM_RESULTS', 'FINANCIAL_STATEMENTS', 'EARNINGS_RELEASE', 'BOARD_DISCLOSURE', 'SHAREHOLDER_DISCLOSURE', 'CAPITAL_ACTION', 'MATERIAL_EVENT', 'REGULATORY_FILING'].includes(metadata?.documentType)) issues.push('DOCUMENT_TYPE_INVALID');
  if (!['CONSOLIDATED', 'STANDALONE', 'NOT_APPLICABLE', 'UNKNOWN'].includes(metadata?.statementScope || 'UNKNOWN')) issues.push('STATEMENT_SCOPE_INVALID');
  return { valid: issues.length === 0, issues };
}

function archiveDocument({ buffer, metadata, cacheRoot, existingIndex = [] }) {
  if (!Buffer.isBuffer(buffer)) throw new Error('DOCUMENT_BUFFER_REQUIRED');
  const hash = contentHash(buffer);
  const complete = { ...metadata, contentHash: hash };
  const validation = validateDocumentMetadata(complete);
  if (!validation.valid) throw new Error(`DOCUMENT_METADATA_INVALID:${validation.issues.join(',')}`);
  const duplicate = existingIndex.find(item => item.contentHash === hash);
  if (duplicate) return { metadata: duplicate, duplicate: true, cacheFile: null };
  const extension = metadata.extension || '.pdf';
  const cacheFile = path.join(cacheRoot, `${hash}${extension}`);
  fs.mkdirSync(cacheRoot, { recursive: true });
  if (!fs.existsSync(cacheFile)) fs.writeFileSync(cacheFile, buffer);
  return { metadata: complete, duplicate: false, cacheFile };
}

module.exports = { contentHash, validateDocumentMetadata, archiveDocument };
