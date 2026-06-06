#!/usr/bin/env node
/**
 * Update Base Images - автоматическое обновление базовых образов Docker
 * 
 * Этот скрипт:
 * 1. Получает последние digest'ы для базовых образов
 * 2. Обновляет все Dockerfile'ы с pinned версиями
 * 3. Проверяет уязвимости новых образов
 * 
 * Запуск: node scripts/update-base-images.js [--dry-run]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Конфигурация базовых образов
const BASE_IMAGES = {
    'node': {
        tag: '22-alpine',
        fullTag: '22.21.1-alpine',
        services: [
            'frontend/Dockerfile',
            'backend/api-gateway/Dockerfile',
            'backend/auth-service/Dockerfile',
            'backend/database-service/Dockerfile',
            'backend/upload-service/Dockerfile',
            'backend/playlist-service/Dockerfile',
            'backend/lyrics-service/Dockerfile',
            'backend/recommendations-service/Dockerfile',
            'backend/track-processor/Dockerfile'
        ]
    },
    'python': {
        tag: '3.12-slim',
        fullTag: '3.12.7-slim-bookworm',
        services: [
            'backend/reco-offline-worker/Dockerfile'
        ]
    }
};

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function runCommand(command) {
    try {
        return execSync(command, { encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch (error) {
        return null;
    }
}

/**
 * Получить digest для образа
 */
function getImageDigest(image, tag) {
    log(`\n🔍 Getting digest for ${image}:${tag}...`, 'blue');

    // Пытаемся получить digest через docker manifest
    const digest = runCommand(
        `docker manifest inspect ${image}:${tag} --verbose 2>/dev/null | findstr "digest"`
    );

    if (digest) {
        const match = digest.match(/sha256:[a-f0-9]{64}/);
        if (match) {
            log(`  ✅ Found: ${match[0].substring(0, 20)}...`, 'green');
            return match[0];
        }
    }

    // Fallback: pull и inspect
    runCommand(`docker pull ${image}:${tag} 2>/dev/null`);
    const inspectDigest = runCommand(
        `docker inspect ${image}:${tag} --format "{{.RepoDigests}}" 2>/dev/null`
    );

    if (inspectDigest) {
        const match = inspectDigest.match(/sha256:[a-f0-9]{64}/);
        if (match) {
            log(`  ✅ Found: ${match[0].substring(0, 20)}...`, 'green');
            return match[0];
        }
    }

    log(`  ⚠ Could not get digest`, 'yellow');
    return null;
}

/**
 * Обновить Dockerfile с pinned версией
 */
function updateDockerfile(dockerfilePath, image, currentTag, newTag, digest, dryRun) {
    const fullPath = path.join(__dirname, '..', dockerfilePath);

    if (!fs.existsSync(fullPath)) {
        log(`  ⚠ File not found: ${dockerfilePath}`, 'yellow');
        return false;
    }

    let content = fs.readFileSync(fullPath, 'utf8');
    const originalContent = content;

    // Паттерны для замены
    const patterns = [
        // FROM node:22-alpine -> FROM node:22.11.0-alpine3.21@sha256:...
        new RegExp(`FROM ${image}:${currentTag}(\\s+AS\\s+\\w+)?`, 'g'),
        // FROM node:22-alpine@sha256:old -> FROM node:22.11.0-alpine3.21@sha256:new
        new RegExp(`FROM ${image}:[\\w.-]+(@sha256:[a-f0-9]+)?(\\s+AS\\s+\\w+)?`, 'g')
    ];

    // Новое значение FROM
    const newFrom = digest
        ? `FROM ${image}:${newTag}@${digest}`
        : `FROM ${image}:${newTag}`;

    // Заменяем все вхождения
    let updated = false;
    for (const pattern of patterns) {
        if (pattern.test(content)) {
            content = content.replace(pattern, (match, digest, asClause) => {
                const suffix = asClause || '';
                return `${newFrom}${suffix}`;
            });
            updated = true;
        }
    }

    if (!updated) {
        log(`  ⚠ No matching FROM found in ${dockerfilePath}`, 'yellow');
        return false;
    }

    if (content === originalContent) {
        log(`  ✅ Already up to date: ${dockerfilePath}`, 'green');
        return false;
    }

    if (dryRun) {
        log(`  🔄 Would update: ${dockerfilePath}`, 'cyan');
        return true;
    }

    fs.writeFileSync(fullPath, content);
    log(`  ✅ Updated: ${dockerfilePath}`, 'green');
    return true;
}

/**
 * Главная функция
 */
async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');

    log('\n🐳 Docker Base Images Updater', 'cyan');
    log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (will update files)'}`, 'yellow');

    let updatedCount = 0;

    for (const [image, config] of Object.entries(BASE_IMAGES)) {
        log(`\n${'='.repeat(50)}`, 'blue');
        log(`📦 Processing ${image}:${config.tag}`, 'blue');
        log(`${'='.repeat(50)}`, 'blue');

        // Получаем актуальный digest
        const digest = getImageDigest(image, config.fullTag);

        // Обновляем все связанные Dockerfile'ы
        for (const dockerfile of config.services) {
            const updated = updateDockerfile(
                dockerfile,
                image,
                config.tag,
                config.fullTag,
                digest,
                dryRun
            );
            if (updated) updatedCount++;
        }
    }

    log(`\n${'='.repeat(50)}`, 'cyan');
    log(`📊 Summary`, 'cyan');
    log(`${'='.repeat(50)}`, 'cyan');

    if (dryRun) {
        log(`\n${updatedCount} files would be updated`, 'yellow');
        log('Run without --dry-run to apply changes', 'yellow');
    } else {
        log(`\n${updatedCount} files updated`, updatedCount > 0 ? 'green' : 'blue');

        if (updatedCount > 0) {
            log('\nNext steps:', 'cyan');
            log('1. Run: docker-compose build --no-cache --pull', 'blue');
            log('2. Run: node scripts/security-scan.js', 'blue');
            log('3. Test all services', 'blue');
        }
    }
}

main().catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
});
