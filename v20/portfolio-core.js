(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.V20PortfolioCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'egx-pro-v20-user-portfolio-v1';

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeTicker(value) {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/\.CA$/, '')
      .replace(/[^A-Z0-9.]/g, '');
  }

  function normalizeHolding(input) {
    const ticker = normalizeTicker(input?.ticker);
    const averageBuyPrice = finite(input?.averageBuyPrice);
    const quantity = finite(input?.quantity);
    if (!ticker) return { ok: false, error: 'TICKER_REQUIRED' };
    if (!(averageBuyPrice > 0)) return { ok: false, error: 'AVERAGE_BUY_PRICE_MUST_BE_POSITIVE' };
    if (!(quantity > 0)) return { ok: false, error: 'QUANTITY_MUST_BE_POSITIVE' };
    return {
      ok: true,
      holding: {
        ticker,
        averageBuyPrice,
        quantity,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  function currentPriceFromMarketRow(row) {
    const price = finite(row?.price);
    if (row?.currentSessionAvailable !== true) return null;
    if (!(price > 0)) return null;
    return price;
  }

  function evaluateHolding(holding, marketRow, opportunity, executionStatus) {
    const normalized = normalizeHolding(holding);
    if (!normalized.ok) return { ok: false, error: normalized.error, ticker: normalizeTicker(holding?.ticker) };

    const h = normalized.holding;
    const currentPrice = currentPriceFromMarketRow(marketRow);
    const costBasis = h.averageBuyPrice * h.quantity;
    const currentValue = currentPrice === null ? null : currentPrice * h.quantity;
    const pnl = currentValue === null ? null : currentValue - costBasis;
    const pnlPct = pnl === null || !(costBasis > 0) ? null : (pnl / costBasis) * 100;
    const riskFlags = [];

    if (currentPrice === null) riskFlags.push('NO_CURRENT_SESSION_PRICE');
    if (marketRow?.sourceConflict === true) riskFlags.push('SOURCE_CONFLICT');
    if (
      marketRow &&
      (
        marketRow.dataQualityState !== 'COMPLETE_FOR_CURRENT_SCOPE' ||
        Number(marketRow.criticalFieldCompletenessPct || 0) < 85
      )
    ) riskFlags.push('CURRENT_DATA_QUALITY_PARTIAL');
    if (executionStatus !== 'EXECUTION_GRADE') riskFlags.push('GLOBAL_EXECUTION_GATE_CLOSED');

    const stop = finite(opportunity?.tradePlan?.stop);
    const target1 = finite(opportunity?.tradePlan?.target1);
    if (currentPrice !== null && stop !== null && currentPrice <= stop) riskFlags.push('REFERENCE_STOP_LEVEL_REACHED_OR_BREACHED');
    if (currentPrice !== null && target1 !== null && currentPrice >= target1) riskFlags.push('REFERENCE_TARGET1_REACHED_OR_EXCEEDED');

    const requiresReview = riskFlags.some(flag => [
      'NO_CURRENT_SESSION_PRICE',
      'SOURCE_CONFLICT',
      'CURRENT_DATA_QUALITY_PARTIAL',
      'REFERENCE_STOP_LEVEL_REACHED_OR_BREACHED',
    ].includes(flag));

    return {
      ok: true,
      ticker: h.ticker,
      averageBuyPrice: h.averageBuyPrice,
      quantity: h.quantity,
      costBasis,
      currentPrice,
      currentValue,
      pnl,
      pnlPct,
      currentSessionPriced: currentPrice !== null,
      v20ReferenceStatus: opportunity?.status || null,
      v20ReferenceRank: finite(opportunity?.rank),
      riskFlags,
      monitoringState: requiresReview ? 'OWNED_POSITION_REVIEW_REQUIRED' : 'OWNED_POSITION_MONITOR',
      automaticBuySellInstruction: null,
      executionGateOverridden: false,
    };
  }

  function aggregateEvaluations(items) {
    const valid = (items || []).filter(item => item?.ok === true);
    const totalCostBasis = valid.reduce((sum, item) => sum + Number(item.costBasis || 0), 0);
    const priced = valid.filter(item => item.currentSessionPriced === true && finite(item.currentValue) !== null);
    const pricedCurrentValue = priced.reduce((sum, item) => sum + Number(item.currentValue || 0), 0);
    const pricedCostBasis = priced.reduce((sum, item) => sum + Number(item.costBasis || 0), 0);
    const pricedPnl = priced.reduce((sum, item) => sum + Number(item.pnl || 0), 0);
    const pricedPnlPct = pricedCostBasis > 0 ? (pricedPnl / pricedCostBasis) * 100 : null;

    return {
      holdingCount: valid.length,
      pricedCount: priced.length,
      unpricedCount: valid.length - priced.length,
      totalCostBasis,
      pricedCurrentValue,
      pricedCostBasis,
      pricedPnl,
      pricedPnlPct,
    };
  }

  function portfolioWeights(items) {
    const priced = (items || []).filter(item => item?.ok === true && item.currentSessionPriced === true && finite(item.currentValue) !== null);
    const total = priced.reduce((sum, item) => sum + Number(item.currentValue || 0), 0);
    const map = {};
    for (const item of priced) map[item.ticker] = total > 0 ? (Number(item.currentValue) / total) * 100 : null;
    return map;
  }

  return {
    STORAGE_KEY,
    finite,
    normalizeTicker,
    normalizeHolding,
    currentPriceFromMarketRow,
    evaluateHolding,
    aggregateEvaluations,
    portfolioWeights,
  };
});
