'use strict';

const fs = require('fs');

function read(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function fail(message, report) {
  const out = {
    ok: false,
    version: '13.17.1',
    generatedAt: new Date().toISOString(),
    mode,
    message,
    gatewayStatus: report?.status || null,
    executionGrade: report?.executionGrade === true,
    quality: report?.quality || null
  };
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync('data/market-quality-acceptance-v13-17-1.json', JSON.stringify(out, null, 2));
  console.error(`V13.17.1 MARKET QUALITY FAILURE: ${message}`);
  process.exit(1);
}

const arg = process.argv.find(x => x.startsWith('--mode='));
const mode = String(process.env.V13_17_1_QUALITY_MODE || (arg ? arg.split('=')[1] : 'intraday')).toLowerCase();
const report = read('data/market-quality-report.json');
const market = read('data/market.json', {});
const policy = read('data/v13-17-1-production-policy.json', {});

if (!report) fail('market-quality-report.json is missing', report);
if (report.engine !== 'v13.17.1_production_data_gateway') fail(`unexpected gateway engine: ${report.engine}`, report);
if (!Array.isArray(market.rows) || market.rows.length < Number(policy?.marketData?.minimumOperationalRows || 100)) fail('market row coverage is below the operational minimum', report);
if (Number(report?.quality?.invalidOhlcRows || 0) > 0) fail('invalid OHLC rows were detected', report);
if (Number(report?.quality?.priceValidPct || 0) < Number(policy?.marketData?.minimumPriceValidityPct || 98)) fail('price validity is below policy', report);

if (mode === 'postclose' || mode === 'production') {
  if (report.executionGrade !== true) fail('post-close requires execution-grade current data', report);
  if (report.fallbackUsed === true) fail('post-close cannot use a last-good fallback snapshot', report);
  if (Number(report.marketRows || 0) < Number(policy?.marketData?.minimumExecutionGradeRows || 180)) fail('post-close row coverage is below the execution-grade minimum', report);
  if (Number(report?.quality?.ohlcValidPct || 0) < Number(policy?.marketData?.minimumExecutionGradeOhlcPct || 80)) fail('post-close OHLC validity is below policy', report);
}

const result = {
  ok: true,
  version: '13.17.1',
  generatedAt: new Date().toISOString(),
  mode,
  gatewayStatus: report.status,
  executionGrade: report.executionGrade === true,
  fallbackUsed: report.fallbackUsed === true,
  marketRows: report.marketRows,
  quality: report.quality,
  message: mode === 'postclose' || mode === 'production'
    ? 'Execution-grade market data accepted for finalization gates.'
    : 'Operational market data accepted for monitoring and intraday decision support.'
};
fs.writeFileSync('data/market-quality-acceptance-v13-17-1.json', JSON.stringify(result, null, 2));
console.log('V13.17.1 market quality acceptance passed', result);
