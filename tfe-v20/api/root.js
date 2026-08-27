import fs from 'node:fs';

const INDEX_URL = new URL('../public/index.html', import.meta.url);
const FIX_TAG = '<script type="module" src="/snapshot-date-fix.js?v=20260827-snapshot-date-guard2"></script>';

export default function handler(req, res) {
  const source = fs.readFileSync(INDEX_URL, 'utf8');
  const html = source.includes(FIX_TAG) ? source : source.replace('</body>', `  ${FIX_TAG}\n</body>`);
  res.statusCode = 200;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(html);
}
