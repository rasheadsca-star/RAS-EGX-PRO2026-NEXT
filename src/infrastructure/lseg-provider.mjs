import { DataUnavailableError } from './errors.mjs';

const REQUIRED_FIELDS = ['DATE'];

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseLsegTable(payload) {
  const table = Array.isArray(payload)
    ? payload[0]
    : (Array.isArray(payload?.data) && payload.data[0]?.headers ? payload.data[0] : payload);

  if (!table || !Array.isArray(table.headers) || !Array.isArray(table.data)) {
    throw new DataUnavailableError('LSEG_SCHEMA_INVALID', 'Unexpected LSEG tabular response');
  }

  const headers = table.headers.map((header) => typeof header === 'string' ? header : header?.name);
  for (const required of REQUIRED_FIELDS) {
    if (!headers.includes(required)) {
      throw new DataUnavailableError('LSEG_SCHEMA_INVALID', `Missing field: ${required}`);
    }
  }

  const closeField = ['TRDPRC_1', 'MID_PRICE', 'CLOSE'].find((name) => headers.includes(name));
  if (!closeField) {
    throw new DataUnavailableError('LSEG_SCHEMA_INVALID', 'No supported close-price field');
  }

  const index = Object.fromEntries(headers.map((name, i) => [name, i]));
  const rows = table.data.map((row) => {
    if (!Array.isArray(row)) throw new DataUnavailableError('LSEG_SCHEMA_INVALID', 'Non-tabular row');
    const date = String(row[index.DATE] ?? '').slice(0, 10);
    const close = finiteOrNull(row[index[closeField]]);
    const open = index.OPEN_PRC === undefined ? close : finiteOrNull(row[index.OPEN_PRC]);
    const high = index.HIGH_1 === undefined ? close : finiteOrNull(row[index.HIGH_1]);
    const low = index.LOW_1 === undefined ? close : finiteOrNull(row[index.LOW_1]);
    const volumeIndex = index.ACVOL_UNS ?? index.TRNOVR_UNS;
    const volume = volumeIndex === undefined ? null : finiteOrNull(row[volumeIndex]);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) {
      throw new DataUnavailableError('LSEG_DATA_INVALID', 'Invalid required price/date value');
    }
    if (![open, high, low].every((value) => Number.isFinite(value) && value > 0)) {
      throw new DataUnavailableError('LSEG_DATA_INVALID', 'Invalid OHLC value');
    }

    return { date, open, high, low, close, volume };
  });

  rows.sort((a, b) => a.date.localeCompare(b.date));
  const unique = [];
  for (const row of rows) {
    if (unique.at(-1)?.date === row.date) unique[unique.length - 1] = row;
    else unique.push(row);
  }
  return unique;
}

export class LsegProvider {
  constructor({ config, fetchImpl = globalThis.fetch, now = () => new Date() }) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.cachedToken = null;
  }

  isConfigured() {
    return Boolean(this.config.clientId && this.config.clientSecret);
  }

  async accessToken() {
    if (!this.isConfigured()) {
      throw new DataUnavailableError(
        'LICENSED_PROVIDER_NOT_CONFIGURED',
        'LSEG credentials are not configured; no fallback source is permitted.',
      );
    }

    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 30_000) {
      return this.cachedToken.value;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: this.config.scope || 'trapi',
    });

    let response;
    try {
      response = await this.fetchImpl(this.config.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new DataUnavailableError('LSEG_AUTH_NETWORK_FAILURE', error.message);
    }

    if (!response.ok) {
      throw new DataUnavailableError('LSEG_AUTH_REJECTED', `LSEG token request returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (!payload.access_token) {
      throw new DataUnavailableError('LSEG_AUTH_SCHEMA_INVALID', 'LSEG token response missing access_token');
    }

    const expiresIn = Number(payload.expires_in || 300);
    this.cachedToken = {
      value: payload.access_token,
      expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
    };
    return this.cachedToken.value;
  }

  async getHistory(ric, { start, end, count = 10000 } = {}) {
    if (!/^[A-Za-z0-9.=^_-]{1,40}$/.test(String(ric || ''))) {
      throw new DataUnavailableError('INVALID_RIC', 'Instrument must be an explicit LSEG RIC.');
    }

    const token = await this.accessToken();
    const base = this.config.baseUrl.replace(/\/$/, '');
    const url = new URL(`${base}/data/historical-pricing/v1/views/interday-summaries/${encodeURIComponent(ric)}`);
    url.searchParams.set('interval', 'P1D');
    url.searchParams.set('count', String(count));
    url.searchParams.set('fields', 'DATE,OPEN_PRC,HIGH_1,LOW_1,TRDPRC_1,ACVOL_UNS');
    url.searchParams.set('adjustments', 'exchangeCorrection,manualCorrection,CCH,CRE,RTS,RPO');
    if (start) url.searchParams.set('start', start);
    if (end) url.searchParams.set('end', end);

    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new DataUnavailableError('LSEG_DATA_NETWORK_FAILURE', error.message);
    }

    if (!response.ok) {
      throw new DataUnavailableError('LSEG_DATA_REJECTED', `LSEG historical-pricing returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    const history = parseLsegTable(payload);
    if (!history.length) {
      throw new DataUnavailableError('LSEG_EMPTY_HISTORY', 'LSEG returned no daily history.');
    }

    const receivedAt = this.now().toISOString();
    return {
      history,
      metadata: {
        provider: 'LSEG Data Platform',
        licenceClass: 'LICENSED',
        mode: 'LICENSED_EOD',
        instrument: ric,
        asOf: history.at(-1).date,
        receivedAt,
        endpoint: '/data/historical-pricing/v1/views/interday-summaries/{RIC}',
      },
    };
  }
}
