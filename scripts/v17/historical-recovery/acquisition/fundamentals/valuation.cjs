'use strict';

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function calculateSameCurrencyValuation(company, market, asOf = new Date()) {
  const evidence = company?.shareEvidence || {};
  const latest = (company?.periods || [])
    .filter(period => period.periodType === 'ANNUAL' && period.comparable !== false)
    .sort((a, b) => String(a.periodEnd).localeCompare(String(b.periodEnd)))
    .at(-1);
  const price = market?.horizons?.maxAvailable?.current;
  const issues = [];
  if (!latest) issues.push('COMPARABLE_ANNUAL_PERIOD_REQUIRED');
  if (!finite(price)) issues.push('VALIDATED_MARKET_PRICE_REQUIRED');
  if (!finite(evidence.sharesOutstanding) || Number(evidence.sharesOutstanding) <= 0) issues.push('SHARES_OUTSTANDING_REQUIRED');
  if (evidence.corporateActionReview) issues.push('SHARE_COUNT_CORPORATE_ACTION_REVIEW');
  if (!company?.currency || !evidence.currency || String(company.currency).toUpperCase() !== String(evidence.currency).toUpperCase()) issues.push('SHARE_EVIDENCE_CURRENCY_CONFLICT');
  if (issues.length) return { status: 'VALUATION_DATA_INSUFFICIENT', issues, valuationTimestamp: asOf.toISOString(), priceTimestamp: market?.coverageEnd || null };

  const shares = Number(evidence.sharesOutstanding);
  const marketCapitalization = Number(price) * shares;
  const priceToEarnings = finite(latest.netProfit) && Number(latest.netProfit) > 0 ? marketCapitalization / Number(latest.netProfit) : null;
  const priceToBook = finite(latest.totalEquity) && Number(latest.totalEquity) > 0 ? marketCapitalization / Number(latest.totalEquity) : null;
  const enterpriseValue = finite(latest.totalDebt) && finite(latest.cash)
    ? marketCapitalization + Number(latest.totalDebt) - Number(latest.cash) : null;
  const evToEbitda = finite(enterpriseValue) && finite(latest.ebitda) && Number(latest.ebitda) > 0 ? enterpriseValue / Number(latest.ebitda) : null;
  const dividendYieldPct = finite(latest.dividendPerShare) && Number(price) > 0 ? Number(latest.dividendPerShare) / Number(price) * 100 : null;
  return {
    status: [priceToEarnings, priceToBook, evToEbitda, dividendYieldPct].filter(finite).length >= 2 ? 'AVAILABLE' : 'VALUATION_DATA_INSUFFICIENT',
    priceToEarnings: finite(priceToEarnings) ? Number(priceToEarnings.toFixed(4)) : null,
    priceToBook: finite(priceToBook) ? Number(priceToBook.toFixed(4)) : null,
    evToEbitda: finite(evToEbitda) ? Number(evToEbitda.toFixed(4)) : null,
    dividendYieldPct: finite(dividendYieldPct) ? Number(dividendYieldPct.toFixed(4)) : null,
    marketCapitalization: Number(marketCapitalization.toFixed(2)),
    enterpriseValue: finite(enterpriseValue) ? Number(enterpriseValue.toFixed(2)) : null,
    currency: company.currency,
    sharesOutstanding: shares,
    valuationTimestamp: asOf.toISOString(),
    priceTimestamp: market.coverageEnd || null,
    priceSource: 'V17_VALIDATED_COMPACT_MARKET_HISTORY',
    shareEvidence: { documentId: evidence.documentId || null, sourceUrl: evidence.sourceUrl || null, asOf: evidence.asOf || null },
    earningsPeriodEnd: latest.periodEnd,
    method: 'SAME_CURRENCY_MARKET_CAP_RATIOS_NO_FX_CONVERSION',
    issues: [],
  };
}

module.exports = { calculateSameCurrencyValuation };
