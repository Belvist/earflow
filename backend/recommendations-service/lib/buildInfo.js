const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function safeReadFile(filePath) {
    try {
        return fs.readFileSync(filePath);
    } catch {
        return null;
    }
}

function loadPackageVersion() {
    try {
        const packageJsonPath = path.join(__dirname, '..', 'package.json');
        const raw = fs.readFileSync(packageJsonPath, 'utf8');
        const parsed = JSON.parse(raw);
        return typeof parsed.version === 'string' && parsed.version ? parsed.version : '0.0.0';
    } catch {
        return '0.0.0';
    }
}

function computeBuildId() {
    const version = loadPackageVersion();
    const sourceVersion = [
        process.env.SOURCE_VERSION,
        process.env.GIT_SHA,
        process.env.GITHUB_SHA,
        process.env.VERCEL_GIT_COMMIT_SHA,
    ].find((v) => typeof v === 'string' && v.length >= 7) || '';

    const serverFile = path.join(__dirname, '..', 'server.js');
    const routesHealthFile = path.join(__dirname, '..', 'routes', 'health.js');
    const recoEngineV2File = path.join(__dirname, '..', 'services', 'engineV2', 'index.js');
    const recoRoutesFile = path.join(__dirname, '..', 'routes', 'recommendations.js');

    const serverBytes = safeReadFile(serverFile) || Buffer.from('');
    const routesHealthBytes = safeReadFile(routesHealthFile) || Buffer.from('');
    const recoEngineV2Bytes = safeReadFile(recoEngineV2File) || Buffer.from('');
    const recoRoutesBytes = safeReadFile(recoRoutesFile) || Buffer.from('');

    const hasher = crypto.createHash('sha256');
    hasher.update(version);
    hasher.update('|');
    hasher.update(sourceVersion);
    hasher.update('|');
    hasher.update(serverBytes);
    hasher.update('|');
    hasher.update(routesHealthBytes);
    hasher.update('|');
    hasher.update(recoEngineV2Bytes);
    hasher.update('|');
    hasher.update(recoRoutesBytes);
    return hasher.digest('hex').slice(0, 16);
}

function getBuildInfo() {
    const version = loadPackageVersion();
    const buildId = computeBuildId();

    return {
        version,
        buildId,
        node: process.version,
    };
}

module.exports = {
    getBuildInfo,
};
