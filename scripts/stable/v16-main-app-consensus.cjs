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
  familyConsensus: [
    'https://rasheadsca-star.github.io/RAS-EGX0.1/data/v20/multi-engine-consensus.json',
    'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX0.1/main/data/v20/multi-engine-consensus.json',
    'https://cdn.jsdelivr.net/gh/rasheadsca-star/RAS-EGX0.1@main/data/v20/multi-engine-consensus.json',
  ],
  quantEdge: [
    'https://quant-edge-shadow.vercel.app/api/run',
    'https://quant-edge-shadow-steverabin38-1168s-projects.vercel.app/api/run',
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
function setOfRows(rows) { return new Set(unique((Array.isArray(rows) ? rows : []).map(row => ticker(row?.ticker || row)))); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchJson(url, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const separator = url.includes('?') ? '&' : '?';
    const response = await fetch(`${url}${separator}t=${Date.now()}-${attempt}`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'User-Agent': 'EGX-MAIN-APP-V16.9.2-all-engine-comparison',
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

function engineState({ id, label, role, family, sessionDate, mainSession, selectedSet, sourceStatus, blocked = false, sourceUrl = null }) {
  const hasSession = Boolean(sessionDate);
  const sessionAligned = Boolean(mainSession && hasSession && sessionDate === mainSession && !blocked);
  return {
    id,
    label,
    role,
    family,
    sessionDate: sessionDate || null,
    sessionAligned,
    sourceStatus: sourceStatus || (hasSession ? 'AVAILABLE' : 'UNAVAILABLE'),
    blocked: Boolean(blocked),
    sourceUrl,
    selectedTickers: sessionAligned ? [...selectedSet] : [],
  };
}

function comparisonForTicker(engine, symbol) {
  const selected = engine.sessionAligned ? engine.selectedTickers.includes(symbol) : null;
  const agreementStatus = !engine.sessionAligned
    ? (engine.blocked ? 'BLOCKED_OR_STALE' : 'SESSION_PENDING')
    : selected
      ? 'AGREE'
      : 'NO_MATCH';
  return {
    id: engine.id,
    label: engine.label,
    role: engine.role,
    family: engine.family,
    sessionDate: engine.sessionDate,
    sessionAligned: engine.sessionAligned,
    blocked: engine.blocked,
    selected,
    agreementStatus,
    sourceStatus: engine.sourceStatus,
  };
}

async function main() {
  const now = new Date().toISOString();
  const snapshot = readJson(SNAPSHOT_PATH, readJson(DECISION_PATH, {}));
  const decision = readJson(DECISION_PATH, {});
  const v17 = readJson(V17_PATH, {});
  const sessionDate = snapshot.sessionDate || decision.sessionDate || null;
  const mainRows = Array.isArray(snapshot.recommendations)
    ? snapshot.recommendations
    : Array.isArray(decision.recommendations)
      ? decision.recommendations
      : [];
  const mainTickers = unique(mainRows.map(row => ticker(row.ticker)));

  const [v20Result, familyResult, quantResult] = await Promise.all([
    fetchFirstValid('V20', EXTERNAL_SOURCES.v20),
    fetchFirstValid('FAMILY', EXTERNAL_SOURCES.familyConsensus),
    fetchFirstValid('QUANT', EXTERNAL_SOURCES.quantEdge),
  ]);

  const v20 = v20Result.data;
  const familyConsensus = familyResult.data;
  const quant = quantResult.data;
  const sourceErrors = [...v20Result.errors, ...familyResult.errors, ...quantResult.errors];

  const v17Session = v17?.sessionDate || v17?.marketSession || v17?.dataTruth?.marketSession || null;
  const v17Set = setOfRows(v17?.recommendations);

  const v19Session = familyConsensus?.sessionDate || null;
  const v19Set = new Set(unique(Array.isArray(familyConsensus?.current?.v19Selected) ? familyConsensus.current.v19Selected.map(ticker) : []));

  const v20Session = v20?.sessionDate || null;
  const v20Set = setOfRows(v20?.publishedCandidates);

  const quantSession = quant?.asOf || quant?.sessionDate || null;
  const quantFresh = quant?.blocked !== true
    && quant?.freshness?.isFresh === true
    && quantSession === sessionDate;
  const quantSet = setOfRows(quant?.recommendations);

  const comparisonEngines = [
    engineState({
      id: 'V17_VALIDATION',
      label: 'V17',
      role: 'RELATED_VALIDATOR_ENGINE',
      family: 'V16_9_METHOD_RELATED',
      sessionDate: v17Session,
      mainSession: sessionDate,
      selectedSet: v17Set,
      sourceStatus: v17?.status || 'UNAVAILABLE',
    }),
    engineState({
      id: 'V19_CHALLENGER',
      label: 'V19 Challenger',
      role: 'RELATED_CHALLENGER',
      family: 'TOP10_PROBABILITY_RELATED',
      sessionDate: v19Session,
      mainSession: sessionDate,
      selectedSet: v19Set,
      sourceStatus: familyConsensus?.status || 'UNAVAILABLE',
      sourceUrl: familyResult.sourceUrl,
    }),
    engineState({
      id: 'V20_NATIVE',
      label: 'V20 Native',
      role: 'INDEPENDENT_DISCOVERY_ENGINE',
      family: 'MULTI_COMPONENT_EVIDENCE_COMPOSITE',
      sessionDate: v20Session,
      mainSession: sessionDate,
      selectedSet: v20Set,
      sourceStatus: v20?.status || 'UNAVAILABLE',
      sourceUrl: v20Result.sourceUrl,
    }),
    engineState({
      id: 'QUANT_EDGE',
      label: 'QUANT EDGE',
      role: 'INDEPENDENT_SHADOW_ENGINE',
      family: 'INDEPENDENT_QUANT_STRATEGY_STACK',
      sessionDate: quantSession,
      mainSession: quantFresh ? sessionDate : '__NOT_ALIGNED__',
      selectedSet: quantSet,
      sourceStatus: quant?.acceptance?.status || quant?.sourceGrade || 'UNAVAILABLE',
      blocked: quant?.blocked === true || quant?.freshness?.isFresh !== true,
      sourceUrl: quantResult.sourceUrl,
    }),
  ];

  const totalOtherEngineCount = comparisonEngines.length;
  const alignedOtherEngineCount = comparisonEngines.filter(engine => engine.sessionAligned).length;
  const pendingOtherEngineCount = totalOtherEngineCount - alignedOtherEngineCount;

  // Independent confidence is separate from the raw agreement count. V19 and
  // V17 are deliberately excluded from the independent score because they are
  // method-related to MAIN APP. V20 and QUANT EDGE are method-independent.
  const independentExternalIds = new Set(['V20_NATIVE', 'QUANT_EDGE']);
  const independentEngineCount = 3; // MAIN APP + V20 Native + QUANT EDGE.

  const annotations = mainTickers.map(symbol => {
    const engineComparisons = comparisonEngines.map(engine => comparisonForTicker(engine, symbol));
    const agreementCount = engineComparisons.filter(engine => engine.sessionAligned && engine.selected === true).length;
    const disagreementCount = engineComparisons.filter(engine => engine.sessionAligned && engine.selected === false).length;
    const pendingCount = engineComparisons.filter(engine => !engine.sessionAligned).length;
    const independentMatches = engineComparisons.filter(engine => independentExternalIds.has(engine.id) && engine.sessionAligned && engine.selected === true);
    const independentAligned = engineComparisons.filter(engine => independentExternalIds.has(engine.id) && engine.sessionAligned);
    const independentVotes = 1 + independentMatches.length;
    const independentAlignedVotesPossible = 1 + independentAligned.length;
    const confirmationScore = independentVotes / independentEngineCount * 100;
    const confirmationLevel = independentVotes === independentEngineCount
      ? 'VERY_HIGH'
      : independentVotes > 1
        ? 'PARTIAL_INDEPENDENT_CONFIRMATION'
        : 'BASE_ONLY';

    return {
      ticker: symbol,
      sessionDate,
      mainAppSelected: true,
      agreementCount,
      otherEngineCount: totalOtherEngineCount,
      alignedEngineCount: alignedOtherEngineCount,
      disagreementCount,
      pendingEngineCount: pendingCount,
      agreementPctOfAllEngines: totalOtherEngineCount ? agreementCount / totalOtherEngineCount * 100 : 0,
      agreementPctOfAlignedEngines: alignedOtherEngineCount ? agreementCount / alignedOtherEngineCount * 100 : null,
      agreementLabelAr: `التوافق مع باقي المحركات ${agreementCount}/${totalOtherEngineCount}`,
      alignmentLabelAr: `المتزامن ${alignedOtherEngineCount}/${totalOtherEngineCount}`,
      engineComparisons,
      independentVotes,
      independentEngineCount,
      independentAlignedEngineCount: independentAlignedVotesPossible,
      confirmationScore,
      confirmationLevel,
      confirmationLabelAr: confirmationLevel === 'VERY_HIGH'
        ? 'تأكيد مستقل كامل'
        : confirmationLevel === 'PARTIAL_INDEPENDENT_CONFIRMATION'
          ? 'تأكيد مستقل جزئي'
          : 'لا يوجد تأكيد مستقل متزامن بعد',
      confirmingIndependentEngines: independentMatches.map(engine => engine.label),
      supportingIndependentEngines: ['MAIN APP · V16.9.2', ...independentMatches.map(engine => engine.label)],
      relatedCorroborators: engineComparisons
        .filter(engine => ['V17_VALIDATION', 'V19_CHALLENGER'].includes(engine.id) && engine.sessionAligned && engine.selected === true)
        .map(engine => engine.label),
      noteAr: alignedOtherEngineCount === 0
        ? 'لا يوجد محرك آخر متزامن مع جلسة MAIN APP الحالية حتى الآن؛ العدد سيُحدّث تلقائيًا فور وصول أي محرك لنفس الجلسة.'
        : agreementCount > 0
          ? `${agreementCount} من ${totalOtherEngineCount} محركات أخرى اختارت السهم، و${alignedOtherEngineCount} محركات فقط متزامنة حاليًا مع نفس الجلسة.`
          : `${alignedOtherEngineCount} محركات أخرى متزامنة، ولم يختر أي منها هذا السهم حاليًا.`,
    };
  });

  const fullyConfirmedCount = annotations.filter(row => row.independentVotes === independentEngineCount).length;
  const anyAgreementCount = annotations.filter(row => row.agreementCount > 0).length;
  const status = !sessionDate
    ? 'MAIN_SESSION_MISSING'
    : alignedOtherEngineCount === totalOtherEngineCount
      ? 'ALL_ENGINE_SESSIONS_ALIGNED'
      : alignedOtherEngineCount > 0
        ? 'PARTIAL_ENGINE_SESSION_ALIGNMENT'
        : 'EXTERNAL_ENGINE_SESSION_PENDING';

  const output = {
    schemaVersion: '20.1.0-method-independent-consensus-1',
    comparisonVersion: '16.9.2-all-engine-matrix-1',
    generatedAt: now,
    sessionDate,
    status,
    scoreDefinition: {
      name: 'METHOD_INDEPENDENT_CONFIRMATION_SCORE_V2',
      purpose: 'DISPLAY_AND_REVIEW_PRIORITY_ONLY',
      independentEngineCount,
      formula: 'MAIN_APP_BASE_VOTE + same-session V20 vote + same-session QUANT_EDGE vote',
      historicalPerformanceUsedInScore: false,
      changesMainAppRanking: false,
      changesExecutionPermission: false,
      rawAgreementDefinition: 'Count same-ticker selections across V17, V19, V20 and QUANT EDGE only when each engine is on the exact MAIN APP session.',
    },
    engineRegistry: {
      primary: {
        id: 'V16_9_EQUAL_WEIGHT_BASKET',
        label: 'MAIN APP · V16.9.2',
        role: 'PRODUCTION_CHAMPION',
        sessionDate,
        status: snapshot.systemState || snapshot.state || null,
      },
      comparisonEngines: comparisonEngines.map(engine => ({
        id: engine.id,
        label: engine.label,
        role: engine.role,
        family: engine.family,
        sessionDate: engine.sessionDate,
        sessionAligned: engine.sessionAligned,
        sourceStatus: engine.sourceStatus,
        blocked: engine.blocked,
      })),
      activeIndependent: [
        { id: 'V16_9_EQUAL_WEIGHT_BASKET', label: 'MAIN APP · V16.9.2', sessionDate, voteEligible: true },
        { id: 'V20_NATIVE', label: 'V20 Native', sessionDate: v20Session, sessionAligned: comparisonEngines[2].sessionAligned, voteEligible: true },
        { id: 'QUANT_EDGE', label: 'QUANT EDGE', sessionDate: quantSession, sessionAligned: comparisonEngines[3].sessionAligned, voteEligible: true, blocked: comparisonEngines[3].blocked },
      ],
      relatedCorroborators: [
        { id: 'V17_VALIDATION', label: 'V17', sessionDate: v17Session, sessionAligned: comparisonEngines[0].sessionAligned, voteEligible: false },
        { id: 'V19_CHALLENGER', label: 'V19 Challenger', sessionDate: v19Session, sessionAligned: comparisonEngines[1].sessionAligned, voteEligible: false },
      ],
      rule: 'Raw agreement displays every monitored recommendation engine. Independent confirmation counts only materially different alpha-generation methods and requires exact session alignment.',
    },
    sourceHealth: {
      mainSession: sessionDate,
      v17Session,
      v17SessionAligned: comparisonEngines[0].sessionAligned,
      v19Session,
      v19SessionAligned: comparisonEngines[1].sessionAligned,
      v20Session,
      v20SessionAligned: comparisonEngines[2].sessionAligned,
      quantSession,
      quantRequiredSession: quant?.requiredSession || null,
      quantSessionAligned: comparisonEngines[3].sessionAligned,
      quantBlocked: comparisonEngines[3].blocked,
      quantBlockReason: quant?.blockReason || null,
      v20Source: v20Result.sourceUrl,
      familyConsensusSource: familyResult.sourceUrl,
      quantSource: quantResult.sourceUrl,
      sourceErrors,
      resilientSourcePolicy: 'GITHUB_PAGES_THEN_RAW_THEN_JSDELIVR_PLUS_VERCEL_QUANT_WITH_RETRY',
    },
    current: {
      mainAppBasket: mainTickers,
      otherEngineCount: totalOtherEngineCount,
      alignedOtherEngineCount,
      pendingOtherEngineCount,
      anyAgreementCount,
      fullyConfirmedCount,
      engineSessions: comparisonEngines.map(engine => ({
        id: engine.id,
        label: engine.label,
        sessionDate: engine.sessionDate,
        sessionAligned: engine.sessionAligned,
        blocked: engine.blocked,
        sourceStatus: engine.sourceStatus,
      })),
      mainAppAnnotations: annotations,
    },
    policy: {
      comparisonCanChangeMainRanking: false,
      comparisonCanGrantExecution: false,
      staleExternalVotesCount: false,
      exactSessionAlignmentRequired: true,
      failClosedOnMissingExternalData: true,
      rawAgreementIncludesRelatedEngines: true,
      independentConfirmationExcludesRelatedEngines: true,
      allOtherEnginesShownInUi: true,
    },
  };

  const regression = {
    schemaVersion: '16.9.2-main-app-consensus-regression',
    generatedAt: now,
    pass: Boolean(
      output.comparisonVersion === '16.9.2-all-engine-matrix-1'
      && annotations.length === mainTickers.length
      && comparisonEngines.length === 4
      && annotations.every(row => Array.isArray(row.engineComparisons) && row.engineComparisons.length === 4)
      && annotations.every(row => row.agreementCount <= row.alignedEngineCount && row.alignedEngineCount <= row.otherEngineCount)
      && annotations.every(row => row.independentVotes >= 1 && row.independentVotes <= independentEngineCount)
      && annotations.every(row => row.engineComparisons.filter(engine => !engine.sessionAligned).every(engine => engine.selected === null))
    ),
    checks: {
      mainBasketCovered: annotations.length === mainTickers.length,
      allComparisonEnginesRegistered: comparisonEngines.length === 4,
      v17Visible: comparisonEngines.some(engine => engine.id === 'V17_VALIDATION'),
      v19Visible: comparisonEngines.some(engine => engine.id === 'V19_CHALLENGER'),
      v20Visible: comparisonEngines.some(engine => engine.id === 'V20_NATIVE'),
      quantEdgeVisible: comparisonEngines.some(engine => engine.id === 'QUANT_EDGE'),
      staleExternalVotesSuppressed: annotations.every(row => row.engineComparisons.filter(engine => !engine.sessionAligned).every(engine => engine.selected === null)),
      rawAgreementBounded: annotations.every(row => row.agreementCount <= row.alignedEngineCount),
      rankingMutationDisabled: output.policy.comparisonCanChangeMainRanking === false,
      executionMutationDisabled: output.policy.comparisonCanGrantExecution === false,
    },
  };

  writeJsonAtomic(OUTPUT_PATH, output);
  writeJsonAtomic(REGRESSION_PATH, regression);
  console.log(JSON.stringify({
    status,
    sessionDate,
    mainTickers,
    otherEngineCount: totalOtherEngineCount,
    alignedOtherEngineCount,
    sessions: Object.fromEntries(comparisonEngines.map(engine => [engine.id, engine.sessionDate])),
    anyAgreementCount,
    fullyConfirmedCount,
    quantBlocked: comparisonEngines[3].blocked,
    sourceErrors,
    regressionPass: regression.pass,
  }, null, 2));
  if (!regression.pass) process.exitCode = 2;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 2;
});
