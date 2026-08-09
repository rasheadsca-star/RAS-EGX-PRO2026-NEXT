#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { scoreFundamentals, unavailableFundamentals } = require('./scoring.cjs');

function buildFundamentalDataset({ universe, input, asOf = new Date() }) {
  const byTicker = new Map((input.companies || []).map(company => [String(company.ticker).toUpperCase(), company]));
  const results = universe.map(stock => {
    const ticker = String(stock.ticker).toUpperCase();
    const supplied = byTicker.get(ticker);
    return supplied
      ? scoreFundamentals({ ...supplied, ticker }, { asOf })
      : unavailableFundamentals({ ticker, sector: stock.sector, missingFields: ['NO_VERIFIED_FINANCIAL_INPUT'] }, undefined, 'NO_VERIFIED_FINANCIAL_INPUT');
  });
  const counts = results.reduce((acc, row) => { acc[row.fundamentalDataConfidence] = (acc[row.fundamentalDataConfidence] || 0) + 1; return acc; }, {});
  return {
    schemaVersion: '17.4.0-fundamentals-1',
    generatedAt: asOf.toISOString(),
    researchOnly: true,
    sourceAuditRequired: true,
    summary: { universe: universe.length, confidenceCounts: counts, scored: results.filter(x => Number.isFinite(x.fundamentalQualityScore)).length },
    results,
  };
}

if (require.main === module) {
  const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
  const market = JSON.parse(fs.readFileSync(path.join(root, 'data/v17/historical-recovery/long-history/compact-market.json'), 'utf8'));
  const input = JSON.parse(fs.readFileSync(path.join(root, 'data/v17/historical-recovery/fundamentals/verified-input.json'), 'utf8'));
  const output = buildFundamentalDataset({ universe: market.results, input, asOf: new Date() });
  fs.writeFileSync(path.join(root, 'data/v17/historical-recovery/fundamentals/current.json'), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output.summary, null, 2));
}

module.exports = { buildFundamentalDataset };
