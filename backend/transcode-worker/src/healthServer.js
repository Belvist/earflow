'use strict';

const http = require('http');

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function startHealthServer({ port, metrics, host = '0.0.0.0' }) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' });
      res.end();
      return;
    }

    if (req.url === '/health') {
      const snapshot = metrics.snapshot();
      sendJson(res, snapshot.ok ? 200 : 503, snapshot);
      return;
    }

    if (req.url === '/metrics') {
      const body = metrics.prometheusText();
      res.writeHead(200, {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  });

  server.on('error', (err) => {
    process.stderr.write(`transcode-worker health server failed: ${err?.message || err}\n`);
    process.exit(1);
  });
  server.listen(port, host);
  return server;
}

function closeHealthServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

module.exports = { startHealthServer, closeHealthServer };
