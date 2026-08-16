import test from 'node:test';
import assert from 'node:assert/strict';
import { LsegProvider, parseLsegTable } from '../src/infrastructure/lseg-provider.mjs';
import { DataUnavailableError } from '../src/infrastructure/errors.mjs';

const sample = [{
  headers: [
    { name: 'DATE' }, { name: 'OPEN_PRC' }, { name: 'HIGH_1' },
    { name: 'LOW_1' }, { name: 'TRDPRC_1' }, { name: 'ACVOL_UNS' },
  ],
  data: [
    ['2026-08-13T00:00:00Z', 10, 11, 9.5, 10.5, 1000],
    ['2026-08-14T00:00:00Z', 10.5, 11.2, 10.1, 11, 1200],
  ],
}];

test('LSEG table parser maps official tabular response and sorts dates', () => {
  const rows = parseLsegTable(sample);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], {
    date: '2026-08-14', open: 10.5, high: 11.2, low: 10.1, close: 11, volume: 1200,
  });
});

test('provider performs OAuth then one licensed historical pricing request', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/auth/oauth2/v2/token')) {
      return new Response(JSON.stringify({ access_token: 'token', expires_in: 300 }), { status: 200 });
    }
    return new Response(JSON.stringify(sample), { status: 200 });
  };

  const provider = new LsegProvider({
    config: {
      baseUrl: 'https://api.refinitiv.com',
      tokenUrl: 'https://api.refinitiv.com/auth/oauth2/v2/token',
      clientId: 'client',
      clientSecret: 'secret',
      scope: 'trapi',
    },
    fetchImpl,
    now: () => new Date('2026-08-14T18:00:00Z'),
  });

  const result = await provider.getHistory('TEST.CA', { start: '2026-08-01', end: '2026-08-14' });
  assert.equal(calls.length, 2);
  assert.equal(result.metadata.provider, 'LSEG Data Platform');
  assert.equal(result.metadata.asOf, '2026-08-14');
  assert.match(calls[1].options.headers.authorization, /^Bearer /);
});

test('missing licensed credentials fails closed with no fallback', async () => {
  const provider = new LsegProvider({
    config: { baseUrl: 'https://api.refinitiv.com', tokenUrl: 'x', clientId: '', clientSecret: '', scope: 'trapi' },
    fetchImpl: async () => { throw new Error('must not be called'); },
  });
  await assert.rejects(() => provider.getHistory('TEST.CA'), (error) => {
    assert.ok(error instanceof DataUnavailableError);
    assert.equal(error.code, 'LICENSED_PROVIDER_NOT_CONFIGURED');
    return true;
  });
});
