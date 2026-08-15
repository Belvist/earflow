#!/usr/bin/env node
'use strict';

const fs = require('fs');

const DEFAULT_SCALABLE_SERVICES = [
  'api-gateway',
  'artist-api-gateway',
  'frontend',
  'artist-frontend',
  'auth-core',
  'database-service',
  'search-service',
  'artist-service',
  'artist-portal-service',
  'security-service',
  'recommendations-service',
  'ranking-service',
  'playlist-service',
  'lyrics-service',
  'subscription-service',
  'device-sync-service',
  'party-gateway-service',
  'direct-stream-service',
  'ebap-hls-adapter',
  'upload-service',
  'reco-feedback-worker-go',
  'transcode-worker',
  'ebap-encoder-worker',
  'ebap-hls-packager-worker',
  'metadata-parser-service',
  'import-service',
];

const DEFAULT_REMOVE_PUBLISHED_PORTS = [
  'ebap-hls-adapter',
];

function parseCSV(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const opts = {
    services: parseCSV(process.env.SCALE_SERVICES).length > 0
      ? parseCSV(process.env.SCALE_SERVICES)
      : DEFAULT_SCALABLE_SERVICES,
    removePublishedPorts: parseCSV(process.env.SCALE_REMOVE_PUBLISHED_PORTS).length > 0
      ? parseCSV(process.env.SCALE_REMOVE_PUBLISHED_PORTS)
      : DEFAULT_REMOVE_PUBLISHED_PORTS,
  };

  for (const arg of argv) {
    if (arg.startsWith('--services=')) {
      opts.services = parseCSV(arg.slice('--services='.length));
    } else if (arg.startsWith('--remove-published-ports=')) {
      opts.removePublishedPorts = parseCSV(arg.slice('--remove-published-ports='.length));
    } else if (arg === '--keep-published-ports') {
      opts.removePublishedPorts = [];
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return opts;
}

function printHelp() {
  console.log(`Usage:
  docker compose config --format json | node scripts/render-scalable-compose.js > docker-compose.scalable.generated.json

Options:
  --services=a,b,c
      Comma-separated services whose fixed container_name must be removed.

  --remove-published-ports=a,b,c
      Remove host-published ports from these scalable services and keep their target ports exposed internally.

  --keep-published-ports
      Do not remove any published ports.

Environment:
  SCALE_SERVICES
  SCALE_REMOVE_PUBLISHED_PORTS`);
}

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function targetPortOf(port) {
  if (!port || typeof port !== 'object') return null;
  const target = port.target ?? port.Target;
  if (target === undefined || target === null || target === '') return null;
  return String(target);
}

function exposeTargetPorts(service) {
  const targets = asArray(service.ports)
    .map(targetPortOf)
    .filter(Boolean);
  if (targets.length === 0) return;

  const current = asArray(service.expose).map((v) => String(v));
  const next = new Set(current);
  for (const target of targets) {
    next.add(target);
  }
  service.expose = Array.from(next);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const raw = readStdin().replace(/^\uFEFF/, '');
  const compose = JSON.parse(raw);
  const services = compose.services || {};
  const scalable = new Set(opts.services);
  const removePublishedPorts = new Set(opts.removePublishedPorts);

  const changed = [];
  for (const name of scalable) {
    const service = services[name];
    if (!service) continue;

    if (Object.prototype.hasOwnProperty.call(service, 'container_name')) {
      delete service.container_name;
      changed.push(name);
    }

    if (removePublishedPorts.has(name) && service.ports) {
      exposeTargetPorts(service);
      delete service.ports;
    }
  }

  compose['x-scalable-services'] = opts.services;
  compose['x-scalable-renderer'] = {
    script: 'scripts/render-scalable-compose.js',
    removed_container_name_from: changed,
    removed_published_ports_from: opts.removePublishedPorts,
  };

  process.stdout.write(`${JSON.stringify(compose, null, 2)}\n`);
}

try {
  main();
} catch (err) {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
}
