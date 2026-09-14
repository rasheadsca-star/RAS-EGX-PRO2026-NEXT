export const DOWNSIDE_FRAGILITY_POLICY = Object.freeze({
  schemaVersion: 'egx.downside-fragility-expert.1',
  expert: 'V16_DOWNSIDE_FRAGILITY',
  purpose: 'Target the observed V16.9 gap-down recovery loss mechanism without using generic market filters.',
  signalStage: 'SIGNAL_CLOSE',
  executionStage: 'NEXT_SESSION_OPEN',
  lookbackGaps: 20,
  historicalDownGapCutoffPct: -1.0,
  minimumDownGapFrequencyPct: 15.0,
  historicalGapQ10CutoffPct: -1.5,
  signalTrigger: 'downGapFrequencyPct >= 15 AND gapQ10Pct <= -1.5',
  executionTrigger: 'nextOpen < frozenEntryLow',
  scoringImpact: 'NONE',
  alphaWeight: 0,
  productionAuthority: false,
  promotionEligible: false,
  retuningAllowedAfterAudit: false,
});

function finite(v) {
  return Number.isFinite(Number(v));
}

function pct(a, b) {
  return finite(a) && finite(b) && Number(b) !== 0
    ? (Number(a) / Number(b) - 1) * 100
    : null;
}

function quantile(values, q) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  const w = pos - lo;
  return s[lo] * (1 - w) + s[hi] * w;
}

function normalizeBars(bars) {
  return (Array.isArray(bars) ? bars : [])
    .map((b) => ({
      date: String(b?.date || ''),
      open: Number(b?.open),
      close: Number(b?.adjustedClose ?? b?.close),
    }))
    .filter((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.date) && b.open > 0 && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function assessSignalTimeFragility({ bars, signalDate } = {}) {
  const date = String(signalDate || '');
  const normalized = normalizeBars(bars);
  const visible = normalized.filter((b) => b.date <= date);
  const required = DOWNSIDE_FRAGILITY_POLICY.lookbackGaps + 1;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || visible.length < required || visible.at(-1)?.date !== date) {
    return Object.freeze({
      decision: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_EXACT_SIGNAL_DATE_HISTORY',
      scoringImpact: 'NONE',
      alphaWeight: 0,
      productionAuthority: false,
    });
  }

  const window = visible.slice(-required);
  const gaps = [];
  for (let i = 1; i < window.length; i++) {
    const gap = pct(window[i].open, window[i - 1].close);
    if (Number.isFinite(gap)) gaps.push(gap);
  }

  if (gaps.length !== DOWNSIDE_FRAGILITY_POLICY.lookbackGaps) {
    return Object.freeze({
      decision: 'UNAVAILABLE',
      reason: 'INCOMPLETE_GAP_WINDOW',
      scoringImpact: 'NONE',
      alphaWeight: 0,
      productionAuthority: false,
    });
  }

  const downsideCount = gaps.filter((g) => g <= DOWNSIDE_FRAGILITY_POLICY.historicalDownGapCutoffPct).length;
  const downGapFrequencyPct = downsideCount / gaps.length * 100;
  const gapQ10Pct = quantile(gaps, 0.10);
  const fragile = downGapFrequencyPct >= DOWNSIDE_FRAGILITY_POLICY.minimumDownGapFrequencyPct
    && gapQ10Pct <= DOWNSIDE_FRAGILITY_POLICY.historicalGapQ10CutoffPct;

  return Object.freeze({
    decision: fragile ? 'FRAGILE_WATCH' : 'PASS',
    reason: fragile ? 'REPEATED_HISTORICAL_DOWNSIDE_GAP_FRAGILITY' : 'NO_FIXED_FRAGILITY_TRIGGER',
    signalDate: date,
    latestUsedDate: visible.at(-1).date,
    observations: gaps.length,
    downGapFrequencyPct: Number(downGapFrequencyPct.toFixed(4)),
    gapQ10Pct: Number(gapQ10Pct.toFixed(4)),
    scoringImpact: 'NONE',
    alphaWeight: 0,
    productionAuthority: false,
  });
}

export function assessNextOpenRecoveryTrap({ frozenEntryLow, nextOpen } = {}) {
  const entryLow = Number(frozenEntryLow);
  const open = Number(nextOpen);
  if (!(entryLow > 0) || !(open > 0)) {
    return Object.freeze({
      decision: 'UNAVAILABLE',
      reason: 'MISSING_FROZEN_ENTRY_OR_NEXT_OPEN',
      scoringImpact: 'NONE',
      alphaWeight: 0,
      productionAuthority: false,
    });
  }

  const gapBelowEntryLowPct = pct(open, entryLow);
  const veto = open < entryLow;
  return Object.freeze({
    decision: veto ? 'VETO_GAP_DOWN_RECOVERY_ENTRY' : 'PASS',
    reason: veto ? 'NEXT_OPEN_BELOW_FROZEN_ENTRY_ZONE' : 'NEXT_OPEN_NOT_BELOW_FROZEN_ENTRY_ZONE',
    gapBelowEntryLowPct: Number(gapBelowEntryLowPct.toFixed(4)),
    scoringImpact: 'NONE',
    alphaWeight: 0,
    productionAuthority: false,
  });
}
