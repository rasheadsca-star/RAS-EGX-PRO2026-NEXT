#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const Q = path.join(DATA, 'quant');
const FILES = {
  policy: path.join(DATA, 'v13-14-unified-center-policy.json'),
  daily: path.join(Q, 'daily-decision-workspace-v13-11.json'),
  tiered: path.join(Q, 'tiered-confidence-recommendations-v13-10.json'),
  live: path.join(Q, 'live-reranked-decision-v13-13.json'),
  intraday: path.join(DATA, 'intraday', 'latest.json'),
  alerts: path.join(DATA, 'intraday', 'alerts.json'),
  stockIndex: path.join(Q, 'stock-intelligence-index.json'),
  risk: path.join(Q, 'portfolio-risk-universe.json'),
  finalization: path.join(DATA, 'postclose', 'latest-v13-14.json'),
  output: path.join(Q, 'unified-autonomous-center-v13-14.json')
};

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, file);
}
function A(value) { return Array.isArray(value) ? value : []; }
function n(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function round(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}
function safeTicker(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
}
function dateOnly(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}
function cairoDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(value).reduce((acc, part) => (acc[part.type] = part.value, acc), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function layerLabel(tier) {
  return ({
    STRICT_PAPER: 'الطبقة الصارمة',
    TIER_A_EXPERIMENTAL_PAPER: 'الطبقة A',
    TIER_B_PRIORITY_WATCH: 'الطبقة B',
    DISCOVERY_WATCH: 'اكتشاف سوقي'
  })[tier] || tier || 'غير مصنف';
}
function stateLabel(code) {
  return ({
    ENTRY_ZONE: 'داخل منطقة الدخول',
    BREAKOUT_CONFIRMED: 'اختراق مؤكد',
    TARGET1_HIT: 'وصل الهدف الأول',
    TARGET2_HIT: 'وصل الهدف الثاني',
    ABOVE_ENTRY: 'أعلى منطقة الدخول',
    BELOW_ENTRY: 'أقل من منطقة الدخول',
    STOP_BREACHED: 'كسر وقف الخسارة',
    SUPPORT_BROKEN: 'كسر الدعم',
    WATCH: 'مراقبة',
    MARKET_LEADER: 'قائد تداول',
    NO_INTRADAY_DATA: 'لا توجد لقطة جلسة'
  })[code] || code || 'مراقبة';
}
function validPlan(plan) {
  return n(plan?.entryLow, 0) > 0 && n(plan?.entryHigh, 0) >= n(plan?.entryLow, 0) &&
    n(plan?.stopLoss, 0) > 0 && n(plan?.entryHigh, 0) > n(plan?.stopLoss, 0) &&
    n(plan?.target1, 0) > n(plan?.entryLow, 0);
}
function finalDecision(candidate, context, policy) {
  const tier = candidate.tier;
  const state = candidate.state;
  const planOK = validPlan(candidate.plan);
  const fresh = candidate.marketCurrent && !candidate.stale;
  if (!planOK && tier !== 'DISCOVERY_WATCH') {
    return { code: 'BLOCKED_INCOMPLETE', labelAr: 'مرفوض — الخطة ناقصة', actionable: false, reasonAr: 'بيانات الدخول أو الوقف أو الهدف غير مكتملة.' };
  }
  if (tier === 'DISCOVERY_WATCH') {
    return { code: 'WATCH_ONLY', labelAr: 'مراقبة سوقية', actionable: false, reasonAr: 'السهم نشط في السوق لكنه لم يجتز طبقات التوصية اليومية.' };
  }
  if (tier === 'TIER_B_PRIORITY_WATCH') {
    return { code: 'WATCH_ONLY', labelAr: 'مراقبة فقط', actionable: false, reasonAr: 'الطبقة B لا تتحول إلى شراء بسبب حركة لحظية.' };
  }
  if (!fresh && policy.decision.currentMarketRequiredForIntradayReady) {
    return { code: 'BLOCKED_STALE', labelAr: 'انتظر تحديث البيانات', actionable: false, reasonAr: 'السعر الحالي قديم أو لقطة السوق ليست من اليوم.' };
  }
  if (['STOP_BREACHED', 'SUPPORT_BROKEN'].includes(state)) {
    return { code: 'BLOCKED_RISK', labelAr: 'مرفوض حاليًا', actionable: false, reasonAr: 'السعر كسر مستوى أمان أساسيًا.' };
  }
  if (['TARGET1_HIT', 'TARGET2_HIT'].includes(state)) {
    return { code: 'PROFIT_MANAGEMENT', labelAr: 'إدارة ربح — لا تطارد السعر', actionable: false, reasonAr: 'السعر وصل أحد الأهداف؛ راجع جني الربح بدل بدء صفقة جديدة.' };
  }
  if (state === 'ABOVE_ENTRY') {
    return { code: 'DO_NOT_CHASE', labelAr: 'لا تطارد السعر', actionable: false, reasonAr: 'السعر تجاوز منطقة الدخول المحددة.' };
  }
  if (state === 'BELOW_ENTRY') {
    return { code: 'WAIT_FOR_ENTRY', labelAr: 'انتظر منطقة الدخول', actionable: false, reasonAr: 'الشروط الأساسية جيدة لكن السعر لم يدخل منطقة الشراء.' };
  }
  if (['ENTRY_ZONE', 'BREAKOUT_CONFIRMED'].includes(state)) {
    return {
      code: 'READY_FOR_PAPER_REVIEW',
      labelAr: tier === 'STRICT_PAPER' ? 'جاهز للمراجعة الورقية الصارمة' : 'جاهز للمراجعة الورقية منخفضة المخاطر',
      actionable: true,
      reasonAr: state === 'ENTRY_ZONE' ? 'السعر داخل منطقة الدخول مع بقاء طبقة التوصية صالحة.' : 'حدث اختراق مؤكد مع بقاء طبقة التوصية اليومية صالحة.'
    };
  }
  return { code: 'WAIT_FOR_ENTRY', labelAr: 'انتظر تأكيد الدخول', actionable: false, reasonAr: 'لم تتحقق حالة دخول واضحة بعد.' };
}
function priority(item, policy) {
  const base = n(policy.decision.decisionPriority?.[item.finalDecision.code], 0);
  const tierBonus = item.tier === 'STRICT_PAPER' ? 20 : item.tier === 'TIER_A_EXPERIMENTAL_PAPER' ? 12 : item.tier === 'TIER_B_PRIORITY_WATCH' ? 4 : 0;
  return base + tierBonus + n(item.liveDecisionScore, n(item.baselineDecisionScore, 0)) / 10;
}
function main() {
  const now = new Date();
  const generatedAt = now.toISOString();
  const today = cairoDate(now);
  const policy = readJson(FILES.policy);
  if (!policy) throw new Error('Missing data/v13-14-unified-center-policy.json');

  const daily = readJson(FILES.daily, { candidates: [] });
  const tiered = readJson(FILES.tiered, {});
  const live = readJson(FILES.live, { candidates: [] });
  const intraday = readJson(FILES.intraday, { rows: [] });
  const alerts = readJson(FILES.alerts, { alerts: [] });
  const stockIndex = readJson(FILES.stockIndex, { stocks: [] });
  const risk = readJson(FILES.risk, { profiles: [] });
  const finalization = readJson(FILES.finalization, null);

  const stockMap = new Map(A(stockIndex.stocks).map(item => [safeTicker(item.ticker), item]));
  const riskMap = new Map(A(risk.profiles).map(item => [safeTicker(item.ticker), item]));
  const liveMap = new Map(A(live.candidates).map(item => [safeTicker(item.ticker), item]));
  const intradayMap = new Map(A(intraday.rows).map(item => [safeTicker(item.ticker), item]));
  const alertMap = new Map();
  for (const alert of A(alerts.alerts)) {
    const ticker = safeTicker(alert.ticker);
    if (!ticker) continue;
    const list = alertMap.get(ticker) || [];
    list.push(alert);
    alertMap.set(ticker, list);
  }

  const analysisSession = daily.sessionId || tiered.sessionId || live.analysisSessionId || null;
  const marketDate = intraday.cairoDate || live.marketSnapshotDate || null;
  const marketCurrent = marketDate === today;
  const analysisCurrent = analysisSession === marketDate && marketCurrent;
  const finalizationCurrent = finalization && finalization.targetPassed === true && finalization.sessionDate === marketDate;

  let operationalStatus = 'STALE_BLOCKED';
  let operationalLabelAr = 'البيانات غير محدثة';
  if (analysisCurrent) {
    operationalStatus = 'CONFIRMED_LATEST_SESSION';
    operationalLabelAr = 'قرار يومي مؤكد ومتابعة حية';
  } else if (marketCurrent && analysisSession) {
    operationalStatus = 'PROVISIONAL_INTRADAY_ON_OLDER_ANALYSIS';
    operationalLabelAr = 'قرار مؤقت على تحليل يومي أقدم';
  }

  const baseCandidates = A(daily.candidates);
  const candidates = baseCandidates.map(base => {
    const ticker = safeTicker(base.ticker);
    const l = liveMap.get(ticker) || {};
    const i = intradayMap.get(ticker) || {};
    const stock = stockMap.get(ticker) || base.stock || {};
    const rp = riskMap.get(ticker) || base.riskProfile || {};
    const tier = base.tier || l.baselineTier || 'TIER_B_PRIORITY_WATCH';
    const currentPrice = n(i.price, n(l.price, n(stock.price)));
    const state = i.state || l.state || 'NO_INTRADAY_DATA';
    const stale = i.stale === true || l.stale === true || !marketCurrent;
    const item = {
      ticker,
      companyNameAr: base.companyNameAr || stock.companyNameAr || i.companyNameAr || '',
      companyNameEn: base.companyNameEn || stock.companyNameEn || i.companyNameEn || '',
      sector: base.sector || stock.sector || rp.sector || 'غير مصنف',
      tier,
      tierLabelAr: base.tierLabelAr || layerLabel(tier),
      baselineRank: n(base.rank, n(l.baselineRank, 999)),
      liveRank: n(l.liveRank, n(base.rank, 999)),
      rankChange: n(l.rankChange, 0),
      recommendationScore: n(base.recommendationScore, n(l.recommendationScore)),
      baselineDecisionScore: n(base.decisionScore, n(l.baselineDecisionScore)),
      liveDecisionScore: n(l.liveDecisionScore, n(base.decisionScore)),
      currentPrice,
      changePct: n(i.changePct, n(l.changePct)),
      moveSincePreviousSnapshotPct: n(i.priceMoveSincePreviousSnapshotPct, n(l.moveSincePreviousSnapshotPct)),
      state,
      stateLabelAr: i.stateLabelAr || l.stateLabelAr || stateLabel(state),
      fetchedAt: i.fetchedAt || l.fetchedAt || null,
      dataAgeMinutes: n(i.dataAgeMinutes, n(l.dataAgeMinutes)),
      stale,
      marketCurrent,
      plan: base.plan || l.plan || null,
      support20: n(stock.support20, n(i.support20)),
      resistance20: n(stock.resistance20, n(i.resistance20)),
      rsi14: n(stock.rsi14),
      volumeRatio20: n(stock.volumeRatio20),
      turnover: n(i.turnover),
      averageTurnover20Egp: n(rp.averageTurnover20Egp, n(stock.averageTurnover20Egp)),
      turnoverPaceRatio: n(i.turnoverPaceRatio, n(l.turnoverPaceRatio)),
      liquidityPercentile: n(rp.liquidityPercentile),
      riskScore: n(rp.riskScore),
      riskLabelAr: rp.riskLabelAr || null,
      volatility20Pct: n(rp.volatility20Pct),
      maxDrawdown100Pct: n(rp.maxDrawdown100Pct),
      hardFailureCount: n(base.hardFailureCount, 0),
      softFailureCount: n(base.softFailureCount, 0),
      softFailures: A(base.softFailures),
      chartPath: `../../data/quant/stocks/${ticker}.json`,
      latestAlerts: A(alertMap.get(ticker)).slice(0, 5),
      sourceMode: i.sourceMode || 'public_delayed',
      source: i.source || l.source || null
    };
    item.finalDecision = finalDecision(item, { operationalStatus, analysisSession, marketDate }, policy);
    item.priorityScore = round(priority(item, policy), 2);
    item.riskPct = tier === 'STRICT_PAPER' ? n(policy.decision.strictRiskPct, 0.5) : n(policy.decision.tierARiskPct, 0.25);
    return item;
  }).sort((a, b) =>
    n(b.priorityScore, 0) - n(a.priorityScore, 0) ||
    n(a.liveRank, 999) - n(b.liveRank, 999) ||
    a.ticker.localeCompare(b.ticker)
  ).map((item, index) => ({ ...item, unifiedRank: index + 1 }));

  const candidateTickers = new Set(candidates.map(item => item.ticker));
  const discoveryWatch = A(intraday.rows)
    .filter(row => !candidateTickers.has(safeTicker(row.ticker)))
    .sort((a, b) => n(b.turnover, 0) - n(a.turnover, 0) || Math.abs(n(b.changePct, 0)) - Math.abs(n(a.changePct, 0)))
    .slice(0, n(policy.decision.maximumDiscoveryWatch, 15))
    .map((row, index) => ({
      unifiedRank: index + 1,
      ticker: safeTicker(row.ticker),
      companyNameAr: row.companyNameAr || '', companyNameEn: row.companyNameEn || '',
      sector: row.sector || 'غير مصنف', tier: 'DISCOVERY_WATCH', tierLabelAr: 'اكتشاف سوقي',
      currentPrice: n(row.price), changePct: n(row.changePct), turnover: n(row.turnover),
      turnoverPaceRatio: n(row.turnoverPaceRatio), state: row.state || 'MARKET_LEADER',
      stateLabelAr: row.stateLabelAr || 'قائد تداول', stale: row.stale === true || !marketCurrent,
      finalDecision: { code: 'WATCH_ONLY', labelAr: 'مراقبة سوقية فقط', actionable: false, reasonAr: 'السهم نشط لكنه غير موجود داخل طبقات التوصية اليومية.' },
      latestAlerts: A(alertMap.get(safeTicker(row.ticker))).slice(0, 3)
    }));

  const primary = candidates.find(item => item.finalDecision.actionable) || candidates[0] || null;
  const counts = {
    totalCandidates: candidates.length,
    strict: candidates.filter(item => item.tier === 'STRICT_PAPER').length,
    tierA: candidates.filter(item => item.tier === 'TIER_A_EXPERIMENTAL_PAPER').length,
    tierB: candidates.filter(item => item.tier === 'TIER_B_PRIORITY_WATCH').length,
    ready: candidates.filter(item => item.finalDecision.code === 'READY_FOR_PAPER_REVIEW').length,
    wait: candidates.filter(item => item.finalDecision.code === 'WAIT_FOR_ENTRY').length,
    blocked: candidates.filter(item => item.finalDecision.code.startsWith('BLOCKED')).length,
    unreadAlerts: A(alerts.newAlerts).length,
    discoveryWatch: discoveryWatch.length
  };

  const output = {
    schemaVersion: '13.14.0', generatedAt, operationalStatus, operationalLabelAr,
    analysisSession, marketDate, marketCurrent, analysisCurrent, finalizationCurrent,
    marketSessionState: intraday.marketSessionState || live.marketSessionState || null,
    publicDelayedData: true, liveExecutionEnabled: false, automaticOrderSubmission: false,
    finalization: finalization ? {
      status: finalization.status, sessionDate: finalization.sessionDate,
      coveragePct: finalization.coveragePct, accepted: finalization.counts?.acceptedCoverage,
      eligible: finalization.counts?.eligibleSymbols, targetPassed: finalization.targetPassed
    } : null,
    counts, primaryCandidate: primary,
    topCandidates: candidates.slice(0, n(policy.decision.maximumPrimaryCandidates, 5)),
    candidates: candidates.slice(0, n(policy.decision.maximumAllCandidates, 60)),
    discoveryWatch,
    allocationPolicy: {
      strictRiskPct: n(policy.decision.strictRiskPct, 0.5),
      tierARiskPct: n(policy.decision.tierARiskPct, 0.25),
      maximumStockWeightPct: n(policy.decision.maximumStockWeightPct, 15),
      maximumSectorWeightPct: n(policy.decision.maximumSectorWeightPct, 30),
      maximumLiquidityParticipationPct: n(policy.decision.maximumLiquidityParticipationPct, 1)
    },
    warningAr: 'هذه الصفحة توحد الطبقات والسعر والخطة والتنبيهات. لا تضمن الربح ولا ترسل أوامر حقيقية.'
  };
  writeJson(FILES.output, output);
  console.log(`V13.14 center: status=${operationalStatus}, analysis=${analysisSession}, market=${marketDate}, candidates=${candidates.length}, ready=${counts.ready}`);
}

try { main(); }
catch (error) {
  console.error(`V13.14 unified center failed: ${error.stack || error.message}`);
  process.exit(1);
}
