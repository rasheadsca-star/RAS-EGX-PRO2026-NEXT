import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { LsegProvider } from './infrastructure/lseg-provider.mjs';
import { RecommendationLedger } from './infrastructure/ledger.mjs';
import { MarketService } from './services/market-service.mjs';
import { DataUnavailableError } from './infrastructure/errors.mjs';
import { WEIGHTS } from './domain/indicators.mjs';
import { DISCLAIMER } from './domain/decision.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function serveFile(res, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
  fs.createReadStream(filePath).pipe(res);
}

export function createAppServer({ service }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    try {
      if (req.method === 'GET' && url.pathname === '/api/status') {
        return sendJson(res, 200, {
          ...service.status(),
          disclaimer: DISCLAIMER,
          methodologyWeights: WEIGHTS,
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/methodology') {
        return sendJson(res, 200, {
          weights: WEIGHTS,
          thresholds: { buy: 35, sell: -35 },
          backtestMinimum: {
            years: config.risk.minBacktestYears,
            directionalTrades: config.risk.minBacktestTrades,
          },
          confidenceInterval: 'Wilson 95%',
          fundamentalsPolicy: 'Medium/long classifications are blocked without verified same-source fundamentals.',
          disclaimer: DISCLAIMER,
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/ledger') {
        return sendJson(res, 200, { entries: service.ledgerEntries() });
      }

      if (req.method === 'POST' && url.pathname === '/api/analysis') {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 32_000) throw new DataUnavailableError('REQUEST_TOO_LARGE');
        }
        const input = JSON.parse(body || '{}');
        const result = await service.analyze({ ric: input.ric, horizon: input.horizon || 'short' });
        return sendJson(res, 200, result);
      }

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        return serveFile(res, path.join(publicDir, 'index.html'), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/app.js') {
        return serveFile(res, path.join(publicDir, 'app.js'), 'text/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/styles.css') {
        return serveFile(res, path.join(publicDir, 'styles.css'), 'text/css; charset=utf-8');
      }

      sendJson(res, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      if (error instanceof SyntaxError) {
        return sendJson(res, 400, { error: 'INVALID_JSON', failClosed: true });
      }
      if (error instanceof DataUnavailableError) {
        return sendJson(res, 409, {
          error: error.code,
          message: error.message,
          details: error.details,
          status: 'BLOCKED_FAIL_CLOSED',
          decision: 'NO_RECOMMENDATION',
          failClosed: true,
        });
      }
      return sendJson(res, 500, {
        error: 'INTERNAL_FAIL_CLOSED',
        status: 'BLOCKED_FAIL_CLOSED',
        decision: 'NO_RECOMMENDATION',
        failClosed: true,
      });
    }
  });
}

export function buildDefaultService() {
  const provider = new LsegProvider({ config: config.provider });
  const ledger = new RecommendationLedger(config.ledgerPath);
  return new MarketService({ provider, ledger, risk: config.risk });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const service = buildDefaultService();
  const server = createAppServer({ service });
  server.listen(config.port, () => {
    console.log(`EGX Audit Core listening on http://localhost:${config.port}`);
  });
}
