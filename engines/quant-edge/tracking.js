'use strict';

function tripleBarrierOutcome({ entry, stop, tp1, tp2, bars, maxSessions = 10 }) {
  const slice = bars.slice(0, maxSessions);
  let tp1HitAt = null, tp2HitAt = null, stopHitAt = null;
  let mfe = 0, mae = 0;
  for (let i = 0; i < slice.length; i++) {
    const b = slice[i];
    mfe = Math.max(mfe, (b.high / entry) - 1);
    mae = Math.min(mae, (b.low / entry) - 1);
    const hitStop = b.low <= stop, hit1 = b.high >= tp1, hit2 = b.high >= tp2;
    if (hitStop && stopHitAt === null) stopHitAt = i + 1;
    if (!hitStop && hit1 && tp1HitAt === null) tp1HitAt = i + 1;
    if (!hitStop && hit2 && tp2HitAt === null) tp2HitAt = i + 1;
    if (stopHitAt !== null || tp2HitAt !== null) break;
  }
  const first = stopHitAt !== null ? 'SL' : tp2HitAt !== null ? 'TP2' : tp1HitAt !== null ? 'TP1' : 'TIME';
  return { firstBarrier: first, tp1HitAt, tp2HitAt, stopHitAt, mfe, mae, sessionsObserved: slice.length };
}

function compareEngines(mainRec, quantRec) {
  if (!mainRec && !quantRec) return 'NO_SIGNAL';
  if (quantRec && !mainRec) return 'QUANT_ONLY';
  if (mainRec && !quantRec) return 'MAIN_ONLY';
  const mainDir = String(mainRec.direction || mainRec.status || '').toUpperCase();
  const quantDir = String(quantRec.direction || quantRec.status || '').toUpperCase();
  const bullish = x => ['BUY', 'STRONG_BUY', 'HIGH_CONVICTION_BUY'].includes(x);
  const bearish = x => ['SELL', 'STRONG_SELL', 'REJECT'].includes(x);
  if ((bullish(mainDir) && bearish(quantDir)) || (bearish(mainDir) && bullish(quantDir))) return 'CONFLICT';
  return 'AGREEMENT';
}

module.exports = { tripleBarrierOutcome, compareEngines };
