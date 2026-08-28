const DEFAULT_RC2_ORIGIN = 'https://egx-tfe-v20-fusion-rc2-7g9dcsh4k-steverabin38-1168s-projects.vercel.app';
const ALLOWED_IMMUTABLE_HOST = /^egx-tfe-v20-fusion-rc2-[a-z0-9]+-steverabin38-1168s-projects\.vercel\.app$/i;

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

export function getOrigin(env = process.env) {
  const raw = env.RC2_ORIGIN || DEFAULT_RC2_ORIGIN;
  const origin = new URL(raw);
  const allowLocal = env.NODE_ENV === 'test' && /^(127\.0\.0\.1|localhost)$/.test(origin.hostname);
  if (!allowLocal && !ALLOWED_IMMUTABLE_HOST.test(origin.hostname)) {
    throw new Error('RC2_ORIGIN must be the immutable frozen RC2 deployment URL. Aliases are forbidden to prevent recursive proxying.');
  }
  if (env.VERCEL_URL && origin.hostname === env.VERCEL_URL) {
    throw new Error('RC2_ORIGIN cannot point to the shell deployment itself.');
  }
  return origin;
}

function appendQuery(url, query = {}) {
  for (const [key, raw] of Object.entries(query)) {
    if (key === 'upstream') continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value !== undefined && value !== null) url.searchParams.append(key, String(value));
    }
  }
}

export function buildTarget(req, env = process.env) {
  const origin = getOrigin(env);
  const upstream = first(req.query?.upstream) || '/';
  if (typeof upstream !== 'string' || !upstream.startsWith('/') || upstream.startsWith('//')) {
    throw new Error('Invalid upstream path.');
  }
  const url = new URL(upstream, origin);
  appendQuery(url, req.query || {});
  return url;
}

export function buildHeaders(req, env = process.env) {
  const headers = new Headers();
  for (const name of ['accept', 'accept-language', 'content-type', 'if-none-match', 'if-modified-since', 'range', 'user-agent']) {
    const value = req.headers?.[name];
    if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
  }
  const bypass = env.VERCEL_AUTOMATION_BYPASS_SECRET || env.RC2_PROTECTION_BYPASS_SECRET;
  if (bypass) {
    headers.set('x-vercel-protection-bypass', bypass);
    headers.set('x-vercel-set-bypass-cookie', 'samesitenone');
  }
  return headers;
}

function bodyFor(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  if (req.body == null) return undefined;
  if (Buffer.isBuffer(req.body) || typeof req.body === 'string') return req.body;
  return JSON.stringify(req.body);
}

function isProtectionRedirect(response) {
  if (![301, 302, 303, 307, 308].includes(response.status)) return false;
  const location = response.headers.get('location') || '';
  return /vercel\.com\/sso-api/i.test(location);
}

function copyResponseHeaders(response, res) {
  const blocked = new Set([
    'content-length', 'content-encoding', 'transfer-encoding', 'connection',
    'x-frame-options', 'content-security-policy', 'set-cookie'
  ]);
  response.headers.forEach((value, key) => {
    if (!blocked.has(key.toLowerCase())) res.setHeader(key, value);
  });
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-rc2-shell', 'SAFE_SIDECAR_ONLY');
}

export default async function handler(req, res) {
  let target;
  try {
    target = buildTarget(req);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok: false, error: 'RC2_ORIGIN_INVALID', message: error.message }));
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method || 'GET',
      headers: buildHeaders(req),
      body: bodyFor(req),
      redirect: 'manual'
    });
  } catch (error) {
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok: false, error: 'RC2_ORIGIN_FETCH_FAILED', message: error.message }));
  }

  if (isProtectionRedirect(upstream)) {
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-rc2-proxy-error', 'PROTECTION_BYPASS_REQUIRED');
    return res.end(JSON.stringify({
      ok: false,
      error: 'RC2_ORIGIN_PROTECTED',
      message: 'Enable Vercel Protection Bypass for Automation. The shell will use VERCEL_AUTOMATION_BYPASS_SECRET automatically.'
    }));
  }

  copyResponseHeaders(upstream, res);
  res.statusCode = upstream.status;
  if (req.method === 'HEAD' || upstream.status === 204 || upstream.status === 304) return res.end();
  const bytes = Buffer.from(await upstream.arrayBuffer());
  return res.end(bytes);
}
