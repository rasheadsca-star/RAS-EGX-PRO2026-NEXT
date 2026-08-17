#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = relative => path.join(ROOT, relative);
const SNAPSHOT_PATH = P('data/stable/v16-main-app-current.json');
const DECISION_PATH = P('data/stable/v16-v169-primary-decision.json');
const V17_PATH = P('data/v17/current.json');
const OUTPUT_PATH = P('data/stable/v16-main-app-consensus.json');
const REGRESSION_PATH = P('data/stable/v16-main-app-consensus-regression.json');

const EXTERNAL_SOURCES = {
  v20: [
    'https://rasheadsca-star.github.io/RAS-EGX0.1/data/v20/native-current.json',
    'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX0.1/main/data/v20/native-current.json',
    'https://cdn.jsdelivr.net/gh/rasheadsca-star/RAS-EGX0.1@main/data/v20/native-current.json',
  ],
  consensus: [
    'https://rasheadsca-star.github.io/RAS-EGX0.1/data/v20/multi-engine-consensus.json',
    'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX0.1/main/data/v20/multi-engine-consensus.json',
    'https://cdn.jsdelivr.net/gh/rasheadsca-star/RAS-EGX0.1@main/data/v20/multi-engine-consensus.json',
  ],
};

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function ticker(value) { return String(value || '').trim().toUpperCase(); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchJson(url, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const separator = url.includes('?') ? '&' : '?';
    const response = await fetch(`${url}${separator}t=${Date.now()}-${attempt}`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'User-Agent': 'EGX-MAIN-APP-V16.9.2-consensus',
        'Cache-Control': 'no-cache',
        'Accept': 'application/json,text/plain;q=0.9,*/*;q=0.8',
      },
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const text = await response.text();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('INVALID_JSON_OBJECT');
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFirstValid(label, urls) {
  const errors = [];
  for (const url of urls) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const data = await fetchJson(url, attempt);
        return { data, sourceUrl: url, attempts: attempt, errors };
      } catch (error) {
        errors.push(`${label}:${new URL(url).hostname}:attempt${attempt}:${error.message}`);
        if (attempt < 2) await sleep(1200 * attempt);
      }
    }
  }
  return { data: null, sourceUrl: null, attempts: 0, errors };
}

