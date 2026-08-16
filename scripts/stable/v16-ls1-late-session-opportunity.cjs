#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = (...parts) => path.join(ROOT, ...parts);
const FILES = {
  policy: P('data/stable/v16-ls1-policy.json'),
  intraday: P('data/intraday/latest.json'),
  market: P('data/market.json'),
  daily: P('data/quant/daily-decision-workspace-v13-11.json'),
  calendar: P('data/session-calendar.json'),
  output: P('data/stable/v16-ls1-late-session-opportunities.json'),
  history: P('data/stable/v16-ls1-history.json')
};

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function n(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function round(value, digits = 3) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function ticker(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
}
function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function rowsOf(doc) {
  if (Array.isArray(doc)) return doc;
  if (Array.isArray(doc?.rows)) return doc.rows;
  if (Array.isArray(doc?.stocks)) return doc.stocks;
  return [];
}
function cairoParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).reduce((acc, item) => (acc[item.type] = item.value, acc), {});
  return {
    weekday: parts.weekday,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    display: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
  };
}
function minutesOf(value) {
  const [h, m] = String(value || '00:00').split(':').map(Number);
  return h * 60 + m;
}
function phaseFor(policy, cairo) {
  if (!policy.tradingDays.includes(cairo.weekday)) return 'NON_TRADING_DAY';
  const current = cairo.hour * 60 + cairo.minute;
  const s = policy.session;
  if (current < minutesOf(s.marketOpenLocal)) return 'PRE_OPEN';
  if (current <= minutesOf(s.monitorUntilLocal)) return 'MONITOR';
  if (current >= minutesOf(s.gateStartLocal) && current <= minutesOf(s.gateEndLocal)) return 'GATE_1400';
  if (current >= minutesOf(s.recheckStartLocal) && current <= minutesOf(s.recheckEndLocal)) return 'RECHECK_1415';
  if (current >= minutesOf(s.finalStartLocal) && current <= minutesOf(s.finalEndLocal)) return 'FINAL_1425';
  if (current >= minutesOf(s.marketCloseLocal)) return 'POST_CLOSE';
  return 'MONITOR';
}
function ageMinutes(value, now) {
  const stamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(stamp) ? (now.getTime() - stamp) / 60000 : null;
}
function currentRiskReward(price, stop, target) {
  if (!(price > 0 && stop > 0 && target > price && stop < price)) return null;
  return (target - price) / (price - stop);
}
function entryQuality(price, low, high, maxAbovePct, maxBelowPct) {
  if (!(price > 0 && low > 0 && high >= low)) return 0;
  if (price >= low && price <= high) return 100;
  if (price > high) {
    const pct = ((price / high) - 1) * 100;
    return pct <= maxAbovePct ? clamp(100 - (pct / maxAbovePct) * 45, 55, 100) : 0;
  }
  const pct = ((low / price) - 1) * 100;
  return pct <= maxBelowPct ? clamp(90 - (pct / maxBelowPct) * 35, 50, 90) : 0;
}
function liquidityQuality(avgTurnover, minimum) {
  if (!(avgTurnover > 0)) return 0;
  return clamp((avgTurnover / minimum) * 55, 0, 100);
}
function evidenceFromMarket(market, today, maxAgeMinutes, now) {
  const valid = [];
  const verified = [];
  const byTicker = new Map();
  for (const row of rowsOf(market)) {
    const symbol = ticker(row.symbol || row.ticker);
    const price = n(row.price ?? row.last ?? row.close, 0);
    if (!symbol || price <= 0) continue;
    const fetchedAt = row.fetchedAt || row.updatedAt || market.updatedAt || market.generatedAt || null;
    const age = ageMinutes(fetchedAt, now);
    if (age !== null && age > maxAgeMinutes) continue;
    valid.push(row);
    const sessionDate = row.sourceSessionDate || row.marketSessionDate || row.sessionDate || null;
    const ok = sessionDate === today;
    byTicker.set(symbol, { verified: ok, sessionDate, fetchedAt, ageMinutes: round(age, 2) });
    if (ok) verified.push(row);
  }
  return {
    validRows: valid.length,
    verifiedRows: verified.length,
    coveragePct: valid.length ? round((verified.length / valid.length) * 100, 2) : 0,
    byTicker
  };
}
function candidateDecision(row, candidate, policy, evidence, globalReady) {
  const gates = policy.candidateGates;
  const symbol = ticker(row.ticker);
  const price = n(row.price);
  const plan = candidate?.plan || row.plan || {};
  const entryLow = n(plan.entryLow);
  const entryHigh = n(plan.entryHigh);
  const stopLoss = n(plan.stopLoss);
  const target1 = n(plan.target1);
  const rr = currentRiskReward(price, stopLoss, target1);
  const decisionScore = n(candidate?.decisionScore, n(row.decisionScore, 0));
  const recommendationScore = n(candidate?.recommendationScore, n(row.recommendationScore, 0));
  const avgTurnover = n(candidate?.riskProfile?.averageTurnover20Egp,
    n(candidate?.stock?.averageTurnover20Egp, n(row.averageTurnover20Egp, 0)));
  const state = String(row.state || 'WATCH');
  const changePct = n(row.changePct, 0);
  const tier = candidate?.tier || row.tier || null;
  const ev = evidence.byTicker.get(symbol) || { verified: false, sessionDate: null, ageMinutes: null };

  const blockers = [];
  if (!globalReady) blockers.push('GLOBAL_SESSION_EVIDENCE_NOT_READY');
  if (!ev.verified) blockers.push('TICKER_SESSION_DATE_NOT_VERIFIED');
  if (row.stale === true) blockers.push('STALE_INTRADAY_ROW');
  if (!gates.allowedTiersForBuy.includes(tier)) blockers.push('TIER_NOT_BUY_ELIGIBLE');
  if (gates.blockedStates.includes(state)) blockers.push(`STATE_${state}`);
  if (!gates.allowedStatesForBuy.includes(state)) blockers.push('STATE_NOT_BUY_ELIGIBLE');
  if (decisionScore < gates.minimumDecisionScore) blockers.push('DECISION_SCORE_BELOW_MIN');
  if (recommendationScore < gates.minimumRecommendationScore) blockers.push('RECOMMENDATION_SCORE_BELOW_MIN');
  if (!(rr !== null && rr >= gates.minimumRiskRewardFromCurrentPrice)) blockers.push('CURRENT_RR_BELOW_MIN');
  if (avgTurnover < gates.minimumAverageTurnover20Egp) blockers.push('LIQUIDITY_BELOW_MIN');
  if (changePct > gates.maximumPositiveSessionMovePct) blockers.push('DO_NOT_CHASE_POSITIVE_EXTENSION');
  if (changePct < gates.minimumSessionMovePct) blockers.push('SESSION_WEAKNESS_TOO_HIGH');

  const entryScore = entryQuality(price, entryLow, entryHigh,
    gates.maximumAboveEntryHighPct, gates.maximumBelowEntryLowPct);
  if (entryScore <= 0) blockers.push('PRICE_OUTSIDE_ACCEPTABLE_ENTRY_EXTENSION');

  const rrScore = rr === null ? 0 : clamp((rr / Math.max(gates.minimumRiskRewardFromCurrentPrice, 0.01)) * 65, 0, 100);
  const liqScore = liquidityQuality(avgTurnover, gates.minimumAverageTurnover20Egp);
  const weights = policy.ranking;
  const ls1Score = round(
    decisionScore * (weights.decisionScoreWeightPct / 100) +
    recommendationScore * (weights.recommendationScoreWeightPct / 100) +
    rrScore * (weights.riskRewardWeightPct / 100) +
    entryScore * (weights.entryQualityWeightPct / 100) +
    liqScore * (weights.liquidityQualityWeightPct / 100), 2
  );
  if (ls1Score < gates.minimumLs1Score) blockers.push('LS1_SCORE_BELOW_MIN');

  return {
    ticker: symbol,
    companyNameAr: candidate?.companyNameAr || row.companyNameAr || '',
    companyNameEn: candidate?.companyNameEn || row.companyNameEn || '',
    tier,
    state,
    stateLabelAr: row.stateLabelAr || state,
    price,
    changePct,
    decisionScore,
    recommendationScore,
    ls1Score,
    entryQualityScore: round(entryScore, 2),
    liquidityQualityScore: round(liqScore, 2),
    currentRiskReward: round(rr, 3),
    averageTurnover20Egp: round(avgTurnover, 0),
    plan: { entryLow, entryHigh, stopLoss, target1, target2: n(plan.target2) },
    source: row.source || null,
    sourceMode: row.sourceMode || null,
    sourceSessionDate: ev.sessionDate,
    dataAgeMinutes: ev.ageMinutes ?? n(row.dataAgeMinutes),
    eligible: blockers.length === 0,
    blockers,
    rationaleAr: blockers.length === 0
      ? 'اجتاز بوابة LS1 التكتيكية: جودة قرار وسيولة ونطاق دخول وعائد/مخاطرة مناسب مع إثبات جلسة المصدر.'
      : 'لم يجتز جميع شروط الشراء التكتيكي قبل الإغلاق.'
  };
}

