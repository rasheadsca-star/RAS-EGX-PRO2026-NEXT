export function auditHistoryDepth(symbols = []) {
  const rows = (Array.isArray(symbols) ? symbols : []).map((x) => {
    const sessions = Number(x.availableSessions ?? 0);
    const tier = sessions >= 750 ? 'MULTI_YEAR_STRONG' : sessions >= 500 ? 'MULTI_YEAR' : sessions >= 250 ? 'ONE_YEAR_PLUS' : sessions >= 120 ? 'SHORT' : 'VERY_SHORT';
    return {
      ticker: String(x.ticker ?? '').toUpperCase(),
      sessions,
      firstSession: x.firstSession ?? null,
      lastSession: x.lastSession ?? null,
      tier,
      suitableForRobustRegimeStudy: sessions >= 500,
      scoringImpact: 'NONE',
    };
  });
  const counts = rows.reduce((acc, x) => ((acc[x.tier] = (acc[x.tier] ?? 0) + 1), acc), {});
  return {
    schemaVersion: 'tfe.history-depth.1',
    scoringImpact: 'NONE',
    total: rows.length,
    robustRegimeCoveragePct: rows.length ? Number((rows.filter((x) => x.suitableForRobustRegimeStudy).length / rows.length * 100).toFixed(1)) : null,
    counts,
    rows,
  };
}
