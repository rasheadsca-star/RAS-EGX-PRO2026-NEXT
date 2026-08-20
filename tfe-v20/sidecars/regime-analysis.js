const avg = (xs) => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
const sma = (xs,n) => xs.length >= n ? avg(xs.slice(-n)) : null;
const pct = (a,b) => Number(b) ? (Number(a)/Number(b)-1)*100 : null;

export function classifyRegime(rows = []) {
  const bars = (Array.isArray(rows) ? rows : []).filter((x) => Number(x.close) > 0).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  if (bars.length < 60) return { regime: 'INSUFFICIENT_HISTORY', confidence: 'LOW', scoringImpact: 'NONE' };
  const closes = bars.map((x)=>Number(x.close));
  const close = closes.at(-1);
  const r20 = pct(close, closes.at(-21));
  const r60 = pct(close, closes.at(-61));
  if (bars.length >= 200) {
    const s50 = sma(closes,50), s200 = sma(closes,200);
    const bull = close > s200 && s50 > s200 && r20 > 0;
    const bear = close < s200 && s50 < s200 && r20 < 0;
    return { regime: bull ? 'BULL' : bear ? 'BEAR' : 'SIDEWAYS', confidence: 'STANDARD_200_SESSION', close, sma50:s50, sma200:s200, return20Pct:r20, return60Pct:r60, scoringImpact:'NONE' };
  }
  const s20 = sma(closes,20), s50 = sma(closes,50);
  const bull = close > s50 && s20 > s50 && r20 > 0 && r60 > 0;
  const bear = close < s50 && s20 < s50 && r20 < 0 && r60 < 0;
  return { regime: bull ? 'BULL' : bear ? 'BEAR' : 'SIDEWAYS', confidence: 'PROVISIONAL_SHORT_HISTORY', close, sma20:s20, sma50:s50, return20Pct:r20, return60Pct:r60, scoringImpact:'NONE' };
}

export function classifyRegimeAtDate(rows = [], date) {
  const prefix = (Array.isArray(rows) ? rows : []).filter((x)=>String(x.date) <= String(date));
  return { ...classifyRegime(prefix), asOfDate: date ?? null, futureRowsExcluded: true };
}

export function segmentEvidenceByRegime(items = []) {
  const groups = { BULL:[], BEAR:[], SIDEWAYS:[], INSUFFICIENT_HISTORY:[] };
  for (const item of Array.isArray(items) ? items : []) {
    const key = groups[item.regime] ? item.regime : 'INSUFFICIENT_HISTORY';
    groups[key].push(item);
  }
  const summarize = (rows) => {
    const resolved = rows.filter((x)=>x.resolved === true && x.status !== 'EXPIRED');
    const t1 = resolved.filter((x)=>x.status === 'TARGET1').length;
    const stops = resolved.filter((x)=>String(x.status).startsWith('STOP')).length;
    return {
      signals: rows.length,
      resolved: resolved.length,
      target1Pct: resolved.length ? Number((t1/resolved.length*100).toFixed(1)) : null,
      stopPct: resolved.length ? Number((stops/resolved.length*100).toFixed(1)) : null,
    };
  };
  return {
    schemaVersion:'tfe.regime-evidence.1',
    scoringImpact:'NONE',
    BULL:summarize(groups.BULL),
    BEAR:summarize(groups.BEAR),
    SIDEWAYS:summarize(groups.SIDEWAYS),
    INSUFFICIENT_HISTORY:summarize(groups.INSUFFICIENT_HISTORY),
  };
}