function main() {
  const now = new Date();
  const cairo = cairoParts(now);
  const policy = readJson(FILES.policy);
  const intraday = readJson(FILES.intraday);
  const market = readJson(FILES.market);
  const daily = readJson(FILES.daily);
  const calendar = readJson(FILES.calendar);
  const previous = readJson(FILES.output, {});
  const previousHistory = readJson(FILES.history, { schemaVersion: '16.9.2-ls1-history-1', events: [] });

  if (!policy?.modelId) throw new Error('Missing LS1 policy.');
  const phase = phaseFor(policy, cairo);
  const evidence = evidenceFromMarket(market, cairo.date, policy.evidence.maximumDataAgeMinutes, now);
  const latestSourceAge = n(intraday?.source?.newestDataAgeMinutes, null);
  const dailySeedSession = daily.sessionId || null;
  const latestCompletedSession = calendar.latestMarketSession || null;
  const seedReady = !policy.evidence.requireDailySeedMatchesLatestCompletedSession ||
    Boolean(dailySeedSession && latestCompletedSession && dailySeedSession === latestCompletedSession);
  const currentDateReady = !policy.evidence.requireCurrentCairoDate || intraday.cairoDate === cairo.date;
  const latestAgeReady = latestSourceAge !== null && latestSourceAge <= policy.evidence.maximumDataAgeMinutes;
  const coverageReady = evidence.verifiedRows >= policy.evidence.minimumVerifiedSessionRows &&
    evidence.coveragePct >= policy.evidence.minimumVerifiedSessionCoveragePct;
  const livePhase = ['MONITOR', 'GATE_1400', 'RECHECK_1415', 'FINAL_1425'].includes(phase);
  const globalEvidenceReady = Boolean(livePhase && currentDateReady && latestAgeReady && coverageReady && seedReady);

  const candidateMap = new Map((Array.isArray(daily.candidates) ? daily.candidates : [])
    .map(item => [ticker(item.ticker), item]));
  const evaluated = (Array.isArray(intraday.rows) ? intraday.rows : [])
    .filter(row => row.isDecisionCandidate === true && candidateMap.has(ticker(row.ticker)))
    .map(row => candidateDecision(row, candidateMap.get(ticker(row.ticker)), policy, evidence, globalEvidenceReady))
    .sort((a, b) => b.ls1Score - a.ls1Score || b.decisionScore - a.decisionScore);

  const priorSignals = new Map((Array.isArray(previous.signals) ? previous.signals : [])
    .filter(item => ['BUY_TODAY_FOR_NEXT_SESSION', 'CONFIRMED_FOR_NEXT_SESSION'].includes(item.action))
    .map(item => [ticker(item.ticker), item]));

  let signals = [];
  if (phase === 'GATE_1400') {
    signals = evaluated.filter(item => item.eligible).slice(0, policy.candidateGates.maximumSignals).map((item, index) => ({
      ...item,
      rank: index + 1,
      action: policy.labels.buy,
      actionAr: 'فرصة شراء تكتيكية قبل الإغلاق بهدف جلسة التداول التالية؛ التنفيذ يدوي فقط وبعد مراجعة السعر الفعلي.',
      createdAt: now.toISOString(),
      expiresAtLocal: `${cairo.date} ${policy.session.marketCloseLocal}`
    }));
  } else if (phase === 'RECHECK_1415' || phase === 'FINAL_1425') {
    signals = [...priorSignals.values()].map(prior => {
      const current = evaluated.find(item => item.ticker === prior.ticker);
      if (current?.eligible) {
        return {
          ...current,
          rank: prior.rank,
          action: policy.labels.confirmed,
          actionAr: phase === 'FINAL_1425'
            ? 'تأكيد LS1 النهائي قبل الإغلاق؛ لا تطارد السعر خارج النطاق المحدد.'
            : 'تمت إعادة مراجعة فرصة الساعة 2 وما زالت الشروط التكتيكية قائمة.',
          createdAt: prior.createdAt || now.toISOString(),
          recheckedAt: now.toISOString(),
          expiresAtLocal: `${cairo.date} ${policy.session.marketCloseLocal}`
        };
      }
      return {
        ...(current || prior),
        rank: prior.rank,
        action: policy.labels.cancel,
        actionAr: 'أُلغيت فرصة LS1 لأن شرطًا أو أكثر لم يعد قائمًا قبل الإغلاق.',
        createdAt: prior.createdAt || null,
        cancelledAt: now.toISOString(),
        blockers: current?.blockers || ['CURRENT_CANDIDATE_NO_LONGER_AVAILABLE']
      };
    });
  } else if (phase === 'POST_CLOSE') {
    signals = [...priorSignals.values()].map(prior => ({
      ...prior,
      action: 'AWAIT_FINAL_V16_9_RECONCILIATION',
      actionAr: 'انتهت الجلسة؛ تُحفظ إشارة LS1 للمقارنة مع توصية V16.9 النهائية بعد الإغلاق ولا تُنشأ أوامر تلقائية.'
    }));
  }

  const activeSignals = signals.filter(item => [policy.labels.buy, policy.labels.confirmed].includes(item.action));
  const evidenceBlockers = [];
  if (!livePhase) evidenceBlockers.push(`PHASE_${phase}`);
  if (!currentDateReady) evidenceBlockers.push('INTRADAY_SNAPSHOT_DATE_MISMATCH');
  if (!latestAgeReady) evidenceBlockers.push('INTRADAY_DATA_TOO_OLD_OR_UNKNOWN');
  if (!coverageReady) evidenceBlockers.push('SOURCE_SESSION_EVIDENCE_BELOW_THRESHOLD');
  if (!seedReady) evidenceBlockers.push('DAILY_SEED_NOT_LATEST_COMPLETED_SESSION');

  let status = 'MONITORING_ONLY';
  if (phase === 'GATE_1400') status = globalEvidenceReady
    ? (activeSignals.length ? 'BUY_TODAY_FOR_NEXT_SESSION_AVAILABLE' : 'NO_SIGNAL')
    : 'SOURCE_EVIDENCE_BLOCKED';
  if (phase === 'RECHECK_1415') status = signals.some(x => x.action === policy.labels.confirmed)
    ? 'SIGNALS_RECONFIRMED' : (priorSignals.size ? 'SIGNALS_CANCELLED' : 'NO_PRIOR_GATE_SIGNAL');
  if (phase === 'FINAL_1425') status = signals.some(x => x.action === policy.labels.confirmed)
    ? 'FINAL_PRE_CLOSE_CONFIRMATION' : (priorSignals.size ? 'FINAL_SIGNALS_CANCELLED' : 'NO_PRIOR_GATE_SIGNAL');
  if (phase === 'POST_CLOSE') status = 'POST_CLOSE_AWAIT_FINAL_V16_9';
  if (phase === 'NON_TRADING_DAY') status = 'NON_TRADING_DAY';
  if (phase === 'PRE_OPEN') status = 'PRE_OPEN';

  const materialState = {
    modelId: policy.modelId,
    version: policy.version,
    cairoDate: cairo.date,
    phase,
    status,
    globalEvidenceReady,
    evidence: {
      validRows: evidence.validRows,
      verifiedRows: evidence.verifiedRows,
      coveragePct: evidence.coveragePct,
      latestSourceAgeMinutes: latestSourceAge,
      dailySeedSession,
      latestCompletedSession
    },
    signals: signals.map(item => ({ ticker: item.ticker, action: item.action, price: item.price, ls1Score: item.ls1Score, blockers: item.blockers }))
  };
  const materialFingerprint = stableHash(materialState);
  const publicationRequired = materialFingerprint !== previous.materialFingerprint;

  const output = {
    schemaVersion: '16.9.2-ls1-output-1',
    generatedAt: now.toISOString(),
    cairoTime: cairo.display,
    cairoDate: cairo.date,
    modelId: policy.modelId,
    modelVersion: policy.version,
    methodologyFrozen: policy.methodologyFrozen === true,
    productionV169MethodologyModified: false,
    phase,
    status,
    statusAr: status === 'BUY_TODAY_FOR_NEXT_SESSION_AVAILABLE'
      ? 'توجد فرصة أو أكثر يمكن اقتناصها تكتيكيًا قبل الإغلاق بهدف جلسة الغد، مع بقاء توصية V16.9 النهائية مستقلة بعد الإغلاق.'
      : status === 'SOURCE_EVIDENCE_BLOCKED'
        ? 'لم تُفتح بوابة شراء الساعة 2 لأن إثبات جلسة المصدر أو حداثة البيانات لم يكتمل.'
        : status === 'NO_SIGNAL'
          ? 'تم فحص بوابة الساعة 2 ولم تظهر فرصة تستوفي جميع شروط LS1.'
          : 'طبقة LS1 تعمل كمراقبة تكتيكية مستقلة ولا تغيّر محرك V16.9 النهائي.',
    globalEvidenceReady,
    evidenceBlockers,
    evidence: {
      intradaySnapshotCairoDate: intraday.cairoDate || null,
      intradayMarketSessionState: intraday.marketSessionState || null,
      publicDelayedData: intraday.publicDelayedData === true,
      selectedSource: intraday?.source?.selectedSource || market.source || null,
      latestSourceAgeMinutes: latestSourceAge,
      validMarketRows: evidence.validRows,
      sourceSessionVerifiedRows: evidence.verifiedRows,
      sourceSessionEvidenceCoveragePct: evidence.coveragePct,
      requiredVerifiedRows: policy.evidence.minimumVerifiedSessionRows,
      requiredCoveragePct: policy.evidence.minimumVerifiedSessionCoveragePct,
      dailySeedSession,
      latestCompletedSession,
      seedReady
    },
    signals,
    signalCount: signals.length,
    activeSignalCount: activeSignals.length,
    watchTop: evaluated.slice(0, 10),
    safety: {
      decisionSupportOnly: true,
      automaticOrderSubmission: false,
      brokerExecutionAllowed: false,
      noV169Retune: true,
      sourceSessionTruthRequired: true,
      noSignalWhenEvidenceBlocked: true,
      finalPostCloseV169RemainsAuthoritative: true
    },
    materialFingerprint,
    publicationRequired
  };

  if (publicationRequired || !fs.existsSync(FILES.output)) {
    writeJsonAtomic(FILES.output, output);
    const events = Array.isArray(previousHistory.events) ? previousHistory.events : [];
    events.push({
      generatedAt: output.generatedAt,
      cairoDate: output.cairoDate,
      phase: output.phase,
      status: output.status,
      materialFingerprint,
      signalCount: output.signalCount,
      activeSignalCount: output.activeSignalCount,
      signals: output.signals.map(item => ({ ticker: item.ticker, action: item.action, price: item.price, ls1Score: item.ls1Score }))
    });
    writeJsonAtomic(FILES.history, {
      schemaVersion: '16.9.2-ls1-history-1',
      modelId: policy.modelId,
      modelVersion: policy.version,
      events: events.slice(-250)
    });
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publicationRequired ? 'true' : 'false'}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `status=${status}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `active_signals=${activeSignals.length}\n`);
  }
  console.log(JSON.stringify({
    modelId: policy.modelId,
    phase,
    status,
    globalEvidenceReady,
    evidenceBlockers,
    sourceSessionVerifiedRows: evidence.verifiedRows,
    sourceSessionEvidenceCoveragePct: evidence.coveragePct,
    activeSignals: activeSignals.map(item => item.ticker),
    publicationRequired
  }, null, 2));
}

main();
