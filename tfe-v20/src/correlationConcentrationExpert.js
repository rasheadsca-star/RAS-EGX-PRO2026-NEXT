export const CORRELATION_CONCENTRATION_POLICY = Object.freeze({
  schemaVersion: 'egx.correlation-concentration-expert.1',
  expert: 'V16_CORRELATION_CONCENTRATION',
  researchOnly: true,
  lookbackReturns: 20,
  minimumCommonReturnsPerPair: 15,
  minimumBasketMembers: 3,
  medianPairwiseCorrelationWatchThreshold: 0.60,
  decisionWatch: 'CORRELATED_BASKET_WATCH',
  decisionPass: 'PASS',
  decisionUnavailable: 'UNAVAILABLE',
  scoringImpact: 'NONE',
  alphaWeight: 0,
  productionAuthority: false,
  promotionEligible: false,
  retuningAllowedAfterOutcome: false,
});

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function pearsonCorrelation(xs = [], ys = []) {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < 2) return null;
  const x = xs.map(finiteNumber);
  const y = ys.map(finiteNumber);
  if (x.some((v) => v === null) || y.some((v) => v === null)) return null;
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX <= 0 || varY <= 0) return null;
  return cov / Math.sqrt(varX * varY);
}

export function median(values = []) {
  const xs = values.map(finiteNumber).filter((v) => v !== null).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export function pairwiseCorrelations(returnSeriesByTicker = {}) {
  const tickers = Object.keys(returnSeriesByTicker).sort();
  const pairs = [];
  for (let i = 0; i < tickers.length; i += 1) {
    for (let j = i + 1; j < tickers.length; j += 1) {
      const left = tickers[i];
      const right = tickers[j];
      const leftMap = new Map((returnSeriesByTicker[left] || []).map((x) => [String(x.date), Number(x.returnPct)]));
      const rightMap = new Map((returnSeriesByTicker[right] || []).map((x) => [String(x.date), Number(x.returnPct)]));
      const commonDates = [...leftMap.keys()].filter((d) => rightMap.has(d)).sort();
      const xs = commonDates.map((d) => leftMap.get(d));
      const ys = commonDates.map((d) => rightMap.get(d));
      const correlation = pearsonCorrelation(xs, ys);
      pairs.push(Object.freeze({ left, right, commonReturns: commonDates.length, correlation }));
    }
  }
  return pairs;
}

export function assessCorrelationConcentration({ returnSeriesByTicker = {} } = {}) {
  const tickers = Object.keys(returnSeriesByTicker).sort();
  if (tickers.length < CORRELATION_CONCENTRATION_POLICY.minimumBasketMembers) {
    return Object.freeze({
      decision: CORRELATION_CONCENTRATION_POLICY.decisionUnavailable,
      reason: 'BASKET_TOO_SMALL',
      tickers,
      eligiblePairs: 0,
      medianPairwiseCorrelation: null,
      latestUsedDate: null,
    });
  }

  const allPairs = pairwiseCorrelations(returnSeriesByTicker);
  const eligiblePairs = allPairs.filter((p) =>
    p.commonReturns >= CORRELATION_CONCENTRATION_POLICY.minimumCommonReturnsPerPair
    && Number.isFinite(p.correlation));
  if (!eligiblePairs.length) {
    return Object.freeze({
      decision: CORRELATION_CONCENTRATION_POLICY.decisionUnavailable,
      reason: 'NO_ELIGIBLE_PAIRS',
      tickers,
      eligiblePairs: 0,
      medianPairwiseCorrelation: null,
      latestUsedDate: null,
      pairs: allPairs,
    });
  }

  const med = median(eligiblePairs.map((p) => p.correlation));
  const latestUsedDate = Object.values(returnSeriesByTicker)
    .flat()
    .map((x) => String(x.date || ''))
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const decision = med >= CORRELATION_CONCENTRATION_POLICY.medianPairwiseCorrelationWatchThreshold
    ? CORRELATION_CONCENTRATION_POLICY.decisionWatch
    : CORRELATION_CONCENTRATION_POLICY.decisionPass;

  return Object.freeze({
    decision,
    reason: decision === CORRELATION_CONCENTRATION_POLICY.decisionWatch
      ? 'MEDIAN_PAIRWISE_CORRELATION_AT_OR_ABOVE_FROZEN_THRESHOLD'
      : 'MEDIAN_PAIRWISE_CORRELATION_BELOW_FROZEN_THRESHOLD',
    tickers,
    eligiblePairs: eligiblePairs.length,
    medianPairwiseCorrelation: med,
    latestUsedDate,
    pairs: eligiblePairs,
  });
}
