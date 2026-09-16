'use strict';

const fs = require('fs');
const path = require('path');
const {
  fetchExactEgxHistory,
  diagnoseExactEgxHistory,
} = require('../../scripts/history/adapters/starta-exact-egx-adapter.cjs');
const {
  probeMubasherCurrent,
  probeEgxOfficialCurrent,
  probeLicensedCurrent,
  validateCurrentRow,
} = require('../../scripts/history/adapters/g11-approved-current-source-adapter.cjs');
const { mergeAndValidate } = require('../../scripts/history/history-validator.cjs');
const { readHistory, writeHistory } = require('../../scripts/history/history-storage.cjs');
const { historyStatus, buildSummary, buildSessionCalendar } = require('../../scripts/history/history-summary-builder.cjs');
const { unique } = require('../../scripts/history/lib/utils.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const R = (p) => path.join(ROOT, p);
const read = (p, d = null) => { try { return JSON.parse(fs.readFileSync(R(p), 'utf8')); } catch { return d; } };
const write = (p, value) => { fs.mkdirSync(path.dirname(R(p)), { recursive:true }); fs.writeFileSync(R(p), JSON.stringify(value, null, 2) + '\n', 'utf8'); };
const nowIso = () => process.env.G11_EVALUATED_AT || new Date().toISOString();
const safeTicker = (v) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');

const NONCOVERAGE_FINALS = new Set(['PRODUCTION_RELEVANT_EXTERNAL_SOURCE_BLOCKER_NO_APPROVED_CURRENT_ROW']);
const DERIVED_ONLY_DISCOVERY = new Set([
  'data/final-opportunity-ranking.json',
  'data/final-multisource-ranking.json',
  'data/actionable-watchlist.json',
]);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitCsvLine(line) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function loadApprovedCatalog() {
  const text = fs.readFileSync(R('config/egx-symbols.csv'), 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = splitCsvLine(lines.shift()).map((x) => x.trim());
  const rows = lines.map((line) => {
    const values = splitCsvLine(line);
    const row = Object.fromEntries(headers.map((h, i) => [h, values[i] || '']));
    row.symbol = safeTicker(row.symbol);
    row.aliasList = String(row.aliases || '').split('|').map((x) => x.trim()).filter(Boolean);
    return row;
  }).filter((x) => x.symbol);
  const bySymbol = new Map(rows.map((x) => [x.symbol, x]));
  const aliasIndex = new Map();
  for (const row of rows) {
    for (const token of [row.symbol, row.name_ar, row.name_en, ...row.aliasList]) {
      const key = normalizeText(token);
      if (!key) continue;
      if (!aliasIndex.has(key)) aliasIndex.set(key, new Set());
      aliasIndex.get(key).add(row.symbol);
    }
  }
  return { rows, bySymbol, aliasIndex };
}

function exactCatalogReplacement(mapEntry, catalog) {
  const ticker = safeTicker(mapEntry?.ticker);
  if (!ticker || catalog.bySymbol.has(ticker)) return null;
  const tokens = [mapEntry?.companyNameAr, mapEntry?.companyNameEn]
    .flatMap((v) => String(v || '').split('|'))
    .map(normalizeText)
    .filter(Boolean);
  const hits = new Set();
  const evidenceTokens = [];
  for (const token of tokens) {
    for (const symbol of catalog.aliasIndex.get(token) || []) {
      if (symbol !== ticker) { hits.add(symbol); evidenceTokens.push({ token, symbol }); }
    }
  }
  return hits.size === 1 ? { replacement:[...hits][0], evidenceTokens } : null;
}

function explicitNonSecurityArtifact(mapEntry, catalog) {
  const ticker = safeTicker(mapEntry?.ticker);
  const sources = Array.isArray(mapEntry?.discoverySources) ? mapEntry.discoverySources : [];
  const noIdentity = !String(mapEntry?.companyNameAr || '').trim() && !String(mapEntry?.companyNameEn || '').trim() && !String(mapEntry?.isin || '').trim();
  const derivedOnly = sources.length > 0 && sources.every((x) => DERIVED_ONLY_DISCOVERY.has(x));
  return Boolean(ticker && !catalog.bySymbol.has(ticker) && noIdentity && derivedOnly);
}

function localApprovedRows(ticker, expectedSession) {
  const out = [];
  const fallback = read('data/history-fallback-import.json', { records:[] });
  for (const rec of fallback.records || []) {
    if (safeTicker(rec.ticker) !== ticker || rec.approved !== true || rec.symbolVerified !== true) continue;
    for (const s of rec.sessions || []) {
      const row = {
        ticker, sourceSymbol:ticker, sessionDate:String(s.date || s.sessionDate || '').slice(0,10),
        open:Number(s.open), high:Number(s.high), low:Number(s.low), close:Number(s.close),
        volume:s.volume === null || s.volume === undefined ? null : Number(s.volume),
        turnover:s.turnover ?? s.valueTraded ?? null,
        sourceId:String(rec.source || '').toLowerCase(), sourceUrl:rec.sourceUrl || null,
        fetchedAt:rec.fetchedAt || nowIso(), approvedRecord:true,
      };
      const validation = validateCurrentRow(row, expectedSession);
      if (validation.ok) out.push({ sourceId:`approved_import:${row.sourceId}`, row, validation, priority: {egx_official:100,mubasher:90,investing:85,approved_csv:80}[row.sourceId] || 70 });
    }
  }
  const overrides = read('data/history-verification-overrides.json', { records:[] });
  for (const rec of overrides.records || []) {
    if (safeTicker(rec.ticker) !== ticker || rec.approved !== true) continue;
    const row = {
      ticker, sourceSymbol:ticker, sessionDate:String(rec.date || rec.sessionDate || '').slice(0,10),
      open:Number(rec.open), high:Number(rec.high), low:Number(rec.low), close:Number(rec.close),
      volume:rec.volume === null || rec.volume === undefined ? null : Number(rec.volume), turnover:rec.turnover ?? null,
      sourceId:String(rec.source || '').toLowerCase(), sourceUrl:rec.sourceUrl || null,
      fetchedAt:rec.fetchedAt || nowIso(), approvedRecord:true,
    };
    const validation = validateCurrentRow(row, expectedSession);
    if (validation.ok) out.push({ sourceId:`approved_override:${row.sourceId}`, row, validation, priority:{egx_official:100,mubasher:90,investing:85}[row.sourceId] || 70 });
  }
  return out;
}

function materialDisagreement(left, right) {
  const cfg = read('data/history-gap-diagnostics-config.json', {}) || {};
  const pctTol = Number(cfg.overlapCloseTolerancePct ?? 0.25);
  const absTol = Number(cfg.overlapCloseToleranceAbsolute ?? 0.02);
  const a = Number(left?.close), b = Number(right?.close);
  if (!(a > 0 && b > 0)) return true;
  const abs = Math.abs(a - b);
  const pct = abs / Math.max(Math.abs(a), Math.abs(b)) * 100;
  return abs > absTol && pct > pctTol;
}

function prepareCanonicalRow(ticker, candidate) {
  const row = candidate.row;
  const source = candidate.sourceId.replace(/^approved_(?:import|override):/, '');
  const priority = Number(candidate.priority || 75);
  return {
    ticker,
    date:row.sessionDate,
    open:Number(row.open), high:Number(row.high), low:Number(row.low), close:Number(row.close),
    adjustedClose:null,
    volume:Number(row.volume),
    currency:'EGP',
    primarySource:source,
    officialVerified:source.includes('egx_official'),
    verifiedBy:[source],
    sourceUrls:{ primary:row.sourceUrl || null, verification:[] },
    fetchedAt:row.fetchedAt || nowIso(),
    validatedAt:nowIso(),
    confidence:{ overall:priority, ohlc:priority, volume:priority, symbolIdentity:100 },
    validationStatus:'g11_approved_current_source_validated',
    warnings:['g11_approved_current_fallback','no_carry_forward','exact_symbol_required'],
  };
}

function persistApprovedCurrentRow(ticker, mapEntry, candidate, expectedSession) {
  const incoming = prepareCanonicalRow(ticker, candidate);
  if (incoming.date !== expectedSession) throw new Error(`refuse_non_expected_session:${incoming.date}`);
  const existing = readHistory(ROOT, ticker) || {};
  const merged = mergeAndValidate(existing.sessions || [], [incoming], 100);
  const current = merged.sessions.find((x) => String(x.date).slice(0,10) === expectedSession);
  if (!current) throw new Error('approved_current_row_failed_history_validation');
  const sessions = merged.sessions;
  const document = {
    ...existing,
    schemaVersion:existing.schemaVersion || '12.5.0',
    ticker,
    companyNameAr:mapEntry.companyNameAr || existing.companyNameAr || null,
    companyNameEn:mapEntry.companyNameEn || existing.companyNameEn || null,
    isin:mapEntry.isin || existing.isin || null,
    reutersCode:mapEntry.reutersCode || existing.reutersCode || null,
    yahooSymbol:mapEntry.yahooSymbol || existing.yahooSymbol || null,
    currency:mapEntry.currency || existing.currency || 'EGP',
    exchange:'EGX',
    generatedAt:nowIso(),
    availableSessions:sessions.length,
    firstSession:sessions[0]?.date || null,
    lastSession:sessions.at(-1)?.date || null,
    historyStatus:historyStatus(sessions.length),
    primarySource:incoming.primarySource,
    verificationSources:unique([...(existing.verificationSources || []), incoming.primarySource]),
    officiallyVerifiedLatestSession:incoming.officialVerified,
    symbolVerified:true,
    symbolVerification:{ verified:true, policy:'G11_APPROVED_SOURCE_PRECEDENCE', source:incoming.primarySource, verifiedAt:nowIso() },
    staleData:false,
    updateFailed:false,
    sessions,
  };
  writeHistory(ROOT, ticker, document);
  return { session:expectedSession, source:incoming.primarySource, sessionsStored:sessions.length };
}

async function probeApprovedFallbacks(ticker, expectedSession) {
  const candidates = [...localApprovedRows(ticker, expectedSession)];
  const attempts = [];
  const licensed = await probeLicensedCurrent(ticker, expectedSession, { timeoutMs:12000 });
  attempts.push(licensed);
  if (licensed.ok) candidates.push({ sourceId:'optional_licensed_eod_provider', row:licensed.row, priority:95 });
  const egx = await probeEgxOfficialCurrent(ticker, expectedSession, { timeoutMs:12000 });
  attempts.push(egx);
  if (egx.ok) candidates.push({ sourceId:'egx_official_public_pages', row:egx.row, priority:100 });
  const mubasher = await probeMubasherCurrent(ticker, expectedSession, { timeoutMs:12000 });
  attempts.push(mubasher);
  if (mubasher.ok) candidates.push({ sourceId:'mubasher_public_stock_pages', row:mubasher.row, priority:90 });
  candidates.sort((a,b) => Number(b.priority || 0) - Number(a.priority || 0));
  const disagreements = [];
  for (let i = 0; i < candidates.length; i += 1) for (let j = i + 1; j < candidates.length; j += 1) {
    if (materialDisagreement(candidates[i].row, candidates[j].row)) disagreements.push({ left:candidates[i].sourceId, right:candidates[j].sourceId, leftClose:candidates[i].row.close, rightClose:candidates[j].row.close });
  }
  return { candidates, attempts, disagreements };
}

function buildSourceRegistry(expectedSession) {
  const hist = read('data/historical-source-registry.json', {}) || {};
  const fallback = read('data/history-fallback-import.json', {records:[]});
  const overrides = read('data/history-verification-overrides.json', {records:[]});
  const licensedConfigured = Boolean(String(process.env.EGX_HISTORY_API_URL || '').trim());
  return {
    schemaVersion:'astra-g11-approved-source-registry-1', generatedAt:nowIso(), expectedSession,
    policy:'Only APPROVED_EXISTING or APPROVED_FALLBACK sources may populate current canonical truth. No candidate is silently promoted.',
    records:[
      {sourceId:'starta_egx_exact',classification:'APPROVED_EXISTING',sourceType:'public EGX-scoped exact-symbol API',authoritativeScope:'exact EGX security identity + OHLCV fallback used by certified G11 repair',currentSessionCapability:true,ohlcSupport:true,volumeSupport:true,turnoverSupport:'derived close*volume downstream; source turnover not required',historicalDepth:'up to configured 5y/2000 rows',securityCoverage:'partial; exact /egx/stock identity required',symbolScheme:'EGX ticker exact',existingAdapter:'scripts/history/adapters/starta-exact-egx-adapter.cjs',validationStatus:'G11_EXACT_SYMBOL_OHLCV_VALIDATION_ACTIVE',currentAvailability:true,credentialsPermissionRequirement:'none',productionApprovalEvidence:['astra/data-health/g11-source-data-repair.cjs','data/history-starta-gap-config.json','docs/astra/G11_SOURCE_IDENTITY_REPAIR.json']},
      {sourceId:'egx_official_public_pages',classification:'APPROVED_FALLBACK',sourceType:'official public HTML/export when available',authoritativeScope:'official EGX public reference/current rows only when exact symbol + explicit session + OHLCV parse succeeds',currentSessionCapability:'conditional',ohlcSupport:'conditional',volumeSupport:'conditional',turnoverSupport:'conditional',historicalDepth:'page/export dependent',securityCoverage:'page dependent',symbolScheme:'EGX ticker',existingAdapter:'scripts/history/adapters/g11-approved-current-source-adapter.cjs',validationStatus:'STRICT_CURRENT_ROW_PROBE_REQUIRED',currentAvailability:'probed during this run',credentialsPermissionRequirement:'none',productionApprovalEvidence:['data/historical-source-registry.json','data/history-gap-diagnostics-config.json','scripts/history/approved-fallback-importer.cjs']},
      {sourceId:'mubasher_public_stock_pages',classification:'APPROVED_FALLBACK',sourceType:'public delayed HTML',authoritativeScope:'cross-check/fallback only with exact route, explicit session date and valid OHLCV',currentSessionCapability:'conditional',ohlcSupport:'conditional',volumeSupport:'conditional',turnoverSupport:'conditional',historicalDepth:'page dependent',securityCoverage:'partial',symbolScheme:'Mubasher EGX ticker',existingAdapter:'scripts/history/adapters/g11-approved-current-source-adapter.cjs',validationStatus:'STRICT_CURRENT_ROW_PROBE_REQUIRED',currentAvailability:'probed during this run',credentialsPermissionRequirement:'none',productionApprovalEvidence:['data/historical-source-registry.json','data/history-gap-diagnostics-config.json','scripts/history/approved-fallback-importer.cjs','fetch-market-data.js']},
      {sourceId:'approved_reviewed_import',classification:'APPROVED_FALLBACK',sourceType:'administrator-reviewed import/override',authoritativeScope:'egx_official/mubasher/investing/approved_csv records only when approved=true and symbolVerified=true',currentSessionCapability:true,ohlcSupport:true,volumeSupport:true,turnoverSupport:'optional/derived',historicalDepth:'supplied reviewed rows',securityCoverage:'record-specific',symbolScheme:'canonical ticker',existingAdapter:'scripts/history/approved-fallback-importer.cjs + approved-verification-adapter.cjs',validationStatus:'EXPLICIT_APPROVAL_REQUIRED',currentAvailability:(fallback.records || []).length + (overrides.records || []).length > 0,approvedRecordCount:(fallback.records || []).length + (overrides.records || []).length,credentialsPermissionRequirement:'administrator review',productionApprovalEvidence:['data/history-fallback-import.json','data/history-verification-overrides.json','scripts/history/approved-fallback-importer.cjs']},
      {sourceId:'optional_licensed_eod_provider',classification:licensedConfigured?'APPROVED_FALLBACK':'UNAVAILABLE',sourceType:'licensed API placeholder',authoritativeScope:'future production EOD history/current only when configured and row validates',currentSessionCapability:licensedConfigured,ohlcSupport:true,volumeSupport:true,turnoverSupport:'provider dependent',historicalDepth:'provider dependent',securityCoverage:'provider dependent',symbolScheme:'template {symbol}',existingAdapter:'scripts/history/adapters/g11-approved-current-source-adapter.cjs',validationStatus:licensedConfigured?'CONFIGURED_STRICT_VALIDATION_REQUIRED':'NOT_CONFIGURED',currentAvailability:licensedConfigured,credentialsPermissionRequirement:'EGX_HISTORY_API_URL and optional EGX_HISTORY_API_KEY secret',productionApprovalEvidence:['data/historical-source-registry.json']},
      {sourceId:'yahoo_chart_public_api',classification:'HISTORICAL_ONLY',sourceType:'public chart JSON',authoritativeScope:'historical backfill/diagnostics; not current canonical truth in this G11 closure',currentSessionCapability:false,ohlcSupport:true,volumeSupport:true,turnoverSupport:false,historicalDepth:'provider dependent',securityCoverage:'partial .CA',symbolScheme:'ticker.CA',existingAdapter:'scripts/history/adapters/yahoo-history-adapter.cjs',validationStatus:'NOT_APPROVED_FOR_CURRENT_TRUTH_THIS_RUN',currentAvailability:false,credentialsPermissionRequirement:'none',productionApprovalEvidence:['docs/astra/G11_SOURCE_IDENTITY_REPAIR.json']},
      {sourceId:'tradingview_public_symbol_pages',classification:'RESEARCH_ONLY',sourceType:'public reference page',authoritativeScope:'symbol resolution/reference only',currentSessionCapability:false,ohlcSupport:false,volumeSupport:false,turnoverSupport:false,historicalDepth:null,securityCoverage:'reference only',symbolScheme:'public symbol page',existingAdapter:null,validationStatus:'REFERENCE_ONLY',currentAvailability:false,credentialsPermissionRequirement:'none',productionApprovalEvidence:['data/historical-source-registry.json']},
      {sourceId:'legacy_engine_decision_outputs',classification:'LEGACY_DECISION_SOURCE_FORBIDDEN',sourceType:'legacy recommendation/decision artifacts',authoritativeScope:'never market truth',currentSessionCapability:false,ohlcSupport:false,volumeSupport:false,turnoverSupport:false,historicalDepth:null,securityCoverage:null,symbolScheme:null,existingAdapter:null,validationStatus:'FORBIDDEN_FOR_G11_MARKET_TRUTH',currentAvailability:false,credentialsPermissionRequirement:'n/a',productionApprovalEvidence:['G11 no-legacy-output policy']},
    ],
    discoveredRegistrySourceCount:Array.isArray(hist.sources)?hist.sources.length:0,
  };
}

function buildPrecedence(expectedSession) {
  return {
    schemaVersion:'astra-g11-source-precedence-1', generatedAt:nowIso(), expectedSession,
    rules:[
      {priority:1,sourceId:'starta_egx_exact',role:'PRIMARY_APPROVED_EXISTING',requirements:['exact EGX source identity','expected-session row','valid OHLCV','no ISIN conflict']},
      {priority:2,sourceId:'egx_official_public_pages',role:'APPROVED_FALLBACK',requirements:['exact symbol evidence','explicit expected-session date','valid OHLCV']},
      {priority:3,sourceId:'optional_licensed_eod_provider',role:'APPROVED_FALLBACK_IF_CONFIGURED',requirements:['configured project secret','exact source symbol when supplied','expected-session row','valid OHLCV']},
      {priority:4,sourceId:'mubasher_public_stock_pages',role:'APPROVED_FALLBACK',requirements:['exact EGX stock route','explicit expected-session date','valid OHLCV']},
      {priority:5,sourceId:'approved_reviewed_import',role:'APPROVED_FALLBACK',requirements:['approved=true','symbolVerified=true','allowed source','expected-session row','valid OHLCV']},
      {priority:99,sourceId:'UNAVAILABLE',role:'EXPLICIT_DIAGNOSTIC',requirements:['never carry forward','never use legacy decisions','never silently null']},
    ],
    sourceMixing:{allowed:false,reason:'G11 current canonical OHLCV is atomic per security/session. Derived turnover close*volume is downstream and explicitly identified, not silent source blending.'},
    disagreementPolicy:{materialCloseTolerancePct:Number(read('data/history-gap-diagnostics-config.json',{}).overlapCloseTolerancePct ?? 0.25),materialCloseToleranceAbsoluteEgp:Number(read('data/history-gap-diagnostics-config.json',{}).overlapCloseToleranceAbsolute ?? 0.02),rule:'If two approved current sources materially disagree after session/unit validation, persist neither fallback row and emit a blocker.'},
  };
}

async function main() {
  const identity = read('docs/astra/G11_SOURCE_IDENTITY_REPAIR.json', {});
  const stale = read('docs/astra/G11_STALE_RECORDS.json', { records:[] });
  const symbolMap = read('data/symbol-map.json', {});
  const expectedSession = identity.expectedSession || stale.expectedSession || '2026-09-16';
  const catalog = loadApprovedCatalog();
  const registry = buildSourceRegistry(expectedSession);
  const precedence = buildPrecedence(expectedSession);
  write('docs/astra/G11_APPROVED_SOURCE_REGISTRY.json', registry);
  write('docs/astra/G11_SOURCE_PRECEDENCE.json', precedence);

  const noncoverage = (identity.records || []).filter((x) => NONCOVERAGE_FINALS.has(x.finalDisposition)).map((x) => safeTicker(x.canonicalTicker));
  const invalid = (identity.records || []).filter((x) => x.finalDisposition === 'PRODUCTION_RELEVANT_INVALID_SOURCE_BLOCKER').map((x) => safeTicker(x.canonicalTicker));
  const staleTickers = (stale.records || []).map((x) => safeTicker(x.ticker));
  const results = [];
  const changedHistory = [];
  const changedSecurityStatus = [];

  for (const ticker of noncoverage) {
    const mapEntry = symbolMap[ticker] || { ticker };
    const baseline = (identity.records || []).find((x) => safeTicker(x.canonicalTicker) === ticker) || {};
    const directCatalog = catalog.bySymbol.has(ticker);
    const replacement = exactCatalogReplacement(mapEntry, catalog);
    const nonSecurityArtifact = explicitNonSecurityArtifact(mapEntry, catalog);
    let finalDisposition = 'ACTIVE_SECURITY_NO_APPROVED_CURRENT_SOURCE';
    let replacementEvidence = null;
    let fallback = { candidates:[], attempts:[], disagreements:[] };

    if (replacement) {
      const replEntry = symbolMap[replacement.replacement] || { ticker:replacement.replacement };
      try {
        const source = await fetchExactEgxHistory(replEntry, { periodCandidates:['1y'], maximumRowsPerRequest:500, requestTimeoutMs:12000, retryCount:1 });
        const current = source.sessions.find((x) => x.date === expectedSession);
        if (source.identity?.verified && current) {
          finalDisposition = 'SECURITY_STATUS_CHANGED';
          replacementEvidence = { canonicalReplacement:replacement.replacement, exactAliasEvidence:replacement.evidenceTokens, replacementSourceIdentity:source.identity, replacementCurrentSession:current.date, replacementSourceUrl:source.sourceUrl };
          mapEntry.active = false;
          mapEntry.g11Exclusion = { status:'SECURITY_STATUS_CHANGED', canonicalReplacement:replacement.replacement, reason:'legacy/duplicate alias matched exactly to approved catalog identity and replacement has exact current source evidence', evaluatedAt:nowIso() };
          changedSecurityStatus.push({ ticker, disposition:finalDisposition, replacement:replacement.replacement });
        }
      } catch (error) {
        replacementEvidence = { canonicalReplacement:replacement.replacement, exactAliasEvidence:replacement.evidenceTokens, verificationError:error.message };
      }
    }

    if (finalDisposition === 'ACTIVE_SECURITY_NO_APPROVED_CURRENT_SOURCE' && nonSecurityArtifact) {
      fallback = await probeApprovedFallbacks(ticker, expectedSession);
      const hasValid = fallback.candidates.length > 0 && fallback.disagreements.length === 0;
      if (!hasValid) {
        finalDisposition = 'LEGITIMATE_SOURCE_SCOPE_EXCLUSION';
        mapEntry.active = false;
        mapEntry.g11Exclusion = { status:'LEGITIMATE_SOURCE_SCOPE_EXCLUSION', reason:'token is absent from approved EGX catalog, has no company/ISIN identity, and was discovered only from derived ranking/watchlist artifacts; approved live probes supplied no valid current row', evaluatedAt:nowIso() };
        changedSecurityStatus.push({ ticker, disposition:finalDisposition, replacement:null });
      }
    }

    if (finalDisposition === 'ACTIVE_SECURITY_NO_APPROVED_CURRENT_SOURCE') {
      fallback = await probeApprovedFallbacks(ticker, expectedSession);
      if (fallback.disagreements.length) finalDisposition = 'ACTIVE_SECURITY_NO_APPROVED_CURRENT_SOURCE';
      else if (fallback.candidates.length) {
        const chosen = fallback.candidates[0];
        const persisted = persistApprovedCurrentRow(ticker, mapEntry, chosen, expectedSession);
        changedHistory.push({ ticker, ...persisted });
        finalDisposition = chosen.sourceId.includes('starta') ? 'RESOLVED_APPROVED_PRIMARY' : 'RESOLVED_APPROVED_FALLBACK';
      }
    }

    results.push({
      securityId:`EGX:${ticker}`, ticker,
      primarySourceResult:baseline.rootCause || baseline.repairedMappingStatus || null,
      approvedCatalogDirect:directCatalog,
      exactCatalogReplacement:replacementEvidence,
      approvedFallbackSources:fallback.candidates.map((x) => x.sourceId),
      currentExpectedSessionRowAvailable:finalDisposition.startsWith('RESOLVED_'),
      symbolVerified:finalDisposition.startsWith('RESOLVED_') || ['SECURITY_STATUS_CHANGED','LEGITIMATE_SOURCE_SCOPE_EXCLUSION'].includes(finalDisposition),
      ohlcValid:finalDisposition.startsWith('RESOLVED_'), volumeValid:finalDisposition.startsWith('RESOLVED_'), turnoverValid:finalDisposition.startsWith('RESOLVED_') ? 'DERIVABLE_CLOSE_X_VOLUME' : false,
      freshnessValid:finalDisposition.startsWith('RESOLVED_'),
      sourceProvenance:{ baselineEvidence:baseline.evidence || [], fallbackAttempts:fallback.attempts },
      sourceDisagreements:fallback.disagreements,
      finalDisposition,
    });
  }

  const invalidResults = [];
  for (const ticker of invalid) {
    const mapEntry = symbolMap[ticker] || { ticker };
    const startaDiagnosis = await diagnoseExactEgxHistory(mapEntry, { periodCandidates:['1y','2y'], maximumRowsPerRequest:1000, requestTimeoutMs:12000, retryCount:1 });
    const fallback = await probeApprovedFallbacks(ticker, expectedSession);
    let finalDisposition = 'ACTIVE_SECURITY_NO_APPROVED_CURRENT_SOURCE';
    let persisted = null;
    if (!fallback.disagreements.length && fallback.candidates.length) {
      persisted = persistApprovedCurrentRow(ticker, mapEntry, fallback.candidates[0], expectedSession);
      changedHistory.push({ ticker, ...persisted });
      finalDisposition = 'RESOLVED_APPROVED_FALLBACK';
    }
    invalidResults.push({ securityId:`EGX:${ticker}`, ticker, startaDiagnosis, parserOrSourceConclusion:startaDiagnosis.periods?.some((x) => x.rawRowCount > 0 && x.validRowCount === 0) ? 'SOURCE_DATA_REJECTED_BY_UNCHANGED_OHLCV_VALIDATION_RULES' : 'NO_VALID_STARTA_ROW_PROVEN', approvedFallbackSources:fallback.candidates.map((x) => x.sourceId), fallbackAttempts:fallback.attempts, sourceDisagreements:fallback.disagreements, persisted, finalDisposition });
  }

  const staleResults = [];
  for (const ticker of staleTickers) {
    const mapEntry = symbolMap[ticker] || { ticker };
    const baseline = (stale.records || []).find((x) => safeTicker(x.ticker) === ticker) || {};
    let finalDisposition = 'EXTERNAL_CURRENT_DATA_UNAVAILABLE';
    let primary = null, fallback = { candidates:[], attempts:[], disagreements:[] }, persisted = null;
    try {
      const currentPrimary = await fetchExactEgxHistory(mapEntry, { periodCandidates:['1y'], maximumRowsPerRequest:500, requestTimeoutMs:12000, retryCount:1 });
      const row = currentPrimary.sessions.find((x) => x.date === expectedSession);
      if (row) {
        primary = { ok:true, sourceId:'starta_egx_exact', sourceUrl:currentPrimary.sourceUrl, row };
        const candidate = { sourceId:'starta_egx_exact', priority:75, row:{ ticker, sourceSymbol:ticker, sessionDate:row.date, open:row.open, high:row.high, low:row.low, close:row.close, volume:row.volume, turnover:null, sourceId:'starta_egx_exact', sourceUrl:currentPrimary.sourceUrl, fetchedAt:row.fetchedAt } };
        persisted = persistApprovedCurrentRow(ticker, mapEntry, candidate, expectedSession);
        changedHistory.push({ ticker, ...persisted });
        finalDisposition = 'RESOLVED_FRESH_PRIMARY';
      } else primary = { ok:false, latestSession:currentPrimary.sessions.at(-1)?.date || null, sourceUrl:currentPrimary.sourceUrl };
    } catch (error) { primary = { ok:false, error:error.message }; }
    if (finalDisposition !== 'RESOLVED_FRESH_PRIMARY') {
      fallback = await probeApprovedFallbacks(ticker, expectedSession);
      if (!fallback.disagreements.length && fallback.candidates.length) {
        persisted = persistApprovedCurrentRow(ticker, mapEntry, fallback.candidates[0], expectedSession);
        changedHistory.push({ ticker, ...persisted });
        finalDisposition = 'RESOLVED_FRESH_APPROVED_FALLBACK';
      }
    }
    staleResults.push({ securityId:`EGX:${ticker}`, ticker, expectedSession, canonicalSessionBefore:baseline.actualSession || null, primarySourceLatestSession:primary?.row?.date || primary?.latestSession || null, primarySource:primary, approvedFallbackLatestSession:fallback.candidates[0]?.row?.sessionDate || null, securityTraded:null, suspended:null, sourceMissing:!primary?.ok, adapterParserFailed:Boolean(primary?.error), cacheStale:false, sourceIdentityFailed:/identity|404/i.test(String(primary?.error || '')), finalDisposition, fallbackAttempts:fallback.attempts, sourceDisagreements:fallback.disagreements, persisted });
  }

  write('data/symbol-map.json', symbolMap);
  const activeEntries = Object.values(symbolMap).filter((x) => x && x.ticker && x.active !== false).sort((a,b) => safeTicker(a.ticker).localeCompare(safeTicker(b.ticker)));
  const summary = buildSummary(ROOT, activeEntries, {
    egx:{ status:'approved_import_supported', role:'official verification and fallback' },
    yahoo:{ status:'historical_only_for_g11_current_truth', role:'historical backfill' },
    mubasher:{ status:'approved_import_supported', role:'strict current cross-check and fallback' },
    starta:{ status:'approved_existing_exact_symbol', role:'primary G11 exact current/history repair' },
  });
  buildSessionCalendar(ROOT, summary);

  const report = {
    schemaVersion:'astra-g11-approved-source-closure-1', generatedAt:nowIso(), expectedSession,
    noncoverage:{ total:noncoverage.length, records:results },
    invalidSource:{ total:invalid.length, records:invalidResults },
    stale:{ total:staleTickers.length, records:staleResults },
    mutations:{ changedHistory, changedSecurityStatus },
    safety:{ fuzzyMatching:false, previousSessionCarryForward:false, syntheticMarketData:false, legacyDecisionOutputUsed:false, randomInternetProviderUsed:false, sourceMixing:false },
  };
  write('docs/astra/G11_APPROVED_SOURCE_CLOSURE_RUN.json', report);
  console.log('ASTRA_G11_APPROVED_SOURCE_CLOSURE ' + JSON.stringify({ noncoverage:results.map((x)=>[x.ticker,x.finalDisposition]), invalid:invalidResults.map((x)=>[x.ticker,x.finalDisposition]), stale:staleResults.map((x)=>[x.ticker,x.finalDisposition]), changedHistory:changedHistory.length, changedSecurityStatus:changedSecurityStatus.length, activeAfter:activeEntries.length }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
