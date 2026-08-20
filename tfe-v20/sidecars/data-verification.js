const pctDiff = (a, b) => {
  const x = Number(a), y = Number(b);
  if (!(x > 0) || !(y > 0)) return null;
  return Math.abs(x - y) / Math.max(x, y) * 100;
};

export function verifyOfficialSnapshot({ marketRows = [], officialRows = [], tolerancePct = 1 } = {}) {
  const official = new Map((Array.isArray(officialRows) ? officialRows : []).map((x) => [String(x.ticker ?? '').toUpperCase(), x]));
  const rows = (Array.isArray(marketRows) ? marketRows : []).map((market) => {
    const ticker = String(market.ticker ?? '').toUpperCase();
    const ref = official.get(ticker);
    if (!ref) return { ticker, status: 'MISSING_OFFICIAL', scoringImpact: 'NONE' };
    if (ref.official !== true) return { ticker, status: 'UNVERIFIED_REFERENCE', scoringImpact: 'NONE', source: ref.source ?? null };
    if (market.lastSession && ref.date && market.lastSession !== ref.date) {
      return { ticker, status: 'SESSION_MISMATCH', scoringImpact: 'NONE', marketDate: market.lastSession, officialDate: ref.date, source: ref.source ?? null };
    }
    const conflictPct = pctDiff(market.close ?? market.price ?? market.latestClose, ref.close);
    if (conflictPct == null) return { ticker, status: 'INSUFFICIENT_PRICE_DATA', scoringImpact: 'NONE', source: ref.source ?? null };
    return {
      ticker,
      status: conflictPct <= tolerancePct ? 'VERIFIED' : 'CONFLICT',
      conflictPct: Number(conflictPct.toFixed(4)),
      tolerancePct,
      source: ref.source ?? null,
      officialDate: ref.date ?? null,
      scoringImpact: 'NONE',
    };
  });
  const counts = rows.reduce((acc, x) => ((acc[x.status] = (acc[x.status] ?? 0) + 1), acc), {});
  return {
    schemaVersion: 'tfe.data-verification.1',
    scoringImpact: 'NONE',
    alphaMutationAllowed: false,
    tolerancePct,
    total: rows.length,
    counts,
    rows,
  };
}
