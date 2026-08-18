#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const CONSENSUS_PATH = path.join(ROOT, 'data/stable/v16-main-app-consensus.json');
const ACCEPTANCE_PATH = path.join(ROOT, 'data/stable/v16-main-app-v19v6-consensus-acceptance.json');
const V19_ENGINE_ID = 'V19_CHAT_GPT_NATIVE_CHALLENGER_V6';
const CONSENSUS_ENGINE_ID = 'V19_CHALLENGER';
const V19_LABEL = 'V19 V6';
const SOURCES = [
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/v19-egx-chat-gpt/data/v19/native-challenger-v6.json',
  'https://cdn.jsdelivr.net/gh/rasheadsca-star/RAS-EGX-PRO2026-NEXT@v19-egx-chat-gpt/data/v19/native-challenger-v6.json',
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = `${JSON.stringify(value, null, 2)}\n`;
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (prev === next) return false;
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, next, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
  return true;
}
function ticker(value) { return String(value || '').trim().toUpperCase(); }
function unique(values) { return [...new Set((values || []).filter(Boolean))]; }
function isV19Entry(entry) {
  const id = String(entry?.id || '');
  const sourceEngineId = String(entry?.sourceEngineId || '');
  return id === CONSENSUS_ENGINE_ID || id === V19_ENGINE_ID || sourceEngineId === V19_ENGINE_ID;
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchJson(url, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}-${attempt}`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'User-Agent': 'EGX-MAIN-APP-V19-V6-CONSENSUS-ENRICHER',
        'Cache-Control': 'no-cache',
        Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
      },
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const parsed = JSON.parse(await response.text());
    if (!parsed || typeof parsed !== 'object') throw new Error('INVALID_JSON_OBJECT');
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchV19() {
  const errors = [];
  for (const url of SOURCES) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const data = await fetchJson(url, attempt);
        if (data.engineId !== V19_ENGINE_ID) throw new Error(`ENGINE_ID_MISMATCH_${data.engineId || 'missing'}`);
        return { data, sourceUrl: url, errors };
      } catch (error) {
        errors.push(`${new URL(url).hostname}:attempt${attempt}:${error.message}`);
        if (attempt < 2) await sleep(1000 * attempt);
      }
    }
  }
  throw new Error(`V19_V6_SOURCE_UNAVAILABLE ${errors.join(' | ')}`);
}

function selectedTickers(v19) {
  const current = v19?.current || {};
  const explicit = Array.isArray(current.selectedTickers) ? current.selectedTickers.map(ticker) : [];
  if (explicit.length) return unique(explicit);
  const candidates = Array.isArray(current.candidates) ? current.candidates : [];
  return unique(candidates
    .filter(row => row?.selectedByV6 === true || Number(row?.effectivePortfolioWeightPct || row?.baseBasketWeightPct || 0) > 0)
    .map(row => ticker(row?.ticker)));
}

function replaceV19Entry(list, replacement) {
  const source = Array.isArray(list) ? list : [];
  const out = [];
  let inserted = false;
  for (const entry of source) {
    if (isV19Entry(entry)) {
      if (!inserted) {
        out.push({ ...entry, ...replacement });
        inserted = true;
      }
      continue;
    }
    out.push(entry);
  }
  if (!inserted) out.push(replacement);
  return out;
}

function comparisonForTicker(symbol, engineBase, selectedSet) {
  const selected = engineBase.sessionAligned ? selectedSet.has(symbol) : null;
  return {
    id: CONSENSUS_ENGINE_ID,
    label: V19_LABEL,
    role: 'RELATED_CHALLENGER',
    family: 'TOP10_PROBABILITY_RELATED',
    sessionDate: engineBase.sessionDate,
    sessionAligned: engineBase.sessionAligned,
    blocked: false,
    selected,
    agreementStatus: !engineBase.sessionAligned ? 'SESSION_PENDING' : selected ? 'AGREE' : 'NO_MATCH',
    sourceStatus: engineBase.sourceStatus,
    sourceEngineId: V19_ENGINE_ID,
  };
}

function enrichAnnotation(row, engineBase, selectedSet) {
  const symbol = ticker(row?.ticker);
  const v19Comparison = comparisonForTicker(symbol, engineBase, selectedSet);
  const comparisons = replaceV19Entry(row?.engineComparisons, v19Comparison);
  const total = comparisons.length;
  const aligned = comparisons.filter(engine => engine?.sessionAligned === true).length;
  const agreement = comparisons.filter(engine => engine?.sessionAligned === true && engine?.selected === true).length;
  const disagreement = comparisons.filter(engine => engine?.sessionAligned === true && engine?.selected === false).length;
  const pending = total - aligned;
  const related = comparisons
    .filter(engine => ['V17_VALIDATION', CONSENSUS_ENGINE_ID].includes(engine?.id) && engine?.sessionAligned === true && engine?.selected === true)
    .map(engine => engine.label);

  return {
    ...row,
    agreementCount: agreement,
    otherEngineCount: total,
    alignedEngineCount: aligned,
    disagreementCount: disagreement,
    pendingEngineCount: pending,
    agreementPctOfAllEngines: total ? agreement / total * 100 : 0,
    agreementPctOfAlignedEngines: aligned ? agreement / aligned * 100 : null,
    agreementLabelAr: `التوافق مع باقي المحركات ${agreement}/${total}`,
    alignmentLabelAr: `المتزامن ${aligned}/${total}`,
    engineComparisons: comparisons,
    relatedCorroborators: related,
    noteAr: aligned === 0
      ? 'لا يوجد محرك آخر متزامن مع جلسة MAIN APP الحالية حتى الآن؛ العدد سيُحدّث تلقائيًا فور وصول أي محرك لنفس الجلسة.'
      : agreement > 0
        ? `${agreement} من ${total} محركات أخرى اختارت السهم، و${aligned} محركات متزامنة حاليًا مع نفس الجلسة.`
        : `${aligned} محركات أخرى متزامنة، ولم يختر أي منها هذا السهم حاليًا.`,
  };
}

async function main() {
  if (!fs.existsSync(CONSENSUS_PATH)) throw new Error(`Missing consensus file: ${CONSENSUS_PATH}`);
  const consensus = readJson(CONSENSUS_PATH);
  if (consensus.schemaVersion !== '20.1.0-method-independent-consensus-1') {
    throw new Error(`CONSENSUS_SCHEMA_MISMATCH_${consensus.schemaVersion || 'missing'}`);
  }

  const beforeIndependent = (consensus?.current?.mainAppAnnotations || []).map(row => ({
    ticker: ticker(row?.ticker),
    independentVotes: row?.independentVotes,
    independentEngineCount: row?.independentEngineCount,
    confirmationScore: row?.confirmationScore,
    confirmationLevel: row?.confirmationLevel,
  }));

  const { data: v19, sourceUrl, errors } = await fetchV19();
  const mainSession = consensus.sessionDate || null;
  const v19Session = v19?.current?.signalDate || v19?.signalDate || null;
  const selected = selectedTickers(v19);
  const selectedSet = new Set(selected);
  const aligned = Boolean(mainSession && v19Session && mainSession === v19Session);
  const engineBase = {
    id: CONSENSUS_ENGINE_ID,
    label: V19_LABEL,
    role: 'RELATED_CHALLENGER',
    family: 'TOP10_PROBABILITY_RELATED',
    sessionDate: v19Session,
    sessionAligned: aligned,
    sourceStatus: v19.status || 'AVAILABLE',
    blocked: false,
    sourceEngineId: V19_ENGINE_ID,
  };

  consensus.engineRegistry = consensus.engineRegistry || {};
  consensus.engineRegistry.comparisonEngines = replaceV19Entry(consensus.engineRegistry.comparisonEngines, engineBase);
  consensus.engineRegistry.relatedCorroborators = replaceV19Entry(consensus.engineRegistry.relatedCorroborators, {
    ...engineBase,
    voteEligible: false,
  });

  consensus.sourceHealth = {
    ...(consensus.sourceHealth || {}),
    v19Session,
    v19SessionAligned: aligned,
    v19Source: sourceUrl,
    v19V6Source: sourceUrl,
    v19V6EngineId: V19_ENGINE_ID,
    v19V6GeneratedAt: v19.generatedAt || null,
    v19V6SourceErrors: errors,
  };

  consensus.current = consensus.current || {};
  consensus.current.engineSessions = replaceV19Entry(consensus.current.engineSessions, {
    id: CONSENSUS_ENGINE_ID,
    label: V19_LABEL,
    sessionDate: v19Session,
    sessionAligned: aligned,
    blocked: false,
    sourceStatus: v19.status || 'AVAILABLE',
    sourceEngineId: V19_ENGINE_ID,
  });

  const annotations = (consensus.current.mainAppAnnotations || []).map(row => enrichAnnotation(row, engineBase, selectedSet));
  consensus.current.mainAppAnnotations = annotations;
  const engineSessions = consensus.current.engineSessions || [];
  const totalOther = engineSessions.length;
  const alignedOther = engineSessions.filter(engine => engine?.sessionAligned === true).length;
  consensus.current.otherEngineCount = totalOther;
  consensus.current.alignedOtherEngineCount = alignedOther;
  consensus.current.pendingOtherEngineCount = totalOther - alignedOther;
  consensus.current.anyAgreementCount = annotations.filter(row => Number(row?.agreementCount || 0) > 0).length;

  if (consensus.scoreDefinition) {
    consensus.scoreDefinition.rawAgreementDefinition = 'Count same-ticker selections across V17, V19 V6, V20 and QUANT EDGE only when each engine is on the exact MAIN APP session.';
  }
  consensus.status = !mainSession
    ? 'MAIN_SESSION_MISSING'
    : alignedOther === totalOther
      ? 'ALL_ENGINE_SESSIONS_ALIGNED'
      : alignedOther > 0
        ? 'PARTIAL_ENGINE_SESSION_ALIGNMENT'
        : 'EXTERNAL_ENGINE_SESSION_PENDING';

  consensus.v19V6Enrichment = {
    mode: 'DISPLAY_AND_RAW_AGREEMENT_ONLY',
    sourceEngineId: V19_ENGINE_ID,
    sourceGeneratedAt: v19.generatedAt || null,
    sourceUrl,
    sessionDate: v19Session,
    sessionAligned: aligned,
    selectedTickers: selected,
    changesMainAppRanking: false,
    changesMainAppRecommendations: false,
    changesIndependentConfirmationScore: false,
    canGrantExecution: false,
  };

  const afterIndependent = annotations.map(row => ({
    ticker: ticker(row?.ticker),
    independentVotes: row?.independentVotes,
    independentEngineCount: row?.independentEngineCount,
    confirmationScore: row?.confirmationScore,
    confirmationLevel: row?.confirmationLevel,
  }));
  const independentPreserved = JSON.stringify(beforeIndependent) === JSON.stringify(afterIndependent);
  const v19Entries = (consensus.engineRegistry.comparisonEngines || []).filter(isV19Entry);
  const policySafe = consensus?.policy?.comparisonCanChangeMainRanking === false
    && consensus?.policy?.comparisonCanGrantExecution === false;
  const countsBounded = annotations.every(row => Number(row?.agreementCount || 0) <= Number(row?.alignedEngineCount || 0)
    && Number(row?.alignedEngineCount || 0) <= Number(row?.otherEngineCount || 0));
  const expectedV19Matches = annotations.filter(row => aligned && selectedSet.has(ticker(row?.ticker))).map(row => ticker(row?.ticker));
  const observedV19Matches = annotations
    .filter(row => (row.engineComparisons || []).some(engine => isV19Entry(engine) && engine?.sessionAligned === true && engine?.selected === true))
    .map(row => ticker(row?.ticker));

  const acceptance = {
    schemaVersion: '16.9.2-v19-v6-consensus-acceptance-1',
    sourceEngineId: V19_ENGINE_ID,
    sourceGeneratedAt: v19.generatedAt || null,
    mainSession,
    v19Session,
    v19SessionAligned: aligned,
    v19SelectedTickers: selected,
    expectedV19Matches,
    observedV19Matches,
    checks: {
      exactV19V6Source: v19.engineId === V19_ENGINE_ID,
      singleV19ComparisonEntry: v19Entries.length === 1,
      v19VisibleInComparison: v19Entries[0]?.label === V19_LABEL,
      rawAgreementCountsV19: JSON.stringify(expectedV19Matches) === JSON.stringify(observedV19Matches),
      independentConfirmationPreserved: independentPreserved,
      mainRankingMutationDisabled: consensus?.policy?.comparisonCanChangeMainRanking === false,
      executionGrantDisabled: consensus?.policy?.comparisonCanGrantExecution === false,
      agreementCountsBounded: countsBounded,
      policySafe,
    },
  };
  acceptance.pass = Object.values(acceptance.checks).every(Boolean);

  const consensusChanged = writeJsonAtomic(CONSENSUS_PATH, consensus);
  const acceptanceChanged = writeJsonAtomic(ACCEPTANCE_PATH, acceptance);
  console.log(JSON.stringify({
    status: consensus.status,
    mainSession,
    v19Session,
    aligned,
    selectedTickers: selected,
    matchedMainTickers: observedV19Matches,
    consensusChanged,
    acceptanceChanged,
    acceptancePass: acceptance.pass,
  }, null, 2));
  if (!acceptance.pass) process.exitCode = 2;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 2;
});
