'use strict';

function tripleBarrierOutcome({ entry, stop, tp1, tp2, bars, maxSessions = 10 }) {
  if (![entry, stop, tp1, tp2].every(Number.isFinite)) throw new Error('QUANT_EDGE_INVALID_BARRIERS');
  const slice = Array.isArray(bars) ? bars.slice(0, maxSessions) : [];
  let tp1HitAt = null, tp2HitAt = null, stopHitAt = null, firstBarrier = null;
  let mfe = 0, mae = 0;

  for (let i = 0; i < slice.length; i++) {
    const b = slice[i];
    const high = Number(b.high), low = Number(b.low);
    if (!Number.isFinite(high) || !Number.isFinite(low)) continue;
    mfe = Math.max(mfe, (high / entry) - 1);
    mae = Math.min(mae, (low / entry) - 1);
    const hitStop = low <= stop;
    const hit1 = high >= tp1;
    const hit2 = high >= tp2;

    if (hitStop && tp1HitAt === null) {
      stopHitAt = i + 1;
      firstBarrier = firstBarrier || 'SL';
      break;
    }
    if (hit1 && tp1HitAt === null) {
      tp1HitAt = i + 1;
      firstBarrier = firstBarrier || 'TP1';
    }
    if (hit2 && tp2HitAt === null && !hitStop) {
      if (tp1HitAt === null) tp1HitAt = i + 1;
      tp2HitAt = i + 1;
      firstBarrier = firstBarrier || 'TP1';
      break;
    }
    if (hitStop) {
      stopHitAt = i + 1;
      firstBarrier = firstBarrier || 'SL';
      break;
    }
  }

  const tp1BeforeSl = tp1HitAt !== null && (stopHitAt === null || tp1HitAt < stopHitAt);
  const tp2BeforeSl = tp2HitAt !== null && (stopHitAt === null || tp2HitAt < stopHitAt);
  return {
    firstBarrier: firstBarrier || 'TIME',
    tp1HitAt, tp2HitAt, stopHitAt,
    tp1BeforeSl, tp2BeforeSl,
    stoppedAfterTp1: stopHitAt !== null && tp1HitAt !== null && tp1HitAt < stopHitAt,
    mfe, mae, sessionsObserved: slice.length,
  };
}

function compareEngines(mainRec, quantRec) {
  if (!mainRec && !quantRec) return 'NO_SIGNAL';
  if (quantRec && !mainRec) return 'QUANT_ONLY';
  if (mainRec && !quantRec) return 'MAIN_ONLY';
  const mainDir = String(mainRec.direction || mainRec.status || mainRec.recommendation || mainRec.signal || '').toUpperCase();
  const quantDir = String(quantRec.direction || quantRec.status || '').toUpperCase();
  const bullish = x => ['BUY', 'STRONG_BUY', 'HIGH_CONVICTION_BUY', 'شراء', 'شراء قوي'].some(v => x.includes(v));
  const bearish = x => ['SELL', 'STRONG_SELL', 'REJECT', 'بيع', 'رفض'].some(v => x.includes(v));
  if ((bullish(mainDir) && bearish(quantDir)) || (bearish(mainDir) && bullish(quantDir))) return 'CONFLICT';
  return 'AGREEMENT';
}

module.exports = { tripleBarrierOutcome, compareEngines };
