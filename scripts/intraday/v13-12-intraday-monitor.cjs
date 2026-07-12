#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const DIR = path.join(DATA, 'intraday');
const FILES = {
  policy: path.join(DATA, 'v13-12-intraday-alert-policy.json'),
  market: path.join(DATA, 'market.json'),
  fullCache: path.join(DATA, 'full-market-cache.json'),
  lastGood: path.join(DATA, 'last-good-market.json'),
  sourceHealth: path.join(DATA, 'source-health.json'),
  gateway: path.join(DATA, 'source-gateway-report.json'),
  daily: path.join(DATA, 'quant', 'daily-decision-workspace-v13-11.json'),
  previous: path.join(DIR, 'latest.json'),
  previousAlerts: path.join(DIR, 'alerts.json'),
  previousHistory: path.join(DIR, 'history.json'),
  latest: path.join(DIR, 'latest.json'),
  alerts: path.join(DIR, 'alerts.json'),
  history: path.join(DIR, 'history.json'),
  status: path.join(DIR, 'status.json'),
  telegram: path.join(DIR, 'telegram-message.txt')
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
function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(value || ''), 'utf8');
}
function A(value) { return Array.isArray(value) ? value : []; }
function n(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function round(value, digits = 3) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}
function ticker(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
}
function iso(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function rowTime(row, doc) {
  return iso(row.fetchedAt || row.updatedAt || row.generatedAt || row.cacheUpdatedAt || doc.updatedAt || doc.generatedAt);
}
function rowsOf(doc) {
  if (Array.isArray(doc)) return doc;
  if (Array.isArray(doc?.rows)) return doc.rows;
  if (Array.isArray(doc?.stocks)) return doc.stocks;
  return [];
}
function validMarketRow(row) {
  return ticker(row.symbol || row.ticker) && n(row.price ?? row.lastPrice ?? row.close, 0) > 0;
}
function normalizeRow(row, doc, sourceLabel) {
  const symbol = ticker(row.symbol || row.ticker);
  const price = n(row.price ?? row.lastPrice ?? row.close);
  const previousClose = n(row.previousClose ?? row.prevClose);
  let changePct = n(row.changePct ?? row.changePercent);
  if (changePct === null && price !== null && previousClose > 0) {
    changePct = ((price / previousClose) - 1) * 100;
  }
  return {
    ticker: symbol,
    companyNameAr: row.name_ar || row.companyNameAr || '',
    companyNameEn: row.name_en || row.companyNameEn || row.name || '',
    price,
    previousClose,
    changePct: round(changePct),
    open: n(row.open),
    high: n(row.high),
    low: n(row.low),
    volume: n(row.volume),
    turnover: n(row.turnover ?? row.value ?? row.tradedValue),
    support1: n(row.support1),
    resistance1: n(row.resistance1),
    source: row.priceSource || row.source || doc.source || sourceLabel,
    sourceMode: row.dataMode || doc.dataMode || doc.mode || 'public_delayed',
    fetchedAt: rowTime(row, doc),
    staleFlag: row.stale === true
  };
}
function freshestFirst(a, b) {
  const at = a.fetchedAt ? Date.parse(a.fetchedAt) : 0;
  const bt = b.fetchedAt ? Date.parse(b.fetchedAt) : 0;
  if (bt !== at) return bt - at;
  const sourceRank = source => /market_gateway|mubasher_public|real/i.test(source || '') ? 2 : 1;
  return sourceRank(b.source) - sourceRank(a.source);
}
function cairoParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now).reduce((acc, x) => (acc[x.type] = x.value, acc), {});
  return {
    weekday: parts.weekday,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    display: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
  };
}
function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}
function sessionProgress(policy, nowParts) {
  const current = nowParts.hour * 60 + nowParts.minute;
  const start = minutesOf(policy.schedule.marketOpenLocal);
  const end = minutesOf(policy.schedule.marketCloseLocal);
  if (current <= start) return 0;
  if (current >= end) return 1;
  return Math.max(0, Math.min(1, (current - start) / (end - start)));
}
function percentMove(current, previous) {
  return current > 0 && previous > 0 ? ((current / previous) - 1) * 100 : null;
}
function crossedUp(previous, current, threshold) {
  return Number.isFinite(previous) && Number.isFinite(current) && previous < threshold && current >= threshold;
}
function crossedDown(previous, current, threshold) {
  return Number.isFinite(previous) && Number.isFinite(current) && previous > threshold && current <= threshold;
}
function ageMinutes(value, now) {
  const stamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(stamp) ? (now.getTime() - stamp) / 60000 : null;
}
function alertId(day, symbol, type, key = '') {
  return [day, symbol || 'MARKET', type, key].join(':');
}
function addAlert(out, alert) {
  if (!alert?.id || out.some(x => x.id === alert.id)) return;
  out.push({
    generatedAt: new Date().toISOString(),
    acknowledged: false,
    ...alert
  });
}
function stateFor(row, candidate, pace, policy) {
  const price = n(row.price);
  const plan = candidate?.plan || {};
  const stock = candidate?.stock || {};
  const support = n(stock.support20, n(row.support1));
  const resistance = n(stock.resistance20, n(row.resistance1));
  const buffer = n(policy.thresholds.breakoutBufferPct, 0.15) / 100;
  const supportBuffer = n(policy.thresholds.supportBreakBufferPct, 0.15) / 100;
  if (!candidate) return 'MARKET_LEADER';
  if (n(plan.stopLoss) > 0 && price <= n(plan.stopLoss)) return 'STOP_BREACHED';
  if (n(plan.target2) > 0 && price >= n(plan.target2)) return 'TARGET2_HIT';
  if (n(plan.target1) > 0 && price >= n(plan.target1)) return 'TARGET1_HIT';
  if (resistance > 0 && price >= resistance * (1 + buffer) && pace >= 1.3) return 'BREAKOUT_CONFIRMED';
  if (support > 0 && price <= support * (1 - supportBuffer)) return 'SUPPORT_BROKEN';
  if (n(plan.entryLow) > 0 && n(plan.entryHigh) >= n(plan.entryLow) &&
      price >= n(plan.entryLow) && price <= n(plan.entryHigh)) return 'ENTRY_ZONE';
  if (n(plan.entryHigh) > 0 && price > n(plan.entryHigh)) return 'ABOVE_ENTRY';
  if (n(plan.entryLow) > 0 && price < n(plan.entryLow)) return 'BELOW_ENTRY';
  return 'WATCH';
}
function stateLabel(code) {
  return ({
    STOP_BREACHED: 'كسر وقف الخسارة',
    TARGET2_HIT: 'وصل الهدف الثاني',
    TARGET1_HIT: 'وصل الهدف الأول',
    BREAKOUT_CONFIRMED: 'اختراق مؤكد بحجم',
    SUPPORT_BROKEN: 'كسر الدعم',
    ENTRY_ZONE: 'داخل منطقة الدخول',
    ABOVE_ENTRY: 'أعلى منطقة الدخول',
    BELOW_ENTRY: 'أقل من منطقة الدخول',
    WATCH: 'مراقبة',
    MARKET_LEADER: 'قائد تداول'
  })[code] || code;
}
function levelForState(code) {
  if (['STOP_BREACHED', 'SUPPORT_BROKEN'].includes(code)) return 'critical';
  if (['TARGET1_HIT', 'TARGET2_HIT', 'BREAKOUT_CONFIRMED', 'ENTRY_ZONE'].includes(code)) return 'opportunity';
  return 'info';
}
function actionForState(code) {
  return ({
    STOP_BREACHED: 'إلغاء فكرة الشراء أو مراجعة الخروج الورقي فورًا.',
    TARGET2_HIT: 'مراجعة جني الربح الورقي الكامل.',
    TARGET1_HIT: 'مراجعة جني جزء من الربح وتحريك الوقف.',
    BREAKOUT_CONFIRMED: 'راجع الاختراق والخطة؛ لا تطارد السعر.',
    SUPPORT_BROKEN: 'لا تبدأ شراء جديد قبل استعادة الدعم.',
    ENTRY_ZONE: 'راجع الشروط والسيولة قبل تسجيل محاكاة ورقية.',
    ABOVE_ENTRY: 'انتظر إعادة اختبار أو خطة بديلة؛ لا تطارد السعر.',
    BELOW_ENTRY: 'راقب اقتراب السعر من منطقة الدخول.',
    WATCH: 'استمر في المراقبة.',
    MARKET_LEADER: 'معلومة سوقية وليست توصية شراء.'
  })[code] || 'مراجعة الحالة.';
}
function main() {
  const now = new Date();
  const generatedAt = now.toISOString();
  const policy = readJson(FILES.policy);
  if (!policy) throw new Error('Missing data/v13-12-intraday-alert-policy.json');

  const daily = readJson(FILES.daily, { candidates: [], topCandidates: [] });
  const sourceDocs = [
    { label: 'market', doc: readJson(FILES.market, {}) },
    { label: 'full_market_cache', doc: readJson(FILES.fullCache, {}) },
    { label: 'last_good_market', doc: readJson(FILES.lastGood, {}) }
  ];
  const merged = new Map();
  for (const source of sourceDocs) {
    for (const raw of rowsOf(source.doc)) {
      if (!validMarketRow(raw)) continue;
      const item = normalizeRow(raw, source.doc, source.label);
      const list = merged.get(item.ticker) || [];
      list.push(item);
      merged.set(item.ticker, list);
    }
  }
  const currentRows = new Map(
    [...merged.entries()].map(([symbol, list]) => [symbol, list.sort(freshestFirst)[0]])
  );

  const candidateMap = new Map(A(daily.candidates).map(x => [ticker(x.ticker), x]));
  const selected = new Set(candidateMap.keys());

  const leaders = [...currentRows.values()]
    .filter(x => n(x.turnover, 0) >= n(policy.thresholds.minimumTurnoverForLeaderEgp, 1000000))
    .sort((a, b) => n(b.turnover, 0) - n(a.turnover, 0))
    .slice(0, n(policy.universe.maximumMarketLeaders, 25));
  if (policy.universe.trackTopTurnoverMarketLeaders) {
    for (const row of leaders) selected.add(row.ticker);
  }

  const maxTracked = n(policy.universe.maximumTrackedSymbols, 60);
  const trackedTickers = [...selected].slice(0, maxTracked);
  const previous = readJson(FILES.previous, { rows: [] });
  const previousMap = new Map(A(previous.rows).map(x => [ticker(x.ticker), x]));
  const previousAlertDoc = readJson(FILES.previousAlerts, { alerts: [] });
  const previousAlertIds = new Set(A(previousAlertDoc.alerts).map(x => x.id));
  const previousHistory = readJson(FILES.previousHistory, { snapshots: [] });

  const cairo = cairoParts(now);
  const progress = sessionProgress(policy, cairo);
  const alerts = [];
  const rows = [];

  for (const symbol of trackedTickers) {
    const market = currentRows.get(symbol);
    if (!market) continue;
    const candidate = candidateMap.get(symbol) || null;
    const prev = previousMap.get(symbol) || null;
    const avgTurnover = n(candidate?.riskProfile?.averageTurnover20Egp,
      n(candidate?.stock?.averageTurnover20Egp));
    const effectiveProgress = Math.max(0.15, progress || 0.15);
    const pace = avgTurnover > 0 && n(market.turnover, 0) >= 0
      ? n(market.turnover, 0) / (avgTurnover * effectiveProgress)
      : null;
    const move = prev ? percentMove(n(market.price), n(prev.price)) : null;
    const state = stateFor(market, candidate, n(pace, 0), policy);
    const dataAge = ageMinutes(market.fetchedAt, now);
    const row = {
      ticker: symbol,
      companyNameAr: candidate?.companyNameAr || market.companyNameAr || '',
      companyNameEn: candidate?.companyNameEn || market.companyNameEn || '',
      sector: candidate?.sector || 'غير مصنف',
      isDecisionCandidate: !!candidate,
      rank: candidate?.rank ?? null,
      tier: candidate?.tier || null,
      tierLabelAr: candidate?.tierLabelAr || null,
      actionCode: candidate?.actionCode || null,
      recommendationScore: n(candidate?.recommendationScore),
      decisionScore: n(candidate?.decisionScore),
      plan: candidate?.plan || null,
      support20: n(candidate?.stock?.support20, n(market.support1)),
      resistance20: n(candidate?.stock?.resistance20, n(market.resistance1)),
      averageTurnover20Egp: avgTurnover,
      price: n(market.price),
      previousClose: n(market.previousClose),
      changePct: n(market.changePct),
      open: n(market.open),
      high: n(market.high),
      low: n(market.low),
      volume: n(market.volume),
      turnover: n(market.turnover),
      turnoverPaceRatio: round(pace, 2),
      priceMoveSincePreviousSnapshotPct: round(move, 2),
      state,
      stateLabelAr: stateLabel(state),
      source: market.source,
      sourceMode: market.sourceMode,
      fetchedAt: market.fetchedAt,
      dataAgeMinutes: round(dataAge, 1),
      stale: market.staleFlag || dataAge === null || dataAge > n(policy.thresholds.staleAfterMinutes, 45),
      delayed: true
    };
    rows.push(row);

    if (prev && prev.state !== state && candidate) {
      addAlert(alerts, {
        id: alertId(cairo.date, symbol, 'state_change', state),
        level: levelForState(state),
        type: 'state_change',
        ticker: symbol,
        titleAr: `${symbol}: ${stateLabel(state)}`,
        detailAr: `الحالة السابقة: ${stateLabel(prev.state)} — السعر ${round(row.price, 3)}.`,
        actionAr: actionForState(state),
        previousValue: prev.state,
        currentValue: state,
        price: row.price,
        tier: row.tier
      });
    }

    if (prev && Number.isFinite(move)) {
      const threshold = candidate
        ? n(policy.thresholds.candidateSnapshotMovePct, 1.5)
        : n(policy.thresholds.marketLeaderSnapshotMovePct, 3);
      if (Math.abs(move) >= threshold) {
        const direction = move > 0 ? 'صعود' : 'هبوط';
        addAlert(alerts, {
          id: alertId(cairo.date, symbol, 'snapshot_move', `${Math.sign(move)}:${Math.floor(Math.abs(move) / threshold)}`),
          level: candidate ? (move < 0 ? 'warning' : 'opportunity') : 'info',
          type: 'snapshot_move',
          ticker: symbol,
          titleAr: `${symbol}: ${direction} ${round(Math.abs(move), 2)}% منذ آخر لقطة`,
          detailAr: `السعر السابق ${round(prev.price, 3)} والحالي ${round(row.price, 3)}.`,
          actionAr: candidate ? 'راجع الخطة والوقف والحجم قبل أي قرار.' : 'حركة سوقية تستحق المراقبة.',
          previousValue: prev.price,
          currentValue: row.price,
          price: row.price,
          tier: row.tier
        });
      }
    }

    if (prev) {
      for (const threshold of A(policy.thresholds.positiveSessionThresholdsPct)) {
        if (crossedUp(n(prev.changePct), n(row.changePct), n(threshold))) {
          addAlert(alerts, {
            id: alertId(cairo.date, symbol, 'session_up_cross', threshold),
            level: candidate ? 'opportunity' : 'info',
            type: 'session_up_cross',
            ticker: symbol,
            titleAr: `${symbol}: تجاوز +${threshold}% خلال الجلسة`,
            detailAr: `التغير الحالي ${round(row.changePct, 2)}%.`,
            actionAr: candidate ? 'راجع عدم مطاردة السعر ومساحة الهدف.' : 'معلومة حركة سوق.',
            currentValue: row.changePct,
            price: row.price,
            tier: row.tier
          });
        }
      }
      for (const threshold of A(policy.thresholds.negativeSessionThresholdsPct)) {
        if (crossedDown(n(prev.changePct), n(row.changePct), n(threshold))) {
          addAlert(alerts, {
            id: alertId(cairo.date, symbol, 'session_down_cross', threshold),
            level: candidate ? 'warning' : 'info',
            type: 'session_down_cross',
            ticker: symbol,
            titleAr: `${symbol}: هبط دون ${threshold}% خلال الجلسة`,
            detailAr: `التغير الحالي ${round(row.changePct, 2)}%.`,
            actionAr: candidate ? 'راجع الدعم والوقف وأوقف أي دخول جديد عند كسر الخطة.' : 'معلومة حركة سوق.',
            currentValue: row.changePct,
            price: row.price,
            tier: row.tier
          });
        }
      }
    }

    if (candidate && prev &&
        n(prev.turnoverPaceRatio, 0) < n(policy.thresholds.turnoverPaceAlertRatio, 1.5) &&
        n(row.turnoverPaceRatio, 0) >= n(policy.thresholds.turnoverPaceAlertRatio, 1.5)) {
      addAlert(alerts, {
        id: alertId(cairo.date, symbol, 'turnover_pace', '1.5'),
        level: 'opportunity',
        type: 'turnover_pace',
        ticker: symbol,
        titleAr: `${symbol}: تسارع قوي في قيمة التداول`,
        detailAr: `معدل التداول مقابل المتوقع للجلسة ${round(row.turnoverPaceRatio, 2)}×.`,
        actionAr: 'راجع اتجاه السعر؛ الحجم وحده ليس إشارة شراء.',
        currentValue: row.turnoverPaceRatio,
        price: row.price,
        tier: row.tier
      });
    }

    if (candidate && prev && prev.tier && row.tier && prev.tier !== row.tier) {
      addAlert(alerts, {
        id: alertId(cairo.date, symbol, 'tier_change', `${prev.tier}:${row.tier}`),
        level: 'opportunity',
        type: 'tier_change',
        ticker: symbol,
        titleAr: `${symbol}: تغير مستوى الترشيح`,
        detailAr: `من ${prev.tierLabelAr || prev.tier} إلى ${row.tierLabelAr || row.tier}.`,
        actionAr: 'راجع أسباب التغير في صفحة قرار اليوم.',
        previousValue: prev.tier,
        currentValue: row.tier,
        price: row.price,
        tier: row.tier
      });
    }

    if (candidate && prev &&
        Math.abs(n(row.decisionScore, 0) - n(prev.decisionScore, 0)) >= n(policy.thresholds.decisionScoreChangePoints, 8)) {
      addAlert(alerts, {
        id: alertId(cairo.date, symbol, 'decision_score_change', Math.round(n(row.decisionScore, 0))),
        level: n(row.decisionScore, 0) > n(prev.decisionScore, 0) ? 'opportunity' : 'warning',
        type: 'decision_score_change',
        ticker: symbol,
        titleAr: `${symbol}: تغير مهم في درجة القرار`,
        detailAr: `من ${round(prev.decisionScore, 1)} إلى ${round(row.decisionScore, 1)}.`,
        actionAr: 'راجع أسباب الدرجة؛ ليست احتمال ربح.',
        previousValue: prev.decisionScore,
        currentValue: row.decisionScore,
        price: row.price,
        tier: row.tier
      });
    }

    if (row.stale && (!prev || prev.stale !== true)) {
      addAlert(alerts, {
        id: alertId(cairo.date, symbol, 'stale_data', ''),
        level: candidate ? 'critical' : 'warning',
        type: 'stale_data',
        ticker: symbol,
        titleAr: `${symbol}: البيانات أصبحت قديمة`,
        detailAr: dataAge === null ? 'وقت المصدر غير متاح.' : `عمر البيانات ${round(dataAge, 1)} دقيقة.`,
        actionAr: 'لا تعتمد على السعر حتى يصل تحديث جديد.',
        currentValue: dataAge,
        price: row.price,
        tier: row.tier
      });
    }
  }

  rows.sort((a, b) =>
    Number(b.isDecisionCandidate) - Number(a.isDecisionCandidate) ||
    n(a.rank, 999) - n(b.rank, 999) ||
    n(b.turnover, 0) - n(a.turnover, 0) ||
    a.ticker.localeCompare(b.ticker)
  );

  const gateway = readJson(FILES.gateway, {});
  const sourceHealth = readJson(FILES.sourceHealth, {});
  const newestStamp = rows.map(x => x.fetchedAt).filter(Boolean).sort().at(-1) || null;
  const newestAge = ageMinutes(newestStamp, now);
  const candidateRows = rows.filter(x => x.isDecisionCandidate);
  const snapshot = {
    schemaVersion: '13.12.0',
    generatedAt,
    cairoTime: cairo.display,
    cairoDate: cairo.date,
    sessionProgressPct: round(progress * 100, 1),
    marketSessionState: progress <= 0 ? 'PRE_OPEN' : progress >= 1 ? 'POST_CLOSE' : 'OPEN',
    publicDelayedData: true,
    liveExecutionEnabled: false,
    source: {
      gatewayStatus: gateway.status || null,
      gatewayLevel: gateway.level || null,
      selectedSource: gateway.selectedSource || sourceHealth.sourceName || null,
      fallbackUsed: gateway.fallbackUsed === true,
      newestFetchedAt: newestStamp,
      newestDataAgeMinutes: round(newestAge, 1)
    },
    counts: {
      trackedSymbols: rows.length,
      decisionCandidates: candidateRows.length,
      staleRows: rows.filter(x => x.stale).length,
      entryZone: candidateRows.filter(x => x.state === 'ENTRY_ZONE').length,
      riskStates: candidateRows.filter(x => ['STOP_BREACHED', 'SUPPORT_BROKEN'].includes(x.state)).length,
      opportunityStates: candidateRows.filter(x => ['ENTRY_ZONE', 'BREAKOUT_CONFIRMED', 'TARGET1_HIT', 'TARGET2_HIT'].includes(x.state)).length
    },
    rows
  };

  const allExisting = A(previousAlertDoc.alerts);
  const genuinelyNew = alerts.filter(x => !previousAlertIds.has(x.id))
    .slice(0, n(policy.retention.maximumNewAlertsPerRun, 50));
  const combined = [...genuinelyNew, ...allExisting]
    .filter((item, index, array) => array.findIndex(x => x.id === item.id) === index)
    .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))
    .slice(0, n(policy.retention.maximumAlerts, 250));

  const alertDoc = {
    schemaVersion: '13.12.0',
    generatedAt,
    cairoTime: cairo.display,
    publicDelayedData: true,
    newAlertCount: genuinelyNew.length,
    counts: {
      critical: combined.filter(x => x.level === 'critical').length,
      opportunity: combined.filter(x => x.level === 'opportunity').length,
      warning: combined.filter(x => x.level === 'warning').length,
      info: combined.filter(x => x.level === 'info').length
    },
    newAlerts: genuinelyNew,
    alerts: combined
  };

  const compactSnapshot = {
    generatedAt,
    cairoTime: cairo.display,
    rows: rows.map(x => ({
      ticker: x.ticker,
      price: x.price,
      changePct: x.changePct,
      turnover: x.turnover,
      turnoverPaceRatio: x.turnoverPaceRatio,
      state: x.state,
      tier: x.tier,
      decisionScore: x.decisionScore,
      fetchedAt: x.fetchedAt
    }))
  };
  const history = {
    schemaVersion: '13.12.0',
    updatedAt: generatedAt,
    snapshots: [compactSnapshot, ...A(previousHistory.snapshots)]
      .filter((item, index, array) => array.findIndex(x => x.generatedAt === item.generatedAt) === index)
      .slice(0, n(policy.retention.maximumHistorySnapshots, 120))
  };

  const status = {
    schemaVersion: '13.12.0',
    generatedAt,
    ok: rows.length > 0,
    publicDelayedData: true,
    marketSessionState: snapshot.marketSessionState,
    newestDataAgeMinutes: snapshot.source.newestDataAgeMinutes,
    gatewayStatus: snapshot.source.gatewayStatus,
    fallbackUsed: snapshot.source.fallbackUsed,
    trackedSymbols: rows.length,
    newAlerts: genuinelyNew.length,
    noteAr: rows.length
      ? 'تمت مقارنة اللقطة الحالية بالسابقة دون اختلاق أي سعر أو حجم.'
      : 'لم توجد صفوف سوق صالحة؛ تم الحفاظ على التنبيهات السابقة.'
  };

  const telegramLevels = new Set(policy.notifications.notificationLevels || []);
  const telegramAlerts = genuinelyNew
    .filter(x => telegramLevels.has(x.level))
    .slice(0, n(policy.notifications.telegramMaximumAlertsPerMessage, 8));
  const telegram = telegramAlerts.length
    ? [
        `🔔 EGX Pro V13.12 — ${cairo.display}`,
        ...telegramAlerts.map(x => `• ${x.titleAr}\n${x.actionAr}`),
        '',
        'بيانات عامة متأخرة وليست لحظية، ولا توجد أوامر شراء تلقائية.'
      ].join('\n')
    : '';

  writeJson(FILES.latest, snapshot);
  writeJson(FILES.alerts, alertDoc);
  writeJson(FILES.history, history);
  writeJson(FILES.status, status);
  writeText(FILES.telegram, telegram);

  console.log(`V13.12 tracked=${rows.length}, candidates=${candidateRows.length}, newAlerts=${genuinelyNew.length}, session=${snapshot.marketSessionState}`);
}

try { main(); }
catch (error) {
  console.error(`V13.12 intraday monitor failed: ${error.stack || error.message}`);
  process.exit(1);
}
