#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = (rel, fallback = {}) => {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; }
};
const exists = rel => fs.existsSync(P(rel));
const write = (rel, value) => {
  const file = P(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
};
const symbolOf = value => String(value || '').trim().toUpperCase().replace(/\.CA$/, '').replace(/[^A-Z0-9.]/g, '');
const cleanSector = value => {
  const text = String(value || '').trim();
  if (!text || /^(unclassified|unknown|n\/a|null|غير مصنف|غير معروف)$/i.test(text)) return null;
  return text;
};

function rowsOf(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['rows','items','data','stocks','recommendations','results','symbols']) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function explicitSectorOf(row) {
  for (const key of ['sector','sectorName','sector_name','sectorAr','sector_ar']) {
    const value = cleanSector(row?.[key]);
    if (value) return { value, field: key };
  }
  return null;
}

const universe = read('data/v20/master-universe.json', { rows: [] });
const seedMap = read('config/egx-sector-map.json', {});
const legacy = read('data/sector-completion-report.json', {});
const policy = read('data/v20/policy-registry.json', {});
const universeSymbols = new Set((universe.rows || []).map(row => symbolOf(row.ticker)).filter(Boolean));

const candidateFiles = [
  'data/market.json',
  'data/recommendations.json',
  'data/engine-v9.json',
  'data/final-opportunity-ranking.json',
  'data/full-snapshot.json',
  'data/full-market-snapshot.json',
  'data/exchange-index.json',
  'data/all-stocks.json',
  'data/all-tickers.json',
].filter(exists);

const explicitBySymbol = new Map();
const sourceInventory = [];
for (const rel of candidateFiles) {
  const doc = read(rel, {});
  const rows = rowsOf(doc);
  let explicitCount = 0;
  for (const row of rows) {
    const ticker = symbolOf(row?.ticker || row?.symbol || row?.code);
    if (!ticker || !universeSymbols.has(ticker)) continue;
    const sector = explicitSectorOf(row);
    if (!sector) continue;
    explicitCount += 1;
    const item = {
      file: rel,
      field: sector.field,
      sector: sector.value,
      declaredSectorSource: row?.sectorSource || row?.sector_source || null,
      acceptedAsAuthoritative: false,
      reason: 'NO_V20_AUTHORITATIVE_SECTOR_SOURCE_REGISTRY_ENTRY',
    };
    if (!explicitBySymbol.has(ticker)) explicitBySymbol.set(ticker, []);
    explicitBySymbol.get(ticker).push(item);
  }
  sourceInventory.push({ file: rel, rowCount: rows.length, explicitSectorRowsInV20Universe: explicitCount });
}

const seedSymbolMap = seedMap?.symbolToSector && typeof seedMap.symbolToSector === 'object' ? seedMap.symbolToSector : {};
const seedBySymbol = new Map(Object.entries(seedSymbolMap)
  .map(([ticker, sector]) => [symbolOf(ticker), cleanSector(sector)])
  .filter(([ticker, sector]) => ticker && sector && universeSymbols.has(ticker)));

const legacyBySymbol = new Map();
for (const group of Array.isArray(legacy?.sectors) ? legacy.sectors : []) {
  const sector = cleanSector(group?.sector);
  if (!sector) continue;
  for (const raw of Array.isArray(group?.symbols) ? group.symbols : []) {
    const ticker = symbolOf(raw);
    if (ticker && universeSymbols.has(ticker)) legacyBySymbol.set(ticker, sector);
  }
}

const acceptedProductionProvenance = new Set(policy?.portfolio?.sectorConcentrationPolicy?.acceptedProductionProvenance || []);
const rows = (universe.rows || []).map(base => {
  const ticker = symbolOf(base.ticker);
  const explicitEvidence = explicitBySymbol.get(ticker) || [];
  const explicitSectors = [...new Set(explicitEvidence.map(item => item.sector))];
  const seedSector = seedBySymbol.get(ticker) || null;
  const legacySector = legacyBySymbol.get(ticker) || null;
  const explicitConflict = explicitSectors.length > 1;
  const crossSourceConflict = explicitSectors.length === 1 && [seedSector, legacySector].filter(Boolean).some(s => s !== explicitSectors[0]);

  let researchCandidateSector = null;
  let researchProvenance = 'UNCLASSIFIED';
  if (explicitSectors.length === 1 && !explicitConflict) {
    researchCandidateSector = explicitSectors[0];
    researchProvenance = 'UPSTREAM_EXPLICIT_UNVERIFIED';
  } else if (seedSector) {
    researchCandidateSector = seedSector;
    researchProvenance = 'UNVERIFIED_SEED_MAP';
  } else if (legacySector) {
    researchCandidateSector = legacySector;
    researchProvenance = 'LEGACY_MIXED_REPORT';
  }

  const productionProvenance = null;
  const acceptedForProduction = Boolean(productionProvenance && acceptedProductionProvenance.has(productionProvenance));
  return {
    ticker,
    productionSector: acceptedForProduction ? researchCandidateSector : null,
    productionProvenance,
    acceptedForProduction,
    researchCandidateSector,
    researchProvenance,
    explicitEvidence,
    seedSector,
    legacySector,
    conflicts: {
      explicitConflict,
      crossSourceConflict,
    },
  };
});

const productionVerified = rows.filter(row => row.acceptedForProduction);
const researchCandidates = rows.filter(row => row.researchCandidateSector);
const explicitUnverified = rows.filter(row => row.researchProvenance === 'UPSTREAM_EXPLICIT_UNVERIFIED');
const seedMapped = rows.filter(row => row.seedSector);
const legacyClassified = rows.filter(row => row.legacySector);
const conflictRows = rows.filter(row => row.conflicts.explicitConflict || row.conflicts.crossSourceConflict);
const universeCount = rows.length;
const legacyEngine = String(legacy?.engine || '');
const legacyInferencePossible = /inference/i.test(legacyEngine) || Array.isArray(seedMap?.namePatterns) || Boolean(seedMap?.namePatterns && typeof seedMap.namePatterns === 'object');

const out = {
  schemaVersion: '20.0.0-sector-provenance-audit-1',
  generatedAt: new Date().toISOString(),
  sessionDate: universe.sessionDate || null,
  decisionSupportOnly: true,
  policy: {
    productionSectorConcentrationEnabled: false,
    productionSectorClassificationEnabled: false,
    nameOrTickerInferenceAllowedForProduction: false,
    seedMapAllowedForProduction: false,
    legacyMixedReportAllowedForProduction: false,
    upstreamExplicitWithoutAuthoritativeRegistryAllowedForProduction: false,
    acceptedProductionProvenance: [...acceptedProductionProvenance],
    enablementRequires: policy?.portfolio?.sectorConcentrationPolicy?.enablementRequires || [],
  },
  sourceAssessment: {
    seedMap: {
      file: 'config/egx-sector-map.json',
      description: seedMap?._meta?.description || null,
      declaredSource: seedMap?._meta?.source || null,
      mappedUniverseSymbols: seedMapped.length,
      hasNamePatterns: Boolean(seedMap?.namePatterns),
      productionEligible: false,
      reason: 'SEED_MAP_IS_RESEARCH_CONTEXT_NOT_AUTHORITATIVE_PROVENANCE',
    },
    legacyCompletionReport: {
      file: 'data/sector-completion-report.json',
      engine: legacy?.engine || null,
      totalSymbols: Number(legacy?.totalSymbols || 0),
      classifiedSymbols: Number(legacy?.classifiedSymbols || 0),
      coveragePct: Number(legacy?.coveragePct || 0),
      classifiedUniverseSymbolsRecovered: legacyClassified.length,
      inferencePossible: legacyInferencePossible,
      perSymbolProvenancePreserved: false,
      productionEligible: false,
      reason: 'LEGACY_REPORT_MIXES_CONFIG_RUNTIME_FIELDS_AND_NAME_INFERENCE_WITHOUT_PER_SYMBOL_PROVENANCE',
    },
    upstreamExplicitScan: {
      filesScanned: sourceInventory,
      symbolsWithSingleExplicitSector: explicitUnverified.length,
      authoritativeRegistryMatches: 0,
      productionEligible: false,
      reason: 'EXPLICIT_FIELD_PRESENCE_ALONE_DOES_NOT_ESTABLISH_AUTHORITATIVE_SECTOR_PROVENANCE',
    },
  },
  summary: {
    universeCount,
    productionVerifiedCount: productionVerified.length,
    productionVerifiedCoveragePct: universeCount ? Number((productionVerified.length / universeCount * 100).toFixed(2)) : 0,
    researchCandidateCount: researchCandidates.length,
    researchCandidateCoveragePct: universeCount ? Number((researchCandidates.length / universeCount * 100).toFixed(2)) : 0,
    upstreamExplicitUnverifiedCount: explicitUnverified.length,
    seedMappedCount: seedMapped.length,
    legacyClassifiedCount: legacyClassified.length,
    conflictCount: conflictRows.length,
    productionSectorConcentrationEnabled: false,
    status: 'BLOCKED_UNTIL_VERIFIED_PROVENANCE',
    reasons: [
      'NO_AUTHORITATIVE_SECTOR_SOURCE_REGISTERED_FOR_V20',
      'SEED_MAP_NOT_PRODUCTION_PROVENANCE',
      legacyInferencePossible ? 'LEGACY_REPORT_CAN_INCLUDE_NAME_INFERENCE' : null,
      'PER_SYMBOL_AUTHORITATIVE_PROVENANCE_REQUIRED_BEFORE_SECTOR_RISK_LIMITS',
    ].filter(Boolean),
  },
  rows,
};

if (out.summary.productionVerifiedCount !== 0) throw new Error('Unexpected production sector verification without authoritative registry');
if (out.summary.productionSectorConcentrationEnabled !== false) throw new Error('Sector concentration must remain disabled');
if (rows.some(row => row.acceptedForProduction && !row.productionSector)) throw new Error('Production sector acceptance missing sector');
if (rows.some(row => row.acceptedForProduction && ['UNVERIFIED_SEED_MAP','LEGACY_MIXED_REPORT','NAME_INFERENCE','UPSTREAM_EXPLICIT_UNVERIFIED'].includes(row.researchProvenance))) {
  throw new Error('Unverified sector provenance leaked into production');
}

write('data/v20/sector-provenance-audit.json', out);
console.log(JSON.stringify(out.summary, null, 2));
