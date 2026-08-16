import { round } from './math.mjs';

export function wilsonInterval(successes, total, z = 1.959963984540054) {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || total <= 0 || successes < 0 || successes > total) {
    return null;
  }
  const p = successes / total;
  const z2 = z ** 2;
  const denominator = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) / total) + (z2 / (4 * total ** 2)))) / denominator;
  return {
    levelPct: 95,
    lowPct: round((centre - margin) * 100, 2),
    highPct: round((centre + margin) * 100, 2),
  };
}
