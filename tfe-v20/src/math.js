export const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
export const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
export const round = (v, d = 2) => Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null;
export const toNum = (v) => v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;

export function piecewise(x, points) {
  if (!Number.isFinite(x)) return null;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    if (x <= points[i][0]) {
      const [x1, y1] = points[i - 1];
      const [x2, y2] = points[i];
      const t = (x - x1) / (x2 - x1 || 1);
      return y1 + (y2 - y1) * t;
    }
  }
  return points.at(-1)[1];
}

export const sma = (xs, n) => xs.length < n ? null : avg(xs.slice(-n));

export function emaSeries(xs, n) {
  const out = Array(xs.length).fill(null);
  const k = 2 / (n + 1);
  let e = null;
  for (let i = 0; i < xs.length; i += 1) {
    if (e === null) {
      if (i >= n - 1) {
        e = avg(xs.slice(i - n + 1, i + 1));
        out[i] = e;
      }
    } else {
      e = xs[i] * k + e * (1 - k);
      out[i] = e;
    }
  }
  return out;
}

export function rsi(xs, n = 14) {
  if (xs.length <= n) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i += 1) {
    const d = xs[i] - xs[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  for (let i = n + 1; i < xs.length; i += 1) {
    const d = xs[i] - xs[i - 1];
    gain = (gain * (n - 1) + Math.max(0, d)) / n;
    loss = (loss * (n - 1) + Math.max(0, -d)) / n;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

export function atr(bars, n = 14) {
  if (bars.length < n) return null;
  const tr = bars.map((x, i) => i === 0
    ? x.high - x.low
    : Math.max(x.high - x.low, Math.abs(x.high - bars[i - 1].close), Math.abs(x.low - bars[i - 1].close)));
  let a = avg(tr.slice(0, n));
  for (let i = n; i < tr.length; i += 1) a = (a * (n - 1) + tr[i]) / n;
  return a;
}
