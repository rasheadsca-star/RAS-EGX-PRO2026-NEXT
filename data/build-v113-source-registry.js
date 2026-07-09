#!/usr/bin/env node
// V11.3 Historical Source Registry
// Defines public/automated historical-data candidates only. No manual CSV or broker-screen input is used.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
function ensureDir(p){ fs.mkdirSync(p, {recursive:true}); }
function writeJson(file, obj){ ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(obj,null,2)); }
const generatedAt = new Date().toISOString();
const registry = {
  ok: true,
  engine: 'v11_4_historical_source_registry_with_adapter_candidates',
  generatedAt,
  dataMode: 'public_or_licensed_api_only_no_manual_csv',
  policy: {
    noFakeHistory: true,
    noManualCsv: true,
    acceptedRowsMustPassOHLCVValidation: true,
    sourcePriority: 'official_or_public_exchange_pages_first_then_public_market_pages_then_optional_licensed_api'
  },
  sources: [
    {
      id: 'egx_official_public_pages',
      name: 'EGX official public pages',
      priority: 100,
      type: 'official_public_html_or_export_when_available',
      enabled: true,
      requiresApiKey: false,
      role: 'official_reference_and_index_context',
      templates: [
        'https://www.egx.com.eg/en/Stock_Trading.aspx?code={symbol}',
        'https://www.egx.com.eg/en/Trading.aspx?code={symbol}',
        'https://www.egx.com.eg/en/ListedStocks.aspx'
      ],
      limitations: ['Public pages may not expose full per-stock OHLCV tables for every symbol.']
    },
    {
      id: 'mubasher_public_stock_pages',
      name: 'Mubasher public EGX stock pages',
      priority: 90,
      type: 'public_delayed_html',
      enabled: true,
      requiresApiKey: false,
      role: 'price_current_history_discovery_when_table_or_embedded_json_exists',
      templates: [
        'https://english.mubasher.info/markets/EGX/stocks/{symbol}/historical-data',
        'https://english.mubasher.info/markets/EGX/stocks/{symbol}/historical-prices',
        'https://english.mubasher.info/markets/EGX/stocks/{symbol}/',
        'https://www.mubasher.info/markets/EGX/stocks/{symbol}/historical-data',
        'https://www.mubasher.info/markets/EGX/stocks/{symbol}/historical-prices',
        'https://www.mubasher.info/markets/EGX/stocks/{symbol}/'
      ],
      limitations: ['Data is public/delayed during market session and HTML structure can change.']
    },
    {
      id: 'tradingview_public_symbol_pages',
      name: 'TradingView public symbol pages',
      priority: 40,
      type: 'public_reference_html',
      enabled: true,
      requiresApiKey: false,
      role: 'symbol_resolution_and_public_reference_only',
      templates: ['https://www.tradingview.com/symbols/EGX-{symbol}/'],
      limitations: ['Not treated as primary historical OHLCV source unless extractable table/structured rows are found.']
    },

    {
      id: 'yahoo_chart_public_api',
      name: 'Yahoo public chart endpoint for EGX .CA symbols when available',
      priority: 88,
      type: 'public_chart_json',
      enabled: true,
      requiresApiKey: false,
      role: 'public_json_ohlcv_candidate_when_symbol_is_available',
      templates: ['https://query1.finance.yahoo.com/v8/finance/chart/{symbol}.CA?range=6mo&interval=1d&events=history'],
      limitations: ['Coverage varies by EGX symbol. Rows are accepted only if OHLCV validates.']
    },
    {
      id: 'stooq_public_daily_candidate',
      name: 'Stooq public daily CSV candidate',
      priority: 45,
      type: 'public_csv_candidate',
      enabled: true,
      requiresApiKey: false,
      role: 'fallback_public_csv_candidate_when_available',
      templates: ['https://stooq.com/q/d/l/?s={symbol}.eg&i=d', 'https://stooq.com/q/d/l/?s={symbol}.ca&i=d'],
      limitations: ['Symbol coverage may be incomplete. Rows are accepted only if OHLCV validates.']
    },
    {
      id: 'optional_licensed_eod_provider',
      name: 'Optional licensed end-of-day provider',
      priority: 95,
      type: 'licensed_api_placeholder',
      enabled: Boolean(process.env.EGX_HISTORY_API_URL),
      requiresApiKey: true,
      role: 'future_production_eod_history',
      templates: process.env.EGX_HISTORY_API_URL ? [process.env.EGX_HISTORY_API_URL] : [],
      limitations: ['Not active unless EGX_HISTORY_API_URL and EGX_HISTORY_API_KEY are configured in GitHub secrets.']
    }
  ],
  acceptanceRules: {
    minExecutableSessions: 20,
    fullTechnicalSessions: 50,
    preferredSessions: 120,
    duplicateDatesRejected: true,
    invalidOHLCVRowsRejected: true
  },
  note: 'V11.4 accelerates readiness by automated public/optional licensed backfill only. Manual CSV and broker-screen data are intentionally excluded.'
};
writeJson(path.join(DATA, 'historical-source-registry.json'), registry);
console.log('Wrote data/historical-source-registry.json');
