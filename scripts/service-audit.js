#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const backendDir = path.join(root, 'backend');
const strict = process.argv.includes('--strict');

const codeExts = new Set(['.go', '.js', '.ts', '.py']);
const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__']);
const skipBackendServices = new Set(['integration-tests']);

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${path.relative(root, file)} is not valid JSON: ${err.message}`);
  }
}

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function auditBackendService(serviceName) {
  const serviceDir = path.join(backendDir, serviceName);
  const files = walkFiles(serviceDir);
  const packagePath = path.join(serviceDir, 'package.json');
  const goModPath = path.join(serviceDir, 'go.mod');
  const requirementsPath = path.join(serviceDir, 'requirements.txt');
  const dockerfilePath = path.join(serviceDir, 'Dockerfile');
  const hasPackage = exists(packagePath);
  const hasGoMod = exists(goModPath);
  const hasRequirements = exists(requirementsPath);
  const manifests = [hasPackage, hasGoMod, hasRequirements].filter(Boolean).length;
  const codeFiles = files.filter((f) => codeExts.has(path.extname(f)));
  const healthHits = codeFiles.filter((f) => {
    const body = fs.readFileSync(f, 'utf8');
    return body.includes('/health') || body.includes('healthz');
  });
  const metricsHits = codeFiles.filter((f) => {
    const body = fs.readFileSync(f, 'utf8').toLowerCase();
    return body.includes('/metrics') || body.includes('prometheus');
  });

  const errors = [];
  const warnings = [];

  if (!exists(dockerfilePath)) {
    errors.push('missing Dockerfile');
  }
  if (manifests === 0) {
    errors.push('missing runtime manifest (package.json, go.mod, or requirements.txt)');
  }
  if (manifests > 1) {
    warnings.push('multiple runtime manifests present');
  }
  if (codeFiles.length === 0) {
    errors.push('no source files found');
  }

  if (hasPackage) {
    const pkg = readJSON(packagePath);
    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
    const hasStart = typeof scripts.start === 'string' && scripts.start.trim() !== '';
    const hasTest = typeof scripts.test === 'string' && scripts.test.trim() !== '';
    if (!hasStart && !(skipBackendServices.has(serviceName) && hasTest)) {
      errors.push('package.json missing start script');
    }
  }
  if (hasGoMod && !exists(path.join(serviceDir, 'go.sum')) && serviceName !== 'ranking-service') {
    warnings.push('go.sum missing');
  }
  if (hasRequirements) {
    const raw = fs.readFileSync(requirementsPath, 'utf8').trim();
    if (raw === '') {
      errors.push('requirements.txt is empty');
    }
  }
  if (healthHits.length === 0 && !skipBackendServices.has(serviceName)) {
    warnings.push('no /health implementation found');
  }
  if (metricsHits.length === 0 && !skipBackendServices.has(serviceName)) {
    warnings.push('no /metrics or Prometheus instrumentation found');
  }

  return {
    service: serviceName,
    files: files.length,
    codeFiles: codeFiles.length,
    kind: hasGoMod ? 'go' : hasPackage ? 'node' : hasRequirements ? 'python' : 'unknown',
    hasDockerfile: exists(dockerfilePath),
    hasHealth: healthHits.length > 0,
    hasMetrics: metricsHits.length > 0,
    errors,
    warnings,
  };
}

function main() {
  if (!exists(backendDir)) {
    throw new Error('backend directory not found');
  }

  const services = fs.readdirSync(backendDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const rows = services.map(auditBackendService);
  const failures = rows.filter((row) => row.errors.length > 0);

  console.log('Service inventory audit');
  console.table(rows.map((row) => ({
    service: row.service,
    kind: row.kind,
    codeFiles: row.codeFiles,
    docker: row.hasDockerfile,
    health: row.hasHealth,
    metrics: row.hasMetrics,
    errors: row.errors.length,
    warnings: row.warnings.length,
  })));

  for (const row of rows) {
    if (row.errors.length === 0 && row.warnings.length === 0) continue;
    console.log(`\n${row.service}`);
    for (const err of row.errors) console.log(`  ERROR ${err}`);
    for (const warn of row.warnings) console.log(`  WARN  ${warn}`);
  }

  if (strict && failures.length > 0) {
    console.error(`\nService audit failed: ${failures.length} service(s) have blocking errors.`);
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
}