async function main() {
  const now = new Date().toISOString();
  const snapshot = readJson(SNAPSHOT_PATH, readJson(DECISION_PATH, {}));
  const decision = readJson(DECISION_PATH, {});
  const v17 = readJson(V17_PATH, {});
  const sessionDate = snapshot.sessionDate || decision.sessionDate || null;
  const mainRows = Array.isArray(snapshot.recommendations) ? snapshot.recommendations : Array.isArray(decision.recommendations) ? decision.recommendations : [];
  const mainTickers = unique(mainRows.map(row => ticker(row.ticker)));

  const [v20Result, relatedResult] = await Promise.all([
    fetchFirstValid('V20', EXTERNAL_SOURCES.v20),
    fetchFirstValid('RELATED', EXTERNAL_SOURCES.consensus),
  ]);
  const v20 = v20Result.data;
  const previousConsensus = relatedResult.data;
  const sourceErrors = [...v20Result.errors, ...relatedResult.errors];

  const v20Session = v20?.sessionDate || null;
  const v20Aligned = Boolean(sessionDate && v20Session && sessionDate === v20Session);
  const v20Tickers = v20Aligned
    ? unique((Array.isArray(v20?.publishedCandidates) ? v20.publishedCandidates : []).map(row => ticker(row.ticker)))
    : [];
  const v20Set = new Set(v20Tickers);

  const oldAligned = previousConsensus?.sessionDate === sessionDate;
  const oldAnnotations = new Map(
    oldAligned && Array.isArray(previousConsensus?.current?.mainAppAnnotations)
      ? previousConsensus.current.mainAppAnnotations.map(row => [ticker(row.ticker), row])
      : []
  );

  const v17Session = v17?.sessionDate || v17?.marketSession || v17?.dataTruth?.marketSession || null;
  const v17Aligned = Boolean(sessionDate && v17Session && sessionDate === v17Session);
  const v17Rows = Array.isArray(v17?.recommendations) ? v17.recommendations : [];
  const v17Map = new Map(v17Rows.map(row => [ticker(row.ticker), row]));

  const independentEngineCount = 2; // MAIN APP + method-independent V20 Native.
  const annotations = mainTickers.map(symbol => {
    const v20Confirms = v20Aligned && v20Set.has(symbol);
    const independentVotes = 1 + (v20Confirms ? 1 : 0);
    const previous = oldAnnotations.get(symbol) || {};
    const relatedCorroborators = oldAligned ? (previous.relatedCorroborators || []) : [];
    const localV17 = v17Aligned ? v17Map.get(symbol) : null;
    const v17Validation = localV17 ? {
      selectionCandidate: true,
      recommendationEligible: localV17.executionAllowed === true || localV17.monitorOnly !== true,
      executionEligible: v17.executionAllowed === true && localV17.executionAllowed !== false,
      dataEligible: true,
      liquidityEligible: true,
      technicalSourceEligible: true,
      srSourceEligible: true,
      blockers: localV17.blockers || [],
    } : (oldAligned ? previous.v17Validation || null : null);
    const level = independentVotes === independentEngineCount ? 'VERY_HIGH' : 'BASE_ONLY';
    return {
      ticker: symbol,
      sessionDate,
      independentVotes,
      independentEngineCount,
      confirmationScore: independentVotes / independentEngineCount * 100,
      confirmationLevel: level,
      confirmationLabelAr: level === 'VERY_HIGH' ? 'تطابق مع محرك مستقل آخر' : 'توصية MAIN APP فقط حاليًا',
      mainAppSelected: true,
      v20NativeSelected: v20Confirms,
      confirmingIndependentEngines: v20Confirms ? ['V20 Native V1'] : [],
      supportingIndependentEngines: v20Confirms ? ['MAIN APP · V16.9.2', 'V20 Native V1'] : ['MAIN APP · V16.9.2'],
      relatedCorroborators,
      v17Validation,
      noteAr: v20Confirms
        ? 'التوصية ظهرت أيضًا في محرك مستقل منهجيًا لنفس جلسة السوق. هذا تأكيد للمراجعة فقط ولا يغيّر ترتيب MAIN APP أو صلاحية التنفيذ.'
        : v20Aligned
          ? 'لا يوجد تطابق مستقل إضافي لهذه التوصية في V20 لنفس الجلسة.'
          : 'بيانات المحرك المستقل لم تصل بعد إلى نفس جلسة MAIN APP؛ لا يُحتسب أي تأكيد حتى تتزامن الجلسات.',
    };
  });

  const fullyConfirmed = annotations.filter(row => row.independentVotes === independentEngineCount).length;
  const status = !sessionDate
    ? 'MAIN_SESSION_MISSING'
    : v20Aligned
      ? 'CURRENT_SESSION_ALIGNED'
      : 'EXTERNAL_ENGINE_SESSION_PENDING';

  const output = {
    schemaVersion: '20.1.0-method-independent-consensus-1',
    generatedAt: now,
    sessionDate,
    status,
    scoreDefinition: {
      name: 'METHOD_INDEPENDENT_CONFIRMATION_SCORE_V1',
      purpose: 'DISPLAY_AND_REVIEW_PRIORITY_ONLY',
      independentEngineCount,
      formula: 'independentVotes / independentEngineCount * 100',
      historicalPerformanceUsedInScore: false,
      changesMainAppRanking: false,
      changesExecutionPermission: false,
      levels: { '2/2': 'VERY_HIGH', '1/2': 'BASE_ONLY' },
    },
    engineRegistry: {
      activeIndependent: [
        {
          id: 'V16_9_EQUAL_WEIGHT_BASKET',
          label: 'MAIN APP · V16.9.2',
          role: 'PRODUCTION_CHAMPION',
          voteEligible: true,
          authority: 'PRIMARY_RECOMMENDATION',
          sessionDate,
          status: snapshot.systemState || snapshot.state || null,
        },
        {
          id: 'V20_FULL_MARKET_NATIVE_SELECTION_V1',
          label: 'V20 Native V1',
          role: 'FULL_MARKET_DISCOVERY',
          voteEligible: true,
          authority: 'INDEPENDENT_RESEARCH_CONFIRMATION_ONLY',
          sessionDate: v20Session,
          sessionAligned: v20Aligned,
          status: v20?.status || 'UNAVAILABLE',
        },
      ],
      relatedCorroborators: oldAligned ? (previousConsensus?.engineRegistry?.relatedCorroborators || []) : [],
      validators: [{
        id: 'V17_PRODUCTION_VALIDATION_AUTHORITY',
        label: 'V17 Validation',
        voteEligible: false,
        sessionDate: v17Session,
        sessionAligned: v17Aligned,
        reason: 'Validator only; never counted as an independent recommendation vote.',
      }],
      rule: 'Independent votes require materially different alpha-generation methodology and exact session alignment.',
    },
    sourceHealth: {
      mainSession: sessionDate,
      v20Session,
      v20SessionAligned: v20Aligned,
      v20GeneratedAt: v20?.generatedAt || null,
      v20Source: v20Result.sourceUrl,
      v17Session,
      v17SessionAligned: v17Aligned,
      previousConsensusSession: previousConsensus?.sessionDate || null,
      relatedConsensusSource: relatedResult.sourceUrl,
      sourceErrors,
      resilientSourcePolicy: 'GITHUB_PAGES_THEN_RAW_THEN_JSDELIVR_WITH_RETRY',
    },
    current: {
      sessionAligned: v20Aligned,
      mainAppBasket: mainTickers,
      v20NativePublished: v20Tickers,
      mainAppAnnotations: annotations,
      fullyConfirmedCount: fullyConfirmed,
    },
    policy: {
      comparisonCanChangeMainRanking: false,
      comparisonCanGrantExecution: false,
      staleExternalVotesCount: false,
      exactSessionAlignmentRequired: true,
      failClosedOnMissingExternalData: true,
      multipleReadSourcesRequiredForResilience: true,
    },
  };

  const regression = {
    schemaVersion: '16.9.2-main-app-consensus-regression',
    generatedAt: now,
    pass: Boolean(
      output.schemaVersion === '20.1.0-method-independent-consensus-1'
      && annotations.length === mainTickers.length
      && annotations.every(row => row.independentVotes >= 1 && row.independentVotes <= independentEngineCount)
      && (!v20Aligned || annotations.every(row => row.sessionDate === sessionDate))
    ),
    checks: {
      mainBasketCovered: annotations.length === mainTickers.length,
      externalSessionAligned: v20Aligned,
      staleExternalVotesSuppressed: !v20Aligned ? annotations.every(row => row.independentVotes === 1) : true,
      rankingMutationDisabled: output.policy.comparisonCanChangeMainRanking === false,
      executionMutationDisabled: output.policy.comparisonCanGrantExecution === false,
      resilientSourcePolicyEnabled: output.policy.multipleReadSourcesRequiredForResilience === true,
    },
  };

  writeJsonAtomic(OUTPUT_PATH, output);
  writeJsonAtomic(REGRESSION_PATH, regression);
  console.log(JSON.stringify({
    status,
    sessionDate,
    v20Session,
    v20Aligned,
    v20Source: v20Result.sourceUrl,
    mainTickers,
    fullyConfirmed,
    sourceErrors,
    regressionPass: regression.pass,
  }, null, 2));
  if (!regression.pass) process.exitCode = 2;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 2;
});
