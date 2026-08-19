// Original standalone EGX technical scorer preserved for RC2.
// Live analysis and historical simulation both reuse this exact scoreBars().
import { sma, rsi, macd, atr, lastValid } from './originalIndicators.js';

export const WEIGHTS = Object.freeze({
  trend: 30,
  momentum: 25,
  macdCross: 20,
  volatilityRisk: -15,
  volumeConfirmation: 10,
});

export function scoreBars(bars) {
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume ?? 0);
  const sma50 = lastValid(sma(closes, 50));
  const sma200 = bars.length >= 200 ? lastValid(sma(closes, 200)) : null;
  const rsi14 = lastValid(rsi(closes, 14));
  const { histogram } = macd(closes);
  const macdHist = lastValid(histogram);
  const macdHistPrev = lastValid(histogram.slice(0, -1));
  const atr14 = lastValid(atr(bars, 14));
  const lastClose = closes[closes.length - 1];
  const avgVolume20 = average(volumes.slice(-20));
  const lastVolume = volumes[volumes.length - 1];
  const breakdown = [];

  let trendPoints = 0;
  if (sma50 != null) {
    if (lastClose > sma50) trendPoints += WEIGHTS.trend * 0.6;
    if (sma200 != null && sma50 > sma200) trendPoints += WEIGHTS.trend * 0.4;
    else if (sma200 == null) trendPoints += WEIGHTS.trend * 0.2;
  }
  breakdown.push({
    component: 'الاتجاه (السعر مقابل المتوسطين 50 و200 يوم)',
    points: round(trendPoints),
    max: WEIGHTS.trend,
    detail: sma200 != null
      ? `السعر ${fmt(lastClose)} | SMA50 ${fmt(sma50)} | SMA200 ${fmt(sma200)}`
      : `السعر ${fmt(lastClose)} | SMA50 ${fmt(sma50)} | SMA200 غير متاح (تاريخ أقل من 200 يوم)`,
  });

  let momentumPoints = 0;
  let rsiNote = 'غير متاح';
  if (rsi14 != null) {
    if (rsi14 >= 50 && rsi14 <= 68) momentumPoints = WEIGHTS.momentum;
    else if (rsi14 > 68 && rsi14 <= 80) momentumPoints = WEIGHTS.momentum * 0.4;
    else if (rsi14 > 80) momentumPoints = 0;
    else if (rsi14 >= 35 && rsi14 < 50) momentumPoints = WEIGHTS.momentum * 0.3;
    else momentumPoints = 0;
    rsiNote = `RSI(14) = ${fmt(rsi14)}`;
  }
  breakdown.push({ component: 'الزخم (RSI)', points: round(momentumPoints), max: WEIGHTS.momentum, detail: rsiNote });

  let macdPoints = 0;
  let macdNote = 'غير متاح';
  if (macdHist != null) {
    if (macdHist > 0 && macdHistPrev != null && macdHist > macdHistPrev) macdPoints = WEIGHTS.macdCross;
    else if (macdHist > 0) macdPoints = WEIGHTS.macdCross * 0.5;
    macdNote = `MACD histogram = ${fmt(macdHist)}${macdHistPrev != null ? ` (سابقًا ${fmt(macdHistPrev)})` : ''}`;
  }
  breakdown.push({ component: 'تقاطع MACD', points: round(macdPoints), max: WEIGHTS.macdCross, detail: macdNote });

  let volPenalty = 0;
  let volNote = 'غير متاح';
  if (atr14 != null && lastClose) {
    const atrPct = (atr14 / lastClose) * 100;
    if (atrPct > 5) volPenalty = WEIGHTS.volatilityRisk;
    else if (atrPct > 3) volPenalty = WEIGHTS.volatilityRisk * 0.5;
    volNote = `ATR(14) = ${fmt(atr14)} (${fmt(atrPct)}% من السعر)`;
  }
  breakdown.push({ component: 'عقوبة التقلب (كلما زاد أعلى قيمة سالبة)', points: round(volPenalty), max: WEIGHTS.volatilityRisk, detail: volNote });

  let volumePoints = 0;
  let volumeNote = 'غير متاح';
  if (avgVolume20 > 0) {
    const ratio = lastVolume / avgVolume20;
    if (ratio >= 1.2) volumePoints = WEIGHTS.volumeConfirmation;
    else if (ratio >= 0.8) volumePoints = WEIGHTS.volumeConfirmation * 0.5;
    volumeNote = `حجم آخر جلسة ÷ متوسط 20 يوم = ${fmt(ratio)}×`;
  }
  breakdown.push({ component: 'تأكيد حجم التداول', points: round(volumePoints), max: WEIGHTS.volumeConfirmation, detail: volumeNote });

  const maxPossible = WEIGHTS.trend + WEIGHTS.momentum + WEIGHTS.macdCross + WEIGHTS.volumeConfirmation;
  const rawTotal = trendPoints + momentumPoints + macdPoints + volPenalty + volumePoints;
  const normalizedScore = round(clamp((rawTotal / maxPossible) * 100, 0, 100));
  let reading = 'محايدة';
  if (normalizedScore >= 65) reading = 'إيجابية';
  else if (normalizedScore <= 35) reading = 'سلبية';

  return {
    lastClose,
    technicalReading: reading,
    score: normalizedScore,
    breakdown,
    oversoldFlag: rsi14 != null && rsi14 < 30,
  };
}

function average(values) {
  const valid = values.filter((v) => v != null);
  if (!valid.length) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function round(v, digits = 1) { return v == null || Number.isNaN(v) ? null : Number(v.toFixed(digits)); }
function fmt(v) { return v == null ? '—' : Number(v).toFixed(2); }
