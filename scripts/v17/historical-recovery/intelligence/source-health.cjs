'use strict';

function deriveSourceHealth({ market, fundamentals, news, generatedAt = new Date() }) {
  const marketCoverage = market.summary.successfullyCoveredEquities / Math.max(1, market.summary.canonicalOrdinaryEquities);
  const historyValid = market.summary.validHistoricalData / Math.max(1, market.summary.canonicalOrdinaryEquities);
  const fundamentalScored = fundamentals.summary.scored / Math.max(1, fundamentals.summary.universe);
  return {
    schemaVersion: '17.4.0-source-health-1',
    generatedAt: generatedAt.toISOString(),
    sources: [
      { id: 'PRICE_SOURCE', labelAr: 'مصدر الأسعار', status: marketCoverage >= 0.95 ? 'HEALTHY' : marketCoverage >= 0.75 ? 'DEGRADED' : 'FAILED', coveragePct: Number((marketCoverage * 100).toFixed(2)) },
      { id: 'LONG_HISTORY_SOURCE', labelAr: 'مصدر التاريخ الطويل', status: historyValid >= 0.9 ? 'HEALTHY' : historyValid >= 0.6 ? 'DEGRADED' : 'FAILED', coveragePct: Number((historyValid * 100).toFixed(2)) },
      { id: 'FUNDAMENTAL_SOURCE', labelAr: 'مصدر القوائم المالية', status: fundamentalScored >= 0.8 ? 'HEALTHY' : fundamentalScored > 0 ? 'DEGRADED' : 'FAILED', coveragePct: Number((fundamentalScored * 100).toFixed(2)) },
      { id: 'OFFICIAL_DISCLOSURE_SOURCE', labelAr: 'مصدر الإفصاحات الرسمية', status: news.sourceHealth || 'FAILED', coveragePct: Number((news.summary.coveredSymbols / Math.max(1, news.summary.universe) * 100).toFixed(2)) },
      { id: 'NEWS_SOURCE', labelAr: 'مصدر الأخبار', status: news.sourceHealth || 'FAILED', coveragePct: Number((news.summary.coveredSymbols / Math.max(1, news.summary.universe) * 100).toFixed(2)) },
    ],
  };
}

module.exports = { deriveSourceHealth };
